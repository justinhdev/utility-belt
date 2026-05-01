import { Settings, SettingsPatch, TabSnapshot } from "./types";

export type RuntimeMessage =
  | { type: "settings:get" }
  | { type: "settings:update"; patch: SettingsPatch }
  | { type: "tabs:list" }
  | { type: "tabs:mute-all" }
  | { type: "tabs:close-duplicates" }
  | { type: "volume:get-current-gain" }
  | { type: "volume:set-gain"; tabId: number; gain: number }
  | { type: "volume:apply-gain"; gain: number }
  | { type: "find:open" };

export interface RuntimeResponseMap {
  "settings:get": Settings;
  "settings:update": Settings;
  "tabs:list": TabSnapshot[];
  "tabs:mute-all": { muted: number };
  "tabs:close-duplicates": { closed: number };
  "volume:get-current-gain": { enabled: boolean; gain: number };
  "volume:set-gain": { ok: true };
  "volume:apply-gain": { ok: true };
  "find:open": { ok: true };
}

type ResponseFor<T extends RuntimeMessage> = T["type"] extends keyof RuntimeResponseMap
  ? RuntimeResponseMap[T["type"]]
  : never;

export async function sendMessage<T extends RuntimeMessage>(message: T): Promise<ResponseFor<T>> {
  return chrome.runtime.sendMessage(message);
}

export async function sendTabMessage<T extends RuntimeMessage>(
  tabId: number,
  message: T,
): Promise<ResponseFor<T>> {
  return chrome.tabs.sendMessage(tabId, message);
}

export function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  return Boolean(message && typeof message === "object" && "type" in message);
}
