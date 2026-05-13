# ListenBrainz Playlist Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ListenBrainz as a third playlist sync provider alongside Spotify and Apple Music — including **cross-service collaboration** (a Spotify user and an Apple Music user share an LB playlist; either's edits propagate to both streaming services). Ship the missing pieces that follow naturally — Achordion-side playlist-link display, default-private semantics, and an Achordion-hosted `/go` redirect to replace the last remaining `parachord.com/go` reference.

**Architecture:** ListenBrainz playlists use JSPF + recording MBIDs as the canonical identifier. We mirror the existing `sync-providers/{spotify,applemusic}.js` shape so the multi-provider plumbing (sync_playlist_links durable map, three-layer dedup, mirror-propagation invariants per [CLAUDE.md L236+](../../CLAUDE.md)) extends without special-casing. MBID-or-skip is enforced at push time. Playlist↔LB mapping is also pushed to a new Achordion endpoint so Achordion's UI can surface "View on ListenBrainz" links for shared playlist pages.

**Tech Stack:**
- Desktop: `sync-providers/listenbrainz.js` (Node, uses `electron.net.fetch`), main.js IPC handlers, app.js renderer wizard UI
- Achordion: Next.js API routes (TypeScript + zod), Upstash Redis for storage
- ListenBrainz API: REST + JSPF, `Authorization: Token <user_token>` header (token from the existing scrobbler config, NOT the meta-service config — see CLAUDE.md "ListenBrainz auth token auto-attach")
- MBID Mapper at `https://mapper.listenbrainz.org/mapping/lookup` for tracks lacking MBIDs at push time

---

## Decisions made up-front

The four requirements in the request resolve as follows. Marking each so an executor doesn't need to re-decide:

1. **Conflict resolution with existing Spotify/AM sync** — Reuse the existing multi-provider mirror system end-to-end. LB is the 3rd provider, not a special case. The four cooperating fixes documented at [CLAUDE.md L236+](../../CLAUDE.md) (handlePull mirror flag, local-mutator persistence, provider-scoped `syncedFrom` guard, post-push clear logic) all extend automatically once LB shows up in `enabledProviders`. See [Phase 3](#phase-3-desktop--integration-into-sync-pipeline) for the audit checklist.

2. **Achordion playlist links** — Parachord pushes `{ playlistMbid, links: [{ host, url, label }, ...], name?, creatorName?, trackCount? }` to a new Achordion endpoint `POST /api/playlist-links/submit` (mirrors `/api/track-links/submit`). Achordion stores per-LB-MBID and renders "View on Spotify" / "View on Apple Music" / "View on ListenBrainz" links on a new `/playlist/<mbid>` page. Direction is one-way Parachord → Achordion, matching the existing track-links flow.

3. **Default private** — `createPlaylist` always sends `public: false`. No user-facing setting in v1. If the user makes the LB playlist public on listenbrainz.org directly, subsequent Parachord pushes don't override (we only set `public` on the create-call, not on update-details).

4. **Achordion-hosted share links** — Three threads to wire:
   - New Achordion route `app/go/page.tsx` that accepts `?uri=parachord://...`, renders a small landing page, deep-links into the desktop app. Replaces parachord.com/go for the chat-share button.
   - Extend `app/api/entity-link/route.ts` to accept `type=playlist` with `mbid=<lb-playlist-mbid>`, returning `https://achordion.xyz/playlist/<mbid>`.
   - Wire desktop's `publishCollectionSmartLink` (app.js L13648) playlist branch — currently surfaces "not supported yet" — to call `fetchEntityLink(playlist, { type: 'playlist' })` once Achordion is ready.

---

## Cross-service collaboration via LB (tier-1 feature)

LB collaborative playlists enable **cross-service collaborative playlisting**. Two Parachord users on different streaming services can share an LB playlist as collaborators; either user's local edits propagate through LB to the other user's mirror.

Concrete flow:
1. Alice (Spotify user) creates a playlist locally. Parachord syncs it to LB (her own creator), and to her Spotify mirror.
2. Alice adds Bob as a collaborator on listenbrainz.org.
3. Bob (Apple Music user) imports the LB playlist into HIS Parachord — `syncedFrom.resolver = 'listenbrainz'`. His Parachord pushes it to his Apple Music — `syncedTo.applemusic.externalId = ...`.
4. Bob adds a track in his Parachord. His push loop fires LB push (since he's a writable collaborator on the LB playlist) AND his AM push. LB now has the new track.
5. Alice's next sync sees the LB snapshot change → `hasUpdates: true`. She pulls. Her local playlist now has Bob's track. Her next push loop fires Spotify push. Her Spotify mirror now has Bob's track.

Result: a track Bob added on his Mac shows up in Alice's Spotify within one sync cycle, via LB as the cross-service bridge.

Four pieces have to cooperate for this to work — covered by Tasks 7-bis, 13-bis, 10-bis, 14-bis below:

1. **`isOwnedByUser` includes collaborators.** When the local user is in the playlist's `collaborators` extension field, treat as own-pull-source-capable.
2. **Push-loop `syncedFrom` guard refinement.** Don't blanket-skip push back to the pull source — skip only when there's nothing genuinely local to contribute.
3. **Merge-before-push semantics on LB updates.** The clear+add pattern (Task 10) would clobber co-editors' contributions on snapshot drift. Refactor to fetch-remote → union-with-local → push-union.
4. **UI badge for "shared" playlists.** Surface that this playlist is collaborative so the user understands their edits propagate.

## Decisions explicitly out of scope (open for follow-up tickets)

- **LB collection-as-tracks sync** — LB doesn't have a "library" concept comparable to Spotify Liked Songs / AM Library. Skip entirely. `capabilities.tracks = false`.
- **Spotify/AM ⇄ Achordion playlist links without LB anchor** — the new submit endpoint accepts links from all providers, but the desktop's current behavior only pushes when LB is in the mirror set (LB MBID is the cross-platform anchor). Extending to push Spotify-only or AM-only playlist mappings would need a synthetic anchor; follow-up.
- **Public/private user toggle** — if users complain, add a setting later. Hardcoded `public: false` for v1.
- **Collaborator invite UI in Parachord** — adding collaborators happens on listenbrainz.org for v1. Parachord just respects the collaborator list, doesn't modify it.
- **Fine-grained conflict UX** — when Alice and Bob both edit between syncs, the merge-before-push semantics preserve both sets of additions, but ordering is lost (it becomes "all remote tracks + all local tracks" rather than the user's intended order). Fine-grained merge UI is a future enhancement.

---

## Phase 1: Achordion side prep

### Task 1: Playlist-links Redis store

**Why first:** the desktop sync calls into this endpoint, so the endpoint has to exist before the LB push path is wired. Also independently useful (could be backfilled with existing Spotify/AM playlist mappings later).

**Files:**
- Create: `~/Development/achordion/lib/playlist-links-store.ts`

**Step 1: Write the module**

```ts
import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Persistent LB-playlist-MBID → external-links cache, backed by Upstash Redis.
 * Mirrors `lib/track-links-store.ts` exactly in shape; separate keyspace.
 *
 * One Redis key per LB playlist MBID:
 *   pl-links:<lb-playlist-mbid> = JSON-encoded {
 *     mbid,
 *     name?,
 *     creatorName?,
 *     trackCount?,
 *     links: [{ host, url, label, source: "parachord" }],
 *     updatedAt
 *   }
 *
 * Why per-LB-MBID and not per-Spotify-ID-or-AM-ID-or-LB-MBID: ListenBrainz is
 * the only provider whose ID is a stable MusicBrainz identifier (UUID).
 * Spotify and AM IDs are platform-specific opaque strings. LB MBID is the
 * natural cross-platform anchor for "this is the same playlist across
 * services," same logic the rest of Achordion uses for tracks/recordings.
 *
 * TTL: 90 days. After expiry the read returns null; the next Parachord
 * submission overwrites with a fresh 90-day TTL.
 */

export type PlaylistLink = {
  host: string;
  url: string;
  label: string;
  source: "parachord";
};

export type PlaylistLinksEntry = {
  mbid: string;
  name?: string;
  creatorName?: string;
  trackCount?: number;
  links: PlaylistLink[];
  updatedAt: number;
};

const KEY_PREFIX = "pl-links:";
const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

const redis = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
})();

export async function getPlaylistLinks(mbid: string): Promise<PlaylistLinksEntry | null> {
  if (!redis) return null;
  try {
    const value = await redis.get<PlaylistLinksEntry>(`${KEY_PREFIX}${mbid}`);
    if (!value || typeof value !== "object") return null;
    if (!Array.isArray(value.links)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function setPlaylistLinks(entry: PlaylistLinksEntry): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(`${KEY_PREFIX}${entry.mbid}`, entry, { ex: TTL_SECONDS });
    return true;
  } catch (err) {
    console.warn(`[playlist-links-store] set failed for ${entry.mbid}:`, err);
    return false;
  }
}
```

**Step 2: Commit**

```bash
cd ~/Development/achordion
git add lib/playlist-links-store.ts
git commit -m "playlist-links: redis store mirroring track-links shape"
```

---

### Task 2: `POST /api/playlist-links/submit` endpoint

**Files:**
- Create: `~/Development/achordion/app/api/playlist-links/submit/route.ts`

**Step 1: Write the route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { setPlaylistLinks, type PlaylistLink } from "@/lib/playlist-links-store";

/**
 * Parachord pushes playlist mirror-link mappings here when a local playlist
 * is synced to ListenBrainz (and potentially other providers). The keying
 * MBID is always the ListenBrainz playlist MBID — that's the cross-platform
 * anchor.
 *
 * Symmetric to /api/track-links/submit:
 *   - Bearer token auth (PARACHORD_TRACK_LINKS_TOKEN — reuses the same
 *     env var; this is one logical write contract from one writer).
 *   - Per-IP rate limit shares the announcement-event limiter as a
 *     reasonable approximation; bump to its own kind if volume warrants.
 *   - Best-effort: 200 even when Upstash isn't configured (local dev).
 */

export const dynamic = "force-dynamic";

const NO_STORE: Record<string, string> = {
  "Cache-Control": "private, no-store",
};

const BodySchema = z.object({
  mbid: z.string().uuid(),
  name: z.string().max(500).optional(),
  creatorName: z.string().max(200).optional(),
  trackCount: z.number().int().min(0).max(10_000).optional(),
  links: z
    .array(
      z.object({
        host: z.string().min(1).max(120),
        url: z.string().regex(/^https?:\/\//i),
        label: z.string().min(1).max(60),
      }),
    )
    .min(1)
    .max(10),
});

function bearer(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1].trim() ?? null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.PARACHORD_TRACK_LINKS_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: true, recorded: false, reason: "endpoint not configured" },
      { status: 200, headers: NO_STORE },
    );
  }
  const presented = bearer(request);
  if (!presented || presented !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const limit = await checkRateLimit("announcement-event", request);
  if (!limit.ok) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400, headers: NO_STORE },
    );
  }

  const links: PlaylistLink[] = parsed.data.links.map((l) => ({
    host: l.host,
    url: l.url,
    label: l.label,
    source: "parachord" as const,
  }));

  const recorded = await setPlaylistLinks({
    mbid: parsed.data.mbid,
    name: parsed.data.name,
    creatorName: parsed.data.creatorName,
    trackCount: parsed.data.trackCount,
    links,
    updatedAt: Date.now(),
  });

  return NextResponse.json({ ok: true, recorded }, { headers: NO_STORE });
}
```

**Step 2: Smoke test locally (Achordion dev server)**

```bash
cd ~/Development/achordion
npm run dev   # in another terminal
# Then:
curl -i -X POST http://localhost:3000/api/playlist-links/submit \
  -H "Authorization: Bearer $PARACHORD_TRACK_LINKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mbid":"00000000-0000-0000-0000-000000000001","links":[{"host":"spotify.com","url":"https://open.spotify.com/playlist/X","label":"Spotify"}]}'
# Expect: 200 {"ok":true,"recorded":true}
```

**Step 3: Commit**

```bash
git add app/api/playlist-links/submit/route.ts
git commit -m "api/playlist-links/submit: accept Parachord playlist mirror mappings"
```

---

### Task 3: Extend `/api/entity-link` to support `type=playlist`

**Why:** the desktop's `publishCollectionSmartLink` currently early-returns for playlists (app.js L13655). To unblock it, Achordion needs to return a canonical playlist URL for an LB MBID.

**Files:**
- Modify: `~/Development/achordion/app/api/entity-link/route.ts` — add `playlist` to the type union + URL builder

**Step 1: Update TYPE_ALIASES and EntityType**

Locate the file's existing `TYPE_ALIASES` and `EntityType`:

```ts
type EntityType = "artist" | "release-group" | "recording" | "playlist";

const TYPE_ALIASES: Record<string, EntityType> = {
  artist: "artist",
  "release-group": "release-group",
  album: "release-group",
  recording: "recording",
  track: "recording",
  playlist: "playlist",
};
```

**Step 2: Update `canonicalUrl`**

```ts
function canonicalUrl(type: EntityType, mbid: string): string {
  const path =
    type === "artist"
      ? `/artist/${mbid}`
      : type === "release-group"
        ? `/release-group/${mbid}`
        : type === "playlist"
          ? `/playlist/${mbid}`
          : `/recording/${mbid}`;
  return `${ACHORDION_ORIGIN}${path}`;
}
```

**Step 3: Embed widgets — leave playlists undefined for now**

`embedUrl` currently only returns a URL for `recording`. Don't add playlist embed in this task — separate scope. Existing logic is correct.

**Step 4: Names enrichment branch — handle playlist gracefully**

Search the file for the `include=names` branch. If the type is `playlist`, skip the MB lookup (no MB playlist API) and return without `name` / `artist_name` / `album_name`. Pseudocode addition:

```ts
if (includeNames && type !== "playlist") {
  // ... existing MB fetch
}
```

If the user needs playlist name resolution, that's a future enhancement (fetch from LB by MBID). Skip in v1.

**Step 5: Commit**

```bash
git add app/api/entity-link/route.ts
git commit -m "entity-link: support type=playlist returning /playlist/<mbid>"
```

---

### Task 4: `/playlist/<mbid>` page that displays the mirror links

**Files:**
- Create: `~/Development/achordion/app/playlist/[mbid]/page.tsx`

**Step 1: Write the page**

```tsx
import { notFound } from "next/navigation";
import { getPlaylistLinks } from "@/lib/playlist-links-store";

interface PageProps {
  params: Promise<{ mbid: string }>;
}

export const dynamic = "force-dynamic";

export default async function PlaylistPage({ params }: PageProps) {
  const { mbid } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(mbid)) notFound();

  const entry = await getPlaylistLinks(mbid);
  if (!entry) {
    // Soft-empty: a playlist MBID can exist on LB even if Parachord hasn't
    // submitted mirror links yet. Show a placeholder with the LB link as a
    // fallback so the page isn't totally empty for direct LB-MBID lookups.
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-semibold mb-4">Playlist</h1>
        <p className="text-muted-foreground">
          No mirror data yet for this playlist.
        </p>
        <a
          href={`https://listenbrainz.org/playlist/${mbid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block underline"
        >
          View on ListenBrainz →
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold mb-1">
        {entry.name ?? "Untitled playlist"}
      </h1>
      {entry.creatorName && (
        <p className="text-muted-foreground mb-4">by {entry.creatorName}</p>
      )}
      {typeof entry.trackCount === "number" && (
        <p className="text-sm text-muted-foreground mb-6">
          {entry.trackCount} {entry.trackCount === 1 ? "track" : "tracks"}
        </p>
      )}
      <h2 className="text-sm font-medium mb-2 uppercase tracking-wider text-muted-foreground">
        Listen on
      </h2>
      <ul className="space-y-2">
        {entry.links.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

**Step 2: Commit**

```bash
git add app/playlist
git commit -m "playlist/[mbid]: page rendering mirror links from playlist-links store"
```

---

### Task 5: `/go` redirect route (replaces parachord.com/go)

**Why:** the chat-share button still generates `parachord.com/go?uri=parachord://...`. We want Achordion to own that surface.

**Files:**
- Create: `~/Development/achordion/app/go/page.tsx`

**Step 1: Write the page**

The original parachord.com/go is a static GitHub-Pages page that:
- Reads `?uri=parachord://...` from the query string
- Auto-attempts `window.location.href = uri` (deep link into the desktop app)
- Falls back to a "Get Parachord" page if no desktop install captures the protocol

Mirror that behavior, with Achordion branding:

```tsx
"use client";

import { useEffect, useState } from "react";

export const dynamic = "force-dynamic";

export default function GoPage() {
  const [uri, setUri] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("uri") ?? "";
    // Only accept parachord:// links — anything else is a protocol-injection attempt
    if (!raw.startsWith("parachord://")) return;
    setUri(raw);
    // Attempt the deep-link. If a registered handler exists, the page is
    // replaced; if not, this is a no-op and the user sees the fallback UI.
    window.location.href = raw;
    setAttempted(true);
  }, []);

  if (!uri) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-semibold mb-4">Open in Parachord</h1>
        <p className="text-muted-foreground">
          This link is missing or malformed. Did you mean to share a
          <code className="px-1">parachord://</code> URI?
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold mb-2">Opening Parachord…</h1>
      <p className="text-muted-foreground mb-6">
        If nothing happened, you may not have Parachord installed.
      </p>
      <button
        onClick={() => (window.location.href = uri)}
        className="px-4 py-2 rounded-md border"
      >
        Try again
      </button>
      <p className="mt-8 text-sm">
        <a
          href="https://parachord.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Get Parachord →
        </a>
      </p>
    </main>
  );
}
```

**Step 2: Push all of Phase 1 to deploy**

```bash
cd ~/Development/achordion
git push origin main
# Wait for Vercel deploy to go green (~30s)
curl -i 'https://achordion.xyz/api/entity-link?type=playlist&mbid=00000000-0000-0000-0000-000000000001' \
  -H "Authorization: Bearer $ACHORDION_API_READ_TOKEN"
# Expect: 200 with url including /playlist/<mbid>
```

**Step 3: Commit**

```bash
git add app/go
git commit -m "go: deep-link redirect route replacing parachord.com/go"
```

---

## Phase 2: Desktop — ListenBrainz sync provider

### Task 6: `sync-providers/listenbrainz.js` skeleton

**Why:** lays out the contract the rest of the sync machinery consumes. Match the shape of `sync-providers/spotify.js` and `sync-providers/applemusic.js`.

**Files:**
- Create: `sync-providers/listenbrainz.js`

**Step 1: Write the module skeleton with all required methods stubbed**

```js
// ListenBrainz playlist sync provider.
//
// Uses JSPF for playlist body and recording MBIDs as the canonical track
// identifier. The user token used here is the SCROBBLER-side token (key
// `scrobbler-config-listenbrainz`.userToken), not the meta-service config —
// see CLAUDE.md "ListenBrainz auth token auto-attach" for the rationale.
//
// Capability matrix (mirrors the shape used by spotify.js / applemusic.js):
//   - playlists: true
//   - tracks: false   (LB has no library-of-tracks concept)
//   - albums: false   (LB has no library-of-albums concept)
//   - artists: false  (LB has no library-of-artists concept)

const LB_BASE = 'https://api.listenbrainz.org';

const capabilities = {
  playlists: true,
  tracks: false,
  albums: false,
  artists: false,
};

function authHeaders(token) {
  return {
    'Authorization': `Token ${token}`,
    'Content-Type': 'application/json',
  };
}

async function getUserName(token) {
  // GET /1/validate-token returns { user_name, valid }
  const res = await fetch(`${LB_BASE}/1/validate-token`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`LB validate-token returned ${res.status}`);
  const data = await res.json();
  if (!data.valid || !data.user_name) throw new Error('LB token invalid');
  return data.user_name;
}

// ── Stubs for now; filled in by Tasks 7–11 ──
async function fetchPlaylists(token /*, onProgress, refreshToken */) {
  throw new Error('fetchPlaylists not implemented yet');
}
async function fetchPlaylistTracks(playlistMbid, token /*, _onProgress, refreshToken */) {
  throw new Error('fetchPlaylistTracks not implemented yet');
}
async function createPlaylist(name, description, tracks, token) {
  throw new Error('createPlaylist not implemented yet');
}
async function updatePlaylistTracks(playlistMbid, tracks, token) {
  throw new Error('updatePlaylistTracks not implemented yet');
}
async function updatePlaylistDetails(playlistMbid, details, token) {
  throw new Error('updatePlaylistDetails not implemented yet');
}
async function deletePlaylist(playlistMbid, token) {
  throw new Error('deletePlaylist not implemented yet');
}

module.exports = {
  id: 'listenbrainz',
  name: 'ListenBrainz',
  capabilities,
  fetchPlaylists,
  fetchPlaylistTracks,
  createPlaylist,
  updatePlaylistTracks,
  updatePlaylistDetails,
  deletePlaylist,
};
```

**Step 2: Commit**

```bash
cd ~/Development/parachord/parachord-desktop
git add sync-providers/listenbrainz.js
git commit -m "sync-providers/listenbrainz: skeleton matching spotify.js shape"
```

---

### Task 7: `fetchPlaylists`

**API:** `GET /1/user/{user_name}/playlists` returns `{ playlists: [{ playlist: { identifier, title, annotation, date, creator, track: [...] } }] }`. The `identifier` is `https://listenbrainz.org/playlist/<mbid>`; parse the MBID out. JSPF doesn't separately surface `snapshotId`, so we use the `date` field (last-modified) as a snapshot proxy.

**Files:**
- Modify: `sync-providers/listenbrainz.js`

**Step 1: Replace the stub**

```js
async function fetchPlaylists(token, _onProgress, _refreshToken) {
  const userName = await getUserName(token);
  // LB returns 25 playlists per page by default. Paginate via `count` / `offset`.
  const PAGE_SIZE = 50;
  let offset = 0;
  const playlists = [];
  while (true) {
    const res = await fetch(
      `${LB_BASE}/1/user/${encodeURIComponent(userName)}/playlists?count=${PAGE_SIZE}&offset=${offset}`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) throw new Error(`LB fetchPlaylists returned ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data?.playlists) ? data.playlists : [];
    if (items.length === 0) break;
    for (const item of items) {
      const p = item?.playlist;
      if (!p?.identifier) continue;
      const mbidMatch = p.identifier.match(/playlist\/([a-f0-9-]{36})/i);
      if (!mbidMatch) continue;
      const externalId = mbidMatch[1];
      // Collaborator detection: a user is considered "owner-capable" if
      // they're the creator OR appear in the playlist's collaborators
      // extension. This enables cross-service collaboration — see the
      // "Cross-service collaboration via LB" section at the top.
      const ext = p.extension?.['https://musicbrainz.org/doc/jspf#playlist'] || {};
      const creator = (p.creator || '').toLowerCase();
      const userLower = userName.toLowerCase();
      const collaborators = Array.isArray(ext.collaborators)
        ? ext.collaborators.map(c => String(c).toLowerCase())
        : [];
      const isOwnedByUser = creator === userLower || collaborators.includes(userLower);
      const isCollaborator = !!collaborators.length && creator !== userLower && collaborators.includes(userLower);
      playlists.push({
        externalId,
        id: `listenbrainz-${externalId}`,
        name: p.title || 'Untitled',
        description: p.annotation || '',
        ownerName: p.creator || userName,
        ownerId: p.creator || userName,
        isOwnedByUser,
        // `isCollaborator` is surfaced to the UI for the "shared playlist"
        // badge (Task 14-bis). Owner-only playlists have it false.
        isCollaborator,
        collaborators,
        snapshotId: ext.last_modified_at || p.date || null,
        trackCount: Array.isArray(p.track) ? p.track.length : 0,
        // Surface visibility so the wizard / cleanup UI can show it
        isPublic: !!ext.public,
      });
    }
    if (items.length < PAGE_SIZE) break;
    offset += items.length;
  }
  return { playlists };
}
```

**Step 2: Smoke test (after Task 13 wires the IPC)**

Verify via a manual sync wizard run. Skip if running before Task 13.

**Step 3: Commit**

```bash
git add sync-providers/listenbrainz.js
git commit -m "listenbrainz: fetchPlaylists with pagination"
```

---

### Task 8: `fetchPlaylistTracks`

**API:** `GET /1/playlist/<mbid>` returns the full JSPF playlist envelope; iterate `playlist.track`.

**Files:**
- Modify: `sync-providers/listenbrainz.js`

**Step 1: Replace the stub**

```js
async function fetchPlaylistTracks(playlistMbid, token, _onProgress, _refreshToken) {
  const res = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`LB fetchPlaylistTracks returned ${res.status}`);
  const data = await res.json();
  const tracks = Array.isArray(data?.playlist?.track) ? data.playlist.track : [];
  return tracks.map((t, i) => {
    // JSPF identifier is "https://musicbrainz.org/recording/<mbid>"
    const ids = Array.isArray(t.identifier) ? t.identifier : (t.identifier ? [t.identifier] : []);
    let mbid = null;
    for (const id of ids) {
      const m = String(id).match(/musicbrainz\.org\/recording\/([a-f0-9-]{36})/i);
      if (m) { mbid = m[1]; break; }
    }
    return {
      id: `listenbrainz-track-${playlistMbid}-${i}`,
      title: t.title || '',
      artist: t.creator || '',
      album: t.album || undefined,
      duration: typeof t.duration === 'number' ? t.duration / 1000 : undefined, // JSPF ms → s
      mbid,
      addedAt: Date.now(),  // JSPF doesn't carry per-track add timestamps
      sources: {},
    };
  });
}
```

**Step 2: Commit**

```bash
git commit -am "listenbrainz: fetchPlaylistTracks parsing JSPF"
```

---

### Task 9: `createPlaylist` (with `public: false` default)

**API:** `POST /1/playlist/create` accepts a JSPF playlist body. Returns `{ status: "ok", playlist_mbid: "<uuid>" }`.

**Files:**
- Modify: `sync-providers/listenbrainz.js`

**Step 1: Add MBID resolution helper**

This is where the MBID-or-skip rule lives. Push only tracks with a recording MBID; collect unresolved tracks separately for the caller.

```js
// Resolve a single track to a recording MBID. Tries (1) track.mbid, (2)
// MBID Mapper. Returns the MBID or null. The mapper is fast (~4ms) and
// the result is opportunistically cached by callers via the existing
// `cache_mbid_mapper` electron-store key — but here in main-process
// sync-provider code we just hit the mapper directly each time. The
// renderer-side enrichment loop populates the cache for the next pass.
async function resolveTrackMbid(track) {
  if (track?.mbid && /^[a-f0-9-]{36}$/i.test(track.mbid)) return track.mbid;
  if (!track?.artist || !track?.title) return null;
  try {
    const url = new URL('https://mapper.listenbrainz.org/mapping/lookup');
    url.searchParams.set('artist_credit_name', track.artist);
    url.searchParams.set('recording_name', track.title);
    if (track.album) url.searchParams.set('release_name', track.album);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.recording_mbid && typeof data.confidence === 'number' && data.confidence >= 0.7) {
      return data.recording_mbid;
    }
    return null;
  } catch {
    return null;
  }
}
```

**Step 2: Replace the createPlaylist stub**

```js
async function createPlaylist(name, description, tracks, token) {
  const userName = await getUserName(token);
  const resolvedTracks = [];
  const unresolvedTracks = [];
  for (const t of tracks || []) {
    const mbid = await resolveTrackMbid(t);
    if (mbid) {
      resolvedTracks.push({
        identifier: [`https://musicbrainz.org/recording/${mbid}`],
        title: t.title || '',
        creator: t.artist || '',
      });
    } else {
      unresolvedTracks.push({ artist: t.artist, title: t.title, album: t.album });
    }
  }
  const body = {
    playlist: {
      title: name,
      annotation: description || '',
      extension: {
        'https://musicbrainz.org/doc/jspf#playlist': {
          // Default-private. Hard-coded; see CLAUDE.md "ListenBrainz Playlist
          // Sync" section for rationale and the user-toggle follow-up.
          public: false,
          creator: userName,
        },
      },
      track: resolvedTracks,
    },
  };
  const res = await fetch(`${LB_BASE}/1/playlist/create`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LB createPlaylist returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const externalId = data?.playlist_mbid;
  if (!externalId) throw new Error('LB createPlaylist: no playlist_mbid in response');
  return {
    externalId,
    snapshotId: null,  // LB doesn't return one on create; first fetchPlaylists tick populates
    unresolvedTracks,
  };
}
```

**Step 3: Commit**

```bash
git commit -am "listenbrainz: createPlaylist with public:false default + MBID resolution"
```

---

### Task 10: `updatePlaylistTracks` (replace via clear + add)

**Why:** LB's playlist API offers `POST /1/playlist/<mbid>/item/add` and `POST /1/playlist/<mbid>/item/delete`. There's no full-replace PUT. Simplest semantically: delete all + add all. For playlists with hundreds of tracks this becomes 2 round-trips; acceptable.

LB also supports `move` for re-ordering but we don't have a stable identity to move FROM in the local model, so delete-all + add-all is fine.

**Files:**
- Modify: `sync-providers/listenbrainz.js`

**Step 1: Implementation**

```js
async function updatePlaylistTracks(playlistMbid, tracks, token) {
  // 1. Resolve all incoming tracks to MBIDs (skip unresolved)
  const resolvedTracks = [];
  const unresolvedTracks = [];
  for (const t of tracks || []) {
    const mbid = await resolveTrackMbid(t);
    if (mbid) {
      resolvedTracks.push({
        identifier: [`https://musicbrainz.org/recording/${mbid}`],
        title: t.title || '',
        creator: t.artist || '',
      });
    } else {
      unresolvedTracks.push({ artist: t.artist, title: t.title, album: t.album });
    }
  }

  // 2. Fetch current playlist to learn its track count
  let currentLen = 0;
  try {
    const cur = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
      headers: authHeaders(token),
    });
    if (cur.ok) {
      const data = await cur.json();
      currentLen = Array.isArray(data?.playlist?.track) ? data.playlist.track.length : 0;
    }
  } catch {
    // Non-fatal; treat as 0 → add-only.
  }

  // 3. Delete all existing items (in one bulk call). LB's API spec:
  //    POST /1/playlist/<mbid>/item/delete with { "index": N, "count": M }
  if (currentLen > 0) {
    const delRes = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/item/delete`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ index: 0, count: currentLen }),
    });
    if (!delRes.ok && delRes.status !== 200) {
      // LB returns 200 with body { status: ok } on success. Some clients
      // see 204; either is fine. Anything else is a real error.
      const text = await delRes.text().catch(() => '');
      throw new Error(`LB clear tracks returned ${delRes.status}: ${text.slice(0, 200)}`);
    }
  }

  // 4. Add resolved tracks (batched at 100 — LB doesn't document an upper
  //    bound but smaller batches reduce blast radius on partial failures).
  const BATCH = 100;
  for (let i = 0; i < resolvedTracks.length; i += BATCH) {
    const batch = resolvedTracks.slice(i, i + BATCH);
    const addRes = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/item/add`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ playlist: { track: batch } }),
    });
    if (!addRes.ok) {
      const text = await addRes.text().catch(() => '');
      throw new Error(`LB add tracks returned ${addRes.status}: ${text.slice(0, 200)}`);
    }
  }

  // 5. Re-fetch to get a fresh snapshot anchor
  let newSnapshotId = null;
  try {
    const cur = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
      headers: authHeaders(token),
    });
    if (cur.ok) {
      const data = await cur.json();
      newSnapshotId = data?.playlist?.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.last_modified_at
        || data?.playlist?.date
        || null;
    }
  } catch {
    // Non-fatal.
  }

  return { snapshotId: newSnapshotId, unresolvedTracks };
}
```

**Step 2: Commit**

```bash
git commit -am "listenbrainz: updatePlaylistTracks via clear+add"
```

---

### Task 11: `updatePlaylistDetails` + `deletePlaylist`

**API:**
- Update details: `POST /1/playlist/edit/<mbid>` with `{ playlist: { title, annotation } }`.
- Delete: `POST /1/playlist/<mbid>/delete`.

**Files:**
- Modify: `sync-providers/listenbrainz.js`

**Step 1: Implementations**

```js
async function updatePlaylistDetails(playlistMbid, details, token) {
  const body = {
    playlist: {
      title: details?.name ?? details?.title,
      annotation: details?.description ?? '',
    },
  };
  const res = await fetch(`${LB_BASE}/1/playlist/edit/${encodeURIComponent(playlistMbid)}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Don't throw — see CLAUDE.md "Apple Music fallback behavior" rationale.
    // Track-push happens AFTER details-push in sync:push-playlist; a throw
    // here would abort the track push too. Log + return success-with-skip.
    console.warn(`[LB] updatePlaylistDetails returned ${res.status}: ${text.slice(0, 200)}`);
    return { success: true, skipped: `status-${res.status}` };
  }
  return { success: true };
}

async function deletePlaylist(playlistMbid, token) {
  const res = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/delete`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    return { success: false, reason: `status-${res.status}` };
  }
  return { success: true };
}
```

**Step 2: Commit**

```bash
git commit -am "listenbrainz: updatePlaylistDetails + deletePlaylist"
```

---

## Phase 3: Desktop — integration into sync pipeline

### Task 12: Register the provider in main.js

**Files:**
- Modify: `main.js` — locate the existing `providers` map around `sync:start` / `sync:fetch-playlists` / `sync:create-playlist` handlers

**Step 1: Add LB to every `providers` lookup**

Search main.js for occurrences of `require('./sync-providers/spotify')`. Each one needs the LB sibling added. Pattern (already used for AM):

```js
const providers = {
  spotify: require('./sync-providers/spotify'),
  applemusic: require('./sync-providers/applemusic'),
  listenbrainz: require('./sync-providers/listenbrainz'),
};
```

**Step 2: Auth resolution in main.js**

The LB token lives in the scrobbler config, not the meta-service config. Where main.js currently does `store.get('applemusic_user_token')` etc., add the LB path:

```js
function getProviderToken(providerId) {
  if (providerId === 'spotify') return store.get('spotify_token');
  if (providerId === 'applemusic') return store.get('applemusic_user_token');
  if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    return cfg.userToken || null;
  }
  return null;
}
```

(Or wherever the existing per-provider token lookup lives — match the pattern.)

**Step 3: Validate auth in `sync:check-auth`**

The check-auth handler should call the LB provider's auth probe. For LB, hitting `/1/validate-token` is cheap.

```js
case 'listenbrainz': {
  const token = getProviderToken('listenbrainz');
  if (!token) return { authenticated: false };
  try {
    const res = await fetch(`${LB_BASE}/1/validate-token`, {
      headers: { Authorization: `Token ${token}` },
    });
    const data = await res.json();
    return { authenticated: !!data?.valid };
  } catch {
    return { authenticated: false };
  }
}
```

**Step 4: Commit**

```bash
git add main.js
git commit -m "main: register listenbrainz sync provider + auth resolution from scrobbler config"
```

---

### Task 10-bis: Merge-before-push for LB updates (collaborative-safe)

**Why:** Task 10's clear+add pattern is correct for single-owner playlists, but in the collaborative case it data-loses: if Bob pushes with a stale snapshot, his clear+add wipes any tracks Alice added after Bob's last fetch. The fix is to detect snapshot drift and merge in the missing remote additions before doing the clear+add.

**Files:**
- Modify: `sync-providers/listenbrainz.js` — extend `updatePlaylistTracks` with an optional merge step.

**Step 1: Add merge logic to `updatePlaylistTracks`**

Replace the existing implementation with the merged version:

```js
async function updatePlaylistTracks(playlistMbid, tracks, token, opts = {}) {
  const { knownSnapshotId, mergeWithRemote = false } = opts;

  // ── Step 1: Resolve all incoming tracks to MBIDs ───────────────────
  const resolvedTracks = [];
  const unresolvedTracks = [];
  for (const t of tracks || []) {
    const mbid = await resolveTrackMbid(t);
    if (mbid) {
      resolvedTracks.push({
        identifier: [`https://musicbrainz.org/recording/${mbid}`],
        title: t.title || '',
        creator: t.artist || '',
      });
    } else {
      unresolvedTracks.push({ artist: t.artist, title: t.title, album: t.album });
    }
  }

  // ── Step 2: Fetch current remote (for both clear count AND merge) ──
  let remoteSnapshotDate = null;
  let remoteTracks = [];
  let currentLen = 0;
  try {
    const cur = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
      headers: authHeaders(token),
    });
    if (cur.ok) {
      const data = await cur.json();
      const p = data?.playlist || {};
      remoteSnapshotDate = p.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.last_modified_at
        || p.date
        || null;
      remoteTracks = Array.isArray(p.track) ? p.track : [];
      currentLen = remoteTracks.length;
    }
  } catch {
    // Non-fatal; treat as 0 → add-only.
  }

  // ── Step 3: Merge-before-push (collaborative case) ─────────────────
  //
  // If the caller signals this is a collaborative playlist AND the remote
  // snapshot has advanced since we last knew about it, someone else
  // (another collaborator) made changes between our last pull and this
  // push. Union the unfamiliar remote additions into our outbound payload
  // so we don't wipe their work.
  //
  // "Unfamiliar" = present in remote, identified by recording MBID, not
  // in our local resolved set. This loses fine-grained ordering for
  // foreign additions (they end up appended) but preserves their
  // existence — the priority is data preservation over ordering.
  if (
    mergeWithRemote
    && knownSnapshotId
    && remoteSnapshotDate
    && remoteSnapshotDate !== knownSnapshotId
  ) {
    const localMbidSet = new Set(
      resolvedTracks
        .map(t => {
          const id = Array.isArray(t.identifier) ? t.identifier[0] : t.identifier;
          const m = String(id || '').match(/recording\/([a-f0-9-]{36})/i);
          return m ? m[1] : null;
        })
        .filter(Boolean),
    );
    let foreignAdded = 0;
    for (const rt of remoteTracks) {
      const ids = Array.isArray(rt.identifier) ? rt.identifier : (rt.identifier ? [rt.identifier] : []);
      let mbid = null;
      for (const id of ids) {
        const m = String(id).match(/recording\/([a-f0-9-]{36})/i);
        if (m) { mbid = m[1]; break; }
      }
      if (!mbid || localMbidSet.has(mbid)) continue;
      resolvedTracks.push({
        identifier: [`https://musicbrainz.org/recording/${mbid}`],
        title: rt.title || '',
        creator: rt.creator || '',
      });
      foreignAdded++;
    }
    if (foreignAdded > 0) {
      console.log(`[LB] Merged ${foreignAdded} foreign track(s) from collaborator(s) before push`);
    }
  }

  // ── Step 4: Clear remote (same as before) ──────────────────────────
  if (currentLen > 0) {
    const delRes = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/item/delete`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ index: 0, count: currentLen }),
    });
    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '');
      throw new Error(`LB clear tracks returned ${delRes.status}: ${text.slice(0, 200)}`);
    }
  }

  // ── Step 5: Add the merged set in batches ──────────────────────────
  const BATCH = 100;
  for (let i = 0; i < resolvedTracks.length; i += BATCH) {
    const batch = resolvedTracks.slice(i, i + BATCH);
    const addRes = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/item/add`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ playlist: { track: batch } }),
    });
    if (!addRes.ok) {
      const text = await addRes.text().catch(() => '');
      throw new Error(`LB add tracks returned ${addRes.status}: ${text.slice(0, 200)}`);
    }
  }

  // ── Step 6: Re-fetch fresh snapshot anchor ─────────────────────────
  let newSnapshotId = null;
  try {
    const cur = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
      headers: authHeaders(token),
    });
    if (cur.ok) {
      const data = await cur.json();
      newSnapshotId = data?.playlist?.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.last_modified_at
        || data?.playlist?.date
        || null;
    }
  } catch {}

  return { snapshotId: newSnapshotId, unresolvedTracks };
}
```

**Step 2: Caller passes mergeWithRemote when appropriate**

In main.js's `sync:push-playlist`, when the target provider is `listenbrainz` AND the playlist's `syncedFrom.resolver === 'listenbrainz'` (round-trip case) OR the playlist is flagged as `isCollaborator: true` from a prior fetch:

```js
const opts = {
  knownSnapshotId: localPlaylist.syncedFrom?.snapshotId
    || localPlaylist.syncedTo?.listenbrainz?.snapshotId
    || null,
  mergeWithRemote: providerId === 'listenbrainz' && (
    localPlaylist.syncedFrom?.resolver === 'listenbrainz'
    || !!localPlaylist.isCollaborator
  ),
};
const result = await provider.updatePlaylistTracks(externalId, tracks, token, opts);
```

**Step 3: Commit**

```bash
git commit -am "listenbrainz: merge-before-push for collaborative playlists"
```

---

### Task 13: Audit cross-provider mirror invariants for LB

Per [CLAUDE.md L236+](../../CLAUDE.md), four pieces have to cooperate for multi-provider mirror propagation. Walk through each with LB in mind:

**Step 1: `handlePull` `hasOtherMirrors` check (app.js ~L39818)**

Already provider-agnostic — uses `Object.keys(playlist.syncedTo).some(pid => pid !== provider && ...)`. No change needed; will include LB automatically once an LB push target exists.

**Step 2: Local-content mutators (app.js L17358+)**

`addTracksToPlaylist`, `removeTrackFromPlaylist`, `moveTrackInPlaylist` write `locallyModified: true` when `p.syncedFrom || p.syncedTo`. Already provider-agnostic.

**Step 3: Push-loop `syncedFrom` guard (app.js L5817, L9483) — REFINEMENT for collaborative LB**

The existing rule:

```js
if (playlist.syncedFrom?.resolver === providerId) continue;
```

This is correct for single-owner imported playlists: don't push Spotify-imported content back to Spotify (no value added). But for LB-imported collaborative playlists, the local user IS contributing genuine new edits that need to round-trip back to LB (and from there to other collaborators' streaming services).

Refinement: skip push-to-source ONLY when there are no genuine local edits to contribute. Use the existing "real local divergence" check (the same logic the sync banner uses at app.js L39876+):

```js
// Skip push back to the pull source unless we have genuine local edits.
// `locallyModified: true` alone isn't enough — handlePull sets it for
// multi-mirror propagation. The discriminator is `lastModified` being
// newer than the source provider's last sync timestamp.
const sourceProvider = playlist.syncedFrom?.resolver;
if (sourceProvider === providerId) {
  const sourceSyncedAt = playlist.syncSources?.[sourceProvider]?.syncedAt || 0;
  const hasGenuineLocalEdits = playlist.locallyModified
    && (playlist.lastModified || 0) > sourceSyncedAt;
  if (!hasGenuineLocalEdits) continue;
  // Fall through: push back to source IS warranted (collaborative case).
}
```

Apply at both sites (L5817 and L9483) in lockstep — same rule applies to the background and post-wizard push loops per CLAUDE.md "Push-loop syncedFrom guard must be provider-scoped."

**Step 3a: Grep current state**

```bash
grep -n "playlist.syncedFrom?.resolver === providerId" app.js
# Should show 2 hits (background sync push + post-wizard create loop).
# Both need the refinement.
```

**Step 3b: Apply the refined guard at both sites**

Locate each hit. The before-state:

```js
if (playlist.syncedFrom?.resolver === providerId) continue;
```

Replace with the source-vs-genuine-local check above.

**Step 4: Post-sync clear logic (app.js L5916+)**

The `relevantMirrors = enabledProviders.filter(...)` block must `.filter(pid => playlist.syncedTo[pid]?.externalId && pid !== sourceProvider)`. Already provider-agnostic.

**Step 5: `sync:start` `isOwnPullSource` (main.js ~L5680)**

Same: `isOwnPullSource = !current.syncedFrom?.resolver || current.syncedFrom.resolver === providerId`. Already correct for any provider. Verify.

**No code changes if all 5 audits pass.** Document in commit message:

```bash
git commit --allow-empty -m "audit: cross-provider mirror invariants hold for LB (no code changes needed)"
```

---

### Task 13-bis: "Shared" badge on collaborative playlists

**Why:** users need a clear signal that "your edits here propagate to other collaborators." Otherwise the round-trip-to-other-streaming-service behavior is surprising.

**Files:**
- Modify: `app.js` — playlist row + playlist detail header
- Modify: local playlist data model — persist `isCollaborator` from fetchPlaylists alongside other syncedFrom/syncedTo fields

**Step 1: Persist the collaborator flag**

When `sync:start` imports a playlist (main.js's existing path that consumes `provider.fetchPlaylists`), persist the `isCollaborator` flag onto the local playlist record:

```js
const localPlaylist = {
  // ... existing fields
  syncedFrom: {
    resolver: providerId,
    externalId: remotePlaylist.externalId,
    snapshotId: remotePlaylist.snapshotId,
    ownerId: remotePlaylist.ownerId,
    isCollaborator: !!remotePlaylist.isCollaborator,  // NEW
  },
};
```

Refresh on subsequent syncs so collaborators added/removed on listenbrainz.org reflect locally.

**Step 2: Render badge in playlist row + detail header**

Add a small "Shared" pill (~CSS-styled, no icon dependency) wherever the playlist row renders sync-source badges today. Show only when `playlist.syncedFrom?.isCollaborator === true`:

```js
playlist.syncedFrom?.isCollaborator && React.createElement('span', {
  className: 'shared-playlist-badge',
  title: 'You\'re a collaborator on this playlist — your edits sync to other collaborators',
  style: {
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: 'var(--accent-secondary)',
    color: 'var(--accent-secondary-fg)',
    fontWeight: 600,
  }
}, 'SHARED')
```

**Step 3: Commit**

```bash
git commit -am "app: shared-playlist badge for collaborative LB playlists"
```

---

### Task 14: Wire LB into the sync wizard UI

**Files:**
- Modify: `app.js` — sync setup modal (`syncSetupModal`, around L5361)

**Step 1: Add LB to the provider list shown in the wizard**

Find the array of providers shown in the wizard. Add `{ id: 'listenbrainz', name: 'ListenBrainz', logo: '...', authPath: 'scrobbler-config-listenbrainz' }`.

**Step 2: Surface the "already configured for scrobbling" state**

The wizard needs to know whether the user already has an LB token (from the scrobbler) — if so, skip the auth step and go straight to playlist selection. If not, point them at the scrobbler setup UI (don't introduce a parallel auth path).

```js
const lbToken = await window.electron.store.get('scrobbler-config-listenbrainz');
const lbAuthenticated = !!lbToken?.userToken;
```

**Step 3: Selected-playlists seed**

Per CLAUDE.md "Sync wizard pre-check seeds from push + pull state, not just saved selections." Verify the seed union logic at `openSyncSetupModal` picks up LB the same way it does for Spotify/AM. No code change if the existing implementation is provider-agnostic.

**Step 4: Commit**

```bash
git add app.js
git commit -m "app: surface listenbrainz in sync setup wizard"
```

---

### Task 15: Push playlist-link to Achordion after LB sync

**Files:**
- Modify: `main.js` (or wherever the post-create / post-push hook lives)

**Step 1: Add the helper**

```js
async function pushPlaylistLinksToAchordion(localPlaylist) {
  const links = [];
  const syncedTo = localPlaylist.syncedTo || {};
  if (syncedTo.spotify?.externalId) {
    links.push({
      host: 'open.spotify.com',
      url: `https://open.spotify.com/playlist/${syncedTo.spotify.externalId}`,
      label: 'Spotify',
    });
  }
  if (syncedTo.applemusic?.externalId) {
    links.push({
      host: 'music.apple.com',
      url: `https://music.apple.com/library/playlist/${syncedTo.applemusic.externalId}`,
      label: 'Apple Music',
    });
  }
  if (syncedTo.listenbrainz?.externalId) {
    links.push({
      host: 'listenbrainz.org',
      url: `https://listenbrainz.org/playlist/${syncedTo.listenbrainz.externalId}`,
      label: 'ListenBrainz',
    });
  }
  const lbMbid = syncedTo.listenbrainz?.externalId
    || (localPlaylist.syncedFrom?.resolver === 'listenbrainz' && localPlaylist.syncedFrom.externalId);
  if (!lbMbid || links.length === 0) return; // No anchor MBID = nothing to key on

  const payload = {
    mbid: lbMbid,
    name: localPlaylist.title,
    creatorName: localPlaylist.creator || null,
    trackCount: Array.isArray(localPlaylist.tracks) ? localPlaylist.tracks.length : undefined,
    links,
  };

  try {
    await fetch('https://achordion.xyz/api/playlist-links/submit', {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACHORDION_BEARER}`,  // same env var as track-links/submit
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[achordion] playlist-links submit failed:', err && err.message ? err.message : err);
  }
}
```

**Step 2: Call after every successful LB push**

In `sync:create-playlist` and `sync:push-playlist`, when the affected provider was `listenbrainz` OR the playlist now has LB in its `syncedTo`, call `pushPlaylistLinksToAchordion(localPlaylist)`. Fire-and-forget — don't block the IPC response.

**Step 3: Commit**

```bash
git commit -am "achordion: push playlist mirror links after LB sync writes"
```

---

### Task 16: Wire desktop `publishCollectionSmartLink` playlist branch

**Files:**
- Modify: `app.js:13648+` (`publishCollectionSmartLink`)

**Step 1: Replace the "not supported yet" branch**

Locate the existing block at L13655 that early-returns with toast `"View on Achordion isn't supported for playlists yet"`. Replace:

```js
if (collection.type === 'playlist') {
  // Playlist sharing requires a ListenBrainz MBID anchor — that's the
  // cross-platform identifier Achordion keys its playlist-links cache on.
  const lbMbid = collection.syncedTo?.listenbrainz?.externalId
    || (collection.syncedFrom?.resolver === 'listenbrainz' && collection.syncedFrom.externalId);
  if (!lbMbid) {
    showToast(
      'Sync this playlist to ListenBrainz first to enable sharing via Achordion.',
      'info',
    );
    return;
  }
  let url = `https://achordion.xyz/playlist/${lbMbid}`; // fallback
  if (window.achordion?.fetchEntityLink) {
    const result = await window.achordion.fetchEntityLink(
      { mbid: lbMbid },
      { type: 'playlist' },
    );
    if (result.ok) url = result.url;
  }
  if (openInBrowser) {
    window.electron?.shell?.openExternal?.(url);
    showToast('Opened in browser');
  } else {
    await navigator.clipboard.writeText(url);
    showToast('Link copied to clipboard!');
  }
  return;
}
```

**Step 2: Commit**

```bash
git commit -am "app: enable playlist sharing via Achordion when an LB MBID is available"
```

---

### Task 17: Migrate chat-share button from parachord.com/go → achordion.xyz/go

**Files:**
- Modify: `app.js:55189`

**Step 1: One-line change**

```js
const link = `https://achordion.xyz/go?uri=${encodeURIComponent(uri)}`;
```

**Step 2: Verify nothing else in the desktop generates parachord.com share links**

```bash
grep -n "parachord\.com/go\|go\.parachord" app.js main.js preload.js plugins/
# Expect: only code comments, no remaining live share-link generators.
```

**Step 3: Commit**

```bash
git commit -am "app: chat share button uses achordion.xyz/go"
```

---

## Phase 4: Documentation + cross-platform parity

### Task 18: Update CLAUDE.md syncing section

**Files:**
- Modify: `CLAUDE.md` — `## Syncing System`, `### Provider-Specific Push Semantics` table, `### Android Parity Requirements`

**Step 1: Add an LB row to the provider semantics table**

Locate `### Provider-Specific Push Semantics` table. Add:

```markdown
| **ListenBrainz** | Clear + add | `POST /1/playlist/<mbid>/item/delete` removes all, then `POST /1/playlist/<mbid>/item/add` adds the new list in 100-track batches. No full-replace PUT exists. JSPF format on the wire; recording MBID is the per-track identifier — tracks without a resolvable MBID are skipped and surfaced via `unresolvedTracks`. |
```

**Step 2: Add a section on default-private and Achordion-link push**

After the table:

```markdown
### ListenBrainz Specifics

- **Token source.** The token comes from the scrobbler-side config (`scrobbler-config-listenbrainz.userToken`), NOT a separate meta-service config. Single source of truth — see "ListenBrainz auth token auto-attach" earlier in this file for the same rule on the lb-radio path.

- **Default private.** `createPlaylist` hard-codes `extension['https://musicbrainz.org/doc/jspf#playlist'].public = false`. No user-facing toggle in v1. If the user makes the playlist public on listenbrainz.org directly, subsequent Parachord pushes don't override (we only set `public` on create, not on update-details).

- **MBID-or-skip.** Every track pushed to LB must have a recording MBID. Tracks without one are run through the MBID Mapper (≥0.7 confidence required); unresolved tracks are collected into `syncedTo.listenbrainz.unresolvedTracks` for the UI to surface. Surfacing TBD; for v1 it's just persisted state.

- **Achordion playlist-links push.** After any successful sync write that touches an LB-anchored playlist (create or update), main.js fires `pushPlaylistLinksToAchordion(localPlaylist)` to `POST https://achordion.xyz/api/playlist-links/submit`. Fire-and-forget; same 401-suppression pattern as the track-links submit (Achordion plugin's auth-failed kill-switch). The payload is keyed on the LB playlist MBID; Achordion stores it for 90 days and renders the mirror links on `/playlist/<mbid>`.

- **Snapshot proxy.** LB doesn't return a `snapshotId` per playlist. We use the JSPF `date` field (last-modified timestamp) as the comparison anchor for `hasUpdates` detection. The existing track-count-match suppression covers the case where LB churns this timestamp without real content changes.
```

**Step 3: Update the Android Parity Requirements section**

Locate the AM-specific parity block. Add an equivalent block for LB:

```markdown
**ListenBrainz Android parity**

- Same JSPF + recording-MBID semantics.
- Same default-private (`public: false` on create only).
- Same MBID-or-skip rule, with the same mapper confidence floor (0.7).
- Token comes from the scrobbler-side store, not a meta-service store.
- Same clear-then-add update path (no full-replace PUT).
- Android should mirror the Achordion playlist-links push so cross-platform contribution stays symmetric.
```

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "claude.md: document listenbrainz playlist sync semantics + android parity"
```

---

### Task 19: Update Achordion AGENTS.md

**Files:**
- Modify: `~/Development/achordion/AGENTS.md`

**Step 1: Add the playlist-links endpoint contract**

Find the section that documents the `/api/track-links/submit` contract. Add a sibling block:

```markdown
### `POST /api/playlist-links/submit`

Parachord push endpoint for playlist mirror-link mappings. Accepts:

  {
    "mbid":         "<listenbrainz-playlist-mbid (UUID)>",
    "name":         "<playlist title>"                          // optional
    "creatorName":  "<playlist creator>"                        // optional
    "trackCount":   <int>                                        // optional
    "links":        [
      { "host": "open.spotify.com",  "url": "https://...",  "label": "Spotify" },
      { "host": "music.apple.com",   "url": "https://...",  "label": "Apple Music" },
      { "host": "listenbrainz.org",  "url": "https://...",  "label": "ListenBrainz" }
    ]
  }

Storage: per-MBID Redis key with 90-day TTL. Source is always
`"parachord"`. Same bearer (`PARACHORD_TRACK_LINKS_TOKEN`) and same
rate-limit class as track-links/submit.

Used by /playlist/<mbid> page to render "Listen on Spotify / Apple Music /
ListenBrainz" links. Also surfaced via /api/entity-link?type=playlist as
the canonical URL for sharing.
```

**Step 2: Commit (in achordion repo)**

```bash
cd ~/Development/achordion
git add AGENTS.md
git commit -m "agents.md: document playlist-links/submit contract"
git push
```

---

## Verification matrix

After all phases, manually verify:

| Scenario | Expected |
|---|---|
| Sync a Spotify-imported playlist to LB | New LB playlist created, `public: false`, tracks resolved via mapper for those without MBID |
| Edit playlist locally (add a track), background sync fires | LB push fires AFTER Spotify push (or in parallel), syncedTo.listenbrainz.snapshotId updates |
| Pull from Spotify on a playlist mirrored to LB | `locallyModified: true` set so next push propagates to LB (multi-provider mirror invariant #1) |
| Spotify-imported playlist matched via `syncedTo.listenbrainz.externalId` during LB sync | NOT incorrectly converted to LB-imported (cross-provider syncedFrom preservation) |
| Share a playlist that has LB mirror | Achordion playlist page renders all 3 mirror links |
| Share a playlist with NO LB mirror | Toast: "Sync this playlist to ListenBrainz first to enable sharing via Achordion" |
| Chat share button | Generates `achordion.xyz/go?uri=...` link |
| Track in playlist has no MBID and mapper returns < 0.7 | Track skipped in LB push, `unresolvedTracks` populated |
| LB playlist that lost remote (deleted via listenbrainz.org) | `pendingAction: 'remote-deleted'` flagged on next sync; existing behavior covers this |
| **Cross-service collaboration round-trip** (the marquee test) | Alice (Spotify) creates playlist, adds Bob as collaborator on listenbrainz.org. Bob (AM) imports it. Bob adds a track in his Parachord. Within one sync cycle, the track appears in Alice's Spotify playlist on her side. |
| **Bob (AM, collaborator) sees Alice's additions** | Alice adds a track in Parachord → her Spotify push fires + her LB push fires. Bob's next sync sees `hasUpdates: true` on the LB playlist, pulls, pushes to his AM. Track appears in his AM playlist. |
| **Bob's `isOwnedByUser` is true** | Bob is a collaborator, NOT the creator. fetchPlaylists returns `isOwnedByUser: true, isCollaborator: true` for him. |
| **Read-only follower (neither creator nor collaborator)** | imports cleanly with `isOwnedByUser: false`. Local edits are blocked from pushing to LB (no write permission). Pull-side works normally. |
| **Concurrent edit conflict** | Alice and Bob both add a track between syncs. Bob pushes first via merge-before-push → his addition appears on LB. Alice pushes second → her merge-before-push fetches latest LB, sees Bob's addition, unions it into her push payload. Both additions present in the result; ordering reverts to local-then-foreign-appended. |
| **Shared badge displays** | A playlist with `syncedFrom.isCollaborator: true` shows the "SHARED" pill in the row + detail header. Owner-only playlists do NOT show the pill. |
| **Push-loop `syncedFrom` guard refinement** | Bob's LB-imported playlist with no local edits → push-to-LB skipped (existing behavior preserved). Bob's LB-imported playlist with `locallyModified: true` AND `lastModified > syncSources.listenbrainz.syncedAt` → push-to-LB fires (new behavior). |

---

## Open questions for the user

1. **LB rate limits.** ListenBrainz documents a per-IP rate limit but doesn't publish exact numbers. If a user has 200 playlists to push, we'll hit hundreds of API calls in close succession. Should we add explicit pacing (e.g. 200ms between playlist-level operations) similar to the existing 250ms inter-IPC delay in the push loop? **Recommendation: yes, 200ms minimum between any two LB POSTs.** Cheap, defends against unannounced throttle changes.

2. **Public/private user toggle.** Plan hard-codes `public: false` on create. Should there be a one-time wizard option ("Should new ListenBrainz playlists be public?") that persists? **Recommendation: defer to v2.** Most users won't have a strong preference; the ones that do can flip it on listenbrainz.org.

3. **Existing LB playlists imported into Parachord then synced to Spotify.** When the LB playlist is the `syncedFrom`, the Achordion playlist-links push should still fire (the LB MBID exists). Confirm the wiring in Task 15 handles this case (the `pushPlaylistLinksToAchordion` helper checks both `syncedTo.listenbrainz?.externalId` and `syncedFrom.resolver === 'listenbrainz'` — should be fine but worth a manual test).

4. **Achordion-side telemetry on playlist views.** Should we instrument the /playlist/<mbid> page with the same announcement-event-style counters? Useful for understanding which shared playlists get traction. **Recommendation: not in this PR.** Separate feature with separate privacy considerations.

---

## Estimated effort

- Phase 1 (Achordion): ~3 hours (5 small tasks, mostly mirror existing patterns)
- Phase 2 (Provider): ~5 hours (6 endpoints + merge-before-push refinement in Task 10-bis)
- Phase 3 (Integration): ~6 hours (cross-provider audit + push-loop guard refinement + shared-playlist badge UI + Achordion push wiring + share link migration)
- Phase 4 (Docs): ~1 hour

**Total: ~15 hours of focused work, 2–3 days realistic.** Most of the risk is in Phase 3 Task 13 (push-loop `syncedFrom` guard refinement) — it's an existing-behavior change that affects every provider, not just LB. Run the verification matrix's "cross-service collaboration round-trip" test with two real LB accounts before merging.
