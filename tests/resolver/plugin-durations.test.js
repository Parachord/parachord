/**
 * Bandcamp and YouTube report a track's real length, or null when the service
 * gives none, never a made-up one.
 *
 * Bandcamp's search results said 210 seconds and YouTube's search, link and
 * playlist lookups said 180, whatever the track. Since track lists fall back
 * to the best source's duration (src/renderer/lib/track-duration.js), a track
 * known only to them showed 3:30 or 3:00. Unknown has to stay unknown, and the
 * playback code that reads a length has to cope with null: playbackDurationSeconds
 * falls through to the track's own length (or 0, which every elapsed-time
 * timer treats as "no length" and never auto-advances on).
 */

const fs = require('fs');
const path = require('path');

const loadAxe = (id) => {
  const axe = JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${id}.axe`), 'utf8'));
  const impl = {};
  for (const [name, src] of Object.entries(axe.implementation)) {
    if (typeof src === 'string' && /^\s*(async\s+)?function/.test(src)) impl[name] = new Function('return ' + src)();
  }
  return impl;
};

const { playbackDurationSeconds } = require('../../src/renderer/lib/playback-helpers');

afterEach(() => {
  delete global.fetch;
  delete global.DOMParser;
});

const jsonReply = (body) => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
const textReply = (text) => ({ ok: true, text: async () => text, json: async () => JSON.parse(text) });

describe('Bandcamp durations', () => {
  const bandcamp = loadAxe('bandcamp');

  test('a search result has no made-up length', async () => {
    global.fetch = jest.fn(async () => jsonReply({
      auto: {
        results: [{
          type: 't',
          id: 1,
          name: 'Cleopatra',
          band_name: 'The Lumineers',
          album_name: 'Cleopatra',
          item_url_path: 'https://thelumineers.bandcamp.com/track/cleopatra',
        }],
      },
    }));
    const results = await bandcamp.search('the lumineers cleopatra', {});
    expect(results).toHaveLength(1);
    expect(results[0].duration).toBeNull();
  });

  // A DOMParser just big enough for lookupUrl: JSON-LD scripts and og: metas.
  const stubDomParser = () => {
    global.DOMParser = class {
      parseFromString(html) {
        const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
          .map((m) => ({ textContent: m[1] }));
        const meta = (prop) => {
          const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`));
          return m ? { content: m[1] } : null;
        };
        return {
          querySelectorAll: () => scripts,
          querySelector: (sel) => {
            const m = sel.match(/property="([^"]+)"/);
            return m ? meta(m[1]) : null;
          },
        };
      }
    };
  };

  test("a track page's JSON-LD length is read", async () => {
    stubDomParser();
    const ld = { '@type': 'MusicRecording', name: 'Cleopatra', duration: 'P00H03M21S', byArtist: { name: 'The Lumineers' } };
    global.fetch = jest.fn(async () => textReply(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`));
    const result = await bandcamp.lookupUrl('https://thelumineers.bandcamp.com/track/cleopatra', {});
    expect(result.duration).toBe(201);
  });

  test('a track page without a length reports null, not 0', async () => {
    stubDomParser();
    const ld = { '@type': 'MusicRecording', name: 'Cleopatra', byArtist: { name: 'The Lumineers' } };
    global.fetch = jest.fn(async () => textReply(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`));
    const result = await bandcamp.lookupUrl('https://thelumineers.bandcamp.com/track/cleopatra', {});
    expect(result.duration).toBeNull();
  });

  test('the og: fallback reports null', async () => {
    stubDomParser();
    global.fetch = jest.fn(async () => textReply(
      '<meta property="og:title" content="Cleopatra"><meta property="og:site_name" content="The Lumineers">',
    ));
    const result = await bandcamp.lookupUrl('https://thelumineers.bandcamp.com/track/cleopatra', {});
    expect(result.title).toBe('Cleopatra');
    expect(result.duration).toBeNull();
  });
});

describe('YouTube durations', () => {
  const youtube = loadAxe('youtube');

  // The shape of a results page's videoRenderer, trimmed to what search reads;
  const video = (id, title, channel, length) =>
  // lengthText sits between title and ownerText, as on youtube.com (2026-11).
    `"videoRenderer":{"videoId":"${id}","thumbnail":{"thumbnails":[]},"title":{"runs":[{"text":"${title}"}]},` +
    `"publishedTimeText":{"simpleText":"1 year ago"},` +
    (length
      ? `"lengthText":{"accessibility":{"accessibilityData":{"label":"some minutes"}},"simpleText":"${length}"},`
      : '') +
    `"viewCountText":{"simpleText":"1 view"},"ownerText":{"runs":[{"text":"${channel}"}]}}`;

  test("search reads each video's own length", async () => {
    const html = [
      video('aaaaaaaaaaa', 'Radiohead - Creep', 'Radiohead', '3:57'),
      video('bbbbbbbbbbb', 'Creep (Live)', 'Radiohead', null),
      video('ccccccccccc', 'Creep (1 hour loop)', 'Loops', '1:02:03'),
    ].join(',');
    global.fetch = jest.fn(async () => textReply(html));
    const results = await youtube.search('radiohead creep', {});
    expect(results.map((r) => [r.youtubeId, r.duration])).toEqual([
      ['aaaaaaaaaaa', 237],
      // A live stream has no lengthText: unknown, and the next video's
      // length must not leak into it.
      ['bbbbbbbbbbb', null],
      ['ccccccccccc', 3723],
    ]);
  });

  test('a link lookup has no made-up length', async () => {
    global.fetch = jest.fn(async () => jsonReply({ title: 'Radiohead - Creep', author_name: 'Radiohead' }));
    const result = await youtube.lookupUrl('https://www.youtube.com/watch?v=XFkzRNyygfk', {});
    expect(result).toMatchObject({ artist: 'Radiohead', title: 'Creep' });
    expect(result.duration).toBeNull();
  });

  test('no plugin source says 180 or 210 any more', () => {
    for (const id of ['bandcamp', 'youtube']) {
      const src = fs.readFileSync(path.join(__dirname, `../../plugins-src/${id}/implementation.js`), 'utf8');
      expect(src).not.toMatch(/duration:\s*(180|210)\b/);
    }
  });
});

describe('playback copes with an unknown source length', () => {
  test("a null source length falls back to the track's own", () => {
    expect(playbackDurationSeconds({ duration: null }, { duration: 245 })).toBe(245);
  });

  test('both unknown is 0, which the elapsed-time timers read as no length', () => {
    expect(playbackDurationSeconds({ duration: null }, { duration: null })).toBe(0);
  });

  test('every elapsed-time auto-advance is guarded by a positive length', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const guards = app.match(/const hasValidDuration = currentTrack\?\.duration && currentTrack\.duration > 0;/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
    // The wall-clock timer that calls handleNext on elapsed >= duration only
    // runs with that guard.
    expect(app).toMatch(/!isBrowserTrack && hasValidDuration\) \{\s*const interval = setInterval/);
  });

  test("the app doesn't invent a length for a link or a scraped track", () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    expect(app).not.toMatch(/duration: (trackMeta|track)\.duration \|\| (180|210)/);
  });
});
