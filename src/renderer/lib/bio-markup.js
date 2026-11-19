// src/renderer/lib/discogs-markup.js — Discogs profile markup.
//
// Discogs artist profiles use their own markup: [b]bold[/b], [i]…[/i],
// [u]…[/u], [url=https://…]text[/url], and references to other entities
// either by name ([a=Artist], [l=Label], [r=Release], [m=Master]) or by id
// ([a17632854]). The bio cleanup only handled the by-name forms, so a band
// whose profile listed its members by id showed "[a17632854] – vocals" and
// literal [b] tags on the artist page (2026-10).
//
// normalizeDiscogsProfile resolves references to plain names (ids through a
// name map the caller fetched) and keeps the formatting tags;
// parseBioMarkup turns those tags into segments the artist page renders.

const REF_ID = /\[([alrm])(\d+)\]/g;
const MAX_REF_LOOKUPS = 8;

// Discogs disambiguates same-named artists with a " (2)" suffix.
const stripDisambiguation = (name) => String(name || '').replace(/\s+\(\d+\)$/, '').trim();

// Distinct id references in a profile, in order: [{ type: 'a'|'l'|'r'|'m', id }].
function discogsRefIds(profile) {
  const seen = new Set();
  const refs = [];
  for (const m of String(profile || '').matchAll(REF_ID)) {
    const key = m[1] + m[2];
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ type: m[1], id: m[2] });
  }
  return refs;
}

// The API path for a reference type, for the caller's lookups.
const REF_PATH = { a: 'artists', l: 'labels', r: 'releases', m: 'masters' };

// names: { 'a17632854': 'Iryna Panchuk', ... }. A reference with no name is
// dropped rather than shown as a bare id.
function normalizeDiscogsProfile(profile, names = {}) {
  return String(profile || '')
    .replace(/\r\n?/g, '\n')
    .replace(REF_ID, (_, type, id) => stripDisambiguation(names[type + id] || ''))
    .replace(/\[([alrm])=([^\]]+)\]/g, (_, _type, name) => stripDisambiguation(name))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n') // a dropped reference at a line start leaves a space
    .trim();
}

// Segments for rendering: [{ text, bold?, italic?, underline?, href? }].
// Unknown or unbalanced tags are dropped; only http(s) links are kept.
function parseBioMarkup(text) {
  const segments = [];
  const state = { bold: false, italic: false, underline: false, href: null };
  const push = (t) => {
    if (!t) return;
    const seg = { text: t };
    if (state.bold) seg.bold = true;
    if (state.italic) seg.italic = true;
    if (state.underline) seg.underline = true;
    if (state.href) seg.href = state.href;
    segments.push(seg);
  };
  const TAG = /\[(\/?)(b|i|u|url)(?:=([^\]]*))?\]/gi;
  let last = 0;
  for (const m of String(text || '').matchAll(TAG)) {
    push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'b') state.bold = !closing;
    else if (tag === 'i') state.italic = !closing;
    else if (tag === 'u') state.underline = !closing;
    else if (tag === 'url') state.href = !closing && /^https?:\/\//i.test(m[3] || '') ? m[3] : null;
  }
  push(String(text || '').slice(last));
  return segments;
}

module.exports = { discogsRefIds, normalizeDiscogsProfile, parseBioMarkup, stripDisambiguation, REF_PATH, MAX_REF_LOOKUPS };
