/**
 * parachord://play/radio?artist=X (Mode B) without a title used to clear the
 * queue and then bail in startSpinoff with "missing track info", because
 * Last.fm track.getsimilar needs a track (parachord#1005). The fix resolves a
 * seed (the artist's top track) before the queue is touched. These are
 * source-level checks on app.js, since the handler lives inside the component.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8') +
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');

function modeBSource() {
  const start = app.indexOf('// Mode B: artist-only seed');
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf('// Mode C:', start);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end);
}

describe('play/radio Mode B (artist-only seed)', () => {
  test('resolves the seed before clearing the queue, and bails without clearing when there is no seed', () => {
    const src = modeBSource();
    const seedAt = src.indexOf('await resolveSpinoffSeed(');
    const clearAt = src.indexOf('clearQueue();');
    expect(seedAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(seedAt);
    expect(src.slice(seedAt, clearAt)).toMatch(/if \(!seed\) break;/);
  });

  test('resolveSpinoffSeed falls back to the artist\'s top Last.fm track and toasts when none exists', () => {
    const start = app.indexOf('const resolveSpinoffSeed = async (seed) => {');
    expect(start).toBeGreaterThan(-1);
    const src = app.slice(start, app.indexOf('\n  };', start));
    expect(src).toMatch(/if \(seed\.title\) return \{ artist: seed\.artist, title: seed\.title \};/);
    expect(src).toMatch(/getArtistTopTracks\(seed\.artist, 1\)/);
    expect(src).toMatch(/showToast\(.*to seed the radio.*'error'\)/);
  });

  test('startSpinoff itself accepts an artist-only seed (other callers than the protocol)', () => {
    const start = app.indexOf('const startSpinoff = async (track) => {');
    expect(start).toBeGreaterThan(-1);
    const src = app.slice(start, start + 1200);
    expect(src).toMatch(/if \(track && track\.artist && !track\.title\) \{\s*\n\s*\/\/[^\n]*\n\s*track = await resolveSpinoffSeed\(track\);/);
  });
});
