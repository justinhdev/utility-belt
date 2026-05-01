import { getSettings, updateSettings } from "../shared/storage";
import { isRuntimeMessage, RuntimeMessage } from "../shared/messages";
import { TabSnapshot } from "../shared/types";

function tabToSnapshot(tab: chrome.tabs.Tab): TabSnapshot | null {
  if (tab.id === undefined) {
    return null;
  }

  return {
    id: tab.id,
    title: tab.title ?? "Untitled tab",
    url: tab.url,
    audible: tab.audible,
    muted: tab.mutedInfo?.muted,
  };
}

async function listTabs(): Promise<TabSnapshot[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.map(tabToSnapshot).filter((tab): tab is TabSnapshot => tab !== null);
}

async function muteAllTabs(): Promise<{ muted: number }> {
  const tabs = await chrome.tabs.query({});
  const mutableTabs = tabs.filter((tab) => tab.id !== undefined && !tab.mutedInfo?.muted);

  await Promise.all(mutableTabs.map((tab) => chrome.tabs.update(tab.id!, { muted: true })));
  return { muted: mutableTabs.length };
}

async function closeDuplicateTabs(): Promise<{ closed: number }> {
  const tabs = await chrome.tabs.query({});
  const firstByUrl = new Set<string>();
  const duplicates: number[] = [];

  for (const tab of tabs) {
    if (!tab.url || tab.id === undefined || tab.url.startsWith("chrome://")) {
      continue;
    }

    if (firstByUrl.has(tab.url)) {
      duplicates.push(tab.id);
      continue;
    }

    firstByUrl.add(tab.url);
  }

  if (duplicates.length > 0) {
    await chrome.tabs.remove(duplicates);
  }

  return { closed: duplicates.length };
}

function getHostname(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol.startsWith("http") ? parsedUrl.hostname : undefined;
  } catch {
    return undefined;
  }
}

async function applyGainToTab(tabId: number, gain: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "volume:apply-gain", gain });
  } catch {
    // Restricted pages and tabs that have not finished loading cannot receive content messages.
  }
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case "settings:get":
      return getSettings();
    case "settings:update":
      return updateSettings(message.patch);
    case "tabs:list":
      return listTabs();
    case "tabs:mute-all":
      return muteAllTabs();
    case "tabs:close-duplicates":
      return closeDuplicateTabs();
    case "volume:get-current-gain": {
      const settings = await getSettings();
      const host = getHostname(sender.tab?.url);
      return {
        enabled: settings.volume.enabled,
        gain: host === undefined ? 1 : settings.volume.gainByHost[host] ?? 1,
      };
    }
    case "volume:set-gain": {
      const settings = await getSettings();
      const tab = await chrome.tabs.get(message.tabId);
      const host = getHostname(tab.url);

      if (host !== undefined) {
        const nextGainByHost = { ...settings.volume.gainByHost };

        if (message.gain > 1) {
          nextGainByHost[host] = message.gain;
        } else {
          delete nextGainByHost[host];
        }

        await updateSettings({
          volume: {
            gainByHost: nextGainByHost,
          },
        });
      }

      await applyGainToTab(message.tabId, message.gain);
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      console.error("Utility Belt message failed", error);
      sendResponse({ error: error instanceof Error ? error.message : "Unknown error" });
    });

  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "open-find" && tab.id !== undefined) {
    await chrome.tabs.sendMessage(tab.id, { type: "find:open" });
  }
});
