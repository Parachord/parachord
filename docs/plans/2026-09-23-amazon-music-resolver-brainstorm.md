# Amazon Music resolver

Date: 2026-09-23. Updated 2026-10-12.
Status: **shipped.** Playback is the in-app web player in `amazon-web-player.js`. Operational invariants live in [docs/architecture/amazon-music.md](../architecture/amazon-music.md) (formerly CLAUDE.md § Amazon Music Resolver).

Do not launch the Amazon Music desktop app. Do not open a remote-debugging port. That CDP approach was explored and dropped.

## What ships

Parachord runs on castlabs Electron, which includes a Widevine CDM. Amazon's page at `music.amazon.com` does the DASH license exchange. Parachord does not reimplement DASH, extract keys, or borrow a browser CDM.

- **Player and search** are `WebContentsView`s on the main window. The player is `{x:0,y:0,width:0,height:0}`. Search is parked off-window at a real size so result rows mount, and still cannot cover the app. Neither is an OS window. Neither calls `show()` or `focus()`.
- **Sign-in** is the only real window. The user has to see Amazon's page to pick a profile. `/identity/who-is-listening` and `/ap/signin` are not a finished session.
- **Play** loads `/tracks/{asin}?do=play` and waits until the media element is advancing. A failure pauses, loads `about:blank`, and does not reveal the view. Radio must not pop a window per unplayable track.
- **A superseded play** does not treat the next track's media element as its own success, and does not pause or detach that play's license listener.
- **License refusal** is a 400 from `https://music.amazon.com/*/api/dmls/*` (NA, EU, and FE). A development VMP signature is not enough for Amazon's licence server.
- **Search** scrapes the result buttons (`HorizontalItem,SearchResultsWidget_*`). The track ASIN is the like-button id, not a `/tracks/` anchor. There is no separate search JSON call.
- **Progress** comes from the media element. The poller compares the mini-player ASIN (then the page URL) to the ASIN we asked to play. It does not echo the requested ASIN, or a track change can never be seen. Duration from the element is seconds, stored as milliseconds. Album rows that only have MusicBrainz `length` still supply seconds to the playbar.
- **Quality** writes the same hornet store as Amazon's Audio Quality modal. An unrecognized tier is left alone when Auto-adjust is toggled.
- **Plugin** id `amazonmusic`, `mobile: false`. The phone apps share the marketplace and must not list a plugin that cannot play there.

## Abandoned: desktop-app CDP

An earlier spike drove the Amazon Music desktop app over `--remote-debugging-port` and `window.Native`. It only worked on the Intel Mac build, exposed a local debug port, and is not the resolver. Do not revive the launch, quit-and-relaunch, or `Native.Player.startPlayback` steps from that spike. The findings are historical only.
