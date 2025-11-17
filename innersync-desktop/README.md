# Innersync Desktop

A cross-platform Electron + React shell that will host the automated timetable watcher, login flow, and tray UI.

## Getting Started

1. Install dependencies (requires network access):

   ```bash
   cd innersync-desktop
   npm install
   ```

2. Start the dev server:

   ```bash
   npm run dev
   ```

   This spawns both the Vite renderer and the Electron main process with hot reload.

3. Build for production:

   ```bash
   npm run build
   ```

   The output lives in `dist/` and `dist-electron/`.

### Next Steps

- Wire the existing watcher/API modules into the main process.
- Implement login + settings screens in React (persisting to `app.getPath('userData')`).
- Add tray + auto-launch behavior, then enable auto-update via GitHub releases.
