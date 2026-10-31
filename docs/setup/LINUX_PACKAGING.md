# Packaging Parachord for Linux distributions

This is for people packaging Parachord for NixOS, Arch, Gentoo and other distributions, outside the AppImage, `.deb` and `.rpm` that the releases page ships. It covers what the build does, what it downloads, what needs compiling, and what the app expects at runtime.

The official Linux packages are built by `npm run build:linux` on Ubuntu in CI (`.github/workflows/build.yml`). Everything below describes that build.

## What the build does

1. **`npm ci`.** This installs dependencies from the npm registry, plus Electron from castlabs' GitHub (`github:castlabs/electron-releases#v44.5.1+wvcus`; see [Electron](#electron-castlabs-or-stock)). It doesn't download the Electron binary or compile anything (see [Native code](#native-code)).
2. **`npm run prebuild:linux`.** This generates files the app loads. Every step runs offline:
   - `vendor/tailwind.css`, built with Tailwind from `tailwind-input.css`.
   - `plugins/*.axe` and `src/renderer/lib/fallback-resolvers.generated.js`, built from `plugins-src/` by `scripts/build-axes.js`.
   - `amazon-player-preload.js`, bundled by `scripts/build-amazon-preload.js`.
   - The root `app.js`, bundled by esbuild from `src/renderer/app.js` (`scripts/build-renderer.js`).
3. **`electron-builder --linux`.** This packs the app into `app.asar` (with `plugins/`, `native-messaging/`, `mcp-stdio.js` and `*.node` unpacked), adds the Electron binary, and builds the configured targets: AppImage, deb and rpm.

Steps 1 and 2 need the dev dependencies (esbuild, Tailwind). After step 2 you can drop them (`npm prune --omit=dev`) if you package the app yourself.

## Building without electron-builder's packages

After step 2, the checkout is a runnable Electron app: `electron .` from the repository root starts it. To package it yourself:

- Ship what `build.files` in `package.json` selects: the repository minus `src/`, `tests/`, `docs/`, `scripts/` and the other exclusions listed there. Include the production `node_modules`.
- Run it with castlabs Electron 44 (or stock Electron 44, with the limits below).
- An asar archive is optional. The app handles both layouts.

To get only electron-builder's unpacked directory, without building an AppImage, deb or rpm:

```bash
npx electron-builder --linux dir
```

That writes `dist/linux-unpacked/`. It doesn't need the AppImage or fpm tooling.

## What gets downloaded, and how to supply it yourself

At build time:

- **The Electron binary.** Electron 44's npm package has no postinstall. `npm start` downloads the castlabs binary into `node_modules/electron/dist` on first run (`npx install-electron --no` does it ahead of time). electron-builder downloads its own copy of the release zip, from the mirror in `build.electronDownload`. To use a binary you already have:
  - for `npm start` / `electron .`: set `ELECTRON_OVERRIDE_DIST_PATH` to a directory holding the extracted castlabs build.
  - for electron-builder: pass `-c.electronDist=<directory>`.
  - Either way, the version must match `v44.5.1+wvcus`.
- **electron-builder's packaging tools**, for the AppImage, deb and rpm targets only. The `dir` target doesn't use them.

Nothing else downloads during the build.

At runtime:

- **The Widevine CDM.** castlabs' component updater downloads it on first launch, about 20 MB, into the profile. Only DRM playback needs it (see below).
- **An update check.** electron-updater checks GitHub releases five seconds after launch. It needs the `app-update.yml` that electron-builder writes into its AppImage, deb and rpm builds; without that file the check fails quietly and nothing else happens. There is no switch to turn the check off yet.

## Native code

The only native module is `better-sqlite3`, used by the local-files library. Version 13 ships prebuilt Node-API binaries inside its npm package, for Linux x64 and arm64 on glibc and musl. So nothing compiles: npm doesn't run node-gyp for it, and electron-builder's rebuild step finds nothing to do. Node-API is ABI-stable, so the same binary loads under Electron. Building on Linux doesn't need a C/C++ toolchain.

MPRIS (media keys and the desktop's now-playing widget) uses a pure-JavaScript D-Bus client.

## Electron: castlabs or stock

Parachord is built and tested only on [castlabs Electron for Content Security](https://github.com/castlabs/electron-releases) 44, a fork of Electron that includes Google's Widevine CDM.

- **Stock Electron 44 runs it.** At startup the app checks for castlabs' `components` API, logs that DRM is unavailable, and carries on. What you lose is Widevine: Amazon Music can't play, and Apple Music can't play full tracks. Spotify, local files and the other sources don't use Widevine.
- **The Electron major matters.** The main process `require()`s ESM-only packages (`electron-store` 12, `chokidar` 5, `music-metadata` 12). That needs the `require(esm)` support in Electron 44's Node 24.
- **No VMP signing on Linux.** On macOS and Windows, release builds get a production VMP signature from castlabs. The Linux CDM has no VMP, so the official Linux packages are unsigned too, and a build from source behaves the same as ours here.

## Runtime requirements

- **Audio:** PulseAudio, or PipeWire with `pipewire-pulse`. ALSA alone isn't enough.
- **Shared libraries:** Electron's usual set: `libnss3`, `libatk-bridge2.0-0` (or `at-spi2-core`), `libdrm2`, `libgbm1`, `libgtk-3-0`, `libxshmfence1`. See [SYSTEM_REQUIREMENTS.md](SYSTEM_REQUIREMENTS.md).
- **Media decoding:** Chromium's, through the `libffmpeg.so` that ships with Electron. There's no dependency on a system ffmpeg.
- **Chromium sandbox:** the standard Electron rules apply. Either `chrome-sandbox` is setuid root, or the kernel allows unprivileged user namespaces.

## Desktop integration

- **`parachord://` links.** The official deb, rpm and AppImage declare the scheme in their `.desktop` file (`MimeType=x-scheme-handler/parachord;`, generated from `build.protocols` in `package.json`), so installing the package registers the handler. The app also registers itself at every launch with Electron's `setAsDefaultProtocolClient`, which on Linux goes through `xdg-settings` and a `.desktop` file. A distribution package that writes its own `.desktop` file should declare the scheme the same way, with `%u` or `%U` in `Exec`. The app reads the link from its arguments, both on first launch and when an instance is already running. The entry the deb ships, as a template:

  ```ini
  [Desktop Entry]
  Name=Parachord
  Exec=/opt/Parachord/parachord-desktop %U
  Terminal=false
  Type=Application
  Icon=parachord-desktop
  StartupWMClass=parachord-desktop
  MimeType=x-scheme-handler/parachord;
  Categories=AudioVideo;
  ```

  Name the file `parachord-desktop.desktop` and keep `StartupWMClass=parachord-desktop`. Electron takes the window's app_id / WM_CLASS from `desktopName` in `package.json`, and desktops match running windows to the entry by that name.
- **Browser extension.** At every launch the app writes a native-messaging manifest into `~/.config/{google-chrome,chromium,microsoft-edge,BraveSoftware/Brave-Browser}/NativeMessagingHosts/`. The manifest points at a launcher script that runs the app's own Electron binary with `ELECTRON_RUN_AS_NODE=1`. Keep Electron's `RunAsNode` fuse enabled (the default), or the extension can't connect.
- **MCP bridge.** At every launch the app copies `mcp-stdio.js` into the profile, so the AI-assistant integration has a stable path.

## Environment variables

- `PARACHORD_USER_DATA` moves the profile. It defaults to `~/.config/parachord-desktop`.
- `AUTH_SERVER_PORT` sets the local server port (sign-in callbacks and the `parachord://` HTTP bridge). It defaults to 8888; the setting in Settings wins.
- The service credentials in [`.env.example`](../../.env.example). The app reads a `.env` from its working directory. For an installed package, set real environment variables or use Settings instead.

On credentials:

- **Spotify:** every user brings their own client ID, in Settings.
- **Last.fm:** a key is built in.
- **Apple Music:** this needs a MusicKit developer token. The official builds get one at build time. A build from source needs one in Settings or in `MUSICKIT_DEVELOPER_TOKEN`.

## Questions

Open an issue. If something here is wrong for your distribution, a PR is very welcome.
