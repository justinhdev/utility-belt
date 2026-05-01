import { onSettingsChange } from "../shared/storage";
import { isRuntimeMessage } from "../shared/messages";

interface BoostedElement {
  context: AudioContext;
  gainNode: GainNode;
  source: MediaElementAudioSourceNode;
}

const boostedElements = new WeakMap<HTMLMediaElement, BoostedElement>();
const boostedElementSet = new Set<HTMLMediaElement>();
let currentGain = 1;
let enabled = true;

function findMediaElements(): HTMLMediaElement[] {
  return Array.from(document.querySelectorAll("audio, video"));
}

function getEffectiveGain(): number {
  return enabled ? currentGain : 1;
}

function shouldBoost(): boolean {
  return getEffectiveGain() > 1;
}

function updateBoostedElements(): void {
  const effectiveGain = getEffectiveGain();

  for (const element of boostedElementSet) {
    const boostedElement = boostedElements.get(element);

    if (!element.isConnected || !boostedElement) {
      boostedElementSet.delete(element);
      continue;
    }

    boostedElement.gainNode.gain.value = effectiveGain;
    void boostedElement.context.resume();
  }
}

function boostElement(element: HTMLMediaElement): void {
  if (boostedElements.has(element)) {
    boostedElements.get(element)!.gainNode.gain.value = getEffectiveGain();
    return;
  }

  if (!shouldBoost()) {
    return;
  }

  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(element);
    const gainNode = context.createGain();

    source.connect(gainNode);
    gainNode.connect(context.destination);
    gainNode.gain.value = getEffectiveGain();
    boostedElements.set(element, { context, gainNode, source });
    boostedElementSet.add(element);

    element.addEventListener("play", () => {
      void context.resume();
    });
  } catch {
    console.info("Utility Belt could not boost this media element because its audio is already routed.");
  }
}

function applyGain(gain: number): void {
  currentGain = Math.max(0, Math.min(gain, 4));
  updateBoostedElements();

  if (!shouldBoost()) {
    return;
  }

  for (const element of findMediaElements()) {
    boostElement(element);
  }
}

function observeMedia(): void {
  const observer = new MutationObserver(() => {
    applyGain(currentGain);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

void chrome.runtime
  .sendMessage({ type: "volume:get-current-gain" })
  .then((state) => {
    enabled = state.enabled;
    currentGain = state.gain;
    applyGain(currentGain);
  })
  .catch(() => {
    applyGain(1);
  });

onSettingsChange((settings) => {
  enabled = settings.volume.enabled;
  applyGain(currentGain);
});

observeMedia();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  if (message.type === "volume:apply-gain") {
    applyGain(message.gain);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
