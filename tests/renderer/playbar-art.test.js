/**
 * The playbar kept the last cover whenever a track had none, because "still
 * loading" and "there isn't one" looked the same. A track that never got a cover
 * showed the previous track's until something else replaced it.
 */

const fs = require('fs');
const path = require('path');
const { holdPreviousPlaybarArt, trackArtKey, playbarShowsTrack } = require('../../src/renderer/lib/playbar-art');

const track = { artist: 'Swapmeet', album: 'Mount Zero', title: 'I Know!' };

describe('holdPreviousPlaybarArt', () => {
  test('while the lookup is running, the previous cover stays, so nothing flashes', () => {
    expect(holdPreviousPlaybarArt(track, null)).toBe(true);
    expect(holdPreviousPlaybarArt(track, 'someone|else')).toBe(true);
  });

  test('once the lookup finds nothing for this album, it goes', () => {
    expect(holdPreviousPlaybarArt(track, trackArtKey(track))).toBe(false);
  });

  test('another track on an album already known to have no cover does not wait', () => {
    expect(holdPreviousPlaybarArt({ ...track, title: 'Other' }, trackArtKey(track))).toBe(false);
  });

  test('a track with no album has nothing to look up, so it goes at once', () => {
    expect(holdPreviousPlaybarArt({ artist: 'A', title: 'T', album: null }, null)).toBe(false);
    expect(holdPreviousPlaybarArt({ title: 'T', album: 'Album' }, null)).toBe(false);
  });

  test('a loading placeholder holds it: the real track has not arrived yet', () => {
    expect(holdPreviousPlaybarArt({ title: 'T', artist: 'A', status: 'resolving' }, null)).toBe(true);
    expect(holdPreviousPlaybarArt({ title: 'T', artist: 'A', status: 'loading' }, null)).toBe(true);
    expect(holdPreviousPlaybarArt({ title: 'Loading album…', artist: '', _protocolLoading: true }, null)).toBe(true);
  });

  test('with no track at all, nothing changes', () => {
    expect(holdPreviousPlaybarArt(null, null)).toBe(true);
  });
});

// Play on a paused track that goes back through handlePlay (the first Play
// after a restart, after a failed play, or after the engine was stopped)
// swapped the playbar's cover, title and artist for the loading skeleton and
// back, though the track never changed: it looked like a reload.
describe('playbarShowsTrack', () => {
  const playing = { id: 'swapmeet-i-know', artist: 'Swapmeet', title: 'I Know!', albumArt: 'https://x/a.jpg' };

  test('not loading: the track shows', () => {
    expect(playbarShowsTrack(playing, false, null)).toBe(true);
  });

  test('loading the track already on screen keeps it there', () => {
    expect(playbarShowsTrack(playing, true, { ...playing })).toBe(true);
    // handlePlay may pass a copy with more sources or a resolving status.
    expect(playbarShowsTrack({ ...playing, status: 'resolving' }, true, { ...playing, sources: { spotify: {} } })).toBe(true);
  });

  test('loading another track shows the skeleton, not the old cover and title', () => {
    expect(playbarShowsTrack(playing, true, { id: 'other', artist: 'B', title: 'T' })).toBe(false);
  });

  test('a load flagged before handlePlay ran is another track: skeleton', () => {
    expect(playbarShowsTrack(playing, true, null)).toBe(false);
  });

  test('no track: skeleton', () => {
    expect(playbarShowsTrack(null, false, null)).toBe(false);
    expect(playbarShowsTrack(null, true, playing)).toBe(false);
  });
});

describe('the engine and playbar wire it', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');

  test('handlePlay records the track it starts with the loading flag', () => {
    expect(engine).toMatch(/setLoadingTrack\(trackOrSource\);\s*setTrackLoading\(true\)/);
  });

  test('the record clears when the load ends, so a later click is not mistaken for it', () => {
    expect(engine).toMatch(/if \(!trackLoading\) setLoadingTrack\(null\);\s*\}, \[trackLoading\]\)/);
  });

  test('the playbar asks playbarShowsTrack instead of hiding on any load', () => {
    expect(app).toContain('playbarShowsTrack(currentTrack, trackLoading, loadingTrack) ? [');
    expect(app).not.toContain('currentTrack && !trackLoading ? [');
  });
});

describe('the playbar uses it', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('the crossfade asks instead of always keeping the old cover', () => {
    const start = app.indexOf('// Handle album art crossfade transitions in playbar');
    const effect = app.slice(start, app.indexOf('// Check if spinoff is available', start));
    expect(effect).toMatch(/!newArt && prevArt && holdPlaybarArt/);
    expect(effect).toMatch(/\[currentTrack\?\.albumArt, holdPlaybarArt\]/);
  });

  test('the current track art lookup reports when it finds nothing', () => {
    const start = app.indexOf('// Fetch album art for current track if missing');
    const effect = app.slice(start, app.indexOf('// Stream-quality backfill', start));
    expect(effect).toContain('setPlaybarArtMissKey(');
    expect(effect).toContain('.catch(');
  });

  test('state the crossfade depends on is declared before it', () => {
    expect(app.indexOf('const holdPlaybarArt = ')).toBeGreaterThan(-1);
    expect(app.indexOf('const holdPlaybarArt = ')).toBeLessThan(app.indexOf('// Handle album art crossfade transitions in playbar'));
  });
});
