import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { sendMessage } from "../shared/messages";
import { DEFAULT_SETTINGS, Settings, TabSnapshot } from "../shared/types";
import "./popup.css";

function Popup() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tabs, setTabs] = useState<TabSnapshot[]>([]);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void sendMessage({ type: "settings:get" }).then(setSettings);
    void sendMessage({ type: "tabs:list" }).then(setTabs);
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTab(tab ?? null));
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

  const activeGain = useMemo(() => {
    if (activeHost === undefined) {
      return 1;
    }

    return settings.volume.gainByHost[activeHost] ?? 1;
  }, [activeHost, settings.volume.gainByHost]);

  async function setGain(gain: number) {
    if (activeTab?.id === undefined) {
      return;
    }

    await sendMessage({ type: "volume:set-gain", tabId: activeTab.id, gain });
    const next = await sendMessage({ type: "settings:get" });
    setSettings(next);
    setStatus(`Volume set to ${Math.round(gain * 100)}%`);
  }

  async function toggleVolume(enabled: boolean) {
    const next = await sendMessage({ type: "settings:update", patch: { volume: { enabled } } });
    setSettings(next);
    setStatus(enabled ? "Volume booster enabled" : "Volume booster disabled");
  }

  async function muteAllTabs() {
    const result = await sendMessage({ type: "tabs:mute-all" });
    setTabs(await sendMessage({ type: "tabs:list" }));
    setStatus(`Muted ${result.muted} tabs`);
  }

  async function closeDuplicates() {
    const result = await sendMessage({ type: "tabs:close-duplicates" });
    setTabs(await sendMessage({ type: "tabs:list" }));
    setStatus(`Closed ${result.closed} duplicate tabs`);
  }

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Utility Belt</p>
          <h1>Quick tools</h1>
        </div>
        <button className="icon-button" title="Open options" onClick={() => chrome.runtime.openOptionsPage()}>
          ⚙
        </button>
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
            min="0"
            step="5"
            type="range"
            value={Math.round(activeGain * 100)}
            onChange={(event) => void setGain(Number(event.currentTarget.value) / 100)}
          />
          <strong>{Math.round(activeGain * 100)}%</strong>
        </div>
      </section>

      <section className="section">
        <h2>Tab Utilities</h2>
        <div className="actions">
          <button onClick={() => void muteAllTabs()}>Mute all tabs</button>
          <button onClick={() => void closeDuplicates()}>Close duplicates</button>
        </div>
        <p className="meta">{tabs.length} tabs open</p>
      </section>

      <section className="section">
        <h2>Better Find</h2>
        <div className="actions">
          <button onClick={() => activeTab?.id && chrome.tabs.sendMessage(activeTab.id, { type: "find:open" })}>
            Open find
          </button>
          <button onClick={() => chrome.runtime.openOptionsPage()}>Colors</button>
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
