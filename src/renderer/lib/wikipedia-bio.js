// src/renderer/lib/wikipedia-bio.js — turning a Wikipedia article into an
// artist bio.
//
// Desktop used to ask Wikipedia for the lead section only (exintro), and
// Android for the whole article. Wild Pink's lead is one sentence, so desktop
// showed 19 words; Android showed 294, including the band-member and EP
// lists, empty "Studio albums" headings, "References" and "External links",
// with the headings as raw "== History ==" markup (2026-10-25). Both now take
// the whole plain-text article and keep the lead plus the prose sections:
//
// - a lead of LEAD_ENOUGH_WORDS or more is the whole bio (a big artist's lead
//   is already a full summary; their article runs to 15,000 words);
// - otherwise prose paragraphs from the sections that follow are added, in
//   article order, until the bio reaches TARGET_WORDS (whole paragraphs only);
// - sections that are not a bio (DROP_SECTION_RE: references, discography,
//   members, ...) are skipped with all their subsections;
// - inside a kept section only prose survives: a paragraph of at least
//   MIN_PROSE_WORDS that ends like a sentence. List items ("John Ross
//   (vocals, guitar)", "Good Life (2015, Texas Is Funny)") don't;
// - headings are dropped, and paragraphs are separated by a blank line.
//
// parachord-mobile mirrors this; keep the two in step.

const LEAD_ENOUGH_WORDS = 150;
const TARGET_WORDS = 400;
const MIN_PROSE_WORDS = 4;

const DROP_SECTION_RE = new RegExp(
  '^(?:' + [
    'references', 'external links', 'see also', 'notes', 'notes and references', 'further reading',
    'bibliography', 'sources', 'citations', 'footnotes', 'works cited',
    'discography', 'selected discography', 'filmography', 'videography',
    '(?:band )?members', 'personnel', 'line-?up',
    '(?:concert )?tours', 'tours and concerts',
    'accolades', 'awards(?: and (?:nominations|honou?rs|accolades))?', 'honou?rs',
    'timeline(?: of .*)?', 'lists? of .*',
  ].join('|') + ')$',
  'i'
);

const HEADING_RE = /^(={2,6})\s*(.+?)\s*\1\s*$/;
const SENTENCE_END_RE = /[.!?…]["'”’)\]]*$/;

const wordCount = (text) => (text.match(/\S+/g) || []).length;

const isProse = (paragraph) =>
  SENTENCE_END_RE.test(paragraph) && wordCount(paragraph) >= MIN_PROSE_WORDS;

// The plain-text extract (prop=extracts&explaintext=1, default section
// format) into its lead and its sections, each a list of non-empty lines.
function splitExtract(extract) {
  const lead = [];
  const sections = [];
  let current = null;
  for (const raw of String(extract || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(HEADING_RE);
    if (heading) {
      current = { level: heading[1].length, title: heading[2], paragraphs: [] };
      sections.push(current);
    } else if (current) {
      current.paragraphs.push(line);
    } else {
      lead.push(line);
    }
  }
  return { lead, sections };
}

// Returns the bio text, or null when the article has nothing to show.
function bioFromWikipediaExtract(extract, {
  leadEnoughWords = LEAD_ENOUGH_WORDS,
  targetWords = TARGET_WORDS,
} = {}) {
  const { lead, sections } = splitExtract(extract);
  const paragraphs = [...lead];
  let words = wordCount(lead.join(' '));

  if (words < leadEnoughWords) {
    let droppingBelowLevel = 0; // inside a dropped section: skip until a heading at this level or above
    for (const section of sections) {
      if (words >= targetWords) break;
      if (droppingBelowLevel && section.level > droppingBelowLevel) continue;
      droppingBelowLevel = DROP_SECTION_RE.test(section.title) ? section.level : 0;
      if (droppingBelowLevel) continue;
      for (const paragraph of section.paragraphs) {
        if (words >= targetWords) break;
        if (!isProse(paragraph)) continue;
        paragraphs.push(paragraph);
        words += wordCount(paragraph);
      }
    }
  }

  return paragraphs.length ? paragraphs.join('\n\n') : null;
}

module.exports = {
  bioFromWikipediaExtract,
  splitExtract,
  isProse,
  DROP_SECTION_RE,
  LEAD_ENOUGH_WORDS,
  TARGET_WORDS,
  MIN_PROSE_WORDS,
};
