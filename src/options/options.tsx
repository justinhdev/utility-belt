import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { sendMessage } from "../shared/messages";
import { DEFAULT_SETTINGS, Settings } from "../shared/types";
import "./options.css";

function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [domain, setDomain] = useState("");

  useEffect(() => {
    void sendMessage({ type: "settings:get" }).then(setSettings);
  }, []);

  async function saveFindPatch(findPatch: Partial<Settings["find"]>) {
    setSettings(await sendMessage({ type: "settings:update", patch: { find: findPatch } }));
  }

  async function addDisabledDomain() {
    const normalized = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

    if (!normalized || settings.find.disabledDomains.includes(normalized)) {
      return;
    }

    await saveFindPatch({ disabledDomains: [...settings.find.disabledDomains, normalized] });
    setDomain("");
  }

  async function removeDisabledDomain(value: string) {
    await saveFindPatch({
      disabledDomains: settings.find.disabledDomains.filter((disabledDomain) => disabledDomain !== value),
    });
  }

  return (
    <main className="page">
      <header className="masthead">
        <p>Utility Belt</p>
        <h1>Options</h1>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Better Find</h2>
            <p>Customize matching and choose where Ctrl+F stays native.</p>
          </div>
          <label className="switch-row">
            <span>Replace native find</span>
            <input
              checked={settings.find.replaceNativeFind}
              type="checkbox"
              onChange={(event) => void saveFindPatch({ replaceNativeFind: event.currentTarget.checked })}
            />
          </label>
        </div>

        <div className="color-grid">
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

        <div className="domain-row">
          <input
            placeholder="example.com"
            value={domain}
            onChange={(event) => setDomain(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void addDisabledDomain();
              }
            }}
          />
          <button onClick={() => void addDisabledDomain()}>Add domain</button>
        </div>

        <div className="chips">
          {settings.find.disabledDomains.map((disabledDomain) => (
            <button key={disabledDomain} onClick={() => void removeDisabledDomain(disabledDomain)}>
              {disabledDomain} ×
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Volume Booster</h2>
            <p>Enable or disable the audio gain layer globally.</p>
          </div>
          <label className="switch-row">
            <span>Enabled</span>
            <input
              checked={settings.volume.enabled}
              type="checkbox"
              onChange={(event) =>
                void sendMessage({
                  type: "settings:update",
                  patch: { volume: { enabled: event.currentTarget.checked } },
                }).then(setSettings)
              }
            />
          </label>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
