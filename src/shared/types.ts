export interface FindSettings {
  matchColor: string;
  activeColor: string;
  rippleColor: string;
  replaceNativeFind: boolean;
  disabledDomains: string[];
}

export interface VolumeSettings {
  enabled: boolean;
  limiterEnabled: boolean;
}

export interface VolumeState extends VolumeSettings {
  gain: number;
}

export interface VolumeApplyResult {
  ok: true;
  controlledElements: number;
  mediaElements: number;
}

export type TabSettings = Record<string, never>;

export interface Settings {
  version: 1;
  find: FindSettings;
  volume: VolumeSettings;
  tabs: TabSettings;
}

export interface SettingsPatch {
  version?: Settings["version"];
  find?: Partial<FindSettings>;
  volume?: {
    enabled?: boolean;
    limiterEnabled?: boolean;
  };
  tabs?: TabSettings;
}

export type StoredSettings = Settings | SettingsPatch;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  find: {
    matchColor: "#FFEB3B",
    activeColor: "#FF6F00",
    rippleColor: "#FF6F00",
    replaceNativeFind: true,
    disabledDomains: [],
  },
  volume: {
    enabled: true,
    limiterEnabled: true,
  },
  tabs: {},
};

export interface TabSnapshot {
  id: number;
  title: string;
  url?: string;
  audible?: boolean;
  muted?: boolean;
}
