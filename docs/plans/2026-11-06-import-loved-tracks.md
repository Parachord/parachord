# Import Loved Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-service "Import loved tracks" button in the Last.fm and ListenBrainz settings cards adds that account's loves to the collection, without duplicates, without bringing back tracks the user removed, and without pushing anything back to the service it came from.

**Architecture:** All decisions live in one pure module, `src/renderer/lib/love-import.js`, which parses each service's pages and decides what to add. The two scrobbler classes each gain one read method for fetching a page. `app.js` owns the run: fetch, plan, commit once, write the idempotency keys and the cursor, then optionally push to the other service through a restricted backfill.

**Tech Stack:** Electron renderer (no JSX, `React.createElement`), plain CommonJS modules, jest.

**Spec:** [Parachord/parachord#1071](https://github.com/Parachord/parachord/issues/1071). Push-side background: `docs/plans/2026-05-03-loved-tracks-scrobbler-push-design.md`, and "Loved Tracks" in `docs/architecture/sync.md`.

## Decisions where this plan differs from the issue

The maintainer should check these first. Each comes from reading the code or the real API responses (checked 2026-11-06).

1. **No ISRC matching.** Rule 3 says to match on ISRC "if present". Neither API returns one on a love, so the order is recording MBID, then normalized artist + title.
2. **One tombstone provider, not one per service.** Rule 4 keys tombstones by service. A track loved on both services and removed once would come back from the other service. So every removal writes `('love-import', loveNameKey(track))`, whichever service it came from. The existing `('listenbrainz', mbid)` entry stays.
3. **A love newer than the removal gets through.** Rule 4 says a removed track must not come back, but a love made after the removal is a new decision. Compare the love's date with the tombstone's `removedAt`.
4. **Last.fm's `mbid` is ignored.** 60 of 200 sampled loves had none, and `window.resolveMbidForLove` trusts `track.mbid` without checking it, so a stale value would push the wrong recording to ListenBrainz. Last.fm rows carry no `mbid` and go through the mapper like any other track. ListenBrainz rows keep theirs.
5. **Tracks already in the collection also get marked as pushed.** Rule 1 only names imported tracks. Without this, Backfill would re-push loves the service already has and restamp them as loved "now".
6. **Cross-service push is limited to what was just imported.** `runLoveBackfill` walks every unpushed collection track, so reusing it as it stands would also push the user's older tracks, which they never asked for.
7. **No eager resolution.** Rows are saved with `sources: {}`. The collection already resolves visible rows and an unresolved row plays on click, so resolving thousands of rows up front adds nothing.

## Global Constraints

- Importing never unloves anything on either service, and removing a track still never sends an unlove.
- Libre.fm stays out of scope, same as push.
- `love_import_cursor` must be in `ALLOWED_STORE_KEYS` (`main-process/ipc/store.js`) or the save is silently refused.
- MusicBrainz lookups use the background lane (`mbBackground: true`).
- No album art shortcuts. Rows don't copy Last.fm's images, and art comes from `getAlbumArt`.
- Don't compare names through `normalizeForId`. It strips non-Latin text to nothing.
- `src/renderer/lib/love-import.js` must load under plain Node (no `window` at module scope).
- User-facing copy has no em dashes.

## Review Focus

1. **Fully non-Latin names.** `generateTrackId` gives `--` for every such track, so all of one user's Japanese loves would collapse into one row. Each must get its own row with its own id. Pinned in Task 2.
2. **The cursor after a failed run.** A network failure on page 7 of 20 must not advance the cursor, or pages 8 to 20 are lost for good on later runs. Pinned in Task 4.
3. **Importing with the other service's push toggle on.** An add must not fire one live push per track, and older unpushed tracks must not be pushed. Pinned in Task 4.
4. **Removing then re-importing, across services.** Remove a track imported from Last.fm, then import from ListenBrainz: it stays removed. Pinned in Task 3.
5. **An account with no loves, or a username the service doesn't know.** Last.fm answers `{ error: 6 }`, ListenBrainz answers 404, and an empty account returns an empty list. These must end in a clear toast, never "Imported 0" after a failure. Pinned in Task 1.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/renderer/lib/love-import.js` | Create | Parsing, name key, dedupe plan, row building, cursor rules |
| `scrobbler-loader.js` | Modify | `getLovedTracksPage` on both scrobbler classes |
| `src/renderer/app.js` | Modify | `runLoveImport`, restricted backfill, tombstone entry, state, bulk-load key, card props |
| `src/renderer/components/settings-cards.js` | Modify | Import button and progress in `ScrobblerSettingsCard` |
| `main-process/ipc/store.js` | Modify | Allow `love_import_cursor` |
| `docs/architecture/sync.md` | Modify | Rewrite the "one-way" description |

### Task 1: Parse each service's pages and fetch them

**Files:**
- Create: `src/renderer/lib/love-import.js`
- Modify: `scrobbler-loader.js` (`ListenBrainzScrobbler` near `loveTrack` L571, `LastFmScrobbler` near `loveTrack` L795)
- Test: `tests/renderer/love-import-parse.test.js`, `tests/scrobbling/loved-tracks-page.test.js`

**Interfaces:**
- Produces: a normalized love, `{ artist: string, title: string, album: string, mbid: string|null, lovedAt: number /* seconds */, service: 'lastfm'|'listenbrainz' }`, or for a ListenBrainz item with a recording MBID but no metadata, `{ needsLookup: true, mbid, lovedAt, service: 'listenbrainz' }`.
- Produces: `parseLastfmLovedPage(json) -> { loves, skipped, total, totalPages }` and `parseListenbrainzFeedbackPage(json) -> { loves, skipped, total, returned }`.
- Produces: `scrobbler.getLovedTracksPage({ page, offset, count }) -> Promise<raw json>`, throwing `Error` with the service's message on failure.

- [ ] **Step 1: Write the failing parser tests**

Fixtures are the real shapes, anonymized:

```js
const lastfm = { lovedtracks: {
  '@attr': { user: 'x', totalPages: '2', page: '1', perPage: '2', total: '3' },
  track: [
    { name: 'Roads', mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', url: 'u',
      artist: { name: 'Portishead', mbid: 'b', url: 'u' }, date: { uts: '1700000000', '#text': 't' } },
    { name: 'Glory Box', mbid: '', artist: { name: 'Portishead', mbid: '', url: 'u' }, date: { uts: '1600000000' } },
  ] } };
const lb = { count: 3, offset: 0, total_count: 3, feedback: [
  { created: 1741972335, recording_mbid: 'cccccccc-cccc-cccc-cccc-cccccccccccc', recording_msid: null, score: 1,
    track_metadata: { artist_name: 'Björk', track_name: 'Jóga', release_name: 'Homogenic', mbid_mapping: {} } },
  { created: 1741972328, recording_mbid: 'dddddddd-dddd-dddd-dddd-dddddddddddd', recording_msid: null, score: 1 },
  { created: 1741972320, recording_mbid: null, recording_msid: 'e', score: 1 },
] };
```

Assertions:
- Last.fm: `loves[0]` equals `{ artist: 'Portishead', title: 'Roads', album: '', mbid: null, lovedAt: 1700000000, service: 'lastfm' }` (the `mbid` is dropped on purpose), `total` is 3, `totalPages` is 2.
- Last.fm: `track` as a single object, not an array, parses to one love. `track: []` parses to none.
- ListenBrainz: the first item keeps `mbid` and `album: 'Homogenic'`. The second is `{ needsLookup: true, mbid: 'dddddddd-…', lovedAt: 1741972328, service: 'listenbrainz' }`. The third, with neither, adds 1 to `skipped`.
- ListenBrainz: `total` is 3 and `returned` is 3.
- Items with a blank artist or title add to `skipped`.

- [ ] **Step 2: Write the failing fetch tests**

With `window.electron.proxyFetch` mocked, as in `tests/scrobbling/listenbrainz-client-version.test.js`:
- `LastFmScrobbler`: requests `method=user.getLovedTracks`, the configured `username`, `api_key`, `format=json`, `page`, and `limit=count`. No `sk` or signature.
- `LastFmScrobbler`: `{ error: 6, message: 'User not found' }` rejects with that message.
- `ListenBrainzScrobbler`: requests `/feedback/user/<encoded username>/get-feedback?score=1&count=…&offset=…&metadata=true` with no token header. A 404 rejects with `Error('ListenBrainz user not found')`.
- Both reject with `Error('Not connected')` when the config has no username.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/renderer/love-import-parse.test.js tests/scrobbling/loved-tracks-page.test.js`
Expected: FAIL, modules and methods not defined.

- [ ] **Step 4: Implement the parsers and `getLovedTracksPage`**

Last.fm rejects `limit` above 1000 with error 6, so callers pass `count: 200`. Past the last page it returns an empty list rather than an error.

- [ ] **Step 5: Run the tests to verify they pass**, using the same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/love-import.js scrobbler-loader.js tests/renderer/love-import-parse.test.js tests/scrobbling/loved-tracks-page.test.js
git commit -m "feat(love-import): read loved tracks from Last.fm and ListenBrainz (#1071)"
```

### Task 2: Decide what to add

**Files:**
- Modify: `src/renderer/lib/love-import.js`
- Test: `tests/renderer/love-import-plan.test.js`

**Interfaces:**
- Consumes: normalized loves from Task 1; `normalizeStr` from `sync-providers/confidence-scoring.js`; `generateTrackId`, `normalizeForId` from `./collection-ids`; `trackSlug` from `./track-slug`.
- Produces: `loveNameKey(track) -> string|null`, the normalized `artist|title`. Falls back to trimmed lower case when `normalizeStr` gives nothing (the band `!!!`), and returns `null` when either name is blank.
- Produces: `planLoveImport(loves, tracks, tombstones) -> { add: Row[], matchedIds: string[], tombstoned: number }`. `tombstones` is the raw `sync:tombstones:list` shape, `{ [providerId]: { [externalId]: { removedAt } } }`.
- Produces: `loveRowId(love) -> string`. `Row` is `{ id, title, artist, album, duration: undefined, albumArt: undefined, sources: {}, addedAt, mbid? }`.

- [ ] **Step 1: Write the failing tests**

- `loveNameKey` treats `Björk`/`Bjork`, `AC/DC`/`ACDC` and differing case as equal. `宇多田ヒカル`/`光` gives a non-empty key, different from `宇多田ヒカル`/`Automatic`. `!!!`/`Heart` gives a non-empty key.
- A love whose `mbid` equals a saved row's `mbid` matches, even when the names differ. Its row id lands in `matchedIds`, not `add`.
- A love matching a saved row by name matches, whatever the saved album, including a real album.
- `Song (Remastered)` and `Song` stay two tracks.
- Two loves for the same track in one batch add one row, using the earlier `lovedAt`.
- A new row's `addedAt` is `lovedAt * 1000`.
- A ListenBrainz row keeps `mbid`, and a Last.fm row has none.
- **Non-Latin:** two loves by `宇多田ヒカル` (`光`, `First Love`) add two rows with different ids, neither of them `--`. `loveRowId` uses `generateTrackId` when `normalizeForId` of both the artist and title is non-empty, and `trackSlug` otherwise.
- **Tombstones:** with `{ 'love-import': { [key]: { removedAt: 2000000 } } }`, a love with `lovedAt: 1000` is left out and counted in `tombstoned`. A love with `lovedAt: 3000` (3,000,000 ms) is added. `{ listenbrainz: { [mbid]: { removedAt } } }` is honored the same way.
- `needsLookup` loves are ignored by `planLoveImport`.
- 20,000 loves against 20,000 rows finishes in under a second, which forces an index rather than a scan per love.

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/renderer/love-import-plan.test.js`
Expected: FAIL, functions not defined.

- [ ] **Step 3: Implement `loveNameKey`, `loveRowId` and `planLoveImport`**, indexing the saved rows into two Maps (mbid, name key) up front.

- [ ] **Step 4: Run to verify it passes**, using the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/love-import.js tests/renderer/love-import-plan.test.js
git commit -m "feat(love-import): decide what a love import adds (#1071)"
```

### Task 3: Removal writes the tombstone import checks

**Files:**
- Modify: `src/renderer/app.js` (`deriveTombstoneEntries`, ends near L13330)
- Test: `tests/renderer/love-import-tombstones.test.js`

**Interfaces:**
- Consumes: `loveNameKey` from Task 2.
- Produces: `loveTombstoneEntries(track) -> Array<{ providerId: 'love-import', externalId }>` in `love-import.js`, empty when `loveNameKey` is null.

`sync:start`'s tombstone filter only asks about the provider it is syncing, so a `love-import` entry can't touch Spotify or Apple Music sync. `addTrackToCollection` and removal both go through `deriveTombstoneEntries`, so a deliberate re-add clears the entry with no further change.

- [ ] **Step 1: Write the failing tests**

- `loveTombstoneEntries({ artist: 'Portishead', title: 'Roads' })` returns one entry, and its `externalId` is what `planLoveImport` looks up.
- A round trip: removing a Last.fm-imported track, then planning a ListenBrainz love for it with an older `lovedAt`, leaves it out.
- A source marker: `deriveTombstoneEntries` in `src/renderer/app.js` includes `loveTombstoneEntries(track)`.

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/renderer/love-import-tombstones.test.js`
Expected: FAIL.

- [ ] **Step 3: Add `loveTombstoneEntries` and spread it into `deriveTombstoneEntries`' result**

- [ ] **Step 4: Run to verify it passes**, using the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/love-import.js src/renderer/app.js tests/renderer/love-import-tombstones.test.js
git commit -m "feat(love-import): a removed track stays removed across imports (#1071)"
```

### Task 4: Run the import

**Files:**
- Modify: `src/renderer/lib/love-import.js`, `src/renderer/app.js` (next to `runLoveBackfill`, L13533; bulk-load list L17903 and restore L18658), `main-process/ipc/store.js` (L36-37)
- Test: `tests/renderer/love-import-run.test.js`, `tests/store/allowed-store-keys.test.js`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: `collectLoves({ fetchPage, parse, cursor, pageSize, onProgress }) -> Promise<{ loves, skipped, needsLookup, complete, error }>`, pure and given `fetchPage`, so it can be tested without React.
- Produces: `nextLoveCursor(previous, loves, complete) -> number|null`.
- Produces: `withLovesPushed(keys, trackIds, service, now) -> keys`.
- Produces in `app.js`: `runLoveImport(service)`, state `loveImportRunning`, `loveImportProgress` (`{ done, total }`), refs `loveImportRunningRef` and `loveImportCursorRef`, and `runLoveBackfill(service, { onlyIds } = {})`.

- [ ] **Step 1: Write the failing tests**

`collectLoves`:
- Advances Last.fm by `page` and ListenBrainz by `returned`, because a service may return fewer than asked. It stops when a page comes back empty or everything has been read.
- Stops paging at the first love older than `cursor`, and keeps loves equal to it. Both services answer newest first (checked on real accounts). Dedupe handles the overlap.
- A rejected `fetchPage` on page 2 returns page 1's loves with `complete: false` and `error` set, and doesn't throw.
- Reports progress as `{ done, total }`.

`nextLoveCursor`:
- With `complete: false` returns `previous` unchanged, even with newer loves in hand. **This is Review Focus 2.**
- With `complete: true` returns the newest `lovedAt`, and never moves backwards.

`withLovesPushed`:
- Adds `service` to each id's entry, keeps other services' timestamps, and returns a new object.

Source markers on `app.js`:
- `runLoveImport` doesn't call `addTrackToCollection`, `addTracksToCollection` or `pushLoveToScrobblers`. **This is Review Focus 3.**
- `runLoveBackfill` filters by `onlyIds` when given.
- `love_import_cursor` is in the bulk-load list.

`allowed-store-keys`: add `love_import_cursor` to the expected keys.

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/renderer/love-import-run.test.js tests/store/allowed-store-keys.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the pure helpers, and allow the store key**

- [ ] **Step 4: Implement `runLoveImport(service)` in `app.js`**

In this order:

1. Return if `loveImportRunningRef.current[service]` is set. Toast and stop if the scrobbler isn't connected.
2. If the other service's push toggle is on and it's connected, confirm first with `showConfirmDialog`:
   - Title: `Import loved tracks`
   - Message: `Tracks you import from {Service} will also be loved on {Other}, because "Push newly loved tracks to {Other}" is on. This can't be undone from Parachord.`
   - Confirm label: `Import`. Cancel stops the run.
3. `collectLoves` with `count: 200`, updating `loveImportProgress` no more than once per page.
4. Read `window.electron.tombstones.list()`. If that fails, stop with an error toast: importing without it could bring removed tracks back.
5. `planLoveImport` against `collectionDataRef.current.tracks`. In the `setCollectionData` updater, drop any row whose id appeared since, then `saveCollection` once.
6. For `needsLookup` loves, fetch `https://musicbrainz.org/ws/2/recording/{mbid}?fmt=json&inc=artist-credits+releases` one at a time through the app's wrapped `fetch` with `mbBackground: true`, which is what queues it behind user requests. Build a love from the title, the joined artist credit and the first release's title. Failures add to `skipped`. Plan and commit these as a second batch at the end, so rows with metadata appear right away.
7. `lovePushedKeysRef.current = withLovesPushed(…)` for added and matched ids, for this `service`, and write `love_pushed_keys` once. Don't use `markLovePushed` in a loop: it writes the whole map on every call.
8. Write `love_import_cursor` from `nextLoveCursor`.
9. Toast, using `{ duration: 8000 }`:
   - Normal: `Imported {added} from {Service}. {matched} already in your collection, {skipped} skipped.`
   - Add `, {tombstoned} you removed` when non-zero.
   - Partial: `Imported {added} from {Service}, then stopped: {error}. Run it again to pick up the rest.`, type `error`.
   - Nothing fetched and an error: `Couldn't import from {Service}: {error}`, type `error`, with no counts.
10. If the toggle from step 2 was on and rows were added: `runLoveBackfill(other, { onlyIds: addedIds })`, not awaited, so its own progress shows on the other card.

- [ ] **Step 5: Run to verify it passes**, using the same command, then `npm test`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/love-import.js src/renderer/app.js main-process/ipc/store.js tests/renderer/love-import-run.test.js tests/store/allowed-store-keys.test.js
git commit -m "feat(love-import): import an account's loves into the collection (#1071)"
```

### Task 5: The button, the docs and a live check

**Files:**
- Modify: `src/renderer/components/settings-cards.js` (props L255-265, buttons L532-545), `src/renderer/app.js` (card props L47042 and L47336), `docs/architecture/sync.md` (L323-340)
- Test: `tests/renderer/component-render-smoke.test.js` (extend if the card's props are enumerated there)

**Interfaces:**
- Consumes: `runLoveImport`, `loveImportRunning`, `loveImportProgress`, `loveImportCursorRef`.
- Produces: `ScrobblerSettingsCard` props `onRunLoveImport`, `loveImportRunning`, `loveImportProgress`, `hasImportedLoves`.

- [ ] **Step 1: Write the failing test**

Render `ScrobblerSettingsCard` under Node for `listenbrainz`, connected:
- With `onRunLoveImport` set and `hasImportedLoves: false`, the button reads `Import loved tracks`.
- With `hasImportedLoves: true`, it reads `Import new loves`.
- While running with `{ done: 120, total: 840 }`, it reads `Importing… 120/840` and is disabled.
- With no `onRunLoveImport` (Libre.fm), there's no button.

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/renderer/component-render-smoke.test.js`
Expected: FAIL.

- [ ] **Step 3: Add the button above the push toggle**, with the Backfill button's classes, and pass the props at both call sites.

- [ ] **Step 4: Rewrite the `sync.md` section**

Retitle it "Loved Tracks: ListenBrainz / Last.fm". Add import as a third control, the `love_import_cursor` key, the `love-import` tombstone provider, and the reasons in "Decisions" above. Correct "One-way only" to say that nothing ever unloves on either service, while reads now exist.

- [ ] **Step 5: Run the tests to verify they pass**, then `npm test`. Expected: PASS.

- [ ] **Step 6: Live check on a throwaway profile**

Check the ports first with `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8888|9876|9421|9333|9339) '`, and back up and restore `~/.parachord/native-messaging-host`. With a real account connected:

- [ ] Import from ListenBrainz: the count matches `total_count`, and rows sort by love date.
- [ ] Import again: `Imported 0`, and no request past the first page.
- [ ] Remove a row, import again with the cursor cleared: it stays removed.
- [ ] Import with the other service's toggle on: the dialog appears. Cancel first and confirm nothing changed. **Don't confirm on a real account** without the maintainer's say-so, since that writes loves to a real service.
- [ ] Play an imported row with no album: it resolves and plays.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings-cards.js src/renderer/app.js docs/architecture/sync.md tests/renderer/component-render-smoke.test.js
git commit -m "feat(love-import): add the import button to the scrobbler cards (#1071)"
```

## After merge

- Add a release note to `RELEASE_NOTES.md`.
- File the parachord-mobile parity ticket from CLAUDE.md's "Mobile parity" section, carrying the `love_import_cursor` shape, the `love-import` tombstone key and its normalization, and the no-loop rule. Tombstones aren't synced between devices, so the ticket should say that removing a track on one device doesn't stop an import on the other.

## Not in this plan

- Background or scheduled import. The issue defers it.
- Fixing `generateTrackId`'s non-Latin collapse for other add paths, or `findSavedTrack` matching on `--`. A known gap with its own pair of files to change.
- [#1240](https://github.com/Parachord/parachord/issues/1240) (album and single count as one song). Import's own dedupe already ignores albums, and that change doesn't conflict with this one.
