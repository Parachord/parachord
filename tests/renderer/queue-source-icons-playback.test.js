/**
 * The queue drawer's source icons follow playbackResolvers, not every
 * service a track resolved on (CLAUDE.md "A resolver the account's plan
 * can't play stays active but leaves playback"; docs/architecture/playback.md
 * "Playback limits").
 *
 * Before: VirtualizedQueueList built a row's icons from every key of
 * `track.sources`, so a Prime account saw an Amazon icon and a signed-out
 * Apple Music showed one too, on every queued row. Now the row keeps only
 * the resolvers in the `activeResolvers` prop, which app.js feeds with
 * `playbackResolvers`, as the pages get it. A track whose sources are all
 * unplayable shows no icons (as the page lists do), not the "resolving"
 * shimmer, which stays for a track with no sources yet.
 */

const fs = require('fs');
const path = require('path');

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const { renderToStaticMarkup } = require('react-dom/server');
const { VirtualizedQueueList } = require('../../src/renderer/components/track-lists');

const allResolvers = [
  { id: 'spotify', name: 'Spotify', color: '#1db954' },
  { id: 'amazonmusic', name: 'Amazon Music', color: '#25d1da' },
  { id: 'applemusic', name: 'Apple Music', color: '#fa243c' },
  { id: 'youtube', name: 'YouTube', color: '#ff0000' },
];
const resolverOrder = ['spotify', 'amazonmusic', 'applemusic', 'youtube'];
const noop = () => {};

const renderQueue = (queue, activeResolvers) => renderToStaticMarkup(
  React.createElement(VirtualizedQueueList, {
    queue,
    currentTrack: null,
    resolverOrder,
    allResolvers,
    activeResolvers,
    queueDropTarget: null,
    draggedQueueTrack: null,
    insertedTrackId: null,
    droppingFromIndex: null,
    parentRef: { current: null },
    containerHeight: 400,
    formatTime: () => '3:00',
    handlePlaylistDragEnd: noop,
  })
);

const source = (confidence = 1) => ({ confidence });

describe('queue drawer source icons', () => {
  test('a resolver the plan can\'t play gets no icon', () => {
    const track = {
      id: 't1', title: 'Song', artist: 'Artist', duration: 180,
      sources: { spotify: source(), amazonmusic: source(), applemusic: source(), youtube: source(0.95) },
    };
    // Prime account (Amazon blocked) and a signed-out Apple Music.
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html).toContain('Play via Spotify');
    expect(html).toContain('Play via YouTube');
    expect(html).not.toContain('Play via Amazon Music');
    expect(html).not.toContain('Play via Apple Music');
  });

  test('a track whose only sources are unplayable shows no icons and no resolving shimmer', () => {
    const track = { id: 't2', title: 'Song', artist: 'Artist', duration: 180, sources: { amazonmusic: source() } };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html).not.toContain('Play via');
    expect(html).not.toContain('Resolving track');
  });

  test('a track with no sources yet still shows the resolving shimmer', () => {
    const track = { id: 't3', title: 'Song', artist: 'Artist', duration: 180, sources: {} };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html).toContain('Resolving track');
  });

  test('icons stay in resolverOrder', () => {
    const track = { id: 't4', title: 'Song', artist: 'Artist', duration: 180, sources: { youtube: source(), spotify: source() } };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html.indexOf('Play via Spotify')).toBeLessThan(html.indexOf('Play via YouTube'));
  });

  test('app.js passes playbackResolvers to the queue list', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
    const start = app.indexOf('React.createElement(VirtualizedQueueList, {');
    expect(start).toBeGreaterThan(-1);
    const props = app.slice(start, app.indexOf('})', start));
    expect(props).toMatch(/activeResolvers:\s*playbackResolvers\b/);
  });
});
