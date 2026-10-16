const DEFAULTS = { enabled: true, disabledHosts: [] };

let enabled = true;
let disabledHosts = [];
let sheet = null;
const roots = new Set();
const painted = new Set();
const SKIP_TAGS = new Set([
  "HTML",
  "BODY",
  "IMG",
  "VIDEO",
  "CANVAS",
  "PICTURE",
  "SVG",
  "SOURCE",
  "IFRAME",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "STYLE",
  "SCRIPT",
  "LINK",
  "META",
  "BR",
  "WBR",
]);

function hostnameBlocked() {
  return disabledHosts.includes(location.hostname);
}

function shouldApply() {
  return enabled && !hostnameBlocked();
}

const FALLBACK_CSS = `
:root {
  --pb-canvas: #030303;
  --pb-text: #c0c0c0;
  --pb-frame: #1a1a22;
  --pb-layer-1: #0c0a10;
  --pb-layer-2: #161222;
  --pb-layer-3: #201a30;
  --pb-layer-4: #2a2240;
  background-color: var(--pb-canvas) !important;
  color: var(--pb-text) !important;
  color-scheme: dark !important;
}
html, body { background-color: var(--pb-canvas) !important; color: var(--pb-text) !important; }
html.pb-frame, html.pb-frame body { background-color: var(--pb-frame) !important; }
`;

let cssText = FALLBACK_CSS;

function ensureSheet() {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    fetch(chrome.runtime.getURL("black.css"))
      .then((response) => response.text())
      .then((css) => {
        cssText = css;
        sheet.replaceSync(css);
        const tag = document.getElementById("pure-black-style");
        if (tag) tag.textContent = css;
      })
      .catch(() => {});
  }
  return sheet;
}

function injectStyleTag() {
  let tag = document.getElementById("pure-black-style");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "pure-black-style";
    (document.documentElement || document.head || document).appendChild(tag);
  }
  tag.textContent = cssText;
}

function attach(root) {
  if (!root || !shouldApply()) return;
  if (root === document && window.top !== window) {
    document.documentElement.classList.add("pb-frame");
  }
  const styleSheet = ensureSheet();
  try {
    const current = root.adoptedStyleSheets || [];
    if (!current.includes(styleSheet)) {
      root.adoptedStyleSheets = [...current, styleSheet];
    }
  } catch {
    if (root === document) injectStyleTag();
  }
  roots.add(root);
  if (!root.querySelectorAll) return;
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) attach(element.shadowRoot);
  }
}

function opaqueBackground(color) {
  const match = /rgba?\(([^)]+)\)/.exec(color || "");
  if (!match) return false;
  const parts = match[1].split(",").map((part) => part.trim());
  const alpha = parts.length === 4 ? parseFloat(parts[3]) : 1;
  return alpha > 0.04;
}

/* Layer 1 sits on the canvas. Each painted ancestor pushes a box one layer deeper. */
function layerVariable(element) {
  let depth = 0;
  let node = element.parentElement || element.parentNode?.host;
  while (node) {
    if (painted.has(node)) depth += 1;
    node = node.parentElement || node.parentNode?.host;
  }
  return `var(--pb-layer-${Math.min(depth, 3) + 1})`;
}

function paintElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
  if (painted.has(element) || SKIP_TAGS.has(element.tagName)) return;
  let style;
  try {
    style = getComputedStyle(element);
  } catch {
    return;
  }
  const image = style.backgroundImage;
  if (image && image !== "none" && image.includes("url(")) return;
  const filled = opaqueBackground(style.backgroundColor) || (image && image !== "none");
  if (!filled) return;
  element.style.setProperty("background-color", layerVariable(element), "important");
  element.style.setProperty("background-image", "none", "important");
  painted.add(element);
}

function paintTree(root) {
  if (!root || !shouldApply()) return;
  paintElement(root);
  if (!root.querySelectorAll) return;
  for (const element of root.querySelectorAll("*")) {
    paintElement(element);
    if (element.shadowRoot) {
      attach(element.shadowRoot);
      paintTree(element.shadowRoot);
    }
  }
}

function clearPaint() {
  for (const element of painted) {
    element.style.removeProperty("background-color");
    element.style.removeProperty("background-image");
  }
  painted.clear();
}

function detachAll() {
  clearPaint();
  document.getElementById("pure-black-style")?.remove();
  if (!sheet) {
    roots.clear();
    return;
  }
  for (const root of roots) {
    try {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets].filter((item) => item !== sheet);
    } catch {
      /* Root may already be gone. */
    }
  }
  roots.clear();
}

function sync() {
  if (shouldApply()) {
    attach(document);
    paintTree(document);
  } else {
    detachAll();
  }
}

function scanNode(node) {
  if (!shouldApply() || node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.shadowRoot) attach(node.shadowRoot);
  paintTree(node);
}

let paintQueued = false;

function schedulePaint() {
  if (paintQueued || !shouldApply()) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    if (shouldApply()) paintTree(document);
  });
}

const observer = new MutationObserver((records) => {
  if (!shouldApply()) return;
  for (const record of records) {
    for (const node of record.addedNodes) scanNode(node);
  }
  schedulePaint();
});

const observerOptions = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class", "style"],
};

if (document.documentElement) {
  observer.observe(document.documentElement, observerOptions);
} else {
  document.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.documentElement, observerOptions);
    sync();
  });
}

sync();
document.addEventListener("DOMContentLoaded", sync);
window.addEventListener("load", sync);

chrome.storage.local.get(DEFAULTS, (data) => {
  enabled = data.enabled !== false;
  disabledHosts = Array.isArray(data.disabledHosts) ? data.disabledHosts : [];
  sync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled) enabled = changes.enabled.newValue !== false;
  if (changes.disabledHosts) {
    disabledHosts = Array.isArray(changes.disabledHosts.newValue)
      ? changes.disabledHosts.newValue
      : [];
  }
  sync();
});
