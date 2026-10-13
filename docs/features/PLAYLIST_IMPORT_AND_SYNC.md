# Playlist Import and Sync

Every way a playlist gets into Parachord, and every way one is kept in step with an outside service. Written from the code as of October 2026, not from the design plans. Line numbers are approximate and refer to `app.js` unless another file is named.

Related: [RECOMMENDATIONS.md](RECOMMENDATIONS.md), [XSPF_IMPORT_EXPORT_GUIDE.md](XSPF_IMPORT_EXPORT_GUIDE.md), [protocol-schema.md](../protocol-schema.md), and the Syncing System section of [CLAUDE.md](../../CLAUDE.md) for sync internals (data model, link map, push loops, provider quirks).

All playlists live in the electron-store key `local_playlists`, read and written through the `playlists-load`, `playlists-save` and `playlists-delete` IPC handlers (main.js ~L5258 onward). The `playlists/` folder in the repo is not read at runtime.

## Summary

| Path | Entry point | Accepts | Saved to library? | Ongoing? |
|---|---|---|---|---|
| Import from URL | Import Playlist modal; Playlists page Import button; File menu | Spotify, Apple Music, SoundCloud sets, YouTube playlists, any hosted XSPF URL | Yes, as a hosted playlist | Yes: re-fetched at startup and every 5 minutes |
| Drop a URL | Sidebar Playlists button; Playlists page | Same as above | Yes | Yes |
| Drop a URL on the queue or now-playing | Queue panel; playbar | Track, album or playlist URL any resolver claims | No, queue only | No |
| XSPF file | Import modal "Load from File" | `.xspf` file | Yes | No |
| `parachord://import` | Deep link, website bounce, embed button, local HTTP/WebSocket server | `url=` (hosted or provider) or inline `tracks=` | Yes, after a confirmation dialog | URL form yes, inline form no |
| `parachord://play/playlist` | Deep link | Hosted XSPF/JSPF/JSON, provider pages, Achordion playlist pages, inline tracks | No, plays only | No |
| Browser extension | Popup, context menu, inline buttons, link intercept | Spotify, Apple Music, YouTube, Bandcamp, SoundCloud, Pitchfork pages and links | No, queue only | No |
| Provider sync | Sync wizard; background sync | Spotify, Apple Music, ListenBrainz playlists | Yes, as `${provider}-${externalId}` | Yes: pull, push, n-way mirrors |
| Shuffleupagus chat | AI chat `create_playlist` and playlist tools | Model-chosen tracks | Yes, as `ai-chat-*` | No |
| MCP server | External agents (Claude Desktop etc.) | `create_playlist` | Yes | No |
| Save queue | Queue panel SAVE; File menu "Export Queue as Playlist" | Current queue | Yes, as `queue-*` | No |
| Weekly Jams / Exploration | Home, SAVE button | ListenBrainz generated playlist | Yes, as `playlist-*` | No |
| Add-to-Playlist panel | 19 places across album, track, playlist and friend views; drag a track onto the sidebar | Tracks | Creates or extends a playlist | No |

Not supported anywhere: Bandcamp playlist URLs (no `lookupPlaylist` in `bandcamp.axe`), Tidal, Deezer, listenbrainz.org playlist URLs or MBIDs (only the sync provider brings LB playlists in), Last.fm or Libre.fm playlists, dropping `.xspf`, `.m3u` or audio files onto the window, paste-to-import, `.m3u`/`.pls` scanning in the local files library, and saving a spinoff, radio or history session as a playlist.

## Import from URL

Code: `handleImportPlaylistFromUrl` (~L36907).

Entry points: the Import Playlist modal (~L58082, URL card labelled "Spotify, Apple Music, or hosted .xspf"), the Import button on the Playlists page (~L45582), File menu "Import Playlist..." (main.js ~L1968, menu action `import-playlist` at ~L12698), dropping a URL (next section), `parachord://import?url=`, and the hosted-playlist reload and poller.

How a URL is handled:
1. `findResolverForUrl` (resolver-loader.js ~L217) asks every loaded `.axe` whether its `urlPatterns` match. If one does and `getUrlType` says `playlist`, that resolver's `lookupPlaylist` runs and the result is converted to XSPF with `generateXSPF`.
2. Otherwise the URL is fetched with a plain renderer `fetch` and parsed by `parseXSPF` (~L28996). That parser handles XML only, so JSPF and JSON documents are not accepted on this path (they are on `play/playlist`).

Resolvers that implement `lookupPlaylist`:

| Plugin | Playlist URLs | Notes |
|---|---|---|
| spotify.axe | `open.spotify.com/playlist/*`, `open.spotify.com/intl-*/playlist/*`, `spotify:playlist:*` | Web API, 100 tracks per page. On 403, 404 or no token, falls back to scraping the embed page via the `spotify-scrape-playlist` IPC (main.js ~L3567). |
| applemusic.axe | `music.apple.com/*/playlist/*/*` | `window.appleMusicLookupPlaylist` (~L1028): a MusicKit catalog lookup. Returns nothing when MusicKit is not configured. |
| soundcloud.axe | `soundcloud.com/*/sets/*` | Needs a SoundCloud OAuth token; returns nothing without one. |
| youtube.axe | `youtube.com/playlist?list=*`, `music.youtube.com`, any URL with `&list=` | Scrapes the playlist page, stops at 100 tracks, splits "Artist - Title" on the dash. Not mentioned in the modal label. |

The imported playlist gets the id `hosted-${hash(url)}`, `sourceUrl: url`, and `source` of `${resolverId}-import` or `hosted-xspf`. The URL is also appended to the `hosted_playlists` store list. Re-importing an existing URL updates the playlist in place and sets `locallyModified` only when the content changed. Because resolver imports also carry a `sourceUrl`, they join the poller below.

The hosted fetch goes through `fetchHostedPlaylistText`, which applies `hostedPlaylistFetchProblem` (module scope, next to `isPublicHttpUrl`): the requested URL must be a public http(s) address, redirects are followed but the final URL must also be public, and the body is capped at 5 MB (roughly 10k tracks of XSPF). There is no track cap on this path.

## Drag and drop

Two different drops exist and they do different things.

**Drop a URL to import** (`handlePlaylistDrop`, ~L37109). Targets: the sidebar "Playlists" button (~L39056) and the whole Playlists page (~L45405). Accepts a resolver URL of type `playlist`, or any http(s) URL no resolver claims, which is treated as hosted XSPF. Album and track URLs are ignored here. The URL is read from `text/uri-list` or `text/plain` (`extractUrlFromDrop`, ~L9049). Saves to the library through the URL import above.

**Drop a URL to play or queue** (`handleUrlDrop`, ~L9134, via `handleDrop` ~L9584). Targets: the queue panel and the now-playing area. Album and playlist URLs go through `handleCollectionUrlDrop` (~L9161), which uses `lookupAlbum` or `lookupPlaylist` and puts the tracks at the front of the queue, or plays them when dropped on now-playing. Nothing is saved.

There is no file drop. `dataTransfer.files` is never read, so dropping `.xspf`, `.m3u` or audio files does nothing. There is no paste handler.

**Editing playlists by dragging** (not importing): dragging a track over the sidebar opens the Add-to-Playlist panel (~L38941), where a track can be dropped on a playlist row (~L62733) or on the New Playlist row (~L62476). Because Electron does not always fire `onDrop`, `handlePlaylistDragEnd` (~L9113) acts as a fallback. Playlist edit mode supports drag-to-reorder (~L45164).

## XSPF files

**Import.** "Load from File" in the Import modal (~L58278) calls `handleImportPlaylist` (~L36747), which uses the `playlists-import` IPC (main.js ~L5279). The file dialog allows `.xspf` only and checks for a `<playlist>` element. Saved as `imported-${Date.now()}` with `source: 'imported-xspf'`. One-shot.

**Export.** `handleExportPlaylist` (~L37530) writes an `.xspf` through the `playlists-export` IPC save dialog (main.js ~L6526). Reachable from the playlist header's Share menu ("Export as XSPF…"), the playlist row context menu, and the queue save dialog's "Save to file" button (the dialog's "Save" still saves into the library). Playlists created in-app carry no stored XSPF, so the document is generated from their tracks.

## `parachord://` deep links

The command switch is at ~L13306. Public docs: [protocol-schema.md](../protocol-schema.md). The website reconstructs `parachord://` from `https://parachord.com/<verb>` links, so every form below also works as an HTTPS share link.

**`parachord://import`** (~L13834) saves to the library and always shows a confirmation dialog first.
- `?url=`: must pass `isPublicHttpUrl` (~L188). On confirm it calls the URL import above, so the result is a hosted playlist that keeps updating.
- `?tracks=<base64 JSON>` with optional `title` and `creator`: rejected over 100,000 encoded characters or 500 tracks. Decoded as UTF-8. Saved as `imported-${Date.now()}` with `source: 'imported-xspf'`. One-shot.

**`parachord://play/playlist`** (~L13319) plays only and never saves. Input resolution is `resolveProtocolPlayInput` (~L13083).
- `?url=` must pass the public-URL guard, then `resolveProviderPlaylistUrl` (~L12996) applies `classifyPlaylistUrl` (~L231): `achordion.xyz/playlist/<mbid>` is fetched from `achordion.xyz/api/playlist/<mbid>/xspf`; `on.soundcloud.com` short links are resolved with a main-process HEAD request and re-checked; any other URL a resolver claims goes to its `lookupPlaylist`; everything else is fetched with `redirect: 'error'`, a 100 KB body cap, and the ListenBrainz token attached for `api.listenbrainz.org`, then parsed by `parseProtocolTracklist` (~L36833), which accepts XSPF, JSPF (including the ListenBrainz `payload.jspf` wrapper) and `{ tracks: [] }` JSON, capped at 500 tracks.
- `?tracks=` inline: same 100 KB and 500-track caps.
- `?shuffle=1` shuffles before playing.

`parachord://play/radio` starts a spinoff pool (documented in RECOMMENDATIONS.md) and `parachord://playlist/<id>` only navigates.

**Embed button and local server.** `parachord-button.js` (the embeddable web button) talks to a local server on 127.0.0.1:9876 (WebSocket `importPlaylist`, HTTP `POST /import` at main.js ~L1121). `handleEmbedMessage` (main.js ~L1426) turns those into `parachord://import?url=` or `?tracks=` links, so they go through the same confirmation dialog.

## Browser extension

Source: `parachord-extension/` (Manifest V3, version 0.4.0). Transport is Chrome native messaging (`chrome.runtime.connectNative`), through a native host that connects to the app's IPC socket (main.js ~L1191). The app forwards messages to the renderer (~L12109).

What the renderer does with each message:

| Message | Handler | Result |
|---|---|---|
| `sendToParachord { url }` | `handleSendToParachord` (~L11096), then `handleUrlDrop(url, 'queue')` | Queue only |
| `scrapedPlaylist` | `handleScrapedPlaylist` (~L11115) | Front of queue |
| `scrapedAlbum` | `handleScrapedAlbum` (~L11163), MusicBrainz release-group lookup | Front of queue |
| `addFriend { url }` | `addFriend` | Adds a friend |

Nothing the extension sends is saved as a playlist. To keep a playlist from the extension, save the queue afterwards.

Page detection in the popup (`popup.js` ~L20 onward):

| Site | Page types |
|---|---|
| Spotify | track, album, playlist, artist |
| Apple Music | track, album, playlist, artist |
| YouTube | video, playlist |
| Bandcamp | track, album, fan playlist |
| SoundCloud | track, playlist (`/sets/`), artist, likes |
| Pitchfork | album review, track review |
| Last.fm, ListenBrainz | user page (sends add-friend) |

The popup scrapes Spotify and Apple Music playlists in-page (three attempts), Bandcamp, Pitchfork and SoundCloud pages, and sends everything else as a URL. Content scripts: `content.js` (YouTube watch pages for playback events; Bandcamp track, album and playlist pages), `content-spotify.js` and `content-applemusic.js` (link intercept and playlist scraping), `content-pitchfork.js`, `content-soundcloud.js`, and `content-inline.js` on every other site, which adds up to 200 "Send to Parachord" buttons next to recognised Spotify, Apple Music, YouTube, youtu.be, Bandcamp and SoundCloud links and embeds. Context menus "Send to Parachord" and "Send Link to Parachord" cover Spotify and Apple Music albums and playlists, YouTube watch and playlist pages, and Bandcamp tracks and albums. Navigation intercept for Spotify and Apple Music track, album and playlist URLs is on by default (`spotifyInterceptEnabled`, `appleMusicInterceptEnabled`) and closes the tab after a successful send.

## Hosted playlists (`sourceUrl`)

Any URL import creates a hosted playlist. There is no checkbox and no `.xspf` extension check; any URL no resolver claims is treated as XSPF.

- **Startup reload.** `loadHostedPlaylists` (~L37219) runs two seconds after launch, deduplicates `hosted_playlists`, and re-imports every stored URL, including provider URLs, re-applying stored title and creator overrides.
- **Poller.** `pollHostedPlaylists` (~L37330) runs ten seconds after mount and then every five minutes, yielding to idle. It covers every playlist with a `sourceUrl`, fetches it through the same guarded and capped `fetchHostedPlaylistText` as the import path, and re-imports when the body differs from the stored `xspf`. For provider page URLs the body is HTML, so the comparison always differs; in practice the browser's CORS rules usually block that fetch and the failure is swallowed, so provider-imported playlists refresh at startup rather than on the poll.
- **Edits.** `savePlaylistToStore` writes only title and creator overrides for hosted playlists.
- **Sync.** The pull banner is suppressed for hosted playlists (~L44500) because the URL is canonical and any linked provider copy is a mirror. "Mirror only" is locked on (main.js ~L4735). In the classic engine the push loop skips `hosted-*` playlists for ListenBrainz unless a channel override includes them.

## Provider sync

Providers: Spotify, Apple Music and ListenBrainz (`syncProviderConfig`, ~L6590; `sync-providers/*.js`). There is no YouTube Music provider; the YouTube Music sync design in docs/plans was not built.

| Provider | Remove track | Reorder | Delete playlist | Rename |
|---|---|---|---|---|
| Spotify | by native ID | yes | yes | yes |
| Apple Music | not supported by Apple's public API | no | no | no |
| ListenBrainz | by position | no | yes | yes |

Apple Music writes degrade to append-only when Apple rejects PUT; removals stay on the remote. ListenBrainz needs a recording MBID for every pushed track and detects collaborators. Details and invariants are in CLAUDE.md under Provider-Specific Push Semantics and ListenBrainz Specifics.

**Sync wizard** (`openSyncSetupModal`, ~L11284). Opened from the Collection header Sync dropdown (~L48262), the Collection empty-state buttons, the plugin detail page in Settings (sync, Manage Sync, Stop Syncing), and automatically after Spotify authorisation completes. ListenBrainz requires the scrobbler token first. Steps: options (Playlists, Liked Songs, Saved Albums, Followed Artists, filtered by what the provider supports), playlists (All / Created by Me / Following filters, Select All, and for ListenBrainz a "Push my Parachord playlists" toggle that defaults off), syncing, complete. The checked set is seeded from saved selections plus existing `syncedFrom` and `syncedTo` links. ListenBrainz imports every playlist by default; unticked ones go to `suppressed_sync_playlists`. Start Sync runs `sync:start` with `fullSync: true` and then creates or pushes local playlists.

**Background sync** (`runBackgroundSync`, ~L6786): first run 60 seconds after launch, then every 15 minutes, and 30 seconds after the window loses focus with a 5-minute staleness gate. Background runs process a batch of the oldest-stale playlists per cycle; the wizard bypasses the stagger. A return to the foreground cancels an in-flight background sync.

**Pull and push** (classic engine). `sync:start` (main.js ~L7130) imports the selected remote playlists as `${providerId}-${externalId}`. A changed remote snapshot sets `hasUpdates`; tracks are re-fetched automatically only when the local copy is empty or the playlist is Spotify-curated. Otherwise the playlist banner (~L44466) offers Pull (`handlePull`, ~L44575), Push (`handlePush`, ~L44536), or dismiss, and shows a conflict state when both sides changed. The renderer push loop creates or updates remote copies of local playlists, skipping `localOnly` ones and honouring per-playlist channel overrides. A playlist can mirror to several providers at once; a pull from one provider marks the others for push.

**Per-playlist controls.** The "Local only" / "Syncing" pill (~L44986) appears on playlists that have `syncedTo` and no `syncedFrom`. The native context menu "Sync" submenu (main.js ~L4693) has one checkbox per provider (`sync:set-channel`, optionally deleting the remote copy) plus "Mirror only (one-way)", stored in `sync_playlist_mirror_only`. These match the Android client's channel manager.

**Engine mode.** `sync_engine_mode` is `legacy` (default), `shadow` or `new` (`sync-engine/sync-engine-mode.js`). In `new` mode the classic import, push and create steps stand down and the n-way reconciler runs every 15 minutes plus 90 seconds after startup (`runNwayArmedDrive`, main.js ~L5970). Switch in Settings, Developer Settings, "Use new sync": Preview (a dry run), then accept, or "Switch back to classic" (~L55858).

**Achordion.** After a successful ListenBrainz-anchored sync, playlist links are posted to `achordion.xyz/api/playlist-links/submit` (main.js ~L5989), fire-and-forget. `publishCollectionSmartLink` (~L15409) produces an `achordion.xyz/playlist/<mbid>` share link for a playlist that has a ListenBrainz MBID.

## Shuffleupagus chat and MCP

**Chat.** The `create_playlist` tool (~L4984, executor ~L5272) calls `createPlaylistFromChat` (~L20791), which saves `ai-chat-${Date.now()}` with creator "Shuffleupagus". It is not behind the "Share my data" gate; the other playlist tools (`get_playlists`, `get_playlist_tracks`, `add_to_playlist`, `remove_from_playlist`, `reorder_playlist`, `rename_playlist`, `delete_playlist`) are.

**One-shot AI Playlist.** Plugins with the `generate` capability (ChatGPT, Gemini) return a track list shown in a sidebar with Play, Add to Queue and Add to Playlist (`handleAiAddToPlaylist`, ~L20712, which opens the Add-to-Playlist panel). `handleAiSavePlaylist` (~L29064) and its dialog are defined but never called. The panel itself is only reachable when no chat-capable plugin is enabled.

**MCP server.** `services/mcp-server.js` serves `tools/dj-tools.js` on 127.0.0.1:9421. Of the playlist tools it advertises, only `create_playlist` works today: the MCP tool context (~L12514 onward) provides `createPlaylist` but none of the get, find, add, remove, move, rename or delete methods the other seven need, so they fail with a caught "not a function" error. See "Known gaps".

## Other ways a playlist is created

- **Save the queue.** The queue panel SAVE button (~L65283) and File menu "Export Queue as Playlist..." open the save dialog (`handleSaveQueueAsPlaylist` ~L20295), which saves the current track plus the queue as `queue-${Date.now()}` with creator "Queue".
- **Weekly Jams / Weekly Exploration.** The SAVE button on a ListenBrainz weekly playlist (~L44299) copies it into the library as `playlist-${Date.now()}` with `source: 'listenbrainz'`.
- **Add-to-Playlist panel.** Opened from album, track, playlist and friend views and from the native context menu; its New Playlist row creates `<slug>-${Date.now()}`.
- **Collection drops** (`handleCollectionDrop`, ~L39091) add to the collection, not to a playlist.

## Android

Where the code or CLAUDE.md states parity: `play/playlist` provider sniffing mirrors the mobile deep-link handler and provider playlist resolver; the Sync submenu channels and mirror-only setting match mobile's channel manager; Android auto-pulls on any snapshot change and has no pull banner; every sync field on the playlist object must be preserved by both clients. Nothing states whether URL import, the extension, hosted playlist polling, file import or the MCP server exist on Android.

## Known gaps

Found while writing this inventory; none are fixed by this document.

1. **"Sync Now" is unreachable.** The button lives inside `syncStatusModal` (~L64686), and nothing ever sets that modal open; the only explicit full sync is the wizard's Start Sync. (parachord#1009)
2. **Hosted-playlist polling of provider URLs** compares HTML bodies that always differ and is usually blocked by CORS, so provider imports refresh only at startup.
3. **The Import modal label** omits SoundCloud sets and YouTube playlists, which do import.

Fixed since the first version: the MCP playlist tools work (parachord#1008), playlist XSPF export is wired to the UI (parachord#1010), the URL import path has the public-URL guard and body cap (parachord#1011), and the chat share link host and stale line numbers in CLAUDE.md were corrected (parachord#1012; the link deliberately uses `achordion.xyz/go`, which renders a preview page, rather than the static `parachord.com/go` bounce).
