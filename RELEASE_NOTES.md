# Parachord (unreleased — next release)

## Amazon Music

- **Amazon Music plays in Parachord's own player now** — the same streams and licenses Amazon's web player uses, decrypted by the Widevine CDM on every platform, no embedded Amazon web page in the audio path. Audio quality moved to a global setting (Settings → General → Playback Quality: data-saver ≤100k / standard ≤200k / high ≤500k / max = best available (lossless where your build plays it), plus adaptive streaming that roams below the corridor ceiling live); **the old per-service Amazon quality setting is reset and removed** (your previous choice does not carry over — earlier builds' choices migrate: low→saver, balanced→standard, hornet STANDARD→standard, HD/BEST_AVAILABLE→max; fresh installs start on max + auto adjust). Plays are reported to Amazon the same way the web player reports them.

---

# Parachord v0.9.11

**Release date:** 2026-10-30

> Fixes the unstyled window in 0.9.10. If you're coming from 0.9.9, everything in 0.9.10 below is new to you as well.

---

## Fixed

- **The window is styled again.** 0.9.10 shipped with almost all of its styling missing, so icons filled the window and nothing was laid out. The app itself worked; the stylesheet built for the release was nearly empty. Thanks to @prcutler for reporting it within minutes.

---

# Parachord v0.9.10

**Release date:** 2026-10-30

> A faster, steadier Parachord. The pinwheel and the freezes many of you hit are fixed: the app no longer rewrites one big file on every save, pages only redraw when their own content changes, and big local libraries (especially on spinning hard drives) no longer lock the window. Plus Discord Rich Presence, Amazon Music playlists of any length, Bandcamp links that point at the right song, and covers that come back when a cached image goes dead.

---

## Speed and freezes

- **No more pinwheel on save.** Parachord kept its caches and playlists in one settings file and rewrote the whole thing on every save, which locked the app for a moment each time. Big caches and playlists now live in their own files. Your data moves over automatically on first launch.
- **Pages redraw only when their own content changes.** Collection, Home, playlists, artist pages and Search used to redraw on every change anywhere in the app, such as a track resolving in the background. The Songs list in Collection is no longer rebuilt on each redraw either, which mattered for libraries in the tens of thousands.
- **Local libraries on slow disks.** Checking your music folder for changes held up the app while it worked, and on Windows that froze the whole window. The app also re-read the whole folder every time its window lost and regained focus. It now works in the background in small steps, and only switches to its slower background check after two minutes away.
- **Big local libraries load faster.** Artwork checks run in one batch, a changed file updates just that row instead of reloading the whole library, and the five-minute background check only reloads when something actually changed. Artwork lookup now runs for libraries over 10,000 tracks too, one album at a time, where it used to be skipped.
- **Album and artist pages no longer wait behind a background job.** Filling in missing album track counts used to compete with the pages you open for MusicBrainz lookups (one per second), and it started over at every launch. It now runs in the background lane, saves in batches, and remembers albums MusicBrainz doesn't have.
- **Concerts and Fresh Drops open from what they found last time**, then update in the background. Right after launch, both used to start from scratch: Concerts showed its loading state and fetched everything again, and Fresh Drops ran its full MusicBrainz scan at every start. Saved results that had gone stale were also never refreshed until you pressed refresh. Concerts also refreshes faster, because each concert service (SeatGeek, Ticketmaster and the rest) now has its own queue instead of waiting behind the others, and Fresh Drops no longer looks up every one of your artists on MusicBrainz again at each launch.
- **When MusicBrainz is down, Parachord says so.** Opening an album during a MusicBrainz outage used to jump to the artist's page with "Network error - please check your internet connection", even though your connection was fine. Now the album page stays open, says MusicBrainz couldn't be reached (or is busy), and offers Try Again. Parachord also waits properly between retries instead of firing them back to back, and no longer repeats the same lookup up to nine times.
- **Albums open even when MusicBrainz can't help.** When MusicBrainz is down or doesn't know an album, Parachord now gets the track list from Apple Music's public catalog (no account needed), Spotify, Amazon Music, Bandcamp, your own local files or your Subsonic server, and the album page says where it came from. If MusicBrainz is just slow, the album shows that track list after a few seconds instead of waiting, and MusicBrainz's list takes over once it arrives. Search also shows albums from these during an outage. Albums found on Spotify or Apple Music in search, and some albums on artist pages, used to never open at all; they do now.
- **Albums opened from the playbar or your Collection keep their cover while they load**, and open faster when you've just queued them.
- **Artist bios load even when MusicBrainz is down.** Parachord used to find an artist's Wikipedia article through MusicBrainz, so during an outage the Biography tab spun and then came up empty. It now asks Wikidata directly. A bio the player has already loaded also opens instantly on the artist page instead of being fetched again. And when a Wikipedia article opens with just a sentence or two, the bio now includes the article's history, without its member lists, discography or reference sections.
- **Amazon Music playback no longer churns the UI.** Small bitrate changes during a track were re-rendering the app every few seconds.
- **Amazon Music searches are much faster.** Every Amazon search used to load a full page of Amazon's web player, one at a time, so resolving a playlist paid that cost for every track. Parachord now reuses the search request Amazon's page already made, and runs several at once, so a burst of searches shares a single page load. Resolving a playlist, opening albums and finding artist photos on Amazon all speed up.

## Discord Rich Presence

Turn it on in **Settings → General → Discord Presence** and your Discord profile shows what you're listening to: title, artist, album, the cover, and a progress bar. It only shows while a track is playing, and covers are only sent when Discord can fetch them publicly. A cover from a server that puts a password or token in its address (Plex, Subsonic) is never sent; you get the Parachord logo instead.

## Amazon Music

- **Playlists of any length.** Imports used to stop at the first 100 tracks; a 977-track playlist now comes in whole. Tracks Amazon has delisted are skipped, and the count shows the difference.
- **Share links work**, including `music.amazon.com/user-playlists/…` links for playlists you made yourself.
- **Better search.** Search reads Amazon's own search results instead of scraping the page, and tries both word orders, so songs Amazon only finds with the artist first (or only with the title first) now resolve.
- **Clean titles.** Amazon puts "[Explicit]" inside track titles. It's removed now, so those tracks match other services and scrobble under their real name.
- **The version you asked for.** When Amazon listed a live cut, remix or karaoke version above the original, that's what played. Parachord now picks the exact track first, and only falls back to another version of it when that's all Amazon has.
- **Your OS shows the right track.** During Amazon playback, Control Center on macOS and the media flyout on Windows showed "Amazon Music" instead of the song, and media keys could pause Amazon's player behind Parachord's back. Both are fixed. On Linux there's now one media player entry instead of two.

## Playback and matching

- **Bandcamp links point at the song you're playing.** Bandcamp's search ranks covers, fan remixes and live versions alongside the original, and Parachord often took the first one: the Buy button could send you to a cover by someone else. Parachord now prefers the exact track, skips other versions unless you asked for one, and the Buy button won't link to them.
- **Same recording, same match.** When a result has the same ISRC or MusicBrainz recording ID as the track you asked for, Parachord treats it as an exact match, even when the service spells the title or artist differently.
- **Releases in non-Latin scripts.** On a Cyrillic, Chinese, Japanese or Arabic release, every track got the same internal id, so they all showed as playing and could play the wrong song. Each track is distinct now.
- **Deleted local files.** A track whose file is gone now plays from another service if it can, or says the file wasn't found, instead of claiming the file "could not be decoded".
- **Hi-res audio.** When a local file failed to play, the error told you to downsample hi-res FLAC or WAV. That advice was wrong: they play fine. It's gone.

## Local files

- **Remove Missing Files.** In **Settings → Local Files**, or from a track's right-click menu, you can remove files that are no longer on disk. A folder that can't be read (an unplugged drive, an offline share) is skipped and named, never treated as empty.
- **Library-only tracks** in the Collection's Songs tab offered "Remove from Collection" and then failed. They now offer Show in Finder/Folder instead.

## Album art

- **Dead covers come back.** When a cached cover image stops loading, Parachord looks it up again instead of showing a blank square. This covers album pages, Fresh Drops, Pop of the Tops and Critical Darlings.
- **Critical Darlings and charts** find covers for albums MusicBrainz doesn't know, by asking your services, iTunes and Deezer.
- **Fresh Drops** checks that a cover exists before using it, instead of remembering a guessed address for 90 days.
- **Loading skeletons** on Recommendations, and Critical Darlings' placeholders are now the same size as the cards that replace them.
- **Amazon Music and Subsonic logos** in plugin settings and on track badges.

## Artist pages

- **Discogs biographies read properly.** Bios from Discogs showed their raw markup: band members as `[a17632854]` and headings wrapped in `[b]` tags. Members, labels and releases now appear by name, and bold, italic, underline and links display as formatting.
- **Artist photos without a Spotify or Apple Music sign-in.** Artist photos on Home, Recommendations, Search, friends and in chat only came from Spotify or Apple Music, so without either you saw placeholders. Parachord now also asks your other services that have artist photos (Amazon Music among them), Deezer, Wikipedia and Discogs.

## Recommendations and sharing

- **Recommendations are recommendations.** When ListenBrainz hadn't made you a recommendation playlist yet (common for new accounts), the Recommendations page showed your own most-played tracks instead. Now it shows Last.fm's picks if you've connected it, or says that ListenBrainz needs a few weeks of listens first.
- **Last.fm friends who hide their listening.** A friend whose Last.fm profile hides recent listening looked broken: their card went quietly stale, and their Recent tab said it failed to load. Parachord now says they've hidden it.
- **Copy Link works for playlists.** Share → Copy Link on a playlist, and Copy link from a playlist's right-click menu, always said to sync the playlist to ListenBrainz first, even when it was. Synced playlists now copy their link.

## Settings

- **Local Server Port** (**Settings → General**). Spotify and SoundCloud sign-in, and the `parachord://` bridge used by Raycast, listen on port 8888. If something else on your computer already uses it, you can now pick another port (it takes effect after a restart), and Parachord tells you when it couldn't start on the one you chose. SoundCloud only accepts 8888 unless you use your own SoundCloud app credentials.

## Shuffleupagus

- **ChatGPT works with GPT-5 and the o-series**, and the Home page's Refresh button works with ChatGPT and Gemini again. A Refresh that fails now says so instead of quietly keeping the old suggestions.
- **Artists Shuffleupagus recommends in chat show their photos.** Artist cards in the chat only had a photo if Parachord had already loaded that artist's picture somewhere else; the rest showed a placeholder.

## Under the hood

- Electron 44 (castlabs, up from 39) and current versions of the app's dependencies.
- Two errors at startup fixed.
- ListenBrainz listens now record which Parachord version sent them (e.g. "0.9.10 (desktop)"), so a listen from the desktop app can be told apart from one sent by Parachord on your phone.
- Removed leftover code: the old Qobuz integration, an unused location lookup, and a Spotify permission Parachord never used.
- A large internal reorganization: the main process is split into modules, the interface is split into components, and plugins are generated from source in CI.

## Thanks

@theli-ua did a large share of this release again: Discord Rich Presence, Amazon Music playlist pagination, search and title cleanup, the OS now-playing fix for Amazon, the fix for non-Latin releases, the Electron update, and most of the internal reorganization. Thank you. Thanks also to @jphastings, whose Plex work is where the ISRC matching came from.

---

# Parachord v0.9.9

**Release date:** 2026-10-17

> Two new ways to play: Amazon Music, streamed inside Parachord, and your own Subsonic server (Navidrome, Airsonic, Gonic and friends). Album pages open the moment you click, Fresh Drops and Recommendations scroll smoothly, and AI-recommended tracks finally show their album art. Plus a Custom LLM option for Shuffleupagus, and a lot of fixes from a very productive week of contributions.

---

## Amazon Music

Parachord can now play Amazon Music. Enable the Amazon Music plugin, sign in with your Amazon account, and Amazon tracks show up in search, resolution and playback like any other service. Playback runs through Amazon's own web player inside Parachord, decrypted by the Widevine module that arrived in 0.9.8, so there is no Amazon desktop app to install or keep open.

- **Audio quality** is a setting in the plugin's section: Standard, Data Saver, or HD / Ultra HD (lossless, where your subscription includes it). Parachord measures what it is actually receiving and shows it when you hover the title in the now-playing bar.
- **Playlist import** works for `music.amazon.com/playlists/…` links, from the import dialog or a `parachord://play/playlist` link.
- You need an Amazon Music subscription for full tracks, and this needs the signed release builds (the ones from the Releases page), not a local build from source.
- I tested this on a Mac. Reports from Windows and Linux are welcome on [#983](https://github.com/Parachord/parachord/pull/983).

## Subsonic servers

If you run Navidrome, Airsonic, Gonic, or anything else that speaks the Subsonic API, Parachord can search it and stream from it. Enable the Subsonic plugin, enter the server address, username and password, and your library is a source like any other. Sign-in uses Subsonic's token scheme, so your password is never sent in a URL. Hovering the title in the now-playing bar shows the file's codec, bit rate and sample rate as the server reports them.

## Album pages open instantly

Clicking an album used to show nothing for a second or more, sometimes much longer, before the page appeared. Parachord was waiting for MusicBrainz, which allows one request per second, before changing views, and hover previews were queued ahead of your click. Now the page appears at once with the title and cover, the tracks follow, and an album you have opened before comes straight from the cache with no request at all. This applies to Fresh Drops, Charts, Critic's Picks, the home page cards, and the album art in the now-playing bar.

- **The now-playing album art always opens the album page**, whatever you are playing from. It used to work only when you had started playback from that album's page.
- **Smooth scrolling on Fresh Drops and Recommendations.** Both pages stuttered while tracks resolved in the background. Updates are now batched, and hovering a card no longer fires a lookup until the pointer rests on it.

## Album art everywhere

Every surface now uses the same artwork lookup, which ends with iTunes and Deezer as fallbacks. The visible effect: tracks suggested by Shuffleupagus, which used to render without covers, now get art like everything else.

## Custom LLM for Shuffleupagus

Shuffleupagus can now talk to any OpenAI-compatible or Anthropic-compatible endpoint, not just the named providers: LM Studio, vLLM, llama.cpp, OpenRouter, Ollama's `/v1`, or a hosted API with its own address. Set the API style, the base URL, an optional key, and a model (typed freely, with the endpoint's model list as suggestions). A Reasoning setting controls thinking on models that support it, and a model that spends its whole budget thinking no longer comes back as a blank reply.

## Local files

- **Network shares.** Seeking in a file on an SMB or NFS share failed with "the file may have been moved or deleted" while the file was right there. Seeks and transient read errors are retried; a genuinely missing file still fails cleanly.
- **Stream quality on hover.** Hover the title in the now-playing bar to see the exact parameters of what is playing (for example `FLAC · 44.1 kHz · 16-bit · 847 kbps`). Local files, Amazon Music and Subsonic provide this; other services show the title as before.
- **Adding a library no longer stalls the app.** Library enrichment used to sit in front of search, artist pages and even pressing play for minutes after launch. It now runs behind anything you ask for directly.

## Recommendations and discovery

- **Blocking works.** Telling Shuffleupagus to never recommend an artist, album or track now actually keeps it out of Recommendations, Fresh Drops, the home suggestions and chat. The chat also offers the block tool, as the prompt always claimed.
- **Fresh Drops** no longer silently skips artists when MusicBrainz is slow, and its unread badge (and the Concerts one) survives a restart.
- **Critical Darlings** are remembered between launches instead of reloading every time.
- **Concerts** stop tripping Ticketmaster's rate limit, which was leaving events out.
- **Artist radio links** (`parachord://play/radio?artist=…`) work; they used to fail quietly.

## Playlists and sync

- **"Local only" stays local.** Editing the tracks of a playlist marked local only used to switch sync back on for it.
- **Export as XSPF** is reachable: from the playlist's Share menu, from the playlist's right-click menu, and as "Save to file" in the queue save dialog.
- **The Library Sync window and its "Sync Now" button** are reachable again.
- Playlists mirrored from a web address are fetched with size and address checks, and a streaming-service playlist page is no longer mistaken for one of them (that caused an "Import Failed" message at startup for a playlist that had imported fine).

## Under the hood

- While ListenBrainz's MBID mapper is down (it has been since late September), Parachord falls back to the ListenBrainz labs lookup, so scrobbles keep their MusicBrainz IDs and ListenBrainz playlist sync keeps working.
- Album tracklists from MusicBrainz are cached, so reopening an album costs no request.
- Skipping tracks no longer pauses your Spotify session when Parachord is playing from somewhere else.
- The "Track Re-resolved" dialog names the service that failed.
- The MCP server's `seek`, `get_position` and `block_recommendation` tools, and its playlist tools, work; they were advertised but not wired up.
- Plugins are now generated from source files, so a plugin update cannot drift between the bundled copy and the marketplace.

## Thanks

Most of this release came from @theli-ua: Amazon Music, the Subsonic resolver, Custom LLM and its reasoning support, stream quality on hover, the network-share fix, the unread-badge fix, and the plugin build pipeline. Thank you.

---

# Parachord v0.9.8

**Release date:** 2026-10-11

> Apple Music should now play full tracks on Windows and Linux, not just 30-second previews. Spotify on Windows stops skipping through albums in silence, and media controls on Linux behave the way you'd expect.

---

## Full Apple Music tracks on Windows and Linux

On Windows and Linux, Apple Music only ever played 30-second previews. The cause turned out to be deeper than sign-in: the version of Electron Parachord was built on (the engine underneath the app) can't play copy-protected music at all. Parachord is now built on a version of Electron with Google's Widevine content protection, the same technology Chrome uses for Apple Music, Amazon Music and other streaming services, and its builds are certified to use it.

- The first time you launch this version, Parachord downloads Google's Widevine module in the background. That launch can take a few extra seconds; after that it's instant.
- This also lays the groundwork for more streaming services that need the same protection, on every platform.
- I tested full playback on a Mac but don't have Windows or Linux machines with Apple Music to test on. If it still plays only previews for you, please say so on [#882](https://github.com/Parachord/parachord/issues/882).

## Spotify fixes

- **Albums no longer skip in silence on Windows.** Right after you pressed play, Parachord checked what Spotify was playing. The Spotify desktop app takes a few seconds to wake up, so it answered "nothing", and Parachord took that as the track ending and skipped to the next one, all the way through the album. Parachord now waits for playback to actually start, and nudges Spotify once more if it hasn't.
- **No more endless Spotify sign-in loop.** With Library Sync open, signing in to Spotify could send you back to the consent screen again and again. That's fixed; if Spotify refuses a sync request for another reason, you'll now see the actual error instead.
- **Clearer setup steps.** The Spotify setup instructions now tell you to tick both **Web API** and **Web Playback SDK** when creating your Spotify developer app. Without the second one, playback can fail.

## Media controls on Linux

- **Pause no longer starts music.** Sending Pause while already paused (from a desktop widget, `playerctl`, or KDE Connect pausing for a phone call) used to start playback instead. Play and Pause now do exactly what they say.
- **One key press, one action.** A media key could reach Parachord twice and toggle twice, looking like nothing happened. Parachord now ignores the duplicate.

## Under the hood

- Plugin housekeeping: Parachord no longer re-downloads the SoundCloud, ChatGPT and Gemini plugins on every launch (or logs that it's "downgrading" them). A version mismatch in the plugin catalog made them look out of date.

---

# Parachord v0.9.7

**Release date:** 2026-09-23

> A reliability release. Your Mac and Windows PC now show what Parachord is playing — title, artist, artwork and working controls — in the system Now Playing widget. Search is steadier, and Bandcamp search works again.

---

## Now Playing on macOS and Windows

Parachord now tells your operating system what's playing. On macOS, the Now Playing widget and Control Center show the track's title, artist, album and artwork instead of just "Parachord Desktop", and the widget's play/pause and next/previous buttons control Parachord. The same information now appears in the Windows media overlay.

- A single media-key press now always acts once — it can no longer toggle twice and look like nothing happened.
- Apple Music playback through the native macOS player is now labeled **Parachord** (it read "Parachord MusicKit"), and so is the Apple Music permission prompt. Existing permissions carry over — no need to sign in again.
- Tracks that play in another app — YouTube and Bandcamp in your browser, or Spotify in the Spotify app — still appear under that app, which is where their controls live.

## More reliable search

Search could come back empty or with missing sections, then work fine a minute later. Parachord was sending MusicBrainz several requests at once for every search, and MusicBrainz has recently tightened how many it accepts. Parachord now paces its MusicBrainz requests and backs off politely when asked to slow down, so results fill in reliably. It also now identifies itself properly to MusicBrainz and ListenBrainz, as those services now require.

## Bandcamp search works again

Bandcamp started blocking the search page Parachord relied on, so Bandcamp quietly stopped finding tracks. Parachord now uses Bandcamp's search service instead — it finds more tracks and matches them more accurately. (This fix also reaches existing installs automatically the next time you launch Parachord.)

---

# Parachord v0.9.6

**Release date:** 2026-07-15

> Two focused improvements. Playback is now **lighter on your machine** — Parachord no longer redraws its whole interface on every progress-bar tick, so long listening sessions use less CPU and battery. And **Critical Darlings** moves to a new, more reliable data source as its old feed is retired — with no interruption to the list you see.

---

## Smoother playback

While a track plays, the progress bar updates several times a second. Parachord used to re-render its **entire** interface on every one of those ticks — a constant, invisible tax on CPU and battery. Now only the progress bar updates on a tick, so playback feels lighter and your fans stay quieter during long sessions. Nothing about how playback looks or works changes — it's purely more efficient under the hood.

## Critical Darlings: new source

The Critical Darlings page previously pulled from a third-party feed (RSSground) that's being retired. It now sources from **Achordion**, Parachord's companion discovery service. The switch is seamless: while Achordion's catalog fills in, the page stays full by blending in recent picks, and it converges to the new feed automatically as it grows. No action needed on your end.

---

# Parachord v0.9.5

**Release date:** 2026-06-30

> The headline: an all-new **opt-in sync engine** that finally makes playlists *multi-master* — edit on any service (or a shared playlist someone else owns) and your change rounds-trips everywhere, instead of one service always winning. It ships behind a preview-and-accept flow, so you see exactly what it would change before anything is written, and you can switch back anytime. Plus a deep batch of sync fixes that help **everyone** whether you opt in or not: playlists you follow no longer get duplicated as your own, Apple Music stops creating duplicate entries, track matching is more accurate, and ListenBrainz sync stops hammering MusicBrainz when it's slow. New animated startup, faster launch, and graceful handling of Spotify's new 6-month session expiry round it out.

---

## New: try the new sync engine (opt-in)

Classic sync treats one service as the source of truth — edits elsewhere get overwritten. The **new sync engine** treats every copy of a playlist as equal: an edit on Spotify, Apple Music, ListenBrainz, *or* a collaborative playlist owned by someone else all merge together and propagate to your other services.

It's opt-in and cautious by design:

- **Settings → General → "Use new sync" → Preview.** Parachord runs the new engine against your library **without writing anything** and shows you the exact diff — every track it would add or remove, per service.
- **Nothing changes until you click Accept.** If the preview looks wrong, there's a "Report a problem" button instead.
- **Reversible anytime** with "Switch back to classic."
- **Per device.** Each device opts in separately — if you use Parachord in more than one place, switch them all so they stay in lockstep (the preview reminds you).

Highlights it unlocks: **collaborative playlists round-trip** (your edits to a playlist someone shared with you push back to the original), and **playlists you only follow stay mirror-only** (read in, never re-created as your own).

## Sync got more accurate and more reliable — for everyone

These land regardless of whether you opt into the new engine:

- **No more duplicate copies of playlists you follow or collaborate on.** Following a Spotify playlist (or collaborating on one someone else owns) could spawn a second copy *authored by you* that reappeared even after you deleted it. That's fixed at the source, and existing duplicates can be cleaned up from the sync settings.
- **More accurate track matching.** Sync no longer guesses a wrong-song match when it can't find an exact one (e.g. resolving "Intro" by The xx to a different artist's "Intro"). Apple Music now matches by ISRC in *your* storefront, so you stop getting duplicate Apple Music entries for the same recording.
- **ListenBrainz sync is far gentler on MusicBrainz.** When the LB mapper is slow or down, sync now paces its lookups and remembers misses (instead of re-querying every un-findable track every cycle), and retries transient failures with backoff. ListenBrainz playlist pushes no longer give up on a single hiccup.
- **Spotify rate-limit backoff.** If Spotify hard-limits requests, Parachord now stays backed off instead of re-hammering and prolonging the limit.

## Better track matching across the app, via ISRC

Parachord now captures the **ISRC** (the standard recording identifier) from Spotify, your local files (ID3/Vorbis/MP4 tags), and Apple Music, and uses it everywhere it matters — loving a track, scrobbling, and sharing all resolve to the *right* recording more often. Notably, this keeps loves and scrobbles resolving even when the MusicBrainz mapper is having an outage.

## Spotify session expiry, handled cleanly

Spotify is introducing a **6-month limit on sign-ins** (effective 2026-07-20). When your session expires, Parachord now cleanly detects it, clears the dead session, and prompts you to reconnect — instead of silently failing to sync. Redundant token refreshes are also collapsed so a burst of activity doesn't stampede Spotify's auth.

## New startup experience + faster launch

- A new **animated wordmark splash** on launch, with a smooth hand-off into the app.
- **Faster cold start** — the app no longer waits on a release-notes fetch before becoming interactive, and uses a startup code cache.
- **The window no longer jumps** on open — its size and position are remembered between launches.

## Smaller fixes

- **AI Chat:** links in messages are now clickable, and you can select and copy message text.
- **Fresh Drops** no longer lists release-groups more than two weeks out, so "new releases" actually means new.
- **Share links** open the right thing: a Spotify / Apple Music / SoundCloud playlist URL now plays directly, and the new smart-link redirector works on iOS.
- **Plugins** screen shows a loading skeleton instead of a "Loading…" line.
- **Gemini** API-key errors now explain what to enable and link straight to the key-creation page.
- **Linux:** media-key / now-playing (MPRIS) initialization fixed. **Apple Music** re-injects your user token correctly when checking auth status.

---

# Parachord v0.9.4

**Release date:** 2026-06-05

> A Linux release. Three Linux blockers from the last few months land together — Apple Music sign-in finally works, `playerctl` and KDE/GNOME media widgets see Parachord with full now-playing metadata via MPRIS, and the AppImage MCP config path is now stable across restarts. Plus a batch of sync fixes that benefit every platform: tracks you remove from Collection actually stay removed, Daily Brew auto-updates instead of nagging you, and ListenBrainz scrobbles now carry source URLs + MBIDs so the rest of the LB ecosystem knows where you streamed from.

---

## Linux: Apple Music, media keys, and a stable MCP path

Three independent issues that all blocked Linux users land in this release:

- **Apple Music sign-in works on Linux and Windows.** The MusicKit JS auth popup never worked on these platforms because Electron's session-level "block third-party cookies" gate prevented the popup → parent handshake. Parachord now opens a dedicated browser window against `beta.music.apple.com` directly, harvests the auth cookies on success, and reinjects the user token into the main window's MusicKit JS instance. Library sync runs end-to-end. Verified across five test rounds with two Linux testers (Fedora + Arch). Thanks @dyland84 and @moop250.
- **Linux media keys + DE widgets via MPRIS.** Parachord now registers on `org.mpris.MediaPlayer2.parachord`, so `playerctl`, KDE Plasma media widget, GNOME media widget, and any other MPRIS client sees now-playing track metadata (title, artist, album, art) and routes play / pause / skip / previous controls. The existing `globalShortcut` media-key path still works; MPRIS adds a second dispatch path that DEs typically prefer. (v1 limitation: the progress slider in DE widgets is read-only — interactive seeking via MPRIS is a follow-up.)
- **AppImage MCP config path is now stable.** AppImage mounts itself at `/tmp/.mount_<RANDOM>/` on every launch, so the MCP `stdioPath` Parachord exposed via Settings was going stale on every restart. The bridge is now extracted to `~/.config/Parachord/mcp-stdio.js` once per launch — copy that path into your MCP client config once and it stays valid across restarts and upgrades. Thanks @theli-ua for the precise repro.

## Removed tracks stay removed

Tracks you delete from your Collection no longer silently reappear on the next sync. Two intersecting bugs caused this:

- The Spotify `removeTracks` provider was hitting a non-existent `/me/library` endpoint instead of `/me/tracks` — a regression in an earlier "unified library API" attempt. Local removal succeeded but the remote DELETE silently failed, so the next sync re-imported the still-present track from Spotify.
- Apple Music has no public-API removal endpoint at all (their library DELETE returns 401), so AM-sourced track removals were guaranteed to revert on the next sync no matter what we did.

Fixed both. The Spotify endpoint now hits `DELETE /me/tracks` with the correct body. For Apple Music — and as defense-in-depth for any future Spotify failure — a new **track-level tombstone** mechanism persists every "user removed this on purpose" intent keyed by `(provider, externalId)`. The sync diff filters remote items against this list before adding, so user intent stays sovereign regardless of whether the remote-remove API works.

Tombstones expire after 365 days of no sync confirming the remote still has the track, and clear automatically when you re-add the same track via the UI.

## Daily Brew (and friends) update silently

Spotify's algorithmic playlists — Daily Brew, Discover Weekly, Release Radar, Daily Mix N, Daylist, New Music Friday — used to flag the "pull updates" banner every morning when their content rotated. Pure UX nag for content you can't meaningfully reject or edit.

Sync now detects Spotify-curated playlists (those owned by Spotify itself rather than your account) and silently auto-adopts their daily updates. No banner, content refetches in the background, tomorrow's Daily Brew shows up tomorrow. The banner still appears for your own playlists where local-edit conflicts are real and worth your confirmation.

## Phantom macOS Apple Music re-auth dialog gone

The native macOS "Sign in to your Apple Account" dialog used to pop up unexpectedly during routine sync runs, asking for re-authentication that wasn't actually needed. Root cause: the native MusicKit helper was passing `.ignoreCache` to every user-token fetch, forcing a server round-trip that Apple sometimes responded to with a sign-in prompt.

Fixed: only the explicit recovery path (after Apple returns 401 on a real request) busts the cache. Routine fetches use MusicKit's local token cache and stay quiet.

## ListenBrainz scrobbles carry source URLs and MBIDs

Every Parachord-emitted ListenBrainz scrobble now includes:

- `origin_url` — the URL of the source you actually streamed from
- `music_service` and `music_service_name` — canonical hostname + label
- `spotify_id` — when you have a verified Spotify source on the track
- `recording_mbid`, `release_mbid`, and `artist_mbids` — when known

Two benefits:

1. **LB profile UX.** Scrobble rows can render "Listen on Spotify / Apple Music / etc." links from the source URL the user actually heard.
2. **Achordion match cache.** The shared community track-links cache can key by MBID for any Parachord-played LB-scrobbled track, even when the achordion submit plugin's confidence gate excluded it.

## MCP `seek` tells you where it actually went

The MCP `seek` tool used to report the requested offset as `confirmedMs` even if the audio engine clamped to a different position (end-of-track, DRM boundaries, edge cases on some Apple Music tracks). The Apple Music paths now query the engine for the actual position after the seek and report that. Thanks @gjtorikian for the careful PR review that surfaced this.

## Smaller things

- **`canShortCircuitPlaylistUpdate` log line.** Short-circuited playlist updates are now distinguishable from "never reached" in sync traces — useful when debugging "why didn't sync update playlist X."
- **Three-`if` Apple Music seek branch documented as intentional.** The seek path tries native → MusicKit JS → preview audio as independent branches (not else-if) so each branch can silently recover when a more-preferred engine is unreachable. Now there's a comment explaining why.
- **Mobile-parity rule documented in CLAUDE.md.** The implicit pattern of filing parachord-mobile parity tickets alongside desktop changes is now a documented process rule. Catches cross-platform drift before it hits sync corruption.

---

# Parachord v0.9.3

**Release date:** 2026-05-21

> A performance release. The background sync subsystem that used to spike CPU to 120% and pinwheel the UI for tens of seconds is rebuilt around eight reinforcing fixes; the last few unscrolled track lists are now virtualized; Library art appears on first paint instead of after a warmup loop; and the collection file is now corruption-resistant. ListenBrainz playlist sync ships as a new feature too, with multi-platform collaboration as the marquee.

---

## Background sync stops fighting the rest of the app

The biggest behavioral change in this release. Earlier versions could pin a CPU core for tens of seconds during background sync, lock the UI with a pinwheel, glitch playback timing, and — for users who interacted with the app while sync was running — kill the in-flight sync entirely. Rebuilt around eight reinforcing fixes:

- **Skip unchanged playlists on inbound updates.** When local and remote snapshot IDs already match, sync just bumps the timestamp and moves on — no spread-rewrites for playlists that haven't drifted. New log line so you can tell "short-circuited, no work" apart from "never reached" when debugging.
- **Concurrency cap on resolver searches.** Non-Apple/Spotify resolvers (Bandcamp, SoundCloud, YouTube, etc.) now share a global limiter — 4 concurrent, 100ms gap, exponential backoff on throttle. Stops the "374 local files all fire a Bandcamp search at once" pattern that pinned CPU on every library load.
- **Push loop yields to idle.** The renderer-side per-playlist push loop wraps each iteration in `requestIdleCallback` so it only does work when the renderer is otherwise quiet. Sync no longer competes with scroll/animation/click handling for the main thread.
- **Cancel-on-focus, correctly.** When you cmd-tab back from another app mid-sync, sync now aborts at the next safe yield point and writes the partial result instead of hanging the UI for tens of seconds. Importantly: cancellation only fires on actual blur → focus transitions now, not on every in-app interaction. Earlier versions were canceling sync on every sidebar click, panel switch, and DevTools focus event — effectively starving sync for any user who actively used the app.
- **Cancel honored inside library fetches.** Spotify's paginated library fetch now checks the cancel signal at every page boundary. Cmd-tab-back no longer gets stuck waiting for the next 50-track API page to land.
- **Per-provider playlist mutex.** Two code paths (background timer + post-wizard sync) used to race for the same playlist creation, occasionally creating duplicate remotes. They now coordinate via a per-provider mutex.
- **Playlists are synced in staggered batches.** Instead of churning all selected playlists every 15 minutes, the inbound loop processes a small batch per cycle, oldest-stale first. A user with 50 playlists rolls through the whole set in ~2.5h worst-case rather than pinning a CPU core every quarter-hour. Manual "Sync Now" still does everything immediately.
- **Hosted-XSPF poll yields to idle.** The 5-minute external playlist check now runs during a quiet renderer frame instead of fighting whatever else is on the main thread.

Net effect: open the app, work, sync happens while you're away. No spinning fan when you walk back to your desk, no killed sync because you clicked the sidebar, no playback hitches mid-track.

## Faster track lists, everywhere

Virtualization now applies to the last few places that were still rendering every row:

- **Library tracks list.** Previously sluggish on libraries of 10k+ tracks; smooth at any size now.
- **Playlist tracks.** Long playlists no longer jank when you scroll.
- **Search results.** Big result sets render incrementally.

Combined with the row-memoization work from v0.9.2, scrolling and navigation on large libraries should feel substantially snappier.

## Library album art appears on first paint

Tracks loaded into the Library view now surface album art from three sources immediately instead of waiting for play-time resolution:

- **Folder art** (`cover.jpg` / `folder.jpg` next to your audio files).
- **Embedded art** baked into ID3 tags (when the cache file has been previously extracted).
- **Cover Art Archive art** that was fetched and cached during a previous playback session.

Previously only the play-time resolver path saw all three — bulk Library loads saw none of them, so well-tagged collections showed placeholders even though the art was on disk. Mature collections will notice the difference most.

## ListenBrainz playlist sync (new)

You can now connect ListenBrainz as a full playlist sync target alongside Spotify and Apple Music, with **cross-service collaboration** as the marquee.

- **Push and pull playlists.** Local playlists mirror to LB; LB playlists pull into Parachord. JSPF format on the wire, recording MBID as the per-track identifier.
- **Multi-platform collaboration.** A Spotify user and an Apple Music user can share an LB playlist where either's edits propagate to both streaming services via LB as the hub. Bob edits on Apple Music → LB picks it up → Alice's Parachord pulls and pushes to Spotify. A "SHARED" badge in the playlist UI shows which playlists you're collaborating on.
- **Default private.** Playlists pushed to LB start private. Make them public on listenbrainz.org if you want others to see them.
- **MBID-required tracks** are surfaced clearly. Tracks without a resolvable recording MBID are listed so you can see what didn't push.

The sync setup wizard now includes ListenBrainz alongside the other providers.

## Achordion playlist mirror links

After any sync write that creates or updates a ListenBrainz-anchored playlist, Parachord pushes the LB MBID and its mirror links (Spotify, Apple Music) to Achordion. The result: a public `https://achordion.xyz/playlist/<mbid>` URL where anyone can see all the streaming-service mirrors of a shared playlist in one place — handy for sharing a collaborative playlist across services when each collaborator uses a different one.

Apple Music mirror links are now included for any iCloud-synced library playlist — earlier versions had to omit them because the library URL form (`/me/library/playlists/<p.X>`) only works for the owner. The fix builds the public-share form (`/playlist/<slug>/<pl.u-XXXX>`) using the playlist's catalog `playParams.globalId`, which any Apple Music user can open.

Playlist share URLs in the app also now point through Achordion for the same reason — richer metadata, single canonical link.

## Hosted XSPF playlists no longer duplicate on sync

If you imported the same hosted XSPF URL on both desktop and Android, sync used to create two remote copies. Fixed: `syncedTo` and `sourceUrl` are preserved across re-imports, so the second device recognizes the first device's already-synced mirror and reuses it instead of creating a duplicate.

## Collection file is corruption-resistant

`collection.json` is now written via an atomic-rename pattern (write to `.tmp`, then rename). If the app crashes or is force-quit mid-write, the canonical file is left in either the old or new state — never partially written. The "Unterminated string in JSON at position N" load failure that some users were hitting after force-quits is gone.

## Smaller things

- **Diagnostic logs around sync.** Local/remote track counts and snapshot previews are logged when a "has updates" diff fires, so it's easier to tell whether a flagged update is real or noise.
- **ListenBrainz username caching** avoids redundant token-validate calls — two per sync cycle instead of two per friend.
- **Heal pass for imported playlists with the wrong `syncedFrom` resolver** runs on every startup. Fixes a class of corruption that a now-removed code path used to introduce; cross-platform sync is more robust as a result.
- **Auto-creating LB mirrors of local playlists is opt-in.** Previously this happened silently for some playlist shapes; now it requires an explicit toggle.
- **Removed log spam** around Apple Music false-positive "has updates" detection.

---

# Parachord v0.9.2

**Release date:** 2026-05-08

> Goodbye, "beta." Build numbers drop the suffix starting with this release. Same Parachord, cleaner version string.

---


## Achordion: community-powered match cache

Parachord can now contribute verified resolver matches to [Achordion](https://achordion.xyz), a shared community cache of "this track on MusicBrainz = these streaming URLs." After a track plays at high confidence, its match is submitted so other Parachord users can skip the search step on the same track. No personal data is sent.

- Ships on by default. Disable via the Plugins tab if you'd rather not contribute.
- New **"View on Achordion"** right-click options on tracks, albums, and artists.
- Share links and embed codes now go through Achordion for richer metadata and faster lookups.

This is the **submit** half. The **consume** half — skipping live resolver searches when Achordion already has a hit — is coming next.

## Faster, especially on big libraries

A package of performance work, with the biggest wins on libraries with thousands of local files:

- **Cold launch is noticeably snappier.** Heavy work (album art cache, artist data, Apple Music init, marketplace sync) now hydrates in the background instead of blocking the window from opening.
- **Importing huge local libraries no longer freezes the app.** One user reported a 150k-track library locking things up for tens of seconds — that path is now smooth, with a progress toast so you know what's happening.
- **Embedded album art shows up immediately.** If your local files have art baked into their ID3 tags or a sibling `cover.jpg`, it now appears in the library list right away instead of only when you play the track.
- **DevTools is usable again.** Removed render-path log spam that was making the console unreadable on big libraries.

## Album page fixes

- Tracks now resolve correctly when you navigate directly to an album page (previously, some album views appeared empty).
- Two slowness bugs in album resolution are gone — pages load substantially faster on slower connections.
- Albums where no resolver could match any track now grey out the unavailable tracks, so you can tell at a glance what's reachable on your enabled providers.

## Smarter, calmer track resolution

The background work that figures out where each track is playable on your enabled services has been retuned to do less work, in a smarter order:

- **Tracks you're looking at resolve first.** Whatever's on screen — the album you just opened, the playlist you're scrolling, the artist page you're browsing — gets priority over background pre-resolution. Hovered tracks jump the line; queued tracks jump even higher.
- **No more flooding on album/release pages.** A bug was causing every track on a release page to fight for resolution at once, racing against your queue and slowing both down. Visible tracks now resolve in order; off-screen tracks wait their turn.
- **Less churn at idle.** Background pre-resolution no longer constantly re-checks tracks that already have a confident source — it focuses on the unresolved ones and goes quiet when there's nothing to do.
- **Stale match scores are re-evaluated on launch** so tracks resolved before the v0.9.1 confidence fixes get the benefit without you having to replay them.

The net effect: less network and CPU activity, faster results where you're actually looking, and fewer mystery "No Source Found" dialogs from cached scores that no longer apply.

## Listen-along works again

Starting listen-along from the friends sidebar was silently failing for some friends after the v0.9.1 confidence-scoring changes. Fixed — listen-along is reliable again, including for tracks with non-Latin titles (Japanese, Cyrillic, etc.) which were also being dropped.

## Better bug reports

Settings now has a **"Copy Diagnostic Log"** button that grabs the last 2,000 log lines from this session. If you hit a bug, please attach the output to your bug report — it tells us a lot more than a screenshot.

## Cache cleanup

Fixed a subtle issue where some tracks appeared as "no resolver found a match" forever, even after upstream resolvers were fixed. Affected tracks now re-resolve cleanly once on next play.

## Smaller things

- "Copy link" hover button removed from Critical Darlings and Charts — it was crowding the UI.
- Library scan now toasts progress so you can navigate away from the scan screen and still see what's happening.

---

# Parachord v0.9.1-beta.4

**Release date:** 2026-05-05

---

## Resolver matching reliability

A regression in the resolver-confidence logic was attaching wrong-artist matches as playable sources. The badge would render but selection at click time would silently drop the bad match — leaving the user with a "No Source Found" dialog despite a resolver icon being visible. Hardened across multiple paths:

- **Both-axes match required** — `calculateConfidence` now requires title AND artist to containment-match (was title + duration; ignored artist entirely). Wrong-artist hits collapse to 0.5. Mirrors the Android client's earlier fix; both clients now share the same selection semantics. (#759)
- **0.6 confidence floor at source selection** — wrong-song sources are dropped before the priority sort runs.
- **All 8 resolution paths gated** — below-threshold sources never enter `track.sources` in the first place; no badge, no dropped-at-click surprise.
- **Stale cached confidence values re-scored on hydration** — fixes the "No Enabled Source" dialog firing on tracks whose cached entries had legitimate sources but pre-fix low confidences.
- **Badge dim is now relative-to-best** — when a track has both a 0.95 fuzzy match and a 1.0 direct-ID match, the 0.95 dims so users can see at a glance which resolver has the strongest match.

## Scrobbler & loved-tracks push

- **Love-push toggle now persists across restarts.** `scrobbler_love_push_enabled` and `love_pushed_keys` were missing from the IPC store whitelist — writes were silently blocked at the IPC layer with the warning swallowed by the renderer. Toggle appeared to "uncheck itself" on every restart, and the backfill kept re-pushing the same loves because its idempotency cache never persisted. Existing user state self-heals on the first toggle re-check after upgrade.
- **Last.fm scrobbling tolerates transient auth errors.** Last.fm occasionally returns error code 9 ("Invalid session") during transient backend hiccups (rate-limit windows, replication lag). Previously, a single such blip cleared the session and forced re-authentication. Now requires 3 consecutive auth errors before clearing; any successful API call resets the counter. Below threshold, scrobbles get queued for retry instead of dropped.

## Protocol command UX

Slow `parachord://` commands (play/album, play/playlist, play/radio, listen-along, etc.) used to leave the app appearing unresponsive for several seconds while the URL resolved into a tracklist. Three improvements:

- **Acknowledgment toast** at the URL handler entry: "Loading album…", "Loading playlist…", "Loading radio[: name]…", "Looking up \"X\" by Y…", "Importing…", "Opening chat…", "Connecting to <user>…". Held for 30s so it stays visible through cold-cache resolution (URL fetch + JSPF parse + lookahead resolve, can take >5s).
- **Playbar shows loading state immediately.** Prior track info clears and a shimmer placeholder appears with the best-known title — no more lingering "currently playing" info during the gap.
- **Failed protocol commands clear the placeholder** instead of hanging on "Loading…" forever.

## Auto-skip on playback failure

In spinoff/radio sessions and queue auto-advance, a single unplayable track no longer interrupts playback with a modal. All 8 failure dialogs in `handlePlay` (No Source Found, No Enabled Source, Local Playback Error, SoundCloud Not Connected, SoundCloud Playback Error ×2, Track Re-resolved) auto-skip + advance when in an auto-advance context. User-initiated single-track plays still surface the dialog so you know what failed.

## Radio Mode C reliability

`parachord://play/radio` (externally-curated radio with `?url=` or `?tracks=`+`?refill=`) now pre-resolves the next 2 lookahead tracks before handing the first to handlePlay. Without the lookahead, on heavy-CPU systems track 2's resolution could miss the auto-advance window when track 1 ended — handlePlay would fall into the on-demand resolution path and race against the previous track's teardown, producing a "skip after a couple of seconds" symptom. Bounded ~1s of extra latency before the first track plays buys deterministic auto-advance.

## "Open Resolver Settings" button (#762)

When the "No Source Found" / "No Enabled Source" dialog DOES legitimately fire, it now has a one-click **Open Resolver Settings** button alongside OK — no more hunting through Settings → Plugins manually.

## Resolver scheduler & priority work

- **Release page no longer floods `resolveTrack` on load.** The bulk loop that resolved every album track at once (uncoordinated with the scheduler, racing against queue/hover priority) is gone. Visible tracks resolve at page priority via the existing IntersectionObserver-driven context; below-fold tracks resolve through background pre-resolution when the scheduler is idle.
- **Page coverage audit:** queue (priority 1), hover (2), pool/spinoff (3), collection / release / playlist / search / recommendations / charts-songs / history / top-tracks / friend-history (all 4), pinned friends sidebar (5), background (6).

## Other

- `showToast` now accepts a `duration` option (in ms) to override the 3s/6s default — used by protocol acknowledgments.
- Confirmation dialogs now support an optional `actionButton: { label, onClick }` — used by the resolver-settings shortcut above; available for any future "fix this" dialog.
- Silenced harmless "updateVisibility called for unregistered context" warning that fired during page-navigation transitions when the IntersectionObserver microtask raced the context cleanup/re-register.

---

# Parachord v0.9.0-beta.7

**Release date:** 2026-04-08

---

## Dynamic Model Fetching for AI Plugins

AI plugin model dropdowns now auto-populate from each provider's API instead of shipping hardcoded model lists that go stale.

- **Ollama** — fetches installed models from the local server (`/api/tags`); no more outdated Qwen 2.5 / Gemma 2 entries
- **ChatGPT** — fetches available models from OpenAI's API, filtered by a blocklist to exclude non-chat models (embeddings, DALL-E, Whisper, TTS, etc.)
- **Gemini** — fetches models filtered by `generateContent` capability
- **Claude** — stays curated (Anthropic has no list-models endpoint)
- **Fallback options** — if the fetch fails or no API key is configured, a small curated list is shown
- **Refresh button** — manual re-fetch via ↻ button next to the model label
- **Auto-fetch** — models load automatically when opening plugin settings or after saving an API key/endpoint

## Shuffleupagus AI Chat Improvements

- **Share prompt button** — hover over any of your chat messages to copy a shareable link (`parachord.com/go?uri=parachord://chat?prompt=...`) that works in GitHub Discussions, social media, and anywhere else
- **Queue deduplication** — if the AI model returns multiple `queue_add` calls in one response, they're merged into a single call to prevent adding N× the requested tracks

## Bug Fixes

- Fixed Gemini plugin using deprecated model IDs (`gemini-2.0-flash-001-001`) — updated to 2.5 series (#733)
- Fixed Gemini tool calls failing with "function_response.name cannot be empty" — tool result messages now include the function name (#734)
- Fixed Edit ID3 Tags missing from context menu for multi-source local files
- Fixed playlist sync pull button silently failing
- Fixed sync banner persisting after pull/push
- Fixed background sync overwriting pulled playlist state on disk
- Fixed Spotify redirect URIs not selectable in setup steps (#738)

## Other Changes

- Removed score sort option from Critical Darlings
- Raycast extension: updated install directions for store launch

---

# Parachord v0.9.0-beta.6

**Release date:** 2026-04-01

---

## Shuffleupagus AI DJ — Playlist Management

The AI DJ can now browse, reorder, add to, remove from, rename, and delete your playlists via 7 new tools — all gated behind the existing "Share my data" opt-in setting.

## Duplicate Playlist Cleanup

- **One-click duplicate removal** — new "Clean Up Duplicates" button in Settings > General > Library Sync fetches all remote playlists, groups by name, and deletes duplicates (keeps the copy with the most tracks)
- **Local reference cleanup** — stale syncedTo/syncedFrom pointers to deleted playlists are cleaned up automatically

## Bug Fixes

- Fixed Apple Music sync creating thousands of empty duplicate playlists during background sync — three-layer guard: partial-response detection skips clearing when >30% of playlists appear "missing"; playlist creation now persists syncedTo even if track addition fails; auto-create skips playlists that originated from the target provider
- Fixed Apple Music playlist deletion silently failing — switched to the correct DELETE endpoint with automatic token refresh on 401
- Fixed Apple Music duplicate deduplication using unsupported DELETE API — falls back to clearing tracks and renaming when DELETE returns 401
- Fixed white screen on some Electron versions caused by restrictive permission whitelist — switched to allow-all for non-dangerous permissions
- Fixed missing Spotify OAuth scopes — `user-read-currently-playing`, `playlist-read-private`, and `playlist-read-collaborative` were declared but never requested during auth
- Fixed silent store failures for `cache_mbid_mapper`, `saved_volume`, and `preferred_spotify_device_id` — added to `ALLOWED_STORE_KEYS` whitelist

---

# Parachord v0.9.0-beta.5

**Release date:** 2026-03-25

---

## ListenBrainz MBID Mapper Integration

Integrated the ListenBrainz MBID Mapper v2.0 to resolve track metadata to MusicBrainz IDs in ~4ms, replacing many slow, rate-limited MusicBrainz API searches.

- **Parallel enrichment during playback** — mapper fires alongside resolver searches in `handlePlay`, enriching tracks with `mbid`, `artistMbids`, and `releaseMbid`
- **Canonical name fallback** — when all resolvers fail, the mapper's corrected artist/track names retry resolution (confidence >= 0.7)
- **Artist page speedup** — `getArtistMbidFromMapperCache()` shortcuts the MB artist search (~0ms vs ~500ms)
- **Fresh Drops speedup** — mapper cache checked before rate-limited MB artist search, saving ~1100ms per cache hit across 50 artists
- **Background batch enrichment** — queue additions, playlist loads (XSPF, ListenBrainz, direct), and user-interacted content are enriched in the background
- **Scrobbler enrichment** — ListenBrainz sends `recording_mbid`, `artist_mbids`, `release_mbid` in `additional_info`; Last.fm/Libre.fm sends `mbid` parameter
- **Local files artwork** — local files without embedded album art now fetch artwork via MBID from the Cover Art Archive
- **90-day persistent cache** — results (including misses) cached and persisted via `electron.store`

## Spotify Device Picker

- **Multi-device dialog** — when multiple inactive Spotify devices are detected, a picker dialog lets you choose which one to play on instead of auto-selecting
- **Preferred device memory** — your last-picked device is remembered and auto-selected in future sessions
- **Volume safety** — if the selected device's volume is lower than the app's internal volume, Parachord adopts the device volume to prevent loud surprises

## Bug Fixes

- Fixed unsafe 70% default volume — lowered to 30%, persisted across restarts, and respects device volume on Spotify Connect transfer
- Fixed Spotify playlist import/sync failing with 403 for users with stale tokens missing required scopes
- Fixed native MusicKit auth on macOS — now prefers native auth to avoid passkey stall in the web flow

## UI Improvements

- Fixed album and friends grid cards floating to center — added `alignContent: start` to pack cards to the top

---

# Parachord v0.9.0-beta.4

**Release date:** 2026-03-15

---

## Bidirectional Playlist & Collection Sync

Sync your local playlists to Spotify and Apple Music — playlists you create in Parachord can now be pushed to your streaming services.

- **Push playlists to streaming services** — local playlists sync to Spotify and Apple Music, with track resolution handled automatically
- **Bidirectional collection sync** — tracks and albums you save locally are pushed to your Spotify/Apple Music library
- **Sync status UI** — shows sync progress with a status indicator on synced playlists
- **Local-only toggle** — mark playlists as "local only" to keep them private and exclude them from sync
- **Remote deletion prompt** — when a synced playlist is deleted on the remote side, you're prompted before it gets re-created
- **Background sync** — local playlists are automatically created and pushed during background sync, not just manual sync

## Playlist Import via Drag & Drop

- **Drag & drop import** — drag a Spotify or Apple Music playlist URL onto the sidebar or Playlists tab to import it instantly
- **Playbar drop zone** — drop a URL on the playbar to add tracks to your queue
- **Apple Music playlist import** — now uses the MusicKit API for richer metadata (artwork, track details)

## Widevine CDM Auto-Detection (Linux/Windows)

On Linux, Parachord now automatically finds the Widevine CDM from installed Chromium-based browsers so MusicKit JS can play full Apple Music tracks instead of 30-second previews.

- **Auto-detection** — searches Chrome, Edge, Brave, Vivaldi, Opera, and Dia for installed Widevine CDM
- **Zero configuration** — if you have any Chromium-based browser installed, full Apple Music playback via MusicKit JS just works on Linux
- **macOS unaffected** — native MusicKit continues to handle playback on Mac

## Raycast Extension

- **Published to the Raycast Store** — control Parachord playback, search your library, and start collection radio from Raycast

## Improvements

- Charts now refresh periodically and playlists reload after background sync
- Queue drawer has better contrast in dark mode
- Queue badge color updated to match the app accent palette
- Concert location modal restyled to match the design system
- Geolocation button in concerts is more visually distinct
- Playlist edit mode now styles correctly in dark mode
- Browser extension install buttons show official Chrome and Firefox logos

## Bug Fixes

- Fixed Apple Music sync creating duplicate playlists on every sync
- Fixed synced playlists showing 0 tracks after a failed sync recovery
- Fixed crash when sync skips certain data types
- Fixed Apple Music repeated authorization prompts and auto-play not advancing to the next track
- Fixed auto-updater installing the Intel build on Apple Silicon Macs
- Fixed Spotify 401 errors during playback by adding automatic token refresh
- Fixed Spotify search 400 errors from unquoted field values in search queries
- Fixed Spotify playlist import 403 by requiring re-auth for legacy tokens missing scopes
- Fixed wrong artist appearing on artist pages due to loose MusicBrainz matching; added name validation at every fallback level
- Fixed back navigation loading a blank page after app relaunch
- Fixed concert geo filter to correctly match on city names
- Fixed Critical Darlings RSS feed not showing new entries; added periodic re-fetching
- Fixed Ticketmaster plugin not showing under Concerts category filter
- Fixed protocol volume handler using wrong scale (0–1 instead of 0–100)

---

# Parachord v0.9.0-beta.1

**Release date:** 2026-03-09

---

## Dark Mode & Theming Engine

Full dark mode support with a comprehensive design token system. Every surface, text color, border, shadow, and accent in the app now uses CSS custom properties — no more hardcoded hex values.

- **Dark mode toggle** — choose Light, Dark, or System in Settings; follows your OS preference by default
- **Flash-free startup** — the main process pre-applies the `dark` class before the window is shown, so there is no flash of light mode on launch
- **Design tokens** — 100+ CSS custom properties (`--bg-primary`, `--text-secondary`, `--accent-primary`, `--card-shadow`, etc.) defined in `:root` with `.dark` overrides
- **365+ hardcoded colors converted** — every inline `#hex` and `rgb()` value across cards, tooltips, modals, filter bars, inputs, scrollbars, and skeletons now references design tokens
- **System theme listener** — `nativeTheme.on('updated')` in the main process notifies the renderer when the OS switches between light and dark
- **Theme-aware focus rings** — all `focus-visible` outlines use `--accent-primary` with rounded corners
- **Shimmer and skeleton classes** — new `shimmer-light` and `shimmer-strong` utility classes replace per-element gradient definitions
- **Always-dark surfaces** — the player bar, queue drawer, and AI panels retain their dark appearance in both modes via dedicated `--surface-dark-*` tokens

## Concerts — Live Music Discovery

A brand-new Concerts page aggregates upcoming shows from multiple ticketing services, filtered by your location and listening history.

- **Four concert data sources** — new Bandsintown, Songkick, SeatGeek, and Ticketmaster plugins (`.axe` files) provide concert listings
- **AI concert disclaimer** — when AI-sourced concert results are present, a disclaimer badge flags them as potentially hallucinated
- **Location-aware filtering** — IP-based geolocation with multiple fallback services, plus a location autocomplete search dialog with configurable radius (miles)
- **Improved geo filtering** — text-based location matching now falls back to city-portion matching; geo filter is always applied alongside radius filtering to prevent false positives
- **Restyled location modal** — the concert location picker modal now matches the app design system
- **On Tour indicator** — a purple dot next to the now-playing artist links directly to the On Tour tab when nearby concerts exist; hovering shows a tooltip
- **Artist page On Tour tab** — artist detail pages show an "On Tour" tab with that artist's upcoming concerts, with ticket links and loading skeletons; the tab animates in smoothly via max-width/opacity transitions
- **Concert row design** — large artist images, 3-column layout (date, image, venue/reason), ticket buttons with flyout menus linking to each service
- **Lineup and opener matching** — concerts are matched against your library by headliner, opener, and lineup members; tribute/cover band false positives are filtered out
- **Persistent cache** — concert results are cached for 24 hours and survive app restarts; `cache_concerts` added to the store key whitelist

## Fresh Drops — Reliability Improvements

- **Fixed stale cache loop** — `lastFullScan` is now tracked separately from `timestamp`; incremental refreshes no longer reset the full-scan clock, preventing an infinite refresh loop
- **Shuffled artist sources** — collection, library, and history artists are shuffled and interleaved in round-robin so every refresh discovers releases from different artists
- **Full re-scan after 24 hours** — when the last full scan is over 24 hours old, a complete re-scan runs instead of an incremental check
- **Fixed duplicate releases** — Fresh Drops no longer shows the same releases repeatedly
- **Pill-style filter buttons** — replaced the filter dropdown with pill-style buttons; EP (purple), Single (pink), and Album (blue) colors are consistent between filter pills, text badges, and overlay badges

## Performance

- **Batch IPC on startup** — all `store.get()` calls during initialization are batched into a single `store-get-batch` IPC roundtrip, eliminating dozens of sequential Electron IPC calls and significantly reducing cold-start time
- **Background concert pre-loading** — concert data is fetched in the background after initial load, without blocking the UI

## UI & UX Polish

- **Search tab** — font size and icon size now match other sidebar tabs; subtle active-state indicator added
- **Filter pills** — consistent focus styling, rounded corners on focus-visible rings, standardized chip sizing across concerts and other filter bars; focus-within highlight on pill containers
- **Artist cards** — collection and search artist cards now match album card styling with visible borders at rest and theme-aware colors
- **Sticky album/playlist columns** — left column (art, metadata) stays fixed while the track list scrolls independently
- **Sidebar friends** — fixed layout shift when friends go on-air/off-air by using fixed-height entries
- **Biography panel** — responsive width (25%) instead of fixed pixel widths
- **Artist header tabs** — stronger text shadow for better contrast on bright album art backgrounds
- **Sidebar tab colors** — brightened teal accent; highlight colors match page headers; fixed hover overflow and spin direction
- **Queue drawer contrast** — improved queue drawer readability in dark mode
- **Geolocation button** — restyled to look more clearly interactive
- **Tooltip contrast** — dark mode tooltips use a lighter background for better readability; player bar tooltips stay dark in both modes
- **Playlist share button** — increased spacing above the Share button on playlist view
- **Refresh icon** — fixed spin direction to rotate clockwise; player bar skeleton shimmer now animates correctly
- **Close button** — capitalization fix ("Close" instead of "close"); uses theme-aware styling in Search header
- **Artist discography navigation** — BACK button no longer skips the artist discography when closing a release; it returns to the release list first
- **Queue badge** — color updated from emerald to accent purple for visual consistency
- **Artist fallback view** — navigates to home instead of library when artist data is missing

## Spotify API Resilience

- **Retry on 502/503/504** — both `spotifyRequest` and `spotifyFetch` now retry transient server errors with exponential backoff (up to 30 seconds between retries), instead of failing immediately
- **Token refresh during playback** — Spotify 401 errors during playback now trigger an automatic token refresh and retry, preventing mid-session auth failures

## Artist Lookup & Search

- **MusicBrainz match validation** — results are now validated by name similarity (NFD-normalized, punctuation-stripped) instead of blindly trusting the MB score; fetches 5 candidates instead of 1 for better exact-match chances
- **Multi-source fallback** — when MusicBrainz returns no or weak results, enabled resolvers (Spotify, Apple Music/MusicKit, Last.fm, Discogs) are tried in sequence as fallback sources for artist data and albums
- **Fallback name validation** — all four fallback sources validate that the returned artist name actually matches the query using word-level comparison, preventing false matches like "Jack Jose" → "Jerry Joseph And The Jackmormons"
- **Cache name validation** — cached artist data is checked against the search term before serving, preventing stale wrong-artist entries from persisting
- **Search supplementing** — when MusicBrainz returns fewer than 3 results for artists, albums, or tracks, active resolvers (Spotify, Apple Music) supplement with deduplicated results

## Browser Extension

- **Published to stores** — the browser extension is now available on the Chrome Web Store and Firefox Add-ons; the in-app info modal links directly to the store listings instead of showing manual install instructions
- **Official browser logos** — store buttons use the official Chrome and Firefox logos

## Raycast Extension

- **Store publishing prep** — the Raycast extension is ready for the Raycast Store: added `.eslintrc.json` (extending `@raycast`), CHANGELOG.md, Prettier formatting, and correct author metadata
- **Dependency security** — upgraded `@raycast/eslint-config` to v2 to resolve all npm audit vulnerabilities
- **Sync workflow fixes** — dotfiles (e.g. `.eslintrc.json`) are now included in repo sync; change detection stages files before diffing to catch new files

## Plugin Marketplace

- **New concert plugins** — Bandsintown, Songkick, SeatGeek, and Ticketmaster added to the marketplace manifest with icons, descriptions, and download URLs
- **New `concerts` category** — added to the marketplace category list

## Documentation

- **Design system documentation** — comprehensive documentation of the design token system and theming architecture
- **Harmonix → Parachord cleanup** — removed outdated docs and fixed remaining references to the old project name
- **TypeScript migration plan** — comprehensive plan for migrating the JavaScript codebase to TypeScript
- **YouTube Music sync design** — design document for YouTube Music library sync using Google Data Portability API
- **Listening history import** — issue draft for cross-service listening history import
- **YouTube Music library import** — issue draft for YouTube Music library import feature
- **Bulk export research** — appendices covering Spotify extended streaming history and Apple Music bulk export
- **UI consistency audit** — remaining implementation plan for UI consistency work

## Bug Fixes

- Fixed Artist Suggestions card not loading discography on click
- Fixed playlist resolution stopping when navigating back
- Fixed shimmer animation not playing on resolver icon skeletons (switched from `background` shorthand to `background-image`)
- Fixed concert cache not bypassing when clicking the nav button
- Fixed geoIP location lookup failing by adding multiple fallback services
- Fixed dark mode styling inconsistencies across filter bars and modals
- Fixed concert false positives from tribute and cover bands leaking through the location filter
- Fixed concert refresh not clearing stale cache properly
- Fixed friend activity music note invisible in dark mode (was using `--border-default`)
- Fixed modal button/icon colors washed out in dark mode (switched to vivid purple)
- Fixed album breadcrumb not respecting dark mode
- Fixed back navigation loading empty page after app relaunch (missing view history entry + unguarded data-dependent views)
- Fixed `musicKitWeb` ReferenceError in search supplement code (must use `window.getMusicKitWeb()`)
- Fixed wrong artist match from MusicBrainz (e.g. "Jack Jose" → "José José") by validating name similarity instead of trusting MB score
- Fixed crash in `fetchArtistData` when cached artist name didn't match (undeclared `currentResolverHash` variable)
- Fixed bad MusicBrainz matches persisting in cache across searches
- Fixed protocol volume handler using wrong scale (0–1 instead of 0–100)
- Fixed Ticketmaster plugin not showing under Concerts category filter
- Fixed stale concert list render by keying on location state

---

# Parachord v0.8.0-alpha.12 (last alpha)

**Release date:** 2026-03-03

---

*See git log for alpha.12 and earlier changes.*

---

<details>
<summary>v0.8.0-alpha.2 and earlier</summary>

# Parachord v0.8.0-alpha.2

**Release date:** 2026-02-25

---

## Browser Extension v0.3.0 — Chrome & Firefox

The browser extension no longer uses WebSocket to talk to the desktop app. Communication now goes through Chrome's native messaging API — a secure, local-only channel verified by the browser.

- **Native messaging** — new relay host bridges Chrome's stdin/stdout protocol to the desktop app over a local IPC socket (Unix socket on macOS/Linux, named pipe on Windows)
- **Auto-installer** — registers the host manifest for Chrome, Chromium, Edge, Brave, and Firefox on macOS, Linux, and Windows
- **Firefox support** — packaging script produces both Chrome and Firefox zips; native messaging installer registers for both browser families
- **Spotify URL lookup** — the Spotify resolver now handles `open.spotify.com` and `spotify:` URIs directly (tracks, albums, playlists), so link interception actually delivers tracks to the queue
- **Link intercept fixes** — intercepted tabs only close when the URL is delivered to the desktop app; handles Chrome MV3 service worker restarts gracefully
- **Chrome Web Store packaging** — `npm run package:extension` validates the manifest and produces store-ready zips
- **Store listings** — Chrome Web Store and Firefox Add-ons store descriptions added
- **Privacy policy** — comprehensive policy covering the desktop app and extension

## Smart Links — Large Embed

- **`?size=large` embed** — 600px-wide player with album art (or playlist mosaic), Play All button, streaming service icons, and the complete tracklist with per-track durations and service badges
- **oEmbed support** — `?size=large` returns correct iframe dimensions (dynamic height based on track count)
- **Favicon** — all go.parachord.com pages now have favicon.ico, icon.svg, and apple-touch-icon

## Universal Mac Build

The macOS build was producing arm64-only binaries, causing "not compatible" errors on Intel Macs.

- **Universal binary** — DMG and zip now contain both Intel and Apple Silicon slices
- **MusicKit helper** — Swift build updated to compile for both `arm64` and `x86_64`
- **CI workflow** — now passes `--universal` to electron-builder
- **x64ArchFiles** — tells `@electron/universal` how to merge native `.node` modules
- **Bundle cleanup** — excluded `native/` source directory that was confusing the universal merge

## Spotify Sync — Pre-resolved Sources

- **Synced tracks skip re-resolution** — tracks from Spotify library sync now carry their Spotify source data, so the resolution system skips redundant Search API calls
- **Token refresh retry** — Spotify API calls that fail with HTTP 400 now automatically refresh the token and retry

## Fresh Drops Reliability

- **Cache persistence fixed** — Fresh Drops now correctly survives app restarts (fixed falsy-timestamp sentinel, cache ref overwrite during rebuild, and missing store key whitelist entries)
- **Faster loading** — releases stream in more quickly with a visible loading indicator
- **"Coming" badge** — upcoming releases are highlighted with a "Coming" prefix
- **10s fetch timeout** — MusicBrainz calls now have a timeout to prevent indefinite hangs

## Bug Fixes

- Fixed queue not restoring on restart due to a race condition with resolver settings initialization
- Fixed Spotify synced tracks not resolving (missing source data)
- Fixed "Play Playlist Next" incorrectly creating a library playlist
- Fixed AI Suggestions and New Releases caches silently failing to persist (missing `ALLOWED_STORE_KEYS` entries)
- Replaced text "Refresh" link with spinning refresh icon on AI Suggestions
- Added favicon to go.parachord.com share pages

---

# Parachord v0.8.0-alpha.1

**Release date:** 2026-02-24

---

## AI-Powered Suggestions

The Home tab now features personalized album and artist suggestions powered by your configured AI service (OpenAI or Gemini).

- **Album Suggestions** — 5 AI-recommended studio albums, validated against MusicBrainz to ensure they're real, full-length releases
- **Artist Suggestions** — 5 AI-recommended artists with one-line explanations of why they fit your taste
- **Progressive streaming** — suggestions appear one by one as they validate, with skeleton placeholders for remaining slots
- **Hover actions** — play or queue an album/artist's top tracks directly from the suggestion card
- **Variety on refresh** — 10 rotating variety themes (hidden gems, different decades, global scenes, genre-crossing, etc.) steer each batch in a different direction, and previously suggested items are excluded
- **Expanded listening context** — the AI prompt now draws from your full listening history across all time periods (weekly, monthly, 6-month, all-time), top tracks, and artists/albums extracted from saved songs in your Collection
- **Persistent suggestions** — cached between sessions so suggestions appear instantly on launch, with fresh ones loading in the background

## Fresh Drops

A new section on the Home tab showing recent album releases from artists you listen to.

- **Automatic discovery** — pulls new releases from all your connected artist sources (Collection, listening history, scrobbling services)
- **Incremental refresh** — new albums stream in as they're found; stale broadcasts are filtered out
- **Hover actions and context menus** — play, queue, or share albums directly from the card
- **Instant on launch** — cached between sessions with skeleton loading states

## Album & Playlist Smart Links

Share any album or playlist as a web link that works across streaming services.

- **Album smart links** — service icon row (Spotify, Apple Music, YouTube, etc.) with album-level URLs, full tracklist with per-track play buttons when Parachord is connected
- **Playlist smart links** — 2x2 album art mosaic cover, creator attribution, per-track playback, and `.xspf` download for portable playlist export
- **Server-side enrichment** — missing service URLs are resolved server-side so links show maximum coverage
- **Share button** — added to album and playlist detail pages with a styled flyout menu
- **Context menus** — smart link and share options available on album cards, album page art, playlist pages, Home playlist cards, top albums in history, and friend activity albums

## Embeddable "Send to Parachord" Button

Third-party websites can embed a button that sends playlists directly into Parachord.

- **Three-tier delivery** — WebSocket (instant), HTTP POST fallback, and `parachord://` protocol handler as last resort
- **Hosted on Cloudflare Pages** — `button.js` is CDN-delivered for easy integration
- **HTTPS-compatible** — WebSocket connection upgraded for secure pages; HTTP fetch fallback when WebSocket is blocked

## Listen Along

- **Graceful disconnect** — when a friend goes offline, the current song now finishes playing before the listen-along session ends

## Home Tab Layout

- **Weekly Jams and Weekly Exploration** separated into distinct side-by-side columns
- **Collection section header** added above the stats grid
- **Album art tooltip** now shows both click and drag-to-playlist actions

## Bug Fixes

- Fixed stale closure bug causing resolvers to never execute after settings changes
- Fixed album smart links sometimes returning 0 tracks due to a race condition
- Fixed album-level enrichment matching against track name instead of album name
- Fixed AI recommendations not loading due to race condition with plugin initialization
- Fixed double-encoded HTML entities in Critics Picks descriptions
- Fixed suggestion tooltips clipped by scroll container overflow
- Fixed missing previous weeks in Weekly Jams/Exploration playlists
- Fixed gray screen crash when queuing tracks from certain views
- Fixed multiple TDZ (temporal dead zone) crashes in collection tab and album track fetching
- Fixed collection sidebar showing empty when synced data exists on other tabs
- Fixed cached suggestions not appearing on launch
- Fixed album page crash when Share props were missing
- Fixed WebSocket connection failures from HTTPS-served embed pages
- Fixed Fresh Drops header layout bouncing with few albums
- Fixed New Releases not including all artist sources fairly
- Album art fallback now uses enabled resolvers instead of hardcoded iTunes API

---

<details>
<summary>v0.7.0-alpha.15 and earlier</summary>

## v0.7.0-alpha.5

**Release date:** 2026-02-17

### Resolution Performance

- **Incremental resolver results** — results appear in the UI as they're found
- **Parallel album resolution** — all tracks in an album resolve concurrently
- **Bandcamp pre-resolution** — embedded player pre-resolves track IDs for faster playback

### Apple Music Improvements

- Switched to native MusicKit catalog API with iTunes Search fallback
- Album-aware caching to prevent cross-album mismatches
- Fixed auth failing when Music.app is not running on macOS

### Resolver Fixes

- Track resolution order — pending tracks get promoted when navigated to
- Fixed resolvers with no match being re-queried endlessly
- Fixed sequential playlist re-resolution when resolver settings change

### Sync Safety

- Mass-removal safeguard — bulk deletions are detected and blocked

### UI & Playback Fixes

- Fixed black screen and "Render frame was disposed" error
- Fixed playbar showing wrong album art after reporting a bad match

</details>

---

**Full changelog:** `git log v0.8.0-alpha.1..v0.8.0-alpha.2`

</details>

---

**Full changelog:** `git log v0.8.0-alpha.12..v0.9.0-beta.1`
