import { Settings, SettingsPatch, TabSnapshot, VolumeApplyResult, VolumeState } from "./types";

export type RuntimeMessage =
  | { type: "settings:get" }
  | { type: "settings:update"; patch: SettingsPatch }
  | { type: "tabs:list" }
  | { type: "tabs:set-muted"; tabId: number; muted: boolean }
  | { type: "tabs:mute-all" }
  | { type: "tabs:unmute-all" }
  | { type: "volume:get-current-gain" }
  | { type: "volume:get-tab-gain"; tabId: number }
  | { type: "volume:apply-tab"; tabId: number }
  | { type: "volume:set-gain"; tabId: number; gain: number }
  | ({ type: "volume:apply-state" } & VolumeState);

export interface RuntimeResponseMap {
  "settings:get": Settings;
  "settings:update": Settings;
  "tabs:list": TabSnapshot[];
  "tabs:set-muted": { muted: boolean };
  "tabs:mute-all": { muted: number };
  "tabs:unmute-all": { unmuted: number };
  "volume:get-current-gain": VolumeState;
  "volume:get-tab-gain": { gain: number };
  "volume:apply-tab": { ok: true; applied: boolean };
  "volume:set-gain": { ok: true; applied: boolean };
  "volume:apply-state": VolumeApplyResult;
}

type ResponseFor<T extends RuntimeMessage> = T["type"] extends keyof RuntimeResponseMap
  ? RuntimeResponseMap[T["type"]]
  : never;

export async function sendMessage<T extends RuntimeMessage>(message: T): Promise<ResponseFor<T>> {
  const response = await chrome.runtime.sendMessage(message);

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response;
}

export function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  return Boolean(message && typeof message === "object" && "type" in message);
}

function isErrorResponse(response: unknown): response is { error: string } {
  return Boolean(
    response &&
      typeof response === "object" &&
      "error" in response &&
      typeof (response as { error: unknown }).error === "string",
  );
}
