/**
 * Which SoundCloud search result the plugin's resolve plays (#1306). It took
 * the first result, so Ramones "Judy Is a Punk" resolved to the preview-only
 * "1975 Demo"; matching by containment took "ROTD-Ep100 Judy Is a Punk" by
 * "Ramones of the Day", a 29-minute podcast. The result lists are SoundCloud's,
 * logged on a Pixel 9a (Nov 2026). The vectors are mobile's SoundCloudPickTest
 * (parachord-mobile#597), whose pickSoundCloudTrack has the same rule.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/soundcloud.axe'), 'utf8'));
const resolveFn = new Function('return ' + axe.implementation.resolve)();

// A row the way the plugin's search maps it.
const sc = (title, user, { access = 'playable', streamable = true } = {}) => ({
  title,
  artist: user,
  soundcloudUrl: `https://soundcloud.com/${encodeURIComponent(user)}/${encodeURIComponent(title)}`,
  streamable: streamable && access !== 'blocked',
  limitedPlayback: !!access && access !== 'playable',
});

const resolveWith = async (results, artist, title) => {
  const queries = [];
  const hit = await resolveFn.call({ search: async (q) => { queries.push(q); return results; } }, artist, title, '', {});
  return { hit, queries };
};

const judyResults = [
  sc('Judy Is A Punk (1975 Demo)', 'Ramones', { access: 'preview' }),
  sc('The Ramones - Judy Is A Punk', 'xander_90'),
  sc('Sheena Is a Punk Rocker (2005 Remaster)', 'Ramones', { access: 'preview' }),
  sc('Judy Is A Punk (40th Anniversary Mono Mix)', 'Rhino Records'),
  sc('Judy Is A Punk', 'RAMONOS (Ramones Tribute)'),
  sc('ROTD-Ep100 Judy Is a Punk', 'Ramones of the Day'),
  sc('Judy is a Punk - Ramones - Cover', 'Jacob Sherrard'),
  sc('Judy Is A Punk (Ramones Cover)', 'karl neudert segundo'),
  sc('Judy Is a Punk', 'PEARS', { access: 'preview' }),
];

const herMajestyResults = [
  sc('Her Majesty - The Beatles', 'Unay Okami'),
  sc('Her Majesty (Beatles Cover Arranged by Black Francis)', 'Art Brut', { access: 'preview' }),
  sc('The Beatles - Her Majesty (Long Version)', 'J.J.'),
  sc('The Beatles - Her Majesty', 'Lucas Whitehead'),
  sc('Her Majesty - The Beatles', 'Wellsworth-Records'),
  sc('147. Her Majesty / Here Comes The Sun (Abbey Road, deel 6)', 'Fab4Cast - The Dutch Beatles Podcast'),
];

describe('SoundCloud resolve', () => {
  test('neither the preview-only demo nor a podcast whose uploader contains the artist\'s name', async () => {
    const { hit } = await resolveWith(judyResults, 'Ramones', 'Judy Is a Punk');
    expect(hit.soundcloudUrl).toBe(judyResults[1].soundcloudUrl);
    // Reported as the upload's own artist and title, so the confidence gate scores it.
    expect(hit.artist).toBe('The Ramones');
    expect(hit.title).toBe('Judy Is A Punk');
    // The search row itself is left alone.
    expect(judyResults[1].artist).toBe('xander_90');
  });

  test('an "Artist - Title" upload of the song beats a longer version', async () => {
    const { hit } = await resolveWith(herMajestyResults, 'The Beatles', 'Her Majesty');
    expect(hit.soundcloudUrl).toBe(herMajestyResults[3].soundcloudUrl);
    expect(hit.title).toBe('Her Majesty');
  });

  test('the artist\'s own upload comes first', async () => {
    const own = sc('Judy Is a Punk', 'Ramones');
    const { hit } = await resolveWith([sc('The Ramones - Judy Is A Punk', 'xander_90'), own], 'Ramones', 'Judy Is a Punk');
    expect(hit).toBe(own);
  });

  test('a playable demo by the artist still plays when it is the only match', async () => {
    const demo = sc('Judy Is A Punk (1975 Demo)', 'Ramones');
    const { hit } = await resolveWith([sc('ROTD-Ep100 Judy Is a Punk', 'Ramones of the Day'), demo], 'Ramones', 'Judy Is a Punk');
    expect(hit).toBe(demo);
  });

  test('with nothing by the artist there is no SoundCloud source', async () => {
    const only = [
      sc('ROTD-Ep100 Judy Is a Punk', 'Ramones of the Day'),
      sc('Judy Is A Punk', 'RAMONOS (Ramones Tribute)'),
      sc('Judy Is A Punk (1975 Demo)', 'Ramones', { access: 'preview' }),
    ];
    expect((await resolveWith(only, 'Ramones', 'Judy Is a Punk')).hit).toBeNull();
  });

  test('tracks that cannot be played are never picked', async () => {
    const blocked = sc('Judy Is a Punk', 'Ramones', { access: 'blocked' });
    const notStreamable = sc('Judy Is a Punk', 'Ramones', { streamable: false });
    expect((await resolveWith([blocked, notStreamable], 'Ramones', 'Judy Is a Punk')).hit).toBeNull();
  });

  test('without a target the first playable track is picked', async () => {
    const first = sc('A', 'B');
    expect((await resolveWith([sc('P', 'Q', { access: 'preview' }), first], '', '')).hit).toBe(first);
  });

  test('a medley by the artist loses to the song', async () => {
    const song = sc('Her Majesty', 'The Beatles');
    const { hit } = await resolveWith([sc('Golden Slumbers/Carry That Weight/The End/Her Majesty', 'The Beatles'), song], 'The Beatles', 'Her Majesty');
    expect(hit).toBe(song);
  });

  test('no results is no match, and the query is "artist title"', async () => {
    const { hit, queries } = await resolveWith([], 'Ramones', 'Judy Is a Punk');
    expect(hit).toBeNull();
    expect(queries).toEqual(['Ramones Judy Is a Punk']);
  });

  test('has no property-escape regex literal, which would stop the function parsing', () => {
    expect(axe.implementation.resolve).not.toMatch(/(?<!\\)\\p\{/);
  });
});

describe('capabilities.resolvePicks', () => {
  test('SoundCloud declares it', () => {
    expect(axe.capabilities.resolvePicks).toBe(true);
  });

  test('the play-time resolve calls the plugin\'s resolve instead of choosing among its search results', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
    expect(src).toMatch(/if \(resolver\.search && typeof resolver\.search === 'function' && !resolver\.capabilities\?\.resolvePicks\) \{/);
  });
});
