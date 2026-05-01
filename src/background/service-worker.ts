import { getSettings, updateSettings } from "../shared/storage";
import { isRuntimeMessage, RuntimeMessage } from "../shared/messages";
import { installVolumeController } from "../content/install-volume-controller";
import { TabSnapshot, VolumeApplyResult, VolumeState } from "../shared/types";

const TAB_GAINS_STORAGE_KEY = "volumeTabGains";
const TAB_GAIN_PERSIST_DEBOUNCE_MS = 2_000;
const TAB_GAIN_QUOTA_RETRY_MS = 60_000;

type TabGainStore = Record<string, number>;

let tabGainCache: TabGainStore | undefined;
let tabGainPersistTimer: ReturnType<typeof setTimeout> | undefined;
let tabGainPersistInFlight = false;
let tabGainPersistPending = false;

async function queryFocusedWindowTabs(): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query({ lastFocusedWindow: true });
}

function tabToSnapshot(tab: chrome.tabs.Tab): TabSnapshot | null {
  if (tab.id === undefined) {
    return null;
  }

  return {
    id: tab.id,
    title: tab.title ?? "Untitled tab",
    url: tab.url,
    audible: tab.audible,
    muted: tab.mutedInfo?.muted,
  };
}

async function listTabs(): Promise<TabSnapshot[]> {
  const tabs = await queryFocusedWindowTabs();
  return tabs.map(tabToSnapshot).filter((tab): tab is TabSnapshot => tab !== null);
}

async function muteAllTabs(): Promise<{ muted: number }> {
  const tabs = await queryFocusedWindowTabs();
  const mutableTabs = tabs.filter((tab) => tab.id !== undefined && !tab.mutedInfo?.muted);

  await Promise.all(mutableTabs.map((tab) => chrome.tabs.update(tab.id!, { muted: true })));
  return { muted: mutableTabs.length };
}

async function setTabMuted(tabId: number, muted: boolean): Promise<{ muted: boolean }> {
  await chrome.tabs.update(tabId, { muted });
  return { muted };
}

async function unmuteAllTabs(): Promise<{ unmuted: number }> {
  const tabs = await queryFocusedWindowTabs();
  const mutedTabs = tabs.filter((tab) => tab.id !== undefined && tab.mutedInfo?.muted);

  await Promise.all(mutedTabs.map((tab) => chrome.tabs.update(tab.id!, { muted: false })));
  return { unmuted: mutedTabs.length };
}

function normalizeGain(gain: unknown): number {
  const numericGain = typeof gain === "number" ? gain : Number(gain);
  return Number.isFinite(numericGain) ? Math.max(1, Math.min(numericGain, 4)) : 1;
}

function normalizeGainStore(value: unknown): TabGainStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const gains: TabGainStore = {};

  for (const [tabId, gain] of Object.entries(value)) {
    const normalizedGain = normalizeGain(gain);

    if (normalizedGain > 1) {
      gains[tabId] = normalizedGain;
    }
  }

  return gains;
}

async function getTabGainStore(): Promise<TabGainStore> {
  if (tabGainCache) {
    return tabGainCache;
  }

  try {
    const result = await chrome.storage.session.get(TAB_GAINS_STORAGE_KEY);
    tabGainCache = normalizeGainStore(result[TAB_GAINS_STORAGE_KEY]);
    return tabGainCache;
  } catch (error) {
    console.warn("Utility Belt could not load saved tab volume gains", error);
    tabGainCache = {};
    return tabGainCache;
  }
}

function scheduleTabGainPersist(delay = TAB_GAIN_PERSIST_DEBOUNCE_MS): void {
  tabGainPersistPending = true;

  if (tabGainPersistTimer) {
    clearTimeout(tabGainPersistTimer);
  }

  tabGainPersistTimer = setTimeout(() => {
    tabGainPersistTimer = undefined;
    void persistTabGainStore();
  }, delay);
}

async function persistTabGainStore(): Promise<void> {
  if (tabGainPersistInFlight) {
    scheduleTabGainPersist();
    return;
  }

  if (!tabGainPersistPending) {
    return;
  }

  tabGainPersistInFlight = true;
  tabGainPersistPending = false;

  try {
    await chrome.storage.session.set({ [TAB_GAINS_STORAGE_KEY]: tabGainCache ?? {} });
  } catch (error) {
    console.warn("Utility Belt could not persist tab volume gains; retrying later", error);
    scheduleTabGainPersist(TAB_GAIN_QUOTA_RETRY_MS);
  } finally {
    tabGainPersistInFlight = false;
  }
}

function updateTabGainStore(gains: TabGainStore, tabId: number, gain: number): void {
  if (gain > 1) {
    gains[String(tabId)] = gain;
  } else {
    delete gains[String(tabId)];
  }

  scheduleTabGainPersist();
}

async function pruneTabGainStore(): Promise<void> {
  const gains = await getTabGainStore();
  const tabs = await chrome.tabs.query({});
  const openTabIds = new Set(tabs.flatMap((tab) => (tab.id === undefined ? [] : [String(tab.id)])));
  let changed = false;

  for (const tabId of Object.keys(gains)) {
    if (!openTabIds.has(tabId)) {
      delete gains[tabId];
      changed = true;
    }
  }

  if (changed) {
    scheduleTabGainPersist();
  }
}

async function flushTabGainStore(): Promise<void> {
  if (tabGainPersistTimer) {
    clearTimeout(tabGainPersistTimer);
    tabGainPersistTimer = undefined;
  }

  if (!tabGainPersistPending) {
    return;
  }

  await persistTabGainStore();
}

async function getTabGain(tabId?: number): Promise<number> {
  if (tabId === undefined) {
    return 1;
  }

  const gains = await getTabGainStore();
  return normalizeGain(gains[String(tabId)]);
}

async function setTabGain(tabId: number, gain: unknown): Promise<number> {
  const normalizedGain = normalizeGain(gain);
  const gains = await getTabGainStore();
  updateTabGainStore(gains, tabId, normalizedGain);
  return normalizedGain;
}

async function clearTabGain(tabId: number): Promise<void> {
  const gains = await getTabGainStore();
  const key = String(tabId);

  if (!(key in gains)) {
    return;
  }

  delete gains[key];
  scheduleTabGainPersist();
}

function canInjectIntoTab(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.url && /^https?:\/\//.test(tab.url));
}

async function getVolumeStateForTab(tabId?: number): Promise<VolumeState> {
  const settings = await getSettings();

  return {
    enabled: settings.volume.enabled,
    gain: await getTabGain(tabId),
    limiterEnabled: settings.volume.limiterEnabled,
  };
}

function isVolumeApplyResult(result: unknown): result is VolumeApplyResult {
  return Boolean(
    result &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok: unknown }).ok === true &&
      "controlledElements" in result &&
      typeof (result as { controlledElements: unknown }).controlledElements === "number" &&
      "mediaElements" in result &&
      typeof (result as { mediaElements: unknown }).mediaElements === "number",
  );
}

async function sendVolumeStateToTab(tabId: number, state: VolumeState): Promise<boolean> {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: "volume:apply-state", ...state });
    return isVolumeApplyResult(result);
  } catch {
    return false;
  }
}

async function injectVolumeController(tabId: number, state: VolumeState): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (!canInjectIntoTab(tab)) {
      return false;
    }

    const results = await chrome.scripting.executeScript({
      args: [state],
      func: installVolumeController,
      target: { allFrames: true, tabId },
    });

    const applyResults = results
      .map((result) => result.result)
      .filter((result): result is VolumeApplyResult => isVolumeApplyResult(result));

    return applyResults.length > 0;
  } catch {
    return false;
  }
}

async function applyVolumeStateToTab(tabId: number, state: VolumeState): Promise<boolean> {
  if (await sendVolumeStateToTab(tabId, state)) {
    return true;
  }

  if (await injectVolumeController(tabId, state)) {
    return true;
  }

  return !state.enabled || state.gain <= 1;
}

async function broadcastVolumeState(): Promise<void> {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) {
        return;
      }

      const state = await getVolumeStateForTab(tab.id);

      if (state.gain > 1) {
        await applyVolumeStateToTab(tab.id, state);
        return;
      }

      await sendVolumeStateToTab(tab.id, state);
    }),
  );
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case "settings:get":
      return getSettings();
    case "settings:update": {
      const nextSettings = await updateSettings(message.patch);

      if (message.patch.volume) {
        await broadcastVolumeState();
      }

      return nextSettings;
    }
    case "tabs:list":
      return listTabs();
    case "tabs:set-muted":
      return setTabMuted(message.tabId, message.muted);
    case "tabs:mute-all":
      return muteAllTabs();
    case "tabs:unmute-all":
      return unmuteAllTabs();
    case "volume:get-current-gain": {
      return getVolumeStateForTab(sender.tab?.id);
    }
    case "volume:get-tab-gain":
      return { gain: await getTabGain(message.tabId) };
    case "volume:apply-tab": {
      const state = await getVolumeStateForTab(message.tabId);
      const applied = await applyVolumeStateToTab(message.tabId, state);
      return { ok: true, applied };
    }
    case "volume:set-gain": {
      const gain = await setTabGain(message.tabId, message.gain);
      const state = await getVolumeStateForTab(message.tabId);
      const applied = await applyVolumeStateToTab(message.tabId, {
        ...state,
        gain,
      });
      return { ok: true, applied };
    }
    default:
      return { ok: true };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings();
  await pruneTabGainStore();
});

chrome.runtime.onStartup.addListener(() => {
  void pruneTabGainStore();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabGain(tabId).then(() => flushTabGainStore());
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      console.error("Utility Belt message failed", error);
      sendResponse({ error: error instanceof Error ? error.message : "Unknown error" });
    });

  return true;
});
