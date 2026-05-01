import { onSettingsChange } from "../shared/storage";
import { isRuntimeMessage } from "../shared/messages";
import { DEFAULT_SETTINGS, FindSettings } from "../shared/types";

const BAR_ID = "utility-belt-find";
const STYLE_ID = "utility-belt-find-styles";
const MARK_CLASS = "utility-belt-find-mark";
const ACTIVE_CLASS = "utility-belt-find-active";

let settings: FindSettings = DEFAULT_SETTINGS.find;
let bar: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let countLabel: HTMLSpanElement | null = null;
let matches: HTMLElement[] = [];
let activeIndex = -1;
let lastQuery = "";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function isDisabledForHost(): boolean {
  const host = window.location.hostname;
  return settings.disabledDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function ensureStyles(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.documentElement.append(style);
  }

  style.textContent = `
    #${BAR_ID} {
      align-items: center;
      background: #202124;
      border: 1px solid #3c4043;
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
      color: #f1f3f4;
      display: flex;
      font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 8px;
      padding: 8px;
      position: fixed;
      right: 18px;
      top: 18px;
      width: min(360px, calc(100vw - 36px));
      z-index: 2147483647;
    }

    #${BAR_ID}[hidden] {
      display: none;
    }

    #${BAR_ID} input {
      background: #303134;
      border: 1px solid #5f6368;
      border-radius: 6px;
      color: #f1f3f4;
      flex: 1;
      font: inherit;
      min-width: 0;
      padding: 7px 9px;
      outline: none;
    }

    #${BAR_ID} input:focus {
      border-color: #8ab4f8;
    }

    #${BAR_ID} button {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 6px;
      color: #f1f3f4;
      cursor: pointer;
      display: inline-flex;
      height: 30px;
      justify-content: center;
      padding: 0;
      width: 30px;
    }

    #${BAR_ID} button:hover {
      background: #3c4043;
    }

    #${BAR_ID} span {
      color: #bdc1c6;
      font-size: 12px;
      min-width: 46px;
      text-align: right;
    }

    .${MARK_CLASS} {
      background: ${settings.matchColor};
      color: inherit;
      scroll-margin-block: 96px;
    }

    .${ACTIVE_CLASS} {
      animation: utility-belt-ripple 720ms ease-out;
      background: ${settings.activeColor};
      outline: 2px solid ${settings.rippleColor};
      outline-offset: 2px;
    }

    @keyframes utility-belt-ripple {
      0% { box-shadow: 0 0 0 0 ${settings.rippleColor}80; }
      100% { box-shadow: 0 0 0 14px ${settings.rippleColor}00; }
    }
  `;
}

function createButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function ensureBar(): HTMLDivElement {
  if (bar) {
    return bar;
  }

  ensureStyles();
  bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.hidden = true;

  input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Find";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("input", () => runSearch(input?.value ?? ""));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveActive(event.shiftKey ? -1 : 1);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hideBar();
    }
  });

  countLabel = document.createElement("span");
  countLabel.textContent = "0/0";

  bar.append(
    input,
    createButton("↑", "Previous match", () => moveActive(-1)),
    createButton("↓", "Next match", () => moveActive(1)),
    countLabel,
    createButton("×", "Close find", hideBar),
  );

  document.documentElement.append(bar);
  return bar;
}

function unwrapExistingMatches(): void {
  for (const mark of matches) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }

    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  }

  matches = [];
  activeIndex = -1;
}

function getSearchRoot(): HTMLElement {
  return document.body;
}

function shouldSkipNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }

  return Boolean(
    parent.closest(`#${BAR_ID}, script, style, textarea, input, select, [contenteditable="true"]`) ||
      parent.classList.contains(MARK_CLASS),
  );
}

function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipNode(node) || !node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let node = walker.nextNode();

  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }

  return nodes;
}

function markTextNode(node: Text, query: string): HTMLElement[] {
  const text = node.nodeValue ?? "";
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const fragment = document.createDocumentFragment();
  const found: HTMLElement[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerQuery);

  while (index !== -1) {
    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
    }

    const mark = document.createElement("mark");
    mark.className = MARK_CLASS;
    mark.textContent = text.slice(index, index + query.length);
    fragment.append(mark);
    found.push(mark);
    cursor = index + query.length;
    index = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  node.replaceWith(fragment);
  return found;
}

function runSearch(query: string): void {
  unwrapExistingMatches();
  lastQuery = query;

  if (!query.trim()) {
    updateCount();
    return;
  }

  const root = getSearchRoot();
  matches = collectTextNodes(root).flatMap((node) => markTextNode(node, query));
  activeIndex = matches.length > 0 ? 0 : -1;
  updateActive();
}

function updateActive(): void {
  for (const match of matches) {
    match.classList.remove(ACTIVE_CLASS);
  }

  if (activeIndex >= 0) {
    const active = matches[activeIndex];
    active.classList.add(ACTIVE_CLASS);
    active.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  updateCount();
}

function updateCount(): void {
  if (!countLabel) {
    return;
  }

  countLabel.textContent = matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : "0/0";
}

function moveActive(direction: number): void {
  if (matches.length === 0) {
    return;
  }

  activeIndex = (activeIndex + direction + matches.length) % matches.length;
  updateActive();
}

function showBar(prefill = ""): void {
  if (isDisabledForHost()) {
    return;
  }

  const findBar = ensureBar();
  findBar.hidden = false;
  input?.focus();
  input?.select();

  if (prefill && input) {
    input.value = prefill;
    runSearch(prefill);
  } else if (lastQuery) {
    runSearch(lastQuery);
  }
}

function hideBar(): void {
  if (bar) {
    bar.hidden = true;
  }

  unwrapExistingMatches();
}

document.addEventListener(
  "keydown",
  (event) => {
    const wantsFind = (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f";

    if (!wantsFind || !settings.replaceNativeFind || isDisabledForHost()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const selectedText = window.getSelection()?.toString().trim();
    showBar(isEditable(event.target) ? "" : selectedText ?? "");
  },
  true,
);

onSettingsChange((nextSettings) => {
  settings = nextSettings.find;
  ensureStyles();

  if (lastQuery) {
    runSearch(lastQuery);
  }
});

void chrome.runtime
  .sendMessage({ type: "settings:get" })
  .then((nextSettings) => {
    settings = nextSettings.find;
    ensureStyles();
  })
  .catch(ensureStyles);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  if (message.type === "find:open") {
    showBar();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
