/**
 * Claude Code Browser Bridge — Content Script
 *
 * Injected into every page. Handles DOM reading, element interaction,
 * accessibility tree generation, and form input for Claude Code tools.
 */

// --- Ref ID tracking ---------------------------------------------------------

/** @type {Map<string, Element>} */
const refMap = new Map();
/** Reverse index: Element → ref string for O(1) lookup (WeakMap avoids memory leaks) */
const refReverseMap = new WeakMap();
let refCounter = 0;

function getOrCreateRef(el) {
  // O(1) reverse lookup instead of O(n) refMap scan
  const existing = refReverseMap.get(el);
  if (existing && refMap.has(existing)) return existing;
  const ref = `ref_${++refCounter}`;
  refMap.set(ref, el);
  refReverseMap.set(el, ref);
  return ref;
}

function resolveRef(refId) {
  const el = refMap.get(refId);
  if (el && !el.isConnected) {
    refMap.delete(refId);
    return null;
  }
  return el || null;
}

/** Prune refs to elements no longer in the DOM (SPA navigations, removed nodes) */
function pruneDeadRefs() {
  for (const [ref, el] of refMap.entries()) {
    if (!el.isConnected) refMap.delete(ref);
  }
}

// --- Console capture ---------------------------------------------------------

const capturedConsole = [];
const MAX_CONSOLE_MESSAGES = 50;

// Intercept console methods
["log", "warn", "error", "info", "debug"].forEach((method) => {
  const original = console[method];
  console[method] = function (...args) {
    capturedConsole.push({
      level: method,
      message: args.map((a) => {
        try { return typeof a === "string" ? a : JSON.stringify(a); }
        catch { return String(a); }
      }).join(" "),
      timestamp: Date.now(),
    });
    if (capturedConsole.length > MAX_CONSOLE_MESSAGES) {
      capturedConsole.shift();
    }
    original.apply(console, args);
  };
});

// --- Message handler ---------------------------------------------------------

// --- Persistent port for reliable messaging on Android Edge ------------------
// chrome.runtime.onMessage + sendResponse is unreliable on Android Edge:
// message ports corrupt after 2-3 calls. Use chrome.runtime.connect for a
// persistent port that stays open across multiple tool calls.

let port = null;
let portReconnectAttempts = 0;

function connectPort() {
  try {
    port = chrome.runtime.connect({ name: "cfc-content" });
  } catch {
    // Extension context invalidated — stop retrying
    return;
  }

  // Reset backoff after connection survives 1s without disconnecting.
  // This handles both initial connect and reconnects after failures.
  const connectTimer = setTimeout(() => {
    portReconnectAttempts = 0;
  }, 1000);

  port.onMessage.addListener((msg) => {
    if (!msg.action || !msg._reqId) return;
    // Decouple from port message handler to avoid blocking
    setTimeout(() => {
      handleAction(msg.action, msg.params || {})
        .then((result) => {
          try { port.postMessage({ _reqId: msg._reqId, result }); } catch {}
        })
        .catch((err) => {
          try { port.postMessage({ _reqId: msg._reqId, result: { error: err.message || String(err) } }); } catch {}
        });
    }, 0);
  });

  port.onDisconnect.addListener(() => {
    clearTimeout(connectTimer); // connection didn't survive — don't reset backoff
    port = null;
    portReconnectAttempts++;
    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 60s
    const delay = Math.min(1000 * Math.pow(2, portReconnectAttempts - 1), 60000);
    setTimeout(() => {
      try { connectPort(); } catch {}
    }, delay);
  });
}
connectPort();

// Keep legacy onMessage as fallback for backward compatibility
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg.action) return;
  setTimeout(() => {
    handleAction(msg.action, msg.params || {})
      .then((result) => { try { sendResponse(result); } catch {} })
      .catch((err) => { try { sendResponse({ error: err.message || String(err) }); } catch {} });
  }, 0);
  return true;
});

async function handleAction(action, params) {
  // Prune DOM refs detached by SPA navigations before tree-building operations
  if (action === "read_page" || action === "find" || action === "get_page_text") {
    pruneDeadRefs();
  }
  switch (action) {
    case "read_page":
      return readPage(params);
    case "find":
      return findElements(params);
    case "form_input":
      return formInput(params);
    case "javascript_exec":
      return javascriptExec(params);
    case "click":
      return simulateClick(params);
    case "type_text":
      return typeText(params);
    case "key_press":
      return keyPress(params);
    case "scroll":
      return scroll(params);
    case "scroll_to":
      return scrollTo(params);
    case "hover":
      return simulateHover(params);
    case "screenshot":
      return takeScreenshot(params);
    case "read_console":
      return readConsole(params);
    case "clear_console":
      return clearConsole();
    case "get_storage":
      return getStorage();
    case "delete_storage_item":
      return deleteStorageItem(params);
    case "get_page_text":
      return getPageText(params);
    case "drag":
      return simulateDrag(params);
    case "get_viewport_dims":
      return { width: window.innerWidth, height: window.innerHeight };
    case "upload_image":
      return uploadImage(params);
    case "zapper_start":
      return zapperStart();
    case "zapper_stop":
      return zapperStop();
    default:
      return { error: `Unknown action: ${action}` };
  }
}

// --- read_page: Accessibility tree -------------------------------------------

function readPage(params) {
  const { filter, depth, ref_id, max_chars } = params;
  const maxDepth = depth || 15;
  const maxChars = max_chars || 50000;

  let root = document.body;
  if (ref_id) {
    const el = resolveRef(ref_id);
    if (!el) return { error: `Element ${ref_id} not found` };
    root = el;
  }

  // Node count limit prevents O(n²) getComputedStyle calls on massive DOMs
  let nodeCount = 0;
  const MAX_NODES = 3000;
  const tree = buildAccessibilityTree(root, 0, maxDepth, filter === "interactive", () => ++nodeCount > MAX_NODES);
  let output = serializeTree(tree, 0);

  if (output.length > maxChars) {
    output = output.slice(0, maxChars);
    output += "\n... [TRUNCATED — use depth or ref_id to narrow scope]";
  }

  return { result: output };
}

function buildAccessibilityTree(el, currentDepth, maxDepth, interactiveOnly, isOverLimit) {
  if (currentDepth > maxDepth) return null;
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  if (isOverLimit && isOverLimit()) return null;

  const tag = el.tagName?.toLowerCase() || "";

  // Skip hidden elements
  if (tag === "script" || tag === "style" || tag === "noscript") return null;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return null;

  const role = el.getAttribute("role") || getImplicitRole(tag);
  const isInteractive = isInteractiveElement(el, tag, role);

  // If filtering for interactive only, skip non-interactive elements (but still traverse children)
  const includeThis = !interactiveOnly || isInteractive;

  const node = {
    ref: includeThis ? getOrCreateRef(el) : null,
    tag,
    role,
    text: getDirectText(el),
    attributes: getRelevantAttributes(el),
    interactive: isInteractive,
    children: [],
  };

  for (const child of el.children) {
    const childNode = buildAccessibilityTree(child, currentDepth + 1, maxDepth, interactiveOnly, isOverLimit);
    if (childNode) {
      node.children.push(childNode);
    }
  }

  // If this node has nothing interesting and no children, skip it
  if (!includeThis && node.children.length === 0) return null;

  // If not included but has children, pass through children (flatten)
  if (!includeThis && node.children.length > 0) {
    // Return a virtual node that just holds children
    return { ...node, passthrough: true };
  }

  return node;
}

function serializeTree(node, indent) {
  if (!node) return "";

  const lines = [];
  const pad = "  ".repeat(indent);

  if (node.passthrough) {
    // Flatten — just serialize children at same indent
    for (const child of node.children) {
      lines.push(serializeTree(child, indent));
    }
    return lines.join("");
  }

  let line = `${pad}[${node.ref || "-"}] <${node.tag}>`;
  if (node.role) line += ` role="${node.role}"`;
  if (node.interactive) line += " (interactive)";

  const attrs = node.attributes;
  if (attrs.id) line += ` id="${attrs.id}"`;
  if (attrs.class) line += ` class="${attrs.class}"`;
  if (attrs.href) line += ` href="${attrs.href}"`;
  if (attrs.src) line += ` src="${attrs.src}"`;
  if (attrs.placeholder) line += ` placeholder="${attrs.placeholder}"`;
  if (attrs.value !== undefined) line += ` value="${attrs.value}"`;
  if (attrs.ariaLabel) line += ` aria-label="${attrs.ariaLabel}"`;
  if (attrs.name) line += ` name="${attrs.name}"`;
  if (attrs.type) line += ` type="${attrs.type}"`;

  if (node.text) {
    const text = node.text.length > 100 ? node.text.slice(0, 100) + "..." : node.text;
    line += ` "${text}"`;
  }

  lines.push(line + "\n");

  for (const child of node.children) {
    lines.push(serializeTree(child, indent + 1));
  }

  return lines.join("");
}

function getImplicitRole(tag) {
  const roleMap = {
    a: "link", button: "button", input: "textbox", select: "combobox",
    textarea: "textbox", img: "img", h1: "heading", h2: "heading",
    h3: "heading", h4: "heading", h5: "heading", h6: "heading",
    nav: "navigation", main: "main", aside: "complementary",
    footer: "contentinfo", header: "banner", form: "form",
    table: "table", ul: "list", ol: "list", li: "listitem",
  };
  return roleMap[tag] || "";
}

function isInteractiveElement(el, tag, role) {
  const interactiveTags = ["a", "button", "input", "select", "textarea", "details", "summary"];
  if (interactiveTags.includes(tag)) return true;
  if (el.hasAttribute("onclick") || el.hasAttribute("tabindex")) return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  const interactiveRoles = ["button", "link", "textbox", "combobox", "checkbox", "radio",
    "slider", "switch", "tab", "menuitem", "option"];
  return interactiveRoles.includes(role);
}

function getDirectText(el) {
  let text = "";
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent;
    }
  }
  return text.trim();
}

function getRelevantAttributes(el) {
  const attrs = {};
  const names = ["id", "class", "href", "src", "name", "type", "value",
    "placeholder", "aria-label", "aria-labelledby", "aria-describedby",
    "title", "alt", "role", "data-testid"];
  for (const name of names) {
    const val = el.getAttribute(name);
    if (val) {
      const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      attrs[key] = val.length > 200 ? val.slice(0, 200) + "..." : val;
    }
  }
  // Get value for form elements
  if ("value" in el && el.value !== undefined) {
    attrs.value = String(el.value).slice(0, 200);
  }
  return attrs;
}

// --- find: Element search ----------------------------------------------------

function findElements(params) {
  const { query } = params;
  const queryLower = query.toLowerCase();
  const results = [];
  const MAX_RESULTS = 20;

  const allElements = document.querySelectorAll("*");

  for (const el of allElements) {
    if (results.length >= MAX_RESULTS) break;

    const tag = el.tagName?.toLowerCase() || "";
    if (tag === "script" || tag === "style" || tag === "noscript") continue;

    const text = (el.textContent || "").toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
    const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
    const title = (el.getAttribute("title") || "").toLowerCase();
    const role = (el.getAttribute("role") || getImplicitRole(tag)).toLowerCase();
    const alt = (el.getAttribute("alt") || "").toLowerCase();
    const name = (el.getAttribute("name") || "").toLowerCase();
    const id = (el.getAttribute("id") || "").toLowerCase();
    const className = (el.getAttribute("class") || "").toLowerCase();

    // Score match quality
    let score = 0;
    if (ariaLabel.includes(queryLower)) score += 10;
    if (placeholder.includes(queryLower)) score += 9;
    if (title.includes(queryLower)) score += 8;
    if (alt.includes(queryLower)) score += 8;
    if (name.includes(queryLower)) score += 7;
    if (id.includes(queryLower)) score += 6;
    if (role.includes(queryLower)) score += 5;
    if (className.includes(queryLower)) score += 3;

    // Direct text match (only the node's own text, not children)
    const directText = getDirectText(el).toLowerCase();
    if (directText.includes(queryLower)) score += 10;

    // Weaker: any child text
    if (score === 0 && text.includes(queryLower)) score += 1;

    if (score > 0) {
      const ref = getOrCreateRef(el);
      const rect = el.getBoundingClientRect();
      results.push({
        ref,
        tag,
        role: el.getAttribute("role") || getImplicitRole(tag),
        text: getDirectText(el).slice(0, 100),
        ariaLabel: el.getAttribute("aria-label") || "",
        coordinates: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
        score,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return {
    result: results,
    totalMatches: results.length,
    ...(results.length >= MAX_RESULTS && { note: "Results limited to 20. Use a more specific query." }),
  };
}

// --- form_input: Set form values ---------------------------------------------

function formInput(params) {
  const { ref, value } = params;
  const el = resolveRef(ref);
  if (!el) return { error: `Element ${ref} not found` };

  const tag = el.tagName?.toLowerCase();

  if (tag === "select") {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { result: `Set select value to "${value}"` };
  }

  if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) {
    el.checked = Boolean(value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { result: `Set ${el.type} to ${el.checked}` };
  }

  if (tag === "input" || tag === "textarea") {
    // Use native input setter to trigger React/Vue state updates
    const nativeInputValueSetter =
      Object.getOwnPropertyDescriptor(
        tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value"
      )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { result: `Set input value to "${String(value).slice(0, 50)}"` };
  }

  // contenteditable
  if (el.getAttribute("contenteditable") === "true") {
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { result: `Set contenteditable value` };
  }

  return { error: `Element ${ref} (${tag}) is not a form input` };
}

// --- javascript_exec ---------------------------------------------------------

/**
 * Primary execution path: script-tag injection + window.postMessage bridge.
 *
 * chrome.tabs.executeScript runs in the ISOLATED world only (MV2), and
 * chrome.scripting.executeScript(world:"MAIN") hangs indefinitely on Android
 * Edge. But appending a <script> element with inline textContent executes
 * synchronously in the page's MAIN world — this is a standard capability of
 * content scripts that share DOM access with the page.
 *
 * Subject to the page's own CSP: pages that disallow inline script execution
 * (strict 'script-src' without 'unsafe-inline') will silently block the
 * injected script. The timeout below converts that silent block into an error.
 *
 * Return values must be structured-clone-able (primitives, plain objects,
 * arrays). DOM nodes, functions, and cyclic structures cannot cross the
 * postMessage boundary.
 *
 * Async code is supported: if the IIFE returns a thenable, we await it.
 */
const MAIN_WORLD_TIMEOUT_MS = 5000;

function executeInMainWorld(code) {
  return new Promise((resolve, reject) => {
    const id = (crypto?.randomUUID && crypto.randomUUID()) ||
      `cfc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let timeoutHandle;

    function cleanup() {
      window.removeEventListener("message", handler);
      clearTimeout(timeoutHandle);
    }

    function handler(event) {
      // Reject cross-origin messages and any message not addressed to us
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== "cfc-main-result" || data.id !== id) return;
      if (settled) return;
      settled = true;
      cleanup();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.result);
    }

    window.addEventListener("message", handler);

    timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(
        `executeInMainWorld timed out after ${MAIN_WORLD_TIMEOUT_MS}ms ` +
        `(page CSP blocking inline script injection, or code hung without returning)`
      ));
    }, MAIN_WORLD_TIMEOUT_MS);

    // Inject the script tag. textContent runs synchronously in MAIN world.
    //
    // Execution semantics: we pass user code to eval() so that a bare
    // expression returns its value (matching the tool's documented contract
    // of "no return needed"). eval runs in the enclosing IIFE's scope, sees
    // page globals (window, document, page-defined vars), and its completion
    // value becomes our result. Promise-returning code is awaited.
    //
    // Build the injected source via string concatenation (NOT a template
    // literal): user code may legitimately contain backticks or ${...}
    // template syntax, which would terminate an outer template literal here
    // at build time. JSON.stringify(code) produces a safely-escaped string
    // literal we can hand to eval().
    //
    // Scripts created via document.createElement("script") + textContent
    // are NOT subject to the </script>-terminator rule that applies to inline
    // HTML script tags, so user code containing </script> strings is safe.
    //
    // CSP: pages with 'unsafe-inline' disallowed block the <script> injection
    // entirely (timeout path). Pages with 'unsafe-eval' disallowed block the
    // eval call specifically and the wrapper's try/catch reports the error.
    const script = document.createElement("script");
    script.textContent =
      "(function() {" +
      "  var __cfc_id = " + JSON.stringify(id) + ";" +
      "  var __cfc_post = function(payload) {" +
      "    try {" +
      "      window.postMessage(Object.assign(" +
      "        { type: 'cfc-main-result', id: __cfc_id }, payload), '*');" +
      "    } catch (e) {" +
      "      window.postMessage({" +
      "        type: 'cfc-main-result', id: __cfc_id," +
      "        error: 'result not structured-clone-able: ' + (e && e.message || e)" +
      "      }, '*');" +
      "    }" +
      "  };" +
      "  try {" +
      "    var __cfc_r = (0, eval)(" + JSON.stringify(code) + ");" +
      "    if (__cfc_r && typeof __cfc_r.then === 'function') {" +
      "      __cfc_r.then(" +
      "        function(v) { __cfc_post({ result: v }); }," +
      "        function(e) { __cfc_post({ error: String(e && e.message || e) }); }" +
      "      );" +
      "    } else {" +
      "      __cfc_post({ result: __cfc_r });" +
      "    }" +
      "  } catch (e) {" +
      "    __cfc_post({ error: String(e && e.message || e) });" +
      "  }" +
      "})();";
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // remove tag immediately — script already ran
  });
}

/**
 * Execute JavaScript in the page's MAIN world.
 *
 * Strategy: try MAIN-world injection first (works on most pages). If that
 * times out (page CSP blocking, hung code) or throws, fall back to the
 * restricted DOM-property evaluator so common simple queries still succeed
 * even on strict-CSP pages.
 */
async function javascriptExec(params) {
  const { code } = params;
  const trimmed = code.trim();

  // 1. Try MAIN world via script-tag injection (works on most pages)
  let mainErrMsg = null;
  try {
    const result = await executeInMainWorld(code);
    return { result: JSON.stringify(result) };
  } catch (mainErr) {
    // CSP blocked inline script, code threw, or timed out. Fall through to
    // DOM-property evaluator so common read patterns still work on strict pages.
    mainErrMsg = mainErr && mainErr.message ? mainErr.message : String(mainErr);
  }

  // 2. DOM-property fallback — restricted expression set, works under any CSP
  try {
    // Pattern: simple global properties
    // document.title, document.URL, document.readyState, location.href, etc.
    if (/^(document\.(title|URL|readyState|domain|referrer|characterSet|contentType|lastModified)|location\.(href|hostname|pathname|search|hash|origin|protocol|port))$/.test(trimmed)) {
      const parts = trimmed.split(".");
      let val = window;
      for (const p of parts) val = val[p];
      return { result: JSON.stringify(val) };
    }

    // Pattern: document.getElementById('x').prop or document.querySelector('sel').prop
    const READABLE_PROPS = "textContent|innerText|innerHTML|outerHTML|value|className|id|tagName|checked|disabled|href|src|alt|title|placeholder|type|name";
    const elPropMatch = trimmed.match(
      new RegExp(`^document\\.(getElementById|querySelector)\\(\\s*['"]([^'"]+)['"]\\s*\\)\\s*\\.\\s*(${READABLE_PROPS})$`)
    );
    if (elPropMatch) {
      const [, method, selector, prop] = elPropMatch;
      const el = method === "getElementById" ? document.getElementById(selector) : document.querySelector(selector);
      if (!el) return { result: "null" };
      return { result: JSON.stringify(el[prop]) };
    }

    // Pattern: document.querySelectorAll('sel').length
    const qsaLenMatch = trimmed.match(/^document\.querySelectorAll\(\s*['"]([^'"]+)['"]\s*\)\.length$/);
    if (qsaLenMatch) {
      return { result: JSON.stringify(document.querySelectorAll(qsaLenMatch[1]).length) };
    }

    // Pattern: document.body.innerText / .innerHTML / .textContent
    const bodyMatch = trimmed.match(/^document\.body\.(innerText|innerHTML|textContent)$/);
    if (bodyMatch) {
      const text = document.body[bodyMatch[1]];
      return { result: JSON.stringify(text.length > 50000 ? text.slice(0, 50000) + "..." : text) };
    }

    // Pattern: window.innerWidth, window.innerHeight, window.scrollX, etc.
    const winMatch = trimmed.match(/^window\.(innerWidth|innerHeight|outerWidth|outerHeight|scrollX|scrollY|devicePixelRatio)$/);
    if (winMatch) {
      return { result: JSON.stringify(window[winMatch[1]]) };
    }

    // Pattern: string literals — 'hello' or "hello"
    const strLitMatch = trimmed.match(/^(['"])(.*)\1$/s);
    if (strLitMatch) {
      return { result: JSON.stringify(strLitMatch[2]) };
    }

    // Pattern: boolean, null, undefined literals
    if (/^(true|false|null|undefined)$/.test(trimmed)) {
      const val = { true: true, false: false, null: null, undefined: undefined }[trimmed];
      return { result: JSON.stringify(val) };
    }

    // Pattern: pure arithmetic — digits, operators, parens, spaces, decimals
    // Safe because no identifiers can appear; parsed without eval()
    if (/^[\d\s+\-*/%().]+$/.test(trimmed) && /\d/.test(trimmed)) {
      const arithResult = safeArithmetic(trimmed);
      if (arithResult !== null) return { result: JSON.stringify(arithResult) };
    }

    // Neither MAIN world nor the fallback patterns matched — surface both.
    return {
      error:
        "javascript_exec: MAIN world unavailable and expression does not match " +
        "the fallback DOM-property evaluator. MAIN world error: " + mainErrMsg + ". " +
        "Fallback supports document.title, getElementById('x').textContent, " +
        "querySelector('sel').value, window.innerWidth, 1+1, and similar reads. " +
        "For complex queries on strict-CSP pages, use read_page, find, or form_input.",
    };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/**
 * Safe arithmetic evaluator — recursive descent parser for basic math.
 * Handles +, -, *, /, %, parentheses, unary minus, decimals.
 * No eval/Function needed — CSP-safe for MV3 extensions.
 * Returns null if expression is malformed.
 */
function safeArithmetic(expr) {
  let pos = 0;
  const ch = () => expr[pos] || "";
  const skip = () => { while (pos < expr.length && expr[pos] === " ") pos++; };

  function parseExpr() {
    let left = parseTerm();
    skip();
    while (ch() === "+" || ch() === "-") {
      const op = ch(); pos++; skip();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
      skip(); // skip spaces before next operator
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    skip();
    while (ch() === "*" || ch() === "/" || ch() === "%") {
      const op = ch(); pos++; skip();
      const right = parseFactor();
      if (op === "*") left *= right;
      else if (op === "/") left /= right;
      else left %= right;
      skip(); // skip spaces before next operator
    }
    return left;
  }

  function parseFactor() {
    skip();
    if (ch() === "(") {
      pos++;
      const val = parseExpr();
      skip();
      if (ch() === ")") pos++;
      return val;
    }
    if (ch() === "-") {
      pos++;
      return -parseFactor();
    }
    let numStr = "";
    while (pos < expr.length && (/\d/.test(ch()) || ch() === ".")) {
      numStr += ch(); pos++;
    }
    if (!numStr) return NaN;
    return parseFloat(numStr);
  }

  try {
    const result = parseExpr();
    skip();
    if (pos < expr.length) return null; // unparsed trailing input
    if (!isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

// --- click, type, key, scroll, hover -----------------------------------------

function simulateClick(params) {
  const { x, y, button, clickCount, ref, modifiers } = params;

  // Resolve target: ref-based click takes priority over coordinate-based
  let el;
  if (ref) {
    el = resolveRef(ref);
    if (!el) return { error: `Element ${ref} not found` };
  } else {
    el = document.elementFromPoint(x, y);
    if (!el) return { error: `No element at (${x}, ${y})` };
  }

  const eventType = button === "right" ? "contextmenu" : "click";
  const mouseButton = button === "right" ? 2 : 0;
  const mods = modifiers || {};

  // Use element center if clicking by ref
  let cx = x, cy = y;
  if (ref && el) {
    const rect = el.getBoundingClientRect();
    cx = rect.x + rect.width / 2;
    cy = rect.y + rect.height / 2;
  }

  for (let i = 0; i < (clickCount || 1); i++) {
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, button: mouseButton, bubbles: true, ...mods }));
    el.dispatchEvent(new MouseEvent("mouseup", { clientX: cx, clientY: cy, button: mouseButton, bubbles: true, ...mods }));
    el.dispatchEvent(new MouseEvent(eventType, { clientX: cx, clientY: cy, button: mouseButton, bubbles: true, ...mods }));
  }

  const tag = el.tagName.toLowerCase();
  return { result: `Clicked at (${Math.round(cx)}, ${Math.round(cy)}) on <${tag}>${ref ? ` (${ref})` : ""}` };
}

function typeText(params) {
  const { text, modifiers } = params;
  const el = document.activeElement || document.body;
  const mods = modifiers || {};

  for (const char of text) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true, ...mods }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true, ...mods }));

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.value += char;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true, ...mods }));
  }

  return { result: `Typed ${text.length} characters` };
}

function keyPress(params) {
  const { keys, modifiers } = params;
  const el = document.activeElement || document.body;
  const mods = modifiers || {};

  for (const key of keys.split(" ")) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...mods }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...mods }));
  }

  return { result: `Pressed: ${keys}` };
}

function scroll(params) {
  const { x, y, direction, amount } = params;

  // If direction is specified, use it (up/down/left/right with amount 1-10, ×100px)
  if (direction) {
    const px = (amount || 3) * 100;
    const scrollMap = {
      up: [0, -px],
      down: [0, px],
      left: [-px, 0],
      right: [px, 0],
    };
    const [sx, sy] = scrollMap[direction] || [0, 0];
    window.scrollBy(sx, sy);
    return { result: `Scrolled ${direction} by ${px}px` };
  }

  // Legacy coordinate-based scroll
  window.scrollBy(x, y);
  return { result: `Scrolled by (${x}, ${y})` };
}

function scrollTo(params) {
  const { ref } = params;
  const el = resolveRef(ref);
  if (!el) return { error: `Element ${ref} not found` };

  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return { result: `Scrolled to ${ref}` };
}

function simulateHover(params) {
  const { x, y, modifiers } = params;
  const el = document.elementFromPoint(x, y);
  if (!el) return { error: `No element at (${x}, ${y})` };
  const mods = modifiers || {};

  el.dispatchEvent(new MouseEvent("mouseover", { clientX: x, clientY: y, bubbles: true, ...mods }));
  el.dispatchEvent(new MouseEvent("mouseenter", { clientX: x, clientY: y, bubbles: true, ...mods }));

  return { result: `Hovering at (${x}, ${y})` };
}

// --- screenshot (fallback) ---------------------------------------------------

async function takeScreenshot(_params) {
  // Without captureVisibleTab, we use a canvas-based approach
  try {
    // Try html2canvas if available
    if (typeof html2canvas === "function") {
      const canvas = await html2canvas(document.body, { scale: 0.5 });
      return { result: canvas.toDataURL("image/png"), type: "image/png" };
    }
  } catch {}

  // Fallback: return page HTML summary
  return {
    result: "Screenshot not available on Android. Page title: " + document.title +
            ", URL: " + location.href +
            ", Body text length: " + document.body.innerText.length,
    note: "captureVisibleTab unavailable on mobile, html2canvas not loaded",
  };
}

// --- clear_console -----------------------------------------------------------

function clearConsole() {
  const count = capturedConsole.length;
  capturedConsole.length = 0;
  return { result: `Console cleared (${count} entries removed)` };
}

// --- get_storage / delete_storage_item ---------------------------------------

function getStorage() {
  const result = { localStorage: [], sessionStorage: [] };
  try {
    for (const [key, value] of Object.entries(localStorage)) {
      result.localStorage.push({
        key,
        value: value.length > 500 ? value.slice(0, 500) + "..." : value,
      });
    }
  } catch (e) {
    result.localStorage = [{ error: e.message || "Access denied" }];
  }
  try {
    for (const [key, value] of Object.entries(sessionStorage)) {
      result.sessionStorage.push({
        key,
        value: value.length > 500 ? value.slice(0, 500) + "..." : value,
      });
    }
  } catch (e) {
    result.sessionStorage = [{ error: e.message || "Access denied" }];
  }
  return { result };
}

function deleteStorageItem(params) {
  const { storageType, key } = params;
  try {
    if (storageType === "local") {
      localStorage.removeItem(key);
      return { result: `Removed '${key}' from localStorage` };
    }
    if (storageType === "session") {
      sessionStorage.removeItem(key);
      return { result: `Removed '${key}' from sessionStorage` };
    }
    return { error: `Unknown storageType: ${storageType}` };
  } catch (e) {
    return { error: e.message || "Storage access denied" };
  }
}

// --- read_console ------------------------------------------------------------

function readConsole(_params) {
  return {
    result: capturedConsole.slice(-50), // last 50 messages
    count: capturedConsole.length,
  };
}

// --- get_page_text -----------------------------------------------------------

function getPageText(params) {
  const { max_chars } = params;
  const limit = max_chars || 100000;
  let text = document.body.innerText || "";
  if (text.length > limit) {
    text = text.slice(0, limit) + "\n... [TRUNCATED at " + limit + " chars]";
  }
  return { result: text };
}

// --- drag (left_click_drag) --------------------------------------------------

function simulateDrag(params) {
  const { startX, startY, endX, endY, modifiers } = params;
  const mods = modifiers || {};

  const startEl = document.elementFromPoint(startX, startY);
  if (!startEl) return { error: `No element at start (${startX}, ${startY})` };

  // Mousedown at start position
  startEl.dispatchEvent(new MouseEvent("mousedown", {
    clientX: startX, clientY: startY, button: 0, bubbles: true, ...mods,
  }));

  // Interpolate mousemove steps for smoother drag
  const steps = 10;
  const dx = (endX - startX) / steps;
  const dy = (endY - startY) / steps;
  for (let i = 1; i <= steps; i++) {
    const mx = startX + dx * i;
    const my = startY + dy * i;
    const moveEl = document.elementFromPoint(mx, my) || startEl;
    moveEl.dispatchEvent(new MouseEvent("mousemove", {
      clientX: mx, clientY: my, button: 0, bubbles: true, ...mods,
    }));
  }

  // Mouseup at end position
  const endEl = document.elementFromPoint(endX, endY) || startEl;
  endEl.dispatchEvent(new MouseEvent("mouseup", {
    clientX: endX, clientY: endY, button: 0, bubbles: true, ...mods,
  }));

  return { result: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})` };
}

// --- upload_image (file input via DataTransfer) ------------------------------

function uploadImage(params) {
  const { ref, x, y, image_data } = params;

  // Resolve target element
  let el;
  if (ref) {
    el = resolveRef(ref);
    if (!el) return { error: `Element ${ref} not found` };
  } else if (x !== undefined && y !== undefined) {
    el = document.elementFromPoint(x, y);
    if (!el) return { error: `No element at (${x}, ${y})` };
  } else {
    return { error: "Must provide ref or coordinate for upload target" };
  }

  if (!image_data) return { error: "Missing image_data (base64)" };

  try {
    // Decode base64 to binary
    const binaryStr = atob(image_data.replace(/^data:image\/\w+;base64,/, ""));
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Create File from binary data
    const blob = new Blob([bytes], { type: "image/png" });
    const file = new File([blob], "upload.png", { type: "image/png" });

    // If target is a file input, set via DataTransfer
    if (el.tagName === "INPUT" && el.type === "file") {
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { result: `Set file input to upload.png (${bytes.length} bytes)` };
    }

    // Otherwise, simulate a drop event
    const dt = new DataTransfer();
    dt.items.add(file);
    const rect = el.getBoundingClientRect();
    const dropX = rect.x + rect.width / 2;
    const dropY = rect.y + rect.height / 2;

    el.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, clientX: dropX, clientY: dropY, bubbles: true }));
    el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, clientX: dropX, clientY: dropY, bubbles: true }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: dropX, clientY: dropY, bubbles: true }));

    return { result: `Dropped image on <${el.tagName.toLowerCase()}> (${bytes.length} bytes)` };
  } catch (err) {
    return { error: `Upload failed: ${err.message}` };
  }
}

// --- Element Zapper ------------------------------------------------------------
// Tap-to-fix mode for client-side overlays, popups, and paywalls where the
// content exists in the DOM but is visually blocked. Started from the popup
// ("Zap Element") via the background's start_zapper handler. Tapping an element
// selects it (with a smart climb to the enclosing fixed-position overlay root
// when one covers most of the viewport). Toolbar: Wider / Remove / Reveal /
// Undo / Done. Two paywall archetypes are handled:
//   • Overlay covers content     → Remove deletes the selected overlay element.
//   • Content obscured in place   → Reveal strips blur/opacity/pointer-events
//     locks page-wide (e.g. mlive applies filter:blur() directly to the article
//     paragraphs, so removing them would delete the content — un-blur instead).
// Removing or revealing also unlocks page scroll (sites set overflow:hidden on
// html/body while gated). Removed nodes stay on an undo stack so a mis-tap is
// recoverable until Done; Reveal is non-destructive.

let zapperState = null;

function zapperStart() {
  if (zapperState) return { result: "Zapper already active" };

  const MAX_Z = 2147483647;
  const state = {
    selected: null,
    undoStack: [],
    unlockStyle: null,
    listeners: [],
  };

  // Highlight box tracking the selected element (pointer-events:none so it
  // never interferes with elementFromPoint or taps)
  const highlight = document.createElement("div");
  highlight.setAttribute("data-cfc-zapper", "");
  highlight.style.cssText =
    "position:fixed;pointer-events:none;z-index:" + MAX_Z + ";display:none;" +
    "background:rgba(248,81,73,0.25);border:2px solid #f85149;border-radius:4px;" +
    "box-sizing:border-box;transition:top 0.08s,left 0.08s,width 0.08s,height 0.08s";

  // Floating toolbar — touch-friendly, fixed to bottom of viewport
  const bar = document.createElement("div");
  bar.setAttribute("data-cfc-zapper", "");
  bar.style.cssText =
    "position:fixed;left:8px;right:8px;bottom:12px;z-index:" + MAX_Z + ";" +
    "background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:12px;" +
    "box-shadow:0 4px 24px rgba(0,0,0,0.6);padding:10px 12px;" +
    "font:13px -apple-system,system-ui,sans-serif;box-sizing:border-box";

  const label = document.createElement("div");
  label.style.cssText =
    "font-family:monospace;font-size:11px;color:#8b949e;margin-bottom:8px;" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  const DEFAULT_HINT = "Tap an overlay to Remove, or Reveal to un-blur content";
  label.textContent = DEFAULT_HINT;

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px";

  function mkBtn(text, bg) {
    const b = document.createElement("button");
    b.setAttribute("data-cfc-zapper", "");
    b.textContent = text;
    b.style.cssText =
      "flex:1;min-height:40px;border:1px solid #30363d;border-radius:8px;" +
      "background:" + (bg || "#21262d") + ";color:#fff;font:600 13px -apple-system,system-ui,sans-serif";
    row.appendChild(b);
    return b;
  }

  const widerBtn = mkBtn("Wider");
  const removeBtn = mkBtn("Remove", "#da3633");
  const revealBtn = mkBtn("Reveal", "#1f6feb");
  const undoBtn = mkBtn("Undo");
  const doneBtn = mkBtn("Done", "#238636");

  bar.appendChild(label);
  bar.appendChild(row);
  document.documentElement.appendChild(highlight);
  document.documentElement.appendChild(bar);
  state.highlight = highlight;
  state.bar = bar;

  function describe(el) {
    let s = "<" + el.tagName.toLowerCase();
    if (el.id) s += " id=" + el.id;
    else if (typeof el.className === "string" && el.className.trim()) {
      s += " ." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    }
    const r = el.getBoundingClientRect();
    return s + "> " + Math.round(r.width) + "×" + Math.round(r.height);
  }

  function refreshUi() {
    if (state.selected && state.selected.isConnected) {
      const r = state.selected.getBoundingClientRect();
      highlight.style.display = "block";
      highlight.style.top = r.top + "px";
      highlight.style.left = r.left + "px";
      highlight.style.width = r.width + "px";
      highlight.style.height = r.height + "px";
      label.textContent = describe(state.selected);
    } else {
      state.selected = null;
      highlight.style.display = "none";
      label.textContent = DEFAULT_HINT;
    }
    removeBtn.style.opacity = state.selected ? "1" : "0.4";
    widerBtn.style.opacity = state.selected ? "1" : "0.4";
    undoBtn.style.opacity = state.undoStack.length ? "1" : "0.4";
  }

  // Prefer the outermost fixed/sticky (or positioned high-z absolute) ancestor
  // when it covers most of the viewport — that's the overlay root sites mount
  // paywalls/modals on. Otherwise keep the exact tapped element.
  function pickOverlayRoot(el) {
    let best = el;
    let cur = el;
    const viewArea = window.innerWidth * window.innerHeight;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const positioned =
        cs.position === "fixed" || cs.position === "sticky" ||
        (cs.position === "absolute" && (parseInt(cs.zIndex, 10) || 0) >= 1);
      if (positioned) {
        const r = cur.getBoundingClientRect();
        if (r.width * r.height >= 0.5 * viewArea) best = cur;
      }
      cur = cur.parentElement;
    }
    return best;
  }

  // While an overlay is up, sites lock scroll with overflow:hidden (and
  // sometimes position:fixed) on html/body — undo that once we zap something.
  function applyScrollUnlock() {
    if (state.unlockStyle) return;
    const st = document.createElement("style");
    st.setAttribute("data-cfc-zapper", "");
    st.textContent =
      "html,body{overflow:auto !important;position:static !important;height:auto !important;}";
    document.documentElement.appendChild(st);
    state.unlockStyle = st;
  }

  function onPointerDown(e) {
    if (e.target && e.target.closest && e.target.closest("[data-cfc-zapper]")) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === document.documentElement || el === document.body) {
      state.selected = null;
    } else {
      state.selected = pickOverlayRoot(el);
    }
    refreshUi();
  }

  // Swallow the rest of the tap gesture so the page never reacts to zap taps
  function swallow(e) {
    if (e.target && e.target.closest && e.target.closest("[data-cfc-zapper]")) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function listen(type, fn, opts) {
    document.addEventListener(type, fn, opts);
    state.listeners.push([type, fn, opts]);
  }

  listen("pointerdown", onPointerDown, { capture: true, passive: false });
  for (const t of ["pointerup", "mousedown", "mouseup", "click", "touchstart", "touchend", "touchmove"]) {
    listen(t, swallow, { capture: true, passive: false });
  }
  const reposition = () => refreshUi();
  listen("scroll", reposition, { capture: true, passive: true });
  window.addEventListener("resize", reposition, { passive: true });
  state.listeners.push(["__window_resize", reposition, null]);

  widerBtn.addEventListener("click", () => {
    const p = state.selected && state.selected.parentElement;
    if (p && p !== document.body && p !== document.documentElement) {
      state.selected = p;
      refreshUi();
    }
  });

  removeBtn.addEventListener("click", () => {
    const el = state.selected;
    if (!el || !el.isConnected) return;
    state.undoStack.push({ el, parent: el.parentNode, next: el.nextSibling });
    el.remove();
    applyScrollUnlock();
    state.selected = null;
    refreshUi();
  });

  // Reveal: for paywalls that obscure the real content in place (blur filter,
  // low opacity, pointer-events/user-select locks) rather than covering it with
  // a removable overlay — the content is in the DOM, so we un-hide it instead of
  // deleting it. Scoped to the selection subtree when one is picked, else the
  // whole page. Non-destructive; a persistent override style prevents re-hiding.
  function revealObscured(scope) {
    const root = scope && scope.isConnected ? scope : document.body;
    // Include the scope itself plus every descendant.
    const els = [root, ...root.querySelectorAll("*")];
    let count = 0;
    for (const el of els) {
      if (el.closest && el.closest("[data-cfc-zapper]")) continue;
      const cs = getComputedStyle(el);
      let changed = false;
      if (cs.filter && cs.filter !== "none" && /blur|grayscale/i.test(cs.filter)) {
        el.style.setProperty("filter", "none", "important");
        el.style.setProperty("-webkit-filter", "none", "important");
        changed = true;
      }
      // Faded-out content (not fully hidden — opacity:0 is usually a real hide).
      const op = parseFloat(cs.opacity);
      if (!isNaN(op) && op > 0 && op < 0.6 && (el.textContent || "").trim().length > 20) {
        el.style.setProperty("opacity", "1", "important");
        changed = true;
      }
      // Reading/selection locks used to discourage copying gated text.
      if (cs.pointerEvents === "none") { el.style.setProperty("pointer-events", "auto", "important"); changed = true; }
      if (cs.userSelect === "none") { el.style.setProperty("user-select", "text", "important"); changed = true; }
      if (el.classList && el.classList.length) {
        for (const c of [...el.classList]) {
          if (/blur|obfuscat|paywall|gated|faded/i.test(c)) { el.classList.remove(c); changed = true; }
        }
      }
      if (changed) count++;
    }
    // Persistent override so classes re-applied by the site's JS can't re-blur.
    if (!state.revealStyle) {
      const st = document.createElement("style");
      st.setAttribute("data-cfc-zapper", "");
      st.textContent =
        '[class*="blur" i],[class*="obfuscat" i],[class*="gated" i],[class*="paywall" i]' +
        "{filter:none !important;-webkit-filter:none !important;opacity:1 !important;}";
      document.documentElement.appendChild(st);
      state.revealStyle = st;
    }
    applyScrollUnlock();
    return count;
  }

  revealBtn.addEventListener("click", () => {
    // These paywalls blur many elements across the article, so default to the
    // whole page. A picked container narrows it only when the user selected one
    // bigger than a single inline/text node.
    const sel = state.selected;
    const scope = sel && sel.querySelectorAll && sel.querySelectorAll("*").length > 3 ? sel : document.body;
    const n = revealObscured(scope);
    label.textContent = "Revealed " + n + " element(s) — content un-blurred";
  });

  undoBtn.addEventListener("click", () => {
    const entry = state.undoStack.pop();
    if (entry && entry.parent) {
      try {
        entry.parent.insertBefore(entry.el, entry.next && entry.next.parentNode === entry.parent ? entry.next : null);
      } catch {}
    }
    if (!state.undoStack.length && state.unlockStyle) {
      state.unlockStyle.remove();
      state.unlockStyle = null;
    }
    refreshUi();
  });

  doneBtn.addEventListener("click", () => zapperStop());

  zapperState = state;
  refreshUi();
  return { result: "Zapper started — Remove overlays, or Reveal to un-blur in-place content" };
}

function zapperStop() {
  const state = zapperState;
  if (!state) return { result: "Zapper not active" };
  for (const [type, fn, opts] of state.listeners) {
    if (type === "__window_resize") window.removeEventListener("resize", fn);
    else document.removeEventListener(type, fn, opts);
  }
  state.bar.remove();
  state.highlight.remove();
  // Removed elements stay removed and the scroll unlock persists — that's the
  // point of zapping. Only the mode UI is torn down.
  zapperState = null;
  return { result: `Zapper stopped (${state.undoStack.length} element(s) removed)` };
}
