const DEFAULTS = { enabled: true, disabledHosts: [] };

const enabledInput = document.querySelector("#enabled");
const siteInput = document.querySelector("#site");
const siteRow = document.querySelector("#site-row");
const hostLabel = document.querySelector("#host");
const note = document.querySelector("#note");

let host = null;

function showNote(message) {
  note.hidden = !message;
  note.textContent = message || "";
}

async function currentHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") {
      return null;
    }
    return url.hostname || url.origin;
  } catch {
    return null;
  }
}

function paint(data) {
  const disabledHosts = Array.isArray(data.disabledHosts) ? data.disabledHosts : [];
  enabledInput.checked = data.enabled !== false;
  if (!host) {
    siteRow.hidden = true;
    return;
  }
  siteRow.hidden = false;
  hostLabel.textContent = host;
  siteInput.checked = !disabledHosts.includes(host);
  siteInput.disabled = !enabledInput.checked;
}

async function load() {
  host = await currentHost();
  const data = await chrome.storage.local.get(DEFAULTS);
  paint(data);
  if (!host) showNote("Site toggle is available on web pages.");
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: enabledInput.checked });
  const data = await chrome.storage.local.get(DEFAULTS);
  paint(data);
});

siteInput.addEventListener("change", async () => {
  if (!host) return;
  const data = await chrome.storage.local.get(DEFAULTS);
  const disabledHosts = new Set(Array.isArray(data.disabledHosts) ? data.disabledHosts : []);
  if (siteInput.checked) disabledHosts.delete(host);
  else disabledHosts.add(host);
  await chrome.storage.local.set({ disabledHosts: [...disabledHosts] });
});

load();
