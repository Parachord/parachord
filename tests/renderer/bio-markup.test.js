/**
 * Discogs profile markup (2026-10): a band whose profile listed its members
 * by id showed "[a17632854] – vocals" and literal [b] tags on the artist page.
 * The references are resolved in the Discogs plug-in (its _lib, #1539 step 6);
 * the tags are rendered by the app (src/renderer/lib/bio-markup.js).
 */

const fs = require('fs');
const path = require('path');
const { parseBioMarkup } = require('../../src/renderer/lib/bio-markup');

// The Discogs plug-in's library, as the loader materializes it.
const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/discogs.axe'), 'utf8'));
const lib = new Function('return ' + axe.implementation._lib)()();
const { refIds: discogsRefIds, normalizeProfile: normalizeDiscogsProfile, stripDisambiguation } = lib;

// The live profile for renie cares (Discogs artist 15225678).
const PROFILE = 'renie cares is a Ukrainian indie rock band, formed in 2021 in Kyiv, Ukraine.\r\n\r\n[b]Main official members (in a chronological order):[/b]\r\n[a17632854] – vocals, lyrics (2019-present)\r\n[a17632857] – guitar, producer (2019-04.09.2025)\r\n[a17632959] – drums (2019-2024)';

describe('discogsRefIds', () => {
  test('lists distinct id references of every type, in order', () => {
    expect(discogsRefIds(PROFILE)).toEqual([
      { type: 'a', id: '17632854' }, { type: 'a', id: '17632857' }, { type: 'a', id: '17632959' },
    ]);
    expect(discogsRefIds('[l12] [r34] [m56] [l12] [a=Name]')).toEqual([
      { type: 'l', id: '12' }, { type: 'r', id: '34' }, { type: 'm', id: '56' },
    ]);
  });
});

describe('normalizeDiscogsProfile', () => {
  test('replaces id references with names and keeps formatting tags', () => {
    const out = normalizeDiscogsProfile(PROFILE, { a17632854: 'Iryna Panchuk', a17632857: 'Someone (2)' });
    expect(out).toContain('[b]Main official members (in a chronological order):[/b]');
    expect(out).toContain('\nIryna Panchuk – vocals, lyrics (2019-present)');
    expect(out).toContain('\nSomeone – guitar');           // disambiguation suffix dropped
    expect(out).toContain('\n– drums (2019-2024)');         // unresolved id dropped, not shown
    expect(out).not.toMatch(/\[a\d+\]|\r/);
  });

  test('by-name references become plain names', () => {
    expect(normalizeDiscogsProfile('With [a=John Smith (3)] on [l=Warp Records] and [r=Some Album].'))
      .toBe('With John Smith on Warp Records and Some Album.');
  });

  test('stripDisambiguation only removes a trailing number in parentheses', () => {
    expect(stripDisambiguation('Live (2)')).toBe('Live');
    expect(stripDisambiguation('The Band (UK)')).toBe('The Band (UK)');
  });
});

describe('parseBioMarkup', () => {
  test('turns tags into styled segments', () => {
    expect(parseBioMarkup('A [b]bold[/b] and [i]it[/i] [u]u[/u].')).toEqual([
      { text: 'A ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'it', italic: true },
      { text: ' ' }, { text: 'u', underline: true }, { text: '.' },
    ]);
  });

  test('keeps http(s) links and drops other schemes', () => {
    expect(parseBioMarkup('[url=https://example.com]site[/url]')).toEqual([{ text: 'site', href: 'https://example.com' }]);
    expect(parseBioMarkup('[url=javascript:alert(1)]x[/url]')).toEqual([{ text: 'x' }]);
  });

  test('plain text is one segment, newlines kept', () => {
    expect(parseBioMarkup('line one\nline two')).toEqual([{ text: 'line one\nline two' }]);
  });
});

test('the Discogs plug-in resolves references and the artist page renders a bbcode bio', () => {
  expect(axe.implementation.getArtistBio).toMatch(/lib\.normalizeProfile\(data\.profile, refNames\)/);
  expect(axe.implementation.getArtistBio).toContain("markup: 'bbcode'");
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/artist-page.js'), 'utf8');
  expect(page).toMatch(/artistBio\.markup === 'bbcode'[\s\S]{0,120}parseBioMarkup\(artistBio\.text\)/);
  expect(page).not.toMatch(/artistBio\.source === '/);
});
