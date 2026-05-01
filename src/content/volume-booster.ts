import { installVolumeController } from "./install-volume-controller";
import { VolumeState } from "../shared/types";

const DEFAULT_VOLUME_STATE: VolumeState = {
  enabled: true,
  gain: 1,
  limiterEnabled: true,
};

void chrome.runtime
  .sendMessage({ type: "volume:get-current-gain" })
  .then((state: VolumeState) => installVolumeController(state))
  .catch(() => installVolumeController(DEFAULT_VOLUME_STATE));
