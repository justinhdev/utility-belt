# Utility Belt

Utility Belt is a Manifest V3 Chrome extension that improves built-in browser tools with focused, power-user-friendly enhancements.

## Features

- Volume Booster: per-tab gain control for page audio and video.
- Tab Utilities: quick actions for muting all tabs and closing duplicate tabs.
- Better Find: a Ctrl+F replacement with customizable match colors and an active-match ripple.

## Development

```bash
npm install
npm run dev
```

Then open Chrome and load the development extension from Vite/CRXJS, or build a production bundle:

```bash
npm run build
```

Load the generated `dist/` directory from `chrome://extensions` with Developer Mode enabled.
