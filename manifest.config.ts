import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Utility Belt",
  version: "0.1.0",
  description: "Power-user improvements to Chrome's built-in tools.",
  icons: {
    16: "src/icons/icon-16.png",
    48: "src/icons/icon-48.png",
    128: "src/icons/icon-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Utility Belt",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/better-find.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["<all_urls>"],
      js: ["src/content/volume-booster.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  permissions: ["storage", "tabs", "activeTab", "scripting"],
  commands: {
    "open-find": {
      suggested_key: {
        default: "Ctrl+F",
        mac: "Command+F",
      },
      description: "Open enhanced find bar",
    },
  },
});
