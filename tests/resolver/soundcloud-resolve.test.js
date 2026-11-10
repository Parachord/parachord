/**
 * SoundCloud's resolve picks the requested track among the search results
 * instead of taking the first (#1306). The top result for Ramones "Judy Is a
 * Punk" was "Judy Is A Punk (1975 Demo)", which the confidence gate scores
 * 0.95 like the original, so it played. Mobile's iOS resolver and any desktop
 * path that calls the plugin's resolve take what this returns.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/soundcloud.axe'), 'utf8'));
const resolveFn = new Function('return ' + axe.implementation.resolve)();

const r = (artist, title) => ({ artist, title, soundcloudUrl: `https://soundcloud.com/x/${encodeURIComponent(title)}` });
const resolveWith = (results, artist, title) => {
  const queries = [];
  const p = resolveFn.call({ search: async (q) => { queries.push(q); return results; } }, artist, title, '', {});
  return p.then((hit) => ({ hit, queries }));
};

describe('SoundCloud resolve', () => {
  test('the original beats a demo ranked above it', async () => {
    const { hit } = await resolveWith(
      [r('Ramones', 'Judy Is A Punk (1975 Demo)'), r('Ramones', 'Judy Is a Punk')],
      'Ramones', 'Judy Is a Punk',
    );
    expect(hit.title).toBe('Judy Is a Punk');
  });

  test('a match that is not another version beats a version ranked above it', async () => {
    const { hit } = await resolveWith(
      [r('Ramones', 'Judy Is A Punk (1975 Demo)'), r('Ramones', 'Judy Is a Punk - 2016 Remaster')],
      'Ramones', 'Judy Is a Punk',
    );
    expect(hit.title).toBe('Judy Is a Punk - 2016 Remaster');
  });

  test('a matching version beats a result by someone else ranked above it', async () => {
    const { hit } = await resolveWith(
      [r('Someone Else', 'Totally Different'), r('Ramones', 'Judy Is A Punk (1975 Demo)')],
      'Ramones', 'Judy Is a Punk',
    );
    expect(hit.title).toBe('Judy Is A Punk (1975 Demo)');
  });

  test('a medley that lists the song loses to the song', async () => {
    const { hit } = await resolveWith(
      [r('The Beatles', 'Golden Slumbers/Carry That Weight/The End/Her Majesty'), r('The Beatles', 'Her Majesty')],
      'The Beatles', 'Her Majesty',
    );
    expect(hit.title).toBe('Her Majesty');
  });

  test('an "Artist - Title" upload is an exact match', async () => {
    const { hit } = await resolveWith(
      [r('Ramones', 'Judy Is A Punk (Live)'), r('Ramones', 'Ramones - Judy Is a Punk')],
      'Ramones', 'Judy Is a Punk',
    );
    expect(hit.title).toBe('Ramones - Judy Is a Punk');
  });

  test('a version the request names matches itself', async () => {
    const { hit } = await resolveWith(
      [r('Ramones', 'Judy Is a Punk'), r('Ramones', 'Judy Is A Punk (1975 Demo)')],
      'Ramones', 'Judy Is A Punk (1975 Demo)',
    );
    expect(hit.title).toBe('Judy Is A Punk (1975 Demo)');
  });

  test('with no match, the top result goes to the confidence gate', async () => {
    const top = r('Someone Else', 'Totally Different');
    const { hit } = await resolveWith([top, r('Another', 'Unrelated')], 'Ramones', 'Judy Is a Punk');
    expect(hit).toBe(top);
  });

  test('no results is no match, and the query is "artist title"', async () => {
    const { hit, queries } = await resolveWith([], 'Ramones', 'Judy Is a Punk');
    expect(hit).toBeNull();
    expect(queries).toEqual(['Ramones Judy Is a Punk']);
  });
});
