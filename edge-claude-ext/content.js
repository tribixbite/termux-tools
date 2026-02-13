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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg.action) return;

  // Use setTimeout(0) to decouple handler from message port —
  // on Android Edge, synchronous DOM event dispatch (clicks, key events)
  // can corrupt the message channel if done inside the listener callback.
  setTimeout(() => {
    handleAction(msg.action, msg.params || {})
      .then((result) => { try { sendResponse(result); } catch {} })
      .catch((err) => { try { sendResponse({ error: err.message || String(err) }); } catch {} });
  }, 0);

  return true; // async response
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
 * Execute arbitrary JS in the page's MAIN world by injecting a <script> tag.
 * MV3 content scripts cannot use new Function() / eval() due to CSP, but
 * they CAN create <script> elements that execute in the page context.
 *
 * Results are communicated back via a CustomEvent on document.
 * window.postMessage does NOT cross MAIN→isolated world on Android Edge,
 * but DOM CustomEvents DO propagate across world boundaries.
 */
async function javascriptExec(params) {
  const { code } = params;
  const callbackId = `__cfc_js_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const eventName = `__cfc_result_${callbackId}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      document.removeEventListener(eventName, handler);
      resolve({ error: "javascript_exec timeout (10s)" });
    }, 10000);

    function handler(event) {
      document.removeEventListener(eventName, handler);
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(event.detail));
      } catch {
        resolve({ error: "Failed to parse result" });
      }
    }
    document.addEventListener(eventName, handler);

    // Inject <script> that runs in MAIN world, captures result, dispatches CustomEvent
    const script = document.createElement("script");
    script.textContent = `
      (async () => {
        const __evName = ${JSON.stringify(eventName)};
        try {
          let __result;
          try {
            __result = await eval(${JSON.stringify(`(async () => { return (${code}); })()`)});
          } catch (__exprErr) {
            __result = await eval(${JSON.stringify(`(async () => { ${code} })()`)});
          }
          const __serialized = typeof __result === "undefined" ? "undefined" : JSON.stringify(__result);
          document.dispatchEvent(new CustomEvent(__evName, { detail: JSON.stringify({ result: __serialized }) }));
        } catch (__err) {
          document.dispatchEvent(new CustomEvent(__evName, { detail: JSON.stringify({ error: __err.message || String(__err) }) }));
        }
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  });
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
