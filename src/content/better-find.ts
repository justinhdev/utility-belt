import { onSettingsChange } from "../shared/storage";
import { DEFAULT_SETTINGS, FindSettings } from "../shared/types";

const BAR_ID = "utility-belt-find";
const STYLE_ID = "utility-belt-find-styles";
const MARK_CLASS = "utility-belt-find-mark";
const ACTIVE_CLASS = "utility-belt-find-active";
const ACTIVE_OVERLAY_CLASS = "utility-belt-find-active-overlay";
const ACTIVE_OVERLAY_ID = "utility-belt-find-active-overlay-root";
const SHORTCUT_EVENT = "utility-belt:better-find-shortcut";

let settings: FindSettings = DEFAULT_SETTINGS.find;
let bar: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let countLabel: HTMLSpanElement | null = null;
let activeOverlayRoot: HTMLDivElement | null = null;
let matches: HTMLElement[] = [];
let activeIndex = -1;
let lastQuery = "";
let activeOverlayFrame = 0;

function getReadableTextColor(backgroundColor: string): string {
  const normalized = backgroundColor.trim().replace("#", "");

  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
    return "#061512";
  }

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.52 ? "#061512" : "#F4FBFA";
}

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

function ensureStyles(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const matchTextColor = getReadableTextColor(settings.matchColor);
  const activeTextColor = getReadableTextColor(settings.activeColor);
  const rippleIterationCount = settings.endlessRipple ? "infinite" : "1";

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

    #${ACTIVE_OVERLAY_ID} {
      inset: 0;
      pointer-events: none;
      position: fixed;
      z-index: 2147483646;
    }

    .${ACTIVE_OVERLAY_CLASS} {
      animation: utility-belt-ripple 900ms ease-out ${rippleIterationCount};
      border-radius: ${settings.highlightRadius}px;
      box-shadow: 0 0 0 2px ${settings.rippleColor};
      box-sizing: border-box;
      position: fixed;
    }

    .${MARK_CLASS} {
      background: ${settings.matchColor};
      border-radius: ${settings.highlightRadius}px;
      box-decoration-break: clone;
      box-shadow: 0 0 0 ${settings.highlightPaddingX}em ${settings.matchColor};
      color: ${matchTextColor};
      position: relative;
      scroll-margin-block: 96px;
      text-decoration: none;
      z-index: 2147483645;
      -webkit-box-decoration-break: clone;
    }

    .${ACTIVE_CLASS} {
      background: ${settings.activeColor};
      border-radius: ${settings.highlightRadius}px;
      box-shadow: 0 0 0 ${settings.highlightPaddingX}em ${settings.activeColor};
      color: ${activeTextColor};
      outline: none;
    }

    @keyframes utility-belt-ripple {
      0% { box-shadow: 0 0 0 2px ${settings.rippleColor}; }
      100% { box-shadow: 0 0 0 ${settings.rippleSize}px ${settings.rippleColor}00; }
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

function ensureActiveOverlayRoot(): HTMLDivElement {
  if (activeOverlayRoot) {
    return activeOverlayRoot;
  }

  activeOverlayRoot = document.createElement("div");
  activeOverlayRoot.id = ACTIVE_OVERLAY_ID;
  document.documentElement.append(activeOverlayRoot);
  return activeOverlayRoot;
}

function clearActiveOverlay(): void {
  activeOverlayRoot?.replaceChildren();
}

function renderActiveOverlay(): void {
  clearActiveOverlay();

  if (activeIndex < 0) {
    return;
  }

  const active = matches[activeIndex];

  if (!active?.isConnected) {
    return;
  }

  const root = ensureActiveOverlayRoot();
  const rects = Array.from(active.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);

  for (const rect of rects) {
    const overlay = document.createElement("div");
    overlay.className = ACTIVE_OVERLAY_CLASS;
    overlay.style.height = `${rect.height}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    root.append(overlay);
  }
}

function scheduleActiveOverlayRender(): void {
  if (activeOverlayFrame) {
    return;
  }

  activeOverlayFrame = window.requestAnimationFrame(() => {
    activeOverlayFrame = 0;
    renderActiveOverlay();
  });
}

function unwrapExistingMatches(): void {
  clearActiveOverlay();

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
    parent.closest(
      `#${BAR_ID}, #${ACTIVE_OVERLAY_ID}, [aria-hidden="true"], [hidden], script, style, textarea, input, select, [contenteditable="true"]`,
    ) ||
      parent.classList.contains(MARK_CLASS),
  );
}

function isRectClippedByAncestors(rect: DOMRect, startEl: HTMLElement): boolean {
  let el: HTMLElement | null = startEl;

  while (el && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const ox = style.overflowX;
    const oy = style.overflowY;
    const clipsX = ox === "hidden" || ox === "clip" || ox === "scroll" || ox === "auto";
    const clipsY = oy === "hidden" || oy === "clip" || oy === "scroll" || oy === "auto";

    if (clipsX || clipsY) {
      const elRect = el.getBoundingClientRect();
      if (clipsY && (rect.bottom <= elRect.top || rect.top >= elRect.bottom)) {
        return true;
      }
      if (clipsX && (rect.right <= elRect.left || rect.left >= elRect.right)) {
        return true;
      }
    }

    el = el.parentElement;
  }

  return false;
}

function hasVisibleTextRect(node: Text): boolean {
  const parent = node.parentElement;

  if (!parent) {
    return false;
  }

  if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
    return false;
  }

  const range = document.createRange();
  range.selectNodeContents(node);

  try {
    return Array.from(range.getClientRects()).some(
      (rect) => rect.width > 0 && rect.height > 0 && !isRectClippedByAncestors(rect, parent),
    );
  } finally {
    range.detach();
  }
}

function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipNode(node) || !node.textContent?.trim() || !hasVisibleTextRect(node as Text)) {
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
    scheduleActiveOverlayRender();
  } else {
    clearActiveOverlay();
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

function handleFindShortcut(event: KeyboardEvent): void {
  const wantsFind = (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f";

  if (!wantsFind || !settings.enabled) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  const selectedText = window.getSelection()?.toString().trim();
  showBar(isEditable(event.target) ? "" : selectedText ?? "");
}

function handleFindShortcutEvent(event: Event): void {
  if (!settings.enabled) {
    return;
  }

  const detail = event instanceof CustomEvent && typeof event.detail === "object" ? event.detail : undefined;
  const editable = Boolean(detail && "editable" in detail && detail.editable);
  const selectedText =
    detail && "selectedText" in detail && typeof detail.selectedText === "string" ? detail.selectedText : "";

  showBar(editable ? "" : selectedText);
}

const betterFindGlobal = globalThis as typeof globalThis & {
  __utilityBeltBetterFindInstalled?: boolean;
};

if (!betterFindGlobal.__utilityBeltBetterFindInstalled) {
  betterFindGlobal.__utilityBeltBetterFindInstalled = true;

  window.addEventListener("keydown", handleFindShortcut, true);
  window.addEventListener(SHORTCUT_EVENT, handleFindShortcutEvent);

  onSettingsChange((nextSettings) => {
    settings = nextSettings.find;
    ensureStyles();

    if (lastQuery) {
      runSearch(lastQuery);
    } else {
      renderActiveOverlay();
    }
  });

  window.addEventListener("resize", scheduleActiveOverlayRender);
  window.addEventListener("scroll", scheduleActiveOverlayRender, true);

  void chrome.runtime
    .sendMessage({ type: "settings:get" })
    .then((nextSettings) => {
      settings = nextSettings.find;
      ensureStyles();
    })
    .catch(ensureStyles);
}
