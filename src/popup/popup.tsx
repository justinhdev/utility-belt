import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { sendMessage } from "../shared/messages";
import { DEFAULT_SETTINGS, Settings, TabSnapshot } from "../shared/types";
import "./popup.css";

function normalizeGain(value: unknown): number {
  const gain = typeof value === "number" ? value : Number(value);
  return Number.isFinite(gain) ? Math.max(1, Math.min(gain, 4)) : 1;
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

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Utility Belt</p>
          <h1>Quick tools</h1>
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
          <label>
            <span>Match</span>
            <input
              type="color"
              value={settings.find.matchColor}
              onChange={(event) => void saveFindPatch({ matchColor: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>Active</span>
            <input
              type="color"
              value={settings.find.activeColor}
              onChange={(event) => void saveFindPatch({ activeColor: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>Ripple</span>
            <input
              type="color"
              value={settings.find.rippleColor}
              onChange={(event) => void saveFindPatch({ rippleColor: event.currentTarget.value })}
            />
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
