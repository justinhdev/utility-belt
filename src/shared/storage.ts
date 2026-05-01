import { DEFAULT_SETTINGS, Settings, SettingsPatch, StoredSettings } from "./types";

type LegacyFindSettings = Partial<Settings["find"]> & {
  replaceNativeFind?: boolean;
};

function mergeSettings(settings?: StoredSettings): Settings {
  const findSettings = settings?.find as LegacyFindSettings | undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    find: {
      matchColor: findSettings?.matchColor ?? DEFAULT_SETTINGS.find.matchColor,
      activeColor: findSettings?.activeColor ?? DEFAULT_SETTINGS.find.activeColor,
      rippleColor: findSettings?.rippleColor ?? DEFAULT_SETTINGS.find.rippleColor,
      enabled: findSettings?.enabled ?? findSettings?.replaceNativeFind ?? DEFAULT_SETTINGS.find.enabled,
    },
    volume: {
      enabled: settings?.volume?.enabled ?? DEFAULT_SETTINGS.volume.enabled,
      limiterEnabled: settings?.volume?.limiterEnabled ?? DEFAULT_SETTINGS.volume.limiterEnabled,
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
  // Deep-merge the patch into current settings, then normalize against defaults.
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
