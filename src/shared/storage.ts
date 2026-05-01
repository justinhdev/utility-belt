import { DEFAULT_SETTINGS, Settings, SettingsPatch, StoredSettings } from "./types";

type LegacyFindSettings = Partial<Settings["find"]> & {
  replaceNativeFind?: boolean;
};

const LEGACY_FIND_DEFAULTS = {
  matchColor: "#FFEB3B",
  activeColor: "#FF6F00",
  rippleColor: "#FF6F00",
};

function migrateLegacyDefaultColor(
  color: string | undefined,
  legacyDefault: string,
  nextDefault: string,
): string {
  return !color || color.toUpperCase() === legacyDefault ? nextDefault : color;
}

function mergeSettings(settings?: StoredSettings): Settings {
  const findSettings = settings?.find as LegacyFindSettings | undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    find: {
      matchColor: migrateLegacyDefaultColor(
        findSettings?.matchColor,
        LEGACY_FIND_DEFAULTS.matchColor,
        DEFAULT_SETTINGS.find.matchColor,
      ),
      activeColor: migrateLegacyDefaultColor(
        findSettings?.activeColor,
        LEGACY_FIND_DEFAULTS.activeColor,
        DEFAULT_SETTINGS.find.activeColor,
      ),
      rippleColor: migrateLegacyDefaultColor(
        findSettings?.rippleColor,
        LEGACY_FIND_DEFAULTS.rippleColor,
        DEFAULT_SETTINGS.find.rippleColor,
      ),
      endlessRipple: findSettings?.endlessRipple ?? DEFAULT_SETTINGS.find.endlessRipple,
      enabled: findSettings?.enabled ?? findSettings?.replaceNativeFind ?? DEFAULT_SETTINGS.find.enabled,
      highlightPaddingX: findSettings?.highlightPaddingX ?? DEFAULT_SETTINGS.find.highlightPaddingX,
      highlightPaddingY: findSettings?.highlightPaddingY ?? DEFAULT_SETTINGS.find.highlightPaddingY,
      highlightRadius: findSettings?.highlightRadius ?? DEFAULT_SETTINGS.find.highlightRadius,
      rippleSize: findSettings?.rippleSize ?? DEFAULT_SETTINGS.find.rippleSize,
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
