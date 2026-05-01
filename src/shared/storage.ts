import { DEFAULT_SETTINGS, Settings, SettingsPatch, StoredSettings } from "./types";

function mergeSettings(settings?: StoredSettings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    find: {
      ...DEFAULT_SETTINGS.find,
      ...settings?.find,
    },
    volume: {
      enabled: settings?.volume?.enabled ?? DEFAULT_SETTINGS.volume.enabled,
      gainByHost: {
        ...DEFAULT_SETTINGS.volume.gainByHost,
        ...settings?.volume?.gainByHost,
      },
    },
    tabs: {
      ...DEFAULT_SETTINGS.tabs,
      ...settings?.tabs,
    },
  };
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get("settings");
  return mergeSettings(result.settings);
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const current = await getSettings();
  const next = mergeSettings({
    ...current,
    ...patch,
    find: {
      ...current.find,
      ...patch.find,
    },
    volume: {
      ...current.volume,
      ...patch.volume,
      gainByHost: {
        ...current.volume.gainByHost,
        ...patch.volume?.gainByHost,
      },
    },
    tabs: {
      ...current.tabs,
      ...patch.tabs,
    },
  });

  await chrome.storage.sync.set({ settings: next });
  return next;
}

export function onSettingsChange(callback: (settings: Settings) => void): () => void {
  const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area === "sync" && changes.settings) {
      callback(mergeSettings(changes.settings.newValue));
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
