# Bucks App Store — Build Summary

## 10 Apps in the Store

| # | Name | Type |
|---|------|------|
| 1 | Excalidraw | Collaborative whiteboard / diagramming |
| 2 | JSON Crack | JSON visualizer / editor |
| 3 | tldraw | Infinite canvas drawing tool |
| 4 | Penpot | Open-source design tool |
| 5 | n8n | Workflow automation |
| 6 | AppFlowy | Notion-like workspace |
| 7 | Reactive Resume | Resume builder |
| 8 | Actual Budget | Local-first budget manager |
| 9 | Markmap | Markdown mind-map visualizer |
| 10 | Mermaid Live | Diagram-as-code editor |

## Files Changed / Created

### New file
- `electron/app-runner.js` — Install + launch engine
  - `launchWeb(mainWindow, app)` — opens hosted URL in sandboxed BrowserView
  - `installLocal(appId, repo, event)` — git clone + npm install with progress events
  - `launchLocal(mainWindow, app)` — starts local server, polls port, then loads view
  - `uninstall(appId)` — removes directory and db entry
  - `getInstalled()` — returns `~/.bucks/apps/installed.json`

### Modified files
- `electron/main.js` — Added 6 IPC handlers inside `app.whenReady()`, after `setupIPFS()`:
  - `app-store-get-apps` — returns all apps with installed flag
  - `app-store-launch-web` — launches in BrowserView
  - `app-store-install` — clones and installs locally
  - `app-store-launch-local` — starts local server and loads it
  - `app-store-uninstall` — removes installed app
  - `app-store-close` — closes the BrowserView

- `electron/preload.js` — Added to `bucksAPI` object (before `Object.freeze`):
  - `getApps`, `launchWebApp`, `installApp`, `launchLocalApp`, `uninstallApp`, `closeApp`, `onInstallProgress`

- `electron/index.html` — Two changes:
  1. Added `#tab-store` nav button in the top-right toolbar (before Messages button)
  2. Added script tags at bottom of `<body>`:
     ```html
     <script src="app-store-data.js"></script>
     <script src="app-store.js"></script>
     ```

- `electron/renderer.js` — Extended `wireAppStore()` to wire the new `#tab-store` button to show `#store-overlay` and initialize `window.appStore` on first open.

## How to Open the App Store

Three ways to open the store:
1. **Top toolbar button** — click the house/store icon (⌂) added next to the Messages button
2. **Hamburger menu** → "App Store" (existed before)
3. **New Tab dock** → "All Apps" button (existed before)

## Runtime Data
- Installed apps database: `~/.bucks/apps/installed.json`
- App files: `~/.bucks/apps/<appId>/`

## IPC Channel Summary

| Channel | Direction | Description |
|---------|-----------|-------------|
| `app-store-get-apps` | renderer → main | Returns all 10 apps + installed flags |
| `app-store-launch-web` | renderer → main | Opens hosted URL in BrowserView |
| `app-store-install` | renderer → main | Clones repo + npm install |
| `app-store-launch-local` | renderer → main | Starts local dev server |
| `app-store-uninstall` | renderer → main | Removes app |
| `app-store-close` | renderer → main | Closes the BrowserView |
| `app-install-progress` | main → renderer | Install progress events (`cloning`, `installing`, `ready`) |
