# In-app announcements

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## In-App Announcements

Public banner notifications fetched from Achordion. Used to push messages (releases, Discord invite, incidents) to every Parachord install without shipping a build.

### Architecture

- **Source of truth:** Upstash Redis key `announcements:json` (a JSON-encoded array). Edit it via the Upstash Data Browser UI; avoid the CLI when values contain apostrophes or other shell-fighting characters (the CLI's outer single-quote breaks on inner `'`).
- **Endpoint:** `GET https://achordion.xyz/api/announcements` ([app/api/announcements/route.ts](../../../../achordion/app/api/announcements/route.ts) in the achordion repo). Reads the Redis key, validates with the same zod schema the desktop client uses, returns the array. Cache headers: `public, s-maxage=60, stale-while-revalidate=600` — edits propagate within ~60s. Public, unauthenticated; gating would just be ceremony.
- **Desktop fetcher:** main.js, ~10s after `app.whenReady()` and on `browser-window-focus` when the last fetch is older than 6h. NO setInterval polling — earlier iteration polled every 1h, dropped to launch+focus-gated to cut request volume ~95% with no behavioural loss for product announcements.
- **Cache:** electron-store key `cached_announcements = { fetchedAt, items }`. Hydrates the renderer at bulk-load time so the banner can render before the first fetch fires. Updated on every successful fetch.
- **Dismissals:** electron-store key `dismissed_announcement_ids = string[]`. Per-id-once. The renderer's `activeAnnouncements` filter strips dismissed/expired/version-mismatched entries; the first remaining item renders.

### Schema

```jsonc
{
  "id": "2026-05-08-launch-discord",  // required, stable; dismissals key off this
  "title": "string",                  // required
  "severity": "info" | "success" | "warn" | "error",  // default 'info'
  "body": "string",                   // optional
  "icon": "📡",                        // optional, ≤4 chars (emoji/glyph)
  "iconUrl": "https://...png",        // optional, https-only, rendered 20×20
  "cta": { "label": "string", "url": "https://..." },  // optional
  "minVersion": "0.9.2",              // optional inclusive lower bound
  "maxVersion": "1.0.0",              // optional inclusive upper bound
  "expiresAt": "2026-06-01T00:00:00Z", // optional ISO-8601
  "surfaces": ["parachord"]           // optional; ('achordion' | 'parachord')[]
}
```

`surfaces` scopes an item to a subset of clients. Omitting it (or sending an empty array) shows the item on every surface — the pre-`surfaces` default, kept for backwards compatibility with entries authored before the field existed. The Achordion API (`app/api/announcements/route.ts`) explicitly delegates surface filtering to the client; Parachord's `activeAnnouncements` filter chain enforces it after the version-range check. If you add a new surface name (e.g. `ios`), both the Achordion zod schema in `lib/announcements.ts` and Parachord's filter need to know about it for the new client to receive items scoped to it.

`iconUrl` takes precedence over `icon`; on image error the banner silently falls back to `icon` (or nothing). Multiple items: id-sort descending wins (date-prefixed ids = recency-sorted), banner shows one at a time, dismiss surfaces the next.

### Per-id-once dismissal is a testing footgun

Once a user dismisses id X, X never re-shows for them — even if the server re-publishes the exact same id with new content. This is correct production behaviour (a fixed, stale banner shouldn't keep appearing), but during testing it looks like "the system is broken." If a banner doesn't appear:

1. Check `await window.electron.store.get('dismissed_announcement_ids')` — if your test id is in there, the filter is correctly suppressing it.
2. Either bump the id (`-v2`, `-v3`, etc.) for each test push, OR clear the dismissed list: `await window.electron.store.set('dismissed_announcement_ids', [])`.

Recommend always changing the id when iterating during dev so you exercise the same code path real users will hit.

### Manual refresh

`await window.electron.announcements.refresh()` (DevTools) forces a fetch regardless of the focus-stale gate. Returns the cached payload after the fetch lands. Use this during testing instead of waiting for focus or restarting.

### Renderer-side diagnostic logs

When `cacheLoaded` flips, the renderer logs `📢 Listener registered for announcements:updated broadcasts`. When main pushes a fresh payload, it logs `📢 Broadcast received: N item(s) [<ids>]`. Absence of either tells you which side the wiring is broken on.

### Cross-process flow

Main fetches → writes `cached_announcements` to electron-store → broadcasts `announcements:updated` via `webContents.send` to every BrowserWindow → renderer's `electron.announcements.onUpdated` listener fires → `setAnnouncements(payload.items)` → `activeAnnouncements` re-derives → banner re-renders. Listener registers in a `useEffect([cacheLoaded])` so it can't miss the broadcast as long as the renderer is up before the 10s mark (it always is — bulk-load completes much earlier).

### Editing flow

1. Upstash Console → Data Browser → key `announcements:json` → paste new JSON array → Save.
2. Within ~60s (CDN cache), `https://achordion.xyz/api/announcements` returns the new array.
3. Users pick it up at next launch (fast path) or on window focus after 6h (slow path), or instantly via manual refresh during testing.

To clear the banner everywhere: `DEL announcements:json` or `SET announcements:json '[]'`.

### Engagement telemetry

Three events fire from the desktop client over the announcement's life:

- **`view`** — first time the banner is painted in a session (deduped per id via `announcementViewedThisSessionRef`; re-renders, focus refetches, etc. don't double-count).
- **`dismiss`** — user clicks the × on the banner. Fires before the dismissed-id-list write so a failed counter increment can't strand the dismissal.
- **`cta-click`** — user clicks the CTA button. Fires before the URL opens.

All three POST to `https://achordion.xyz/api/announcements/event` with `{ id, event }`. Counters are stored as a Redis hash per id: `ann:event:<id> = { view, dismiss, cta-click }`. Read in the Upstash Data Browser via `HGETALL ann:event:<id>` or via `GET https://achordion.xyz/api/announcements/event?id=<id>` which returns `{ id, view, dismiss, "cta-click" }` with absent fields normalised to 0.

**Privacy:** events carry no client identifier, no version, no IP. The IP is read at the edge for rate-limiting only and never persisted. Counters are aggregate-only — there's no path to attribute a dismiss to a specific install.

**Reliability:** the event POST is fire-and-forget with a 4s timeout, `redirect: 'error'`, and full error swallow. Counter writes failing never affect UI state. The endpoint accepts a 200 even when Redis is unconfigured (local dev) so the desktop client doesn't see errors during achordion development without an Upstash backend.

**Rate limit:** 60/min/IP via `lib/rate-limit.ts`'s `announcement-event` kind. Real users emit at most a handful per banner shown; the limit blocks scripts trying to inflate counters.

**Not captured:** time-to-dismiss, time-to-CTA, whether the user dismissed *before or after* clicking CTA, banner impression duration. Add these later if a specific question needs them — don't over-instrument speculatively.
