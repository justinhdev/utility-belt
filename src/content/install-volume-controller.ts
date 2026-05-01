import { VolumeApplyResult, VolumeState } from "../shared/types";

interface VolumeController {
  applyState(state: VolumeState): VolumeApplyResult;
}

interface BoostedElement {
  compressor: DynamicsCompressorNode;
  context: AudioContext;
  gainNode: GainNode;
  source: MediaElementAudioSourceNode;
}

export function installVolumeController(initialState: VolumeState): VolumeApplyResult {
  const controllerKey = "__utilityBeltVolumeController";
  const normalizeGain = (value: unknown): number => {
    const gain = typeof value === "number" ? value : Number(value);
    return Number.isFinite(gain) ? Math.max(1, Math.min(gain, 4)) : 1;
  };
  const normalizeState = (nextState: VolumeState): VolumeState => ({
    enabled: nextState.enabled,
    gain: normalizeGain(nextState.gain),
    limiterEnabled: nextState.limiterEnabled,
  });
  const controllerHost = globalThis as typeof globalThis & {
    __utilityBeltVolumeController?: VolumeController;
  };
  const existingController = controllerHost[controllerKey];

  if (existingController) {
    return existingController.applyState(initialState);
  }

  const boostedElements = new WeakMap<HTMLMediaElement, BoostedElement>();
  const boostedElementSet = new Set<HTMLMediaElement>();
  let state = normalizeState(initialState);

  function findMediaElements(): HTMLMediaElement[] {
    return Array.from(document.querySelectorAll("audio, video"));
  }

  function findMediaElementsInNode(node: Node): HTMLMediaElement[] {
    if (!(node instanceof Element)) {
      return [];
    }

    const mediaElements = Array.from(node.querySelectorAll("audio, video")) as HTMLMediaElement[];

    if (node instanceof HTMLMediaElement) {
      mediaElements.unshift(node);
    }

    return mediaElements;
  }

  function shouldBoost(): boolean {
    return state.enabled && state.gain > 1;
  }

  function configureLimiter(compressor: DynamicsCompressorNode): void {
    compressor.threshold.value = -3;
    compressor.knee.value = 0;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
  }

  function disconnectSafely(node: AudioNode): void {
    try {
      node.disconnect();
    } catch {
      // Some browsers throw when disconnecting an AudioNode with no current outputs.
    }
  }

  function disconnectBoostedElement(boostedElement: BoostedElement): void {
    disconnectSafely(boostedElement.source);
    disconnectSafely(boostedElement.gainNode);
    disconnectSafely(boostedElement.compressor);
  }

  function connectBoostedElement(boostedElement: BoostedElement): void {
    disconnectBoostedElement(boostedElement);

    if (!shouldBoost()) {
      boostedElement.gainNode.gain.value = 1;
      boostedElement.source.connect(boostedElement.context.destination);
      return;
    }

    boostedElement.gainNode.gain.value = state.gain;
    boostedElement.source.connect(boostedElement.gainNode);

    if (state.limiterEnabled) {
      boostedElement.gainNode.connect(boostedElement.compressor);
      boostedElement.compressor.connect(boostedElement.context.destination);
      return;
    }

    boostedElement.gainNode.connect(boostedElement.context.destination);
  }

  function updateBoostedElements(): void {
    for (const element of boostedElementSet) {
      const boostedElement = boostedElements.get(element);

      if (!element.isConnected || !boostedElement) {
        if (boostedElement) {
          disconnectBoostedElement(boostedElement);
          void boostedElement.context.close();
        }

        boostedElementSet.delete(element);
        continue;
      }

      connectBoostedElement(boostedElement);
      void boostedElement.context.resume();
    }
  }

  function boostElement(element: HTMLMediaElement): void {
    const existingBoost = boostedElements.get(element);

    if (existingBoost) {
      connectBoostedElement(existingBoost);
      void existingBoost.context.resume();
      return;
    }

    if (!shouldBoost()) {
      return;
    }

    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(element);
      const gainNode = context.createGain();
      const compressor = context.createDynamicsCompressor();
      const boostedElement = { compressor, context, gainNode, source };

      configureLimiter(compressor);
      connectBoostedElement(boostedElement);
      boostedElements.set(element, boostedElement);
      boostedElementSet.add(element);

      element.addEventListener("play", () => {
        void context.resume();
      });
      void context.resume();
    } catch {
      console.info("Utility Belt could not boost this media element because its audio is already routed.");
    }
  }

  function getResult(): VolumeApplyResult {
    return {
      ok: true,
      controlledElements: boostedElementSet.size,
      mediaElements: findMediaElements().length,
    };
  }

  function applyState(nextState: VolumeState): VolumeApplyResult {
    state = normalizeState(nextState);
    updateBoostedElements();

    if (shouldBoost()) {
      for (const element of findMediaElements()) {
        boostElement(element);
      }
    }

    return getResult();
  }

  const observer = new MutationObserver((mutations) => {
    if (!shouldBoost()) {
      return;
    }

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        for (const element of findMediaElementsInNode(node)) {
          boostElement(element);
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return false;
    }

    if (message.type !== "volume:apply-state") {
      return false;
    }

    sendResponse(
      applyState({
        enabled: Boolean(message.enabled),
        gain: normalizeGain(message.gain),
        limiterEnabled: Boolean(message.limiterEnabled),
      }),
    );
    return true;
  });

  const controller = { applyState };
  controllerHost[controllerKey] = controller;
  return controller.applyState(state);
}
