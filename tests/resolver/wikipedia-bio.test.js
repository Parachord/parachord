/**
 * A Wikipedia article into an artist bio: the lead plus the prose sections,
 * without lists, reference sections or heading markup. Desktop took only the
 * lead (19 words for Wild Pink), Android the whole article, lists and
 * "== History ==" markup included.
 */

const {
  bioFromWikipediaExtract,
  splitExtract,
  isProse,
  DROP_SECTION_RE,
} = require('../../src/renderer/lib/wikipedia-bio');

const words = (n, end = '.') => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + end;
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

// Same shape as Wild Pink's plain-text extract (2026-10-25): a one-sentence
// lead, a History section, then member and discography lists and the link
// sections, some of them empty.
const SHORT_LEAD_ARTICLE = [
  'The Band is an American indie rock band from New York City.',
  '',
  '',
  '== History ==',
  'The Band began in 2015, releasing an EP titled 2 Songs. They signed to a label in 2016.',
  'In 2020, the band contributed to a benefit compilation.',
  '',
  '',
  '== Band members ==',
  '',
  '',
  '=== Current ===',
  'Jane Doe (vocals, guitar)',
  'John Roe (bass)',
  '',
  '',
  '=== Former ===',
  'A. N. Other',
  '',
  '',
  '== Discography ==',
  '',
  '',
  '=== Studio albums ===',
  '',
  '',
  '=== EPs ===',
  '2 Songs (2015, self-released)',
  'Good Life (2015, Texas Is Funny)',
  '',
  '',
  '== References ==',
  '',
  '',
  '=== External links ===',
  'The Band on Bandcamp',
  'The Band on Facebook',
].join('\n');

describe('bioFromWikipediaExtract', () => {
  test('a short lead gets the History prose and nothing after it', () => {
    expect(bioFromWikipediaExtract(SHORT_LEAD_ARTICLE)).toBe([
      'The Band is an American indie rock band from New York City.',
      'The Band began in 2015, releasing an EP titled 2 Songs. They signed to a label in 2016.',
      'In 2020, the band contributed to a benefit compilation.',
    ].join('\n\n'));
  });

  test('no heading markup, list items or link stubs survive', () => {
    const bio = bioFromWikipediaExtract(SHORT_LEAD_ARTICLE);
    expect(bio).not.toMatch(/==/);
    for (const junk of ['Band members', 'Jane Doe', 'Good Life (2015', 'Bandcamp', 'References', 'Studio albums']) {
      expect(bio).not.toContain(junk);
    }
  });

  test('a long lead is the whole bio (a big artist\'s lead is already a summary)', () => {
    const lead = [words(80), words(80)];
    const article = [...lead, '', '== History ==', words(200)].join('\n');
    expect(bioFromWikipediaExtract(article)).toBe(lead.join('\n\n'));
  });

  test('sections are added in order until the target, in whole paragraphs', () => {
    const article = [
      words(20),
      '== Early life ==', words(150),
      '== Career ==', words(150), words(150), words(150),
      '== Legacy ==', words(150),
    ].join('\n');
    const bio = bioFromWikipediaExtract(article);
    const paras = bio.split('\n\n');
    // 20 + 150 + 150 = 320 < 400, so one more paragraph; 470 >= 400 stops.
    expect(paras.map(wordCount)).toEqual([20, 150, 150, 150]);
    expect(wordCount(bio)).toBe(470);
  });

  test('a dropped section takes its subsections with it; a sibling after it is read again', () => {
    const article = [
      words(10),
      '== Discography ==',
      '=== Studio albums ===', 'Album One is the first album by the band and it is fine.',
      '== Musical style ==', 'Their sound mixes folk with rock and a lot of reverb.',
      '=== Influences ===', 'They cite many bands from the nineties as influences.',
    ].join('\n');
    expect(bioFromWikipediaExtract(article)).toBe([
      words(10),
      'Their sound mixes folk with rock and a lot of reverb.',
      'They cite many bands from the nineties as influences.',
    ].join('\n\n'));
  });

  test('null for an empty article; the lead alone when nothing else is prose', () => {
    expect(bioFromWikipediaExtract('')).toBeNull();
    expect(bioFromWikipediaExtract(null)).toBeNull();
    expect(bioFromWikipediaExtract('Short lead.\n== References ==\nSome Ref')).toBe('Short lead.');
  });

  test('limits are adjustable', () => {
    const article = [words(10), '== History ==', words(50), words(50)].join('\n');
    expect(wordCount(bioFromWikipediaExtract(article, { targetWords: 30 }))).toBe(60);
    expect(wordCount(bioFromWikipediaExtract(article, { leadEnoughWords: 5 }))).toBe(10);
  });
});

describe('helpers', () => {
  test('splitExtract separates the lead from the sections and their levels', () => {
    const { lead, sections } = splitExtract(SHORT_LEAD_ARTICLE);
    expect(lead).toEqual(['The Band is an American indie rock band from New York City.']);
    expect(sections.map(s => `${s.level}:${s.title}`)).toEqual([
      '2:History', '2:Band members', '3:Current', '3:Former', '2:Discography',
      '3:Studio albums', '3:EPs', '2:References', '3:External links',
    ]);
  });

  test('isProse wants a sentence ending and a few words', () => {
    expect(isProse('The band broke up in 2019.')).toBe(true);
    expect(isProse('The compilation was titled "Bernie Speaks With the Community."')).toBe(true);
    expect(isProse('Jane Doe (vocals, guitar)')).toBe(false);
    expect(isProse('Good Life (2015, Texas Is Funny)')).toBe(false);
    expect(isProse('Yes.')).toBe(false);
  });

  test('the sections that are not a bio', () => {
    for (const title of ['References', 'External links', 'See also', 'Notes', 'Further reading', 'Discography',
      'Band members', 'Members', 'Personnel', 'Concert tours', 'Accolades', 'Awards and nominations',
      'Timeline of official members', 'Filmography', 'Videography', 'Sources']) {
      expect(DROP_SECTION_RE.test(title)).toBe(true);
    }
    for (const title of ['History', 'Career', 'Early life', 'Musical style', 'Legacy', 'Personal life', 'Artistry']) {
      expect(DROP_SECTION_RE.test(title)).toBe(false);
    }
  });
});
