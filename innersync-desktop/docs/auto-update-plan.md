# Innersync Desktop – Self-Update + Release Plan

This document outlines what we still need to wire up so the Electron desktop shell can ship updates via GitHub releases and update itself in production. The emphasis below is on Windows builds; macOS references are optional for later.

## 1. Put the project under Git & GitHub

1. From `/Users/gmacarthur/Herd/tt`, run `git init` (if not already under version control), add the project files, and create the initial commit.
2. Create a new GitHub repository, e.g. `innersync/innersync-desktop`.
3. Add the GitHub remote: `git remote add origin git@github.com:innersync/innersync-desktop.git`.
4. Push the default branch (`main`): `git push -u origin main`.

## 2. Add an Electron Builder configuration

`electron-updater` expects artifacts that are packaged by `electron-builder`. We need to add the tooling + metadata:

1. Install `electron-builder` as a dev dependency inside `innersync-desktop`.
2. Extend `package.json`:
   - Add `"appId": "com.innersync.desktop"` (or similar).
   - Add a `build` section (electron-builder config) or separate `electron-builder.yml`.
   - Include product name/icon paths and map `files` / `extraResources` if needed.
   - Add scripts:
     ```json
     "scripts": {
       "dev": "electron-vite dev",
       "build": "electron-vite build",
       "package": "electron-builder build --dir",
       "dist": "electron-builder build"
     }
     ```
3. Example `build` section:
   ```json
  "build": {
    "appId": "com.innersync.desktop",
    "productName": "Innersync Desktop",
    "directories": {
      "buildResources": "resources"
    },
    "files": [
      "dist-electron/**/*",
      "dist/**/*",
      "package.json"
    ],
    "win": {
      "target": ["nsis"],
      "artifactName": "innersync-desktop-${version}-setup.${ext}",
      "publisherName": "Innersync Pty Ltd"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowElevation": false,
      "createDesktopShortcut": true
    },
    "publish": [
      {
        "provider": "github",
         "owner": "innersync",
         "repo": "innersync-desktop"
       }
     ]
   }
   ```
   Adjust targets to match the platforms you plan to ship. Add macOS targets later if/when you want to publish that platform.

## 3. Windows signing (optional)

For this client deployment you’ve chosen to ship unsigned installers. That’s fine—`electron-builder` and `electron-updater` both support unsigned artifacts. Expect Windows SmartScreen to show an “Unknown publisher” prompt during installs/updates; include a short note for the customer explaining they can click “More info → Run anyway”.

If you later decide to sign builds (to remove the warning), purchase an Authenticode certificate and set `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` before running `electron-builder`. A self-signed cert can also be used if you install it in the customer’s trusted root store.

## 4. Wire up GitHub releases for auto-update

`electron-updater` already polls once `appUpdater.setEnabled(true)` is called, but we must publish the correct artifacts:

1. Bump `version` in `innersync-desktop/package.json` for each release.
2. Run `npm run dist`. This builds the renderer/main bundles (`electron-vite build`) and packages with `electron-builder`, producing Windows installers and update files (`latest.yml`, `.blockmap`, `.exe`).
3. Create a GitHub release for the tag `vX.Y.Z` and upload all generated artifacts (or let CI publish automatically—see below). The `publish` block in the builder config pushes the assets + release metadata when `GH_TOKEN` is set.
4. Provide a `GH_TOKEN` (classic PAT with `repo` scope) in both local environment and CI so `electron-builder` can create releases. In CI: `env: GH_TOKEN: ${{ secrets.GH_TOKEN }}`.
5. Once a release is published, clients will download the delta when `appUpdater.checkForUpdates()` runs (either automatically or when the user presses “Check Now”).

## 5. Continuous delivery via GitHub Actions

Because electron-builder must run on Windows for `.exe`/NSIS packages, configure a workflow (e.g. `.github/workflows/release-win.yml`):

1. Trigger on tag push `v*`.
2. Use the `windows-latest` runner.
3. Steps: checkout, `npm ci` at repo root, run `npm run build` within `innersync-desktop`, then `npm run dist -- --win`.
4. Provide the `GH_TOKEN` secret so `electron-builder --publish=always` can attach the artifacts to the GitHub release. Because we’re shipping unsigned builds, the certificate-related env vars are not needed (leave them unset).

You can add macOS/Linux workflows later once you decide to support those platforms.

## 6. Smoke-test the updater

1. Install the `v0.1.0` build from GitHub (unsigned installer).
2. Create a small code change, bump to `v0.1.1`, and publish another release.
3. On the installed app, open Settings → “Check Now” and confirm the updater finds `v0.1.1`.
4. Click “Install Update” and verify the new app launches and `app.getVersion()` matches.
5. Monitor console logs (`~/Library/Logs/Innersync`) to ensure the updater events show as expected.

## 7. Future improvements

- Add channel support (e.g., beta) by publishing prerelease tags.
- Improve UX by surfacing download progress (listen for `download-progress` events in `updater.ts`).
- Consider crash/error reporting for updater failures.

With the above steps implemented, the desktop app will be hosted on GitHub, ship Windows installers (unsigned for now), and be able to fetch/apply updates through `electron-updater`.
