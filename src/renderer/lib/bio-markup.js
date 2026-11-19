// src/renderer/lib/bio-markup.js: a bio's formatting tags.
//
// A plug-in's bio is plain text, or, when it says `markup: 'bbcode'`, text
// with [b]bold[/b], [i]…[/i], [u]…[/u] and [url=https://…]text[/url] tags
// (Discogs's profile markup; the Discogs plug-in resolves Discogs's entity
// references to names before the bio gets here, #1539 step 6). The Biography
// tab renders the tags through parseBioMarkup instead of showing them.

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

// A bio as plain text, its tags dropped: for the short previews (the
// playbar's tooltip, Search's artist preview), which show no formatting.
// bio: { text, markup? }; '' when there is none.
function bioPlainText(bio) {
  if (!bio || typeof bio.text !== 'string') return '';
  return bio.markup === 'bbcode' ? parseBioMarkup(bio.text).map((seg) => seg.text).join('') : bio.text;
}

module.exports = { parseBioMarkup, bioPlainText };
