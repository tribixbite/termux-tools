/**
 * Claude Code Browser Bridge — Content Script
 *
 * Injected into every page. Handles DOM reading, element interaction,
 * accessibility tree generation, and form input for Claude Code tools.
 */

// --- Ref ID tracking ---------------------------------------------------------

/** @type {Map<string, Element>} */
const refMap = new Map();
let refCounter = 0;

function getOrCreateRef(el) {
  for (const [ref, elem] of refMap) {
    if (elem === el) return ref;
  }
  const ref = `ref_${++refCounter}`;
  refMap.set(ref, el);
  return ref;
}

function resolveRef(refId) {
  return refMap.get(refId) || null;
}

// --- Console capture ---------------------------------------------------------

const capturedConsole = [];
const MAX_CONSOLE_MESSAGES = 100;

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
  portReconnectAttempts = 0; // reset on successful connect

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

  const tree = buildAccessibilityTree(root, 0, maxDepth, filter === "interactive");
  let output = serializeTree(tree, 0);

  if (output.length > maxChars) {
    output = output.slice(0, maxChars);
    output += "\n... [TRUNCATED — use depth or ref_id to narrow scope]";
  }

  return { result: output };
}

function buildAccessibilityTree(el, currentDepth, maxDepth, interactiveOnly) {
  if (currentDepth > maxDepth) return null;
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

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
    const childNode = buildAccessibilityTree(child, currentDepth + 1, maxDepth, interactiveOnly);
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
 * Execute JavaScript — limited on Android Edge.
 *
 * Android Edge blocks ALL MAIN-world code execution from extensions:
 * - chrome.scripting.executeScript(world:"MAIN") hangs indefinitely
 * - new Function() / eval() blocked by MV3 extension CSP in isolated world
 * - <script> tag injection from content scripts doesn't execute
 * - blob: URL scripts don't execute either
 *
 * Fallback: handle common DOM property reads directly in the isolated world.
 * Content scripts share the DOM so reads work, but page-level JS variables
 * and functions are NOT accessible.
 *
 * TODO: full javascript_exec requires chrome.debugger API or X11 Chromium
 */
async function javascriptExec(params) {
  const { code } = params;
  const trimmed = code.trim();

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

    return {
      error: "javascript_exec limited on Android Edge — only DOM property reads and " +
        "arithmetic are supported (document.title, getElementById('x').textContent, " +
        "querySelector('sel').value, window.innerWidth, 1+1, etc.). " +
        "Use read_page, find, or form_input tools instead.",
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
  const { x, y, button, clickCount } = params;
  const el = document.elementFromPoint(x, y);
  if (!el) return { error: `No element at (${x}, ${y})` };

  const eventType = button === "right" ? "contextmenu" : "click";
  const mouseButton = button === "right" ? 2 : 0;

  for (let i = 0; i < (clickCount || 1); i++) {
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: x, clientY: y, button: mouseButton, bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y, button: mouseButton, bubbles: true }));
    el.dispatchEvent(new MouseEvent(eventType, { clientX: x, clientY: y, button: mouseButton, bubbles: true }));
  }

  return { result: `Clicked at (${x}, ${y}) on <${el.tagName.toLowerCase()}>` };
}

function typeText(params) {
  const { text } = params;
  const el = document.activeElement || document.body;

  for (const char of text) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.value += char;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
  }

  return { result: `Typed ${text.length} characters` };
}

function keyPress(params) {
  const { keys } = params;
  const el = document.activeElement || document.body;

  for (const key of keys.split(" ")) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  }

  return { result: `Pressed: ${keys}` };
}

function scroll(params) {
  const { x, y } = params;
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
  const { x, y } = params;
  const el = document.elementFromPoint(x, y);
  if (!el) return { error: `No element at (${x}, ${y})` };

  el.dispatchEvent(new MouseEvent("mouseover", { clientX: x, clientY: y, bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseenter", { clientX: x, clientY: y, bubbles: true }));

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

// --- read_console ------------------------------------------------------------

function readConsole(_params) {
  return {
    result: capturedConsole.slice(-50), // last 50 messages
    count: capturedConsole.length,
  };
}
