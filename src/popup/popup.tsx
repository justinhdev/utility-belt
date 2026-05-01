import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { sendMessage } from "../shared/messages";
import { DEFAULT_SETTINGS, Settings, TabSnapshot } from "../shared/types";
import "./popup.css";

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

interface ColorPickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

interface SliderControlProps {
  label: string;
  max: number;
  min: number;
  step: number;
  value: number;
  valueLabel: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

function normalizeGain(value: unknown): number {
  const gain = typeof value === "number" ? value : Number(value);
  return Number.isFinite(gain) ? Math.max(1, Math.min(gain, 4)) : 1;
}

function getReadableTextColor(backgroundColor: string): string {
  const normalized = backgroundColor.trim().replace("#", "");

  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
    return "#061512";
  }

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.52 ? "#061512" : "#F4FBFA";
}

function normalizeHexColor(value: string): string | undefined {
  const withHash = value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`;
  return HEX_COLOR_PATTERN.test(withHash) ? withHash.toUpperCase() : undefined;
}

function radiusFromSlider(value: number): number {
  return value >= 24 ? 999 : value;
}

function radiusToSlider(value: number): number {
  return value >= 24 ? 24 : value;
}

function SliderControl({ label, max, min, onChange, onCommit, step, value, valueLabel }: SliderControlProps) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onBlur={(event) => onCommit(Number(event.currentTarget.value))}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit(Number(event.currentTarget.value))}
        onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
      />
      <strong>{valueLabel}</strong>
    </label>
  );
}

function ColorPickerField({ label, value, onChange }: ColorPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function commitColor(nextValue: string) {
    const normalized = normalizeHexColor(nextValue);

    if (!normalized) {
      return;
    }

    setDraft(normalized);
    onChange(normalized);
  }

  return (
    <div className="color-picker" ref={pickerRef}>
      <button
        aria-expanded={open}
        className="color-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <span className="color-swatch" style={{ backgroundColor: value }} />
      </button>
      {open && (
        <div className="color-popover">
          <label>
            <span>Picker</span>
            <input type="color" value={value} onChange={(event) => commitColor(event.currentTarget.value)} />
          </label>
          <label>
            <span>Hex</span>
            <input
              maxLength={7}
              spellCheck={false}
              type="text"
              value={draft}
              onBlur={() => setDraft(normalizeHexColor(draft) ?? value)}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                setDraft(nextValue);

                if (HEX_COLOR_PATTERN.test(nextValue)) {
                  commitColor(nextValue);
                }
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Popup() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tabs, setTabs] = useState<TabSnapshot[]>([]);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [activeGain, setActiveGain] = useState(1);
  const [status, setStatus] = useState("");
  const pendingGainCommit = useRef<{ tabId: number; gain: number } | undefined>(undefined);
  const gainCommitInFlight = useRef(false);

  useEffect(() => {
    void sendMessage({ type: "settings:get" })
      .then(setSettings)
      .catch(() => setStatus("Could not load settings"));
    void sendMessage({ type: "tabs:list" })
      .then(setTabs)
      .catch(() => setStatus("Could not load tabs"));
    void chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => setActiveTab(tab ?? null))
      .catch(() => setStatus("Could not detect active tab"));
  }, []);

  useEffect(() => {
    if (!status) {
      return;
    }

    const timeoutId = window.setTimeout(() => setStatus(""), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  const activeHost = useMemo(() => {
    if (!activeTab?.url) {
      return undefined;
    }

    try {
      const parsedUrl = new URL(activeTab.url);
      return parsedUrl.protocol.startsWith("http") ? parsedUrl.hostname : undefined;
    } catch {
      return undefined;
    }
  }, [activeTab?.url]);

  const displayedGain = normalizeGain(activeGain);
  const activeTabSnapshot = useMemo(() => tabs.find((tab) => tab.id === activeTab?.id), [activeTab?.id, tabs]);
  const activeTabMuted = activeTabSnapshot?.muted ?? activeTab?.mutedInfo?.muted ?? false;
  const mutedTabs = useMemo(() => tabs.filter((tab) => tab.muted).length, [tabs]);
  const hasMutedTabs = mutedTabs > 0;

  useEffect(() => {
    if (!settings.find.enabled || activeTab?.id === undefined || activeHost === undefined) {
      return;
    }

    void sendMessage({ type: "find:ensure-tab", tabId: activeTab.id }).catch(() => undefined);
  }, [activeHost, activeTab?.id, settings.find.enabled]);

  useEffect(() => {
    if (activeTab?.id === undefined || activeHost === undefined) {
      setActiveGain(1);
      return;
    }

    let cancelled = false;

    void sendMessage({ type: "volume:get-tab-gain", tabId: activeTab.id })
      .then(({ gain }) => {
        if (!cancelled) {
          setActiveGain(normalizeGain(gain));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("Could not load tab volume");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeHost, activeTab?.id]);

  function flushGainCommit() {
    if (gainCommitInFlight.current || pendingGainCommit.current === undefined) {
      return;
    }

    const commit = pendingGainCommit.current;
    pendingGainCommit.current = undefined;
    gainCommitInFlight.current = true;

    void sendMessage({ type: "volume:set-gain", tabId: commit.tabId, gain: commit.gain })
      .then((result) => {
        if (pendingGainCommit.current === undefined) {
          setStatus(
            result.applied
              ? `Volume set to ${Math.round(commit.gain * 100)}%`
              : "This page cannot be controlled",
          );
        }
      })
      .catch(() => setStatus("Could not apply volume"))
      .finally(() => {
        gainCommitInFlight.current = false;
        flushGainCommit();
      });
  }

  function setGain(gain: number) {
    if (activeTab?.id === undefined) {
      return;
    }

    const clampedGain = Math.max(1, Math.min(gain, 4));
    setActiveGain(clampedGain);
    pendingGainCommit.current = { tabId: activeTab.id, gain: clampedGain };
    flushGainCommit();
  }

  async function applyActiveTabVolume() {
    if (activeTab?.id === undefined || activeHost === undefined) {
      return;
    }

    await sendMessage({ type: "volume:apply-tab", tabId: activeTab.id });
  }

  async function toggleVolume(enabled: boolean) {
    try {
      const next = await sendMessage({ type: "settings:update", patch: { volume: { enabled } } });
      setSettings(next);
      await applyActiveTabVolume();
      setStatus(enabled ? "Volume booster enabled" : "Volume booster disabled");
    } catch {
      setStatus("Could not update volume booster");
    }
  }

  async function toggleLimiter(limiterEnabled: boolean) {
    try {
      const next = await sendMessage({ type: "settings:update", patch: { volume: { limiterEnabled } } });
      setSettings(next);
      await applyActiveTabVolume();
      setStatus(limiterEnabled ? "Limiter enabled" : "Limiter disabled");
    } catch {
      setStatus("Could not update limiter");
    }
  }

  async function saveFindPatch(findPatch: Partial<Settings["find"]>) {
    try {
      setSettings(await sendMessage({ type: "settings:update", patch: { find: findPatch } }));
      setStatus("Better Find settings saved");
    } catch {
      setStatus("Could not save Better Find settings");
    }
  }

  function setFindDraft(findPatch: Partial<Settings["find"]>) {
    setSettings((current) => ({
      ...current,
      find: {
        ...current.find,
        ...findPatch,
      },
    }));
  }

  async function toggleActiveTabMute() {
    if (activeTab?.id === undefined) {
      return;
    }

    const muted = !activeTabMuted;

    try {
      await sendMessage({ type: "tabs:set-muted", tabId: activeTab.id, muted });
      setTabs(await sendMessage({ type: "tabs:list" }));
      setActiveTab((current) =>
        current
          ? {
              ...current,
              mutedInfo: {
                ...(current.mutedInfo ?? {}),
                muted,
              },
            }
          : current,
      );
      setStatus(muted ? "Muted active tab" : "Unmuted active tab");
    } catch {
      setStatus(activeTabMuted ? "Could not unmute active tab" : "Could not mute active tab");
    }
  }

  async function toggleWindowMute() {
    try {
      if (hasMutedTabs) {
        const result = await sendMessage({ type: "tabs:unmute-all" });
        setTabs(await sendMessage({ type: "tabs:list" }));
        setStatus(`Unmuted ${result.unmuted} tabs in this window`);
        return;
      }

      const result = await sendMessage({ type: "tabs:mute-all" });
      setTabs(await sendMessage({ type: "tabs:list" }));
      setStatus(`Muted ${result.muted} tabs in this window`);
    } catch {
      setStatus(hasMutedTabs ? "Could not unmute tabs" : "Could not mute tabs");
    }
  }

  const radiusSliderValue = radiusToSlider(settings.find.highlightRadius);
  const previewStyle = {
    "--find-active-color": settings.find.activeColor,
    "--find-active-text": getReadableTextColor(settings.find.activeColor),
    "--find-match-color": settings.find.matchColor,
    "--find-match-text": getReadableTextColor(settings.find.matchColor),
    "--find-padding-x": `${settings.find.highlightPaddingX}em`,
    "--find-padding-y": `${settings.find.highlightPaddingY}em`,
    "--find-radius": `${settings.find.highlightRadius}px`,
    "--find-ripple-color": settings.find.rippleColor,
    "--find-ripple-iterations": settings.find.endlessRipple ? "infinite" : "1",
    "--find-ripple-size": `${settings.find.rippleSize}px`,
    "--find-ripple-transparent": `${settings.find.rippleColor}00`,
  } as React.CSSProperties & Record<string, string>;

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Utility Belt</p>
        </div>
      </header>

      <section className="section">
        <div className="section-heading">
          <h2>Volume Booster</h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.volume.enabled}
              onChange={(event) => void toggleVolume(event.currentTarget.checked)}
            />
            <span />
          </label>
        </div>
        <div className="range-row">
          <span>100%</span>
          <input
            aria-label="Current tab volume"
            disabled={!settings.volume.enabled || activeTab?.id === undefined || activeHost === undefined}
            max="400"
            min="100"
            step="5"
            type="range"
            value={Math.round(displayedGain * 100)}
            onChange={(event) => setGain(normalizeGain(Number(event.currentTarget.value) / 100))}
          />
          <strong>{Math.round(displayedGain * 100)}%</strong>
        </div>
        <div className="sub-setting">
          <span>Limiter</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.volume.limiterEnabled}
              onChange={(event) => void toggleLimiter(event.currentTarget.checked)}
            />
            <span />
          </label>
        </div>
      </section>

      <section className="section">
        <h2>Tab Utilities</h2>
        <div className="actions">
          <button disabled={activeTab?.id === undefined} onClick={() => void toggleActiveTabMute()}>
            {activeTabMuted ? "Unmute tab" : "Mute tab"}
          </button>
          <button onClick={() => void toggleWindowMute()}>{hasMutedTabs ? "Unmute window" : "Mute window"}</button>
        </div>
        <p className="meta">{tabs.length} tabs in this window</p>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Better Find</h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.find.enabled}
              onChange={(event) => void saveFindPatch({ enabled: event.currentTarget.checked })}
            />
            <span />
          </label>
        </div>
        <div className="color-row">
          <ColorPickerField
            label="Match"
            value={settings.find.matchColor}
            onChange={(color) => void saveFindPatch({ matchColor: color })}
          />
          <ColorPickerField
            label="Active"
            value={settings.find.activeColor}
            onChange={(color) => void saveFindPatch({ activeColor: color })}
          />
          <ColorPickerField
            label="Ripple"
            value={settings.find.rippleColor}
            onChange={(color) => void saveFindPatch({ rippleColor: color })}
          />
        </div>
        <div className="find-preview" style={previewStyle}>
          <p>
            Search results should keep <mark className="preview-highlight">Utility Belt</mark> readable, while the
            current <mark className="preview-highlight preview-active">Utility Belt</mark> match stands out.
          </p>
        </div>
        <div className="slider-grid">
          <SliderControl
            label="Width"
            max={0.5}
            min={0}
            step={0.02}
            value={settings.find.highlightPaddingX}
            valueLabel={`${settings.find.highlightPaddingX.toFixed(2)}em`}
            onChange={(value) => setFindDraft({ highlightPaddingX: value })}
            onCommit={(value) => void saveFindPatch({ highlightPaddingX: value })}
          />
          <SliderControl
            label="Height"
            max={0.22}
            min={0}
            step={0.01}
            value={settings.find.highlightPaddingY}
            valueLabel={`${settings.find.highlightPaddingY.toFixed(2)}em`}
            onChange={(value) => setFindDraft({ highlightPaddingY: value })}
            onCommit={(value) => void saveFindPatch({ highlightPaddingY: value })}
          />
          <SliderControl
            label="Roundness"
            max={24}
            min={0}
            step={1}
            value={radiusSliderValue}
            valueLabel={radiusSliderValue >= 24 ? "Full" : `${radiusSliderValue}px`}
            onChange={(value) => setFindDraft({ highlightRadius: radiusFromSlider(value) })}
            onCommit={(value) => void saveFindPatch({ highlightRadius: radiusFromSlider(value) })}
          />
          <SliderControl
            label="Ripple size"
            max={20}
            min={4}
            step={1}
            value={settings.find.rippleSize}
            valueLabel={`${settings.find.rippleSize}px`}
            onChange={(value) => setFindDraft({ rippleSize: value })}
            onCommit={(value) => void saveFindPatch({ rippleSize: value })}
          />
        </div>
        <div className="sub-setting">
          <span>Endless ripple</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.find.endlessRipple}
              onChange={(event) => void saveFindPatch({ endlessRipple: event.currentTarget.checked })}
            />
            <span />
          </label>
        </div>
      </section>

      {status && <p className="status">{status}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
