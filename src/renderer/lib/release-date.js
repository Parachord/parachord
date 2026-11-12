// src/renderer/lib/release-date.js — release dates for the Recommendations
// page's album cards, so an album that isn't out yet carries a "Coming <date>"
// badge (Fresh Drops' wording).
//
// No recommendation provider sends a release date: Amazon's home albums carry
// none (live-checked 2026-11-12: their nodes have id, title, images,
// playParams, parentalSettings, url, contributingArtists, likesContext), nor
// do Last.fm, ListenBrainz or Shuffleupagus. So the page looks each album up
// on MusicBrainz (a release-group search by title and artist, background lane)
// and keeps the date for RELEASE_DATE_TTL_MS.
//
// Pure (no window at module scope), unit-tested in
// tests/renderer/release-date.test.js.

const RELEASE_DATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LIGATURES = { 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ß': 'ss', 'đ': 'd', 'ł': 'l' };
const fold = (s) => String(s || '').toLowerCase()
  .replace(/[æœøßđł]/g, (c) => LIGATURES[c])
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, '');

// A title without the decorations stores add: trailing "(Expanded Edition)",
// "[Explicit]", " - EP", " - Single", ": Expanded Edition" / ": Deluxe" /
// ": Remastered". What the search asks for, and what a match compares.
const EDITION_WORDS = /\b(edition|deluxe|remaster(ed)?|expanded|anniversary|version|reissue|bonus)\b/i;
const searchTitle = (s) => {
  let t = String(s || '').trim();
  for (let i = 0; i < 4; i++) {
    let next = t
      .replace(/\s*[([][^()[\]]*[)\]]\s*$/, '')
      .replace(/\s+-\s+(EP|Single)\s*$/i, '')
      .trim();
    const colon = next.match(/^(.+?):\s+([^:]+)$/);
    if (colon && EDITION_WORDS.test(colon[2])) next = colon[1].trim();
    if (next === t || !next) break;
    t = next;
  }
  return t;
};
const bareTitle = (s) => norm(searchTitle(s));

function releaseDateKey(artist, title) {
  return `${norm(artist)}|${norm(title)}`;
}

const luceneQuote = (s) => `"${String(s || '').replace(/["\\]/g, (c) => `\\${c}`)}"`;

function releaseGroupSearchUrl(artist, title) {
  const query = `releasegroup:${luceneQuote(searchTitle(title))} AND artist:${luceneQuote(artist)}`;
  return `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
}

const creditNames = (group) => (Array.isArray(group && group['artist-credit']) ? group['artist-credit'] : [])
  .map((c) => (c && (c.name || (c.artist && c.artist.name))) || '')
  .filter(Boolean);

const artistMatches = (group, artist) => {
  const want = norm(artist);
  if (!want) return false;
  const names = creditNames(group).map(norm).filter(Boolean);
  const joined = names.join('');
  return names.some((n) => n === want) || (!!joined && (joined === want || joined.includes(want) || want.includes(joined)));
};

const TYPE_RANK = { album: 0, ep: 1 };

// The matching release group's first release date ('YYYY', 'YYYY-MM' or
// 'YYYY-MM-DD'), or null: the title must match without store decorations and
// the artist must be in the credit; an album or EP beats another type of the
// same name, then MusicBrainz's own order (best score first).
function pickReleaseGroupDate(groups, { artist, title } = {}) {
  const wantTitle = bareTitle(title);
  if (!wantTitle || !Array.isArray(groups)) return null;
  const matches = groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g && bareTitle(g.title) === wantTitle && artistMatches(g, artist))
    .sort((a, b) => {
      const ra = TYPE_RANK[String(a.g['primary-type'] || '').toLowerCase()] ?? 2;
      const rb = TYPE_RANK[String(b.g['primary-type'] || '').toLowerCase()] ?? 2;
      return (ra - rb) || (a.i - b.i);
    });
  if (!matches.length) return null;
  const date = matches[0].g['first-release-date'];
  return typeof date === 'string' && date.trim() ? date.trim() : null;
}

const pad = (n) => String(n).padStart(2, '0');

// "Coming Nov 21" (this year), "Coming Feb 3, 2027", "Coming Dec 2026" (month
// only) or "Coming 2027" (year only) for a date after today; null otherwise.
function upcomingLabel(date, today = new Date()) {
  if (typeof date !== 'string') return null;
  const m = date.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : null;
  const day = m[3] ? Number(m[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  if (day !== null) {
    const d = new Date(year, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    if (`${year}-${pad(month)}-${pad(day)}` <= `${ty}-${pad(tm)}-${pad(td)}`) return null;
    const opts = year === ty ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
    return `Coming ${d.toLocaleDateString('en-US', opts)}`;
  }
  if (month !== null) {
    if (`${year}-${pad(month)}` <= `${ty}-${pad(tm)}`) return null;
    return `Coming ${new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  }
  return year > ty ? `Coming ${year}` : null;
}

module.exports = {
  RELEASE_DATE_TTL_MS,
  releaseDateKey,
  releaseGroupSearchUrl,
  pickReleaseGroupDate,
  upcomingLabel
};
