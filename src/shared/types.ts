export interface FindSettings {
  matchColor: string;
  activeColor: string;
  rippleColor: string;
  endlessRipple: boolean;
  enabled: boolean;
  highlightPaddingX: number;
  highlightPaddingY: number;
  highlightRadius: number;
  rippleSize: number;
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
    matchColor: "#99F6E4",
    activeColor: "#14B8A6",
    rippleColor: "#5EEAD4",
    endlessRipple: false,
    enabled: true,
    highlightPaddingX: 0.24,
    highlightPaddingY: 0.04,
    highlightRadius: 999,
    rippleSize: 10,
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
