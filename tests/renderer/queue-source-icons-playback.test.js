/**
 * The queue drawer's source icons follow the same rule as the page lists
 * (lib/visible-sources.js): real sources only, playable on this account,
 * in resolver order, not every key of track.sources (CLAUDE.md "A resolver the account's plan
 * can't play stays active but leaves playback"; docs/architecture/playback.md
 * "Playback limits").
 *
 * Before: VirtualizedQueueList built a row's icons from every key of
 * `track.sources`, so a Prime account saw an Amazon icon and a signed-out
 * Apple Music showed one too, on every queued row. Now the row keeps only
 * real sources (no `noMatch` sentinels) from resolvers in `playbackResolvers`,
 * merged with the live `trackSources`, as the pages do. A track whose sources are all
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

const renderQueue = (queue, playbackResolvers, trackSources = {}) => renderToStaticMarkup(
  React.createElement(VirtualizedQueueList, {
    queue,
    currentTrack: null,
    resolverOrder,
    allResolvers,
    playbackResolvers,
    trackSources,
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
    expect(html).toContain('Play from Spotify');
    expect(html).toContain('Play from YouTube');
    expect(html).not.toContain('Play from Amazon Music');
    expect(html).not.toContain('Play from Apple Music');
    expect(html).not.toMatch(/data-index="0"[^>]*class="[^"]*opacity-50/);
  });

  test('a track whose only sources are unplayable shows no icons and no resolving shimmer', () => {
    const track = { id: 't2', title: 'Song', artist: 'Artist', duration: 180, sources: { amazonmusic: source() } };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html).not.toContain('Play from');
    expect(html).not.toContain('Resolving track');
    // Nothing playable: the row is dimmed.
    expect(html).toMatch(/data-index="0"[^>]*class="[^"]*opacity-50/);
  });

  test('a track with no sources yet still shows the resolving shimmer', () => {
    const track = { id: 't3', title: 'Song', artist: 'Artist', duration: 180, sources: {} };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html).toContain('Resolving track');
    expect(html).not.toMatch(/data-index="0"[^>]*class="[^"]*opacity-50/);
  });

  test('icons stay in resolverOrder', () => {
    const track = { id: 't4', title: 'Song', artist: 'Artist', duration: 180, sources: { youtube: source(), spotify: source() } };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html.indexOf('Play from Spotify')).toBeLessThan(html.indexOf('Play from YouTube'));
  });

  test('a noMatch sentinel gets no icon', () => {
    const track = {
      id: 't5', title: 'Song', artist: 'Artist', duration: 180,
      sources: { spotify: { noMatch: true, resolvedAt: 1 }, youtube: source() },
    };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html).not.toContain('Play from Spotify');
    expect(html).toContain('Play from YouTube');
  });

  test('a track whose sources are all noMatch shows nothing, not the shimmer, and is dimmed', () => {
    const track = { id: 't6', title: 'Song', artist: 'Artist', duration: 180, sources: { spotify: { noMatch: true } } };
    const html = renderQueue([track], ['spotify', 'youtube']);
    expect(html).not.toContain('Play from');
    expect(html).not.toContain('Resolving track');
    expect(html).toMatch(/data-index="0"[^>]*class="[^"]*opacity-50/);
  });

  test('live trackSources count, as in a playlist row', () => {
    const track = { id: 't7', title: 'Song', artist: 'Artist', duration: 180, sources: {} };
    const html = renderQueue([track], ['spotify', 'youtube'], { t7: { spotify: source(), amazonmusic: source() } });
    expect(html).toContain('Play from Spotify');
    expect(html).not.toContain('Play from Amazon Music');
    expect(html).not.toContain('Resolving track');
  });

  test('app.js passes playbackResolvers and trackSources to the queue list', () => {
    const app = require('../helpers/renderer-source').appWithPages(); // the queue list is in components/queue-drawer.js (#1451)
    const start = app.indexOf('React.createElement(VirtualizedQueueList, {');
    expect(start).toBeGreaterThan(-1);
    const props = app.slice(start, app.indexOf('})', start));
    expect(props).toMatch(/^\s*playbackResolvers,$/m);
    expect(props).toMatch(/^\s*trackSources,$/m);
    expect(props).not.toMatch(/activeResolvers/);
  });
});
