// src/renderer/lib/album-catalog.js — album track lists from the plugins when MusicBrainz can't supply them.
//
// Every album page got its track list from MusicBrainz, so during a
// MusicBrainz outage (2026-10) nearly every album in Fresh Drops, Charts,
// Search and the Collection failed to open, and albums that came from a
// service (a Spotify or Apple Music search result, an artist-page card built
// from Spotify / Apple / Last.fm / Discogs) never opened at all: their ids
// were sent to MusicBrainz. Plugins that declare capabilities.albumSearch
// (searchAlbums + lookupAlbum; docs/architecture/plugins.md) can find the
// album by name and load its tracks instead. This module is the pure part:
// which resolvers to ask in what order, whether a result is the album that
// was asked for, and the conversion to the release-page shape.
//
// MusicBrainz stays first for albums that have a MusicBrainz id: the track
// titles it gives are the ones track ids (trackSlug) and the resolution cache
// are keyed on, and its recording ids feed scrobbles and Achordion.

// A MusicBrainz id is a UUID. Anything else on a release (spotify-…,
// applemusic-…, lastfm-…, discogs-…) is a service's id that MusicBrainz will
// never know.
// A compilation's tracks keep their own artists (2026-11-23).
const { ownCatalogTrackArtist } = require('./album-track-artist');

const MB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isMusicBrainzId = (id) => typeof id === 'string' && MB_ID.test(id);

// "spotify-4aawyAB9vmqN3uQ7FjRGTy" -> "spotify", when that is a known resolver.
function resolverIdFromReleaseId(id, knownIds = []) {
  if (typeof id !== 'string') return null;
  const prefix = id.split('-')[0];
  return knownIds.includes(prefix) ? prefix : null;
}

const stripMarks = (s) => {
  let out = String(s || '');
  try { out = out.normalize('NFKD').replace(/\p{M}/gu, ''); } catch (_e) { /* old engines */ }
  return out.toLowerCase();
};

// Edition and format suffixes services add to an album title, which
// MusicBrainz's title and the user's request usually lack.
const EDITION = /\s*[([]\s*(?:[^)\]]*\b(?:deluxe|expanded|remaster(?:ed)?|anniversary|edition|version|explicit|clean|bonus|reissue|mono|stereo)\b[^)\]]*)[)\]]\s*/gi;
const FORMAT_SUFFIX = /\s+-\s+(?:single|ep|lp)\s*$/i;

function normalizeAlbumTitle(title) {
  const s = stripMarks(title).replace(EDITION, ' ').replace(FORMAT_SUFFIX, '');
  // A title with no letters or digits at all ("÷", "+", "×") folds to nothing,
  // which made it unable to match itself: the album page said it couldn't find
  // Ed Sheeran's "÷ (Deluxe)" while main opened it. Such a title is compared
  // as written (the same rule creditMatches gives a symbol-only artist name).
  return s.replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '') || s.trim().replace(/\s+/g, ' ');
}

function normalizeArtistName(name) {
  return stripMarks(name).replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

// The credited artists of a joined credit ("A, B & C", "A feat. B").
const splitArtists = (name) => String(name || '')
  .split(/\s*(?:,|&|\band\b|\bfeat\.?|\bft\.?|\bfeaturing|\bwith|\bx\b|\/)\s*/i)
  .map(normalizeArtistName)
  .filter(Boolean);

// Containment counts only when the shorter side is most of the longer one, so
// "Red" never matches "Red Hot Chili Peppers".
const closeEnough = (a, b, ratio) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length >= long.length * ratio;
};

// A name as written, for the boundary checks below: case and accents folded,
// punctuation and spacing kept (normalizeArtistName drops them).
const looseName = (s) => stripMarks(s).trim().replace(/\s+/g, ' ');

// What can sit between two names in an artist credit. A hyphen cannot: it is
// part of a name ("Blink-182" is not "Blink" with a guest).
const isCreditSeparator = (ch) => !!ch && /[\s,;&/+:|]/u.test(ch);
// What can separate a title from its subtitle ("Rumours: Live from the Forum
// 1977", "(Live)"). A hyphen cannot either: "Go-Go" is not "Go".
const isTitleSeparator = (ch) => !!ch && /[\s:;,.!?([{''"«“”—–]/u.test(ch);

// One credit is the other plus a guest, with the whole shorter name at a name
// boundary and most of the longer one: "Tyler, The Creator" in "Tyler, The
// Creator & Kali Uchis", "AC/DC" in "AC/DC & X". A single act whose own name
// carries a separator is not a joint credit to split, so this catches it. Not
// any containment: "Red" is not most of "Red Hot Chili Peppers", and a
// hyphen is part of a name, not a guest (this rule alone does not match
// "Blink" with "Blink-182"; closeEnough's older containment still may).
function creditContains(one, other) {
  const a = looseName(one);
  const b = looseName(other);
  if (!a || !b || a === b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const s = Array.from(short);
  const l = Array.from(long);
  if (s.length >= l.length || s.length < l.length * 0.5) return false;
  const startsIt = s.every((ch, i) => l[i] === ch);
  if (startsIt && isCreditSeparator(l[s.length])) return true;
  const endsIt = s.every((ch, i) => l[l.length - s.length + i] === ch);
  return endsIt && isCreditSeparator(l[l.length - s.length - 1]);
}

// Whether two artist credits name the same act. Every source writes a joint
// credit its own way — MusicBrainz "A & B", Amazon and Discogs "A, B", some
// "A feat. B" — so comparing the whole strings alone never matched a release
// credited to more than one artist. Opening Ozzy Osbourne's and Black
// Sabbath's "Back to the Beginning" (Amazon: "Ozzy Osbourne, Black Sabbath",
// MusicBrainz: "Ozzy Osbourne & Black Sabbath") matched no search result, and
// the opener fell through to the first studio album MusicBrainz listed, an
// unrelated tribute record.
//
// When one side is a single name, one artist of the other side's joint credit
// is enough (the long-standing rule: an edition a service credits to both
// artists is still the album's). A credit that is the other plus a guest
// (creditContains) matches too. When BOTH sides are joint credits, the same
// names in any order are required — "A, B" is "A & B", but "A & B" is not
// "A & C", which only share a member: sharing one would make any album of a
// collaboration an edition of an album of another.
function creditMatches(want, got) {
  const asWritten = looseName(want);
  const otherWritten = looseName(got);
  if (!asWritten || !otherWritten) return false;
  // A name with no letters or digits at all ("!!!", "†††") folds to nothing:
  // compared as written, or not at all.
  if (asWritten === otherWritten) return true;
  const w = normalizeArtistName(want);
  const g = normalizeArtistName(got);
  if (!w || !g) return false;
  if (closeEnough(w, g, 0.6)) return true;
  if (creditContains(want, got)) return true;
  const wantNames = splitArtists(want);
  const gotNames = splitArtists(got);
  if (wantNames.length <= 1 || gotNames.length <= 1) {
    return wantNames.includes(g) || gotNames.includes(w);
  }
  const wantSet = new Set(wantNames);
  const gotSet = new Set(gotNames);
  return wantSet.size === gotSet.size && [...wantSet].every((name) => gotSet.has(name));
}

// Whether a catalog album is the one that was asked for: the title matches
// (edition suffixes aside) and so does the artist (creditMatches: one artist
// of a joint credit when the other side is a single name, the same names when
// both sides are joint). Returns 0 for no match, else a score where higher is
// closer.
function albumMatchScore(target, album) {
  if (!target || !album) return 0;
  const wantTitle = normalizeAlbumTitle(target.title);
  const gotTitle = normalizeAlbumTitle(album.name);
  if (!closeEnough(wantTitle, gotTitle, 0.6)) return 0;
  const wantArtist = normalizeArtistName(target.artist);
  const gotArtist = normalizeArtistName(album.artist);
  if (!creditMatches(target.artist, album.artist)) return 0;
  // The same title before edition suffixes were stripped beats an edition:
  // "Dulling the Horns" over "Dulling the Horns (Deluxe)".
  const bare = (s) => stripMarks(s).replace(/[^\p{L}\p{N}]+/gu, '');
  const exactTitle = bare(target.title) === bare(album.name) ? 1 : 0;
  return (wantTitle === gotTitle ? 2 : 1) + exactTitle + (wantArtist === gotArtist ? 2 : 1);
}

// Whether two releases are the same album by artist and title, edition
// suffixes aside. Ids are no help here: an album page starts on a
// release-group id and fetchReleaseData moves it to a release id, while the
// slow-MusicBrainz fallback may have filled it in between. Each side's artist
// is a string or a release's { name } object.
function sameAlbumIdentity(a, b) {
  if (!a || !b) return false;
  const artistOf = (x) => (typeof x.artist === 'string' ? x.artist : x.artist?.name) || '';
  const titleA = normalizeAlbumTitle(a.title);
  const artistA = normalizeArtistName(artistOf(a));
  return !!titleA && !!artistA
    && titleA === normalizeAlbumTitle(b.title)
    && artistA === normalizeArtistName(artistOf(b));
}

// The best match among one resolver's results, or null.
function pickCatalogAlbum(albums, target) {
  let best = null;
  let bestScore = 0;
  for (const album of albums || []) {
    const score = albumMatchScore(target, album);
    if (score > bestScore) {
      best = album;
      bestScore = score;
    }
  }
  return best;
}

// The artists a MusicBrainz result (a release group, a release) credits, as
// one string the way the credit reads: "A & B", join phrases included, so a
// single-artist credit has no trailing separator.
function releaseGroupCredit(group) {
  const credit = Array.isArray(group && group['artist-credit']) ? group['artist-credit'] : [];
  return credit
    .map((c, i) => {
      const name = (c && (c.name || (c.artist && c.artist.name))) || '';
      // MusicBrainz carries the join phrase; a credit built from a browse or a
      // test fixture may not, so names are never glued together.
      const join = (c && c.joinphrase) || (i < credit.length - 1 ? ', ' : '');
      return name ? `${name}${join}` : '';
    })
    .join('')
    .trim();
}

const NON_STUDIO_SECONDARY_TYPES = ['live', 'compilation', 'remix', 'dj-mix', 'mixtape/street', 'demo', 'soundtrack'];
const primaryTypeOf = (group) => String((group && group['primary-type']) || '').toLowerCase();
const isAlbumGroup = (group) => primaryTypeOf(group) === 'album';

// A studio album: an Album with no live, compilation, soundtrack or other
// secondary type. The opener looked for one when no result matched the album
// asked for, which is how an unrelated record got opened.
function isStudioReleaseGroup(group) {
  const secondary = ((group && group['secondary-types']) || []).map((t) => String(t).toLowerCase());
  return isAlbumGroup(group) && !secondary.some((t) => NON_STUDIO_SECONDARY_TYPES.includes(t));
}

// A title the other side spells out: "Back to the Beginning" for
// "Back to the Beginning: The Final Show, Live from Villa Park". Compared on
// the titles as written (punctuation and spaces kept, case and accents folded)
// and only at a subtitle's separator, so "Go" is not "Goodbye" or "Go-Go" and
// "Home" is not "Homecoming".
const spokenOut = (one, other) => {
  const a = looseName(one);
  const b = looseName(other);
  if (!a || !b || a === b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const s = Array.from(short);
  const l = Array.from(long);
  if (s.length >= l.length || !s.every((ch, i) => l[i] === ch)) return false;
  return isTitleSeparator(l[s.length]);
};

// Which release-group search result is the album that was asked for.
//
// A search is by name: MusicBrainz ranks by relevance, and mixes in other
// albums of those artists and same-titled albums by anyone. Picking
// "an Album by the right artist, else any Album, else the first result" ignored
// the album's own title, and with a joint credit written differently by the
// source (see creditMatches) the artist never matched either: the album page
// opened the first studio album in the list, whatever it was. The title and
// artist decide first (albumMatchScore: creditMatches for the artist, store
// edition suffixes aside), and only among results for that album does a
// studio album win over a live or compilation edition of it.
//
// A result is only ever the album if its credit matches the artist asked for:
// when nothing does, this answers null and the caller tries the services'
// catalogs. It never hands back "whatever MusicBrainz ranked first" — a search
// for an album MusicBrainz doesn't have (a brand-new release) answers
// same-words albums by other artists, and opening one of those is worse than
// saying the album wasn't found. Among the artist's own results, the closest
// title wins (MusicBrainz often spells an album's title out — "Back to the
// Beginning: The Final Show, Live from Villa Park" for the album a source
// calls "Back to the Beginning" — at a subtitle separator only, so "Go" is
// not "Goodbye").
//
// `title` defaults to empty, and then only the artist decides (a caller that
// knows nothing but the artist — the album-card actions pass the title too).
function pickReleaseGroupForAlbum(results, { artist = '', title = '' } = {}) {
  const list = (Array.isArray(results) ? results : []).filter((r) => r && r.id);
  if (list.length === 0) return null;
  const wantTitle = normalizeAlbumTitle(title);
  // How close a result's title is, beyond albumMatchScore's gate: the whole
  // title, most of it, or the asked-for title as a prefix of MusicBrainz's
  // longer spelling. The prefix must end at a word boundary, so a short title
  // missing from the results ("Go", "Home") does not hand the artist's
  // "Goodbye" or "Homecoming" the win, while "Rumours" still finds
  // "Rumours: Live from the Forum 1977" whatever its length.
  const titleCloseness = (r) => {
    const got = normalizeAlbumTitle(r.title);
    if (!wantTitle || !got) return 0;
    if (wantTitle === got) return 3;
    if (closeEnough(wantTitle, got, 0.6)) return 2;
    return spokenOut(title, r.title) ? 1 : 0;
  };
  const scored = list.map((r, index) => ({
    r, index,
    score: albumMatchScore({ artist, title }, { name: r.title, artist: releaseGroupCredit(r) }),
    closeness: titleCloseness(r)
  }));
  // Equal scores are the same album (title and artist): a studio edition wins
  // over a live one, an Album over a single, then MusicBrainz's own order.
  const best = (entries) => entries.slice().sort((a, b) =>
    (b.score - a.score)
    || (b.closeness - a.closeness)
    || (Number(isStudioReleaseGroup(b.r)) - Number(isStudioReleaseGroup(a.r)))
    || (Number(isAlbumGroup(b.r)) - Number(isAlbumGroup(a.r)))
    || (a.index - b.index))[0].r;
  // The artist's own results only — or every result when the caller has no
  // artist to check against (then the title alone decides). The gate is the
  // artist as written, not its folded form: a symbol-only name ("!!!", "†††")
  // folds to nothing but is still a name, and must not open anyone's album.
  //
  // "A title was given" is the string, not its folded form: "÷" folds to
  // nothing but is a title, and the artist alone must not decide.
  const asWritten = (s) => stripMarks(s).replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  const hasTitle = !!String(title || '').trim();
  const hasArtist = String(artist || '').trim().length > 0;
  const byArtist = hasArtist
    ? scored.filter((entry) => creditMatches(artist, releaseGroupCredit(entry.r)))
    : scored;
  if (byArtist.length > 0) {
    const matched = byArtist.filter((entry) => entry.score > 0);
    if (matched.length > 0) return best(matched);
    // With a title, another album by the same artist is not it unless its
    // title is at least close ("…: the subtitle"): a search for an album
    // MusicBrainz doesn't have must not open the artist's previous record. No
    // title at all (the album-card actions' search): the artist alone decides.
    if (!hasTitle) return best(byArtist);
    const close = byArtist.filter((entry) => entry.closeness > 0);
    return close.length > 0 ? best(close) : null;
  }
  // A credit that does not match at all (a romanised name against its native
  // script, a name the artist now records under: "Hikaru Utada" / 宇多田ヒカル,
  // "Kanye West" / "Ye") is still the album when exactly one result carries
  // the album's exact title — compared as written, not edition-stripped, so
  // "Hits (Deluxe)" by another act is not "Hits". A search that found no such
  // result (MusicBrainz doesn't have the album: "Another Day Once Called
  // Tomorrow" returned "Tomorrow's Another Day" by other artists) answers
  // null — never another artist's album.
  if (!hasTitle) return null;
  const exactTitle = scored.filter((entry) => asWritten(entry.r.title) === asWritten(title));
  return exactTitle.length === 1 ? exactTitle[0].r : null;
}

// A title without any trailing parenthesised or bracketed part, repeatedly:
// "Back to the Beginning (Live)" and "Back to the Beginning" name the same
// album for the edition list, as "Dulling the Horns (Deluxe)" already did.
// Only a suffix is dropped, so "Queen II" is still not "Queen I", and a
// volume marker is never one: "Greatest Hits (Disc 2)" is not an edition of
// "Greatest Hits" — picking it would swap in half an album.
const VOLUME_MARKER = /^(?:disc|cd|part|pt|vol|volume|side)s?(?:$|[^a-z])/i;
// A bare numeral in brackets is a volume or a sequel too: "McCartney (II)",
// "Greatest Hits (2)" are not editions of "McCartney" / "Greatest Hits".
const BARE_SEQUEL = /^(?:[ivxlcdm]+|\d+)$/i;
function bareEditionTitle(title) {
  let out = String(title || '').trim();
  for (let i = 0; i < 3; i++) {
    const suffix = out.match(/\s*[([][^()[\]]*[)\]]\s*$/);
    if (!suffix || !suffix[0].length) break;
    const inner = suffix[0].replace(/^\s*[([]\s*/, '').replace(/\s*[)\]]\s*$/, '');
    if (VOLUME_MARKER.test(inner) || BARE_SEQUEL.test(inner.trim())) break;
    const next = out.slice(0, suffix.index).trim();
    if (!next) break;
    out = next;
  }
  return normalizeAlbumTitle(out);
}

// A catalog album that is the same album the page shows, edition aside —
// the album page's source dropdown lists these (#1238): "Queen I (2011
// Remaster)" is a version of "Queen I", "Queen II" is not. The title must be
// EQUAL once trailing parenthetical parts are dropped (albumMatchScore's
// containment pass is deliberately looser: "Queen I" contains into "Queen
// II", which is fine for picking a fallback but wrong for a version list), and
// the artist must pass any of the match rules — checked via
// albumMatchScore > 0, whose title axis is already satisfied, so only the
// artist rules can fail it.
function isCatalogAlbumEdition(target, album) {
  if (!target || !album || !target.title || !album.name) return false;
  if (bareEditionTitle(target.title) !== bareEditionTitle(album.name)) return false;
  return albumMatchScore(target, album) > 0;
}

// The release group whose editions the album page's source dropdown lists
// for a release (#1238): the group the release carries once it loaded, or the
// group id a still-loading page was opened by (an artist-page card or a
// parachord://album match carries isReleaseGroup). A plain release id must NOT
// be treated as a group id — it is the same UUID shape, and browsing
// release?release-group=<release id> answers an empty list — so a release-id
// open has no group until the release itself answers with one.
function albumVersionsGroup(release) {
  if (!release) return null;
  return release.releaseGroupMbid
    || (release.isReleaseGroup && isMusicBrainzId(release.id) ? release.id : null)
    || null;
}

// The session key of the source dropdown's data: the album's identity (artist
// + title, sameAlbumIdentity's basis) plus the group from albumVersionsGroup.
// A page that learns its group id mid-load (a release-id open, a catalog race
// filling the page before MusicBrainz answers) changes key, so a list loaded
// without a group never stands in for one that should list the group's
// editions. Null when the release has no artist or title to key on.
function albumVersionsKey(release) {
  if (!release || !release.title) return null;
  const artist = typeof release.artist === 'object' ? release.artist?.name : release.artist;
  if (!artist) return null;
  return `${normalizeArtistName(artist)}\u0000${normalizeAlbumTitle(release.title)}\u0000${albumVersionsGroup(release) || ''}`;
}

// The keys an album's picked edition (#1238) is remembered under, for the
// session: by the album's release group when one is known, and by the album's
// identity (artist + title) so a page opened without its group (a release id,
// the playbar) still finds the pick. Both keys are written on a pick; a
// consult tries the identity key first, then the group key (an opener's id
// may be either).
function albumEditionPickKeys({ groupId = null, artist = null, title = null } = {}) {
  const keys = [];
  if (artist && title) {
    keys.push(`album:${normalizeArtistName(artist)}\u0000${normalizeAlbumTitle(title)}`);
  }
  if (groupId) keys.push(`group:${groupId}`);
  return keys;
}

// Which resolvers to ask, in order: one named first (the service a release
// id came from), then the user's active services in their priority order,
// then every other installed resolver that supports album search. A plugin
// without the credentials it needs returns no albums, so asking it is cheap.
function orderCatalogResolvers(resolvers, { activeIds = [], order = [], preferId = null } = {}) {
  const rank = (r) => {
    if (preferId && r.id === preferId) return -1;
    const pos = order.indexOf(r.id);
    const slot = pos === -1 ? order.length : pos;
    return activeIds.includes(r.id) ? slot : 1000 + slot;
  };
  return [...(resolvers || [])].sort((a, b) => rank(a) - rank(b));
}

// A plugin album ({ name, artist, releaseDate, tracks: [{ title, duration
// (seconds), trackNumber, discNumber, ... }] }) in the release-page shape
// fetchReleaseData builds from MusicBrainz ({ title, artist: { name },
// tracks: [{ position, title, length (ms), mediumIndex }] }).
//
// requested: what the page asked for ({ id, title, artistName, albumArt,
// date, releaseType }). Its title and artist win over the catalog's, so the
// tracks get the same ids (trackSlug of artist, title, album) as when
// MusicBrainz answers, and the page header doesn't change under the user.
// Service-specific fields (ids, sources, stream urls) are dropped: the usual
// resolution pass finds each track on the user's own services.
function catalogAlbumToRelease(album, { resolverId, resolverName, requested = {} } = {}) {
  const sorted = [...(album.tracks || [])].sort((a, b) => {
    const da = a.discNumber || 1;
    const db = b.discNumber || 1;
    return da !== db ? da - db : (a.trackNumber || 0) - (b.trackNumber || 0);
  });
  const perDisc = {};
  const albumArtist = requested.artistName || album.artist || null;
  const tracks = sorted.filter(t => t && t.title).map((t) => {
    const disc = t.discNumber || 1;
    perDisc[disc] = (perDisc[disc] || 0) + 1;
    return {
      position: t.trackNumber || perDisc[disc],
      title: t.title,
      length: Number.isFinite(t.duration) && t.duration > 0 ? Math.round(t.duration * 1000) : null,
      mediumIndex: disc,
      mediumTitle: null,
      recording: null,
      mbid: null,
      artistMbids: [],
      trackArtist: ownCatalogTrackArtist(t.artist, albumArtist),
    };
  });
  const releaseDate = typeof album.releaseDate === 'string' ? album.releaseDate.slice(0, 10) : null;
  return {
    id: requested.id || album.id,
    title: requested.title || album.name,
    artist: { id: null, name: requested.artistName || album.artist || 'Unknown Artist' },
    date: requested.date || releaseDate,
    releaseType: requested.releaseType || 'album',
    albumArt: requested.albumArt || album.albumArt || null,
    tracks,
    _catalogSource: { resolverId, name: resolverName || resolverId, url: album.url || null },
  };
}

// A catalog album as a search-result row (the MusicBrainz release-group
// shape the search page renders), carrying where it came from so a click
// loads it from that resolver without searching again.
function catalogAlbumToSearchResult(album, resolverId) {
  return {
    id: album.id,
    title: album.name,
    'primary-type': 'Album',
    'artist-credit': [{ name: album.artist || 'Unknown' }],
    albumArt: album.albumArt || null,
    'first-release-date': album.releaseDate || '',
    _source: resolverId,
    _catalog: { resolverId, url: album.url },
  };
}

module.exports = {
  isMusicBrainzId,
  resolverIdFromReleaseId,
  normalizeAlbumTitle,
  normalizeArtistName,
  albumMatchScore,
  creditMatches,
  releaseGroupCredit,
  pickReleaseGroupForAlbum,
  sameAlbumIdentity,
  pickCatalogAlbum,
  isCatalogAlbumEdition,
  albumVersionsGroup,
  albumVersionsKey,
  albumEditionPickKeys,
  orderCatalogResolvers,
  catalogAlbumToRelease,
  catalogAlbumToSearchResult,
};
