/**
 * @jest-environment jsdom
 *
 * The shared album card (src/renderer/components/album-card.js), rendered for
 * real. Every album grid moved onto it, so the behaviours the per-grid cards
 * carried are pinned here once:
 *   - hover prefetch waits for a 250ms dwell and a leave cancels it (the
 *     Fresh Drops / charts scroll stutter: cards passing under a still
 *     pointer each fired a MusicBrainz lookup);
 *   - a cover the card looked up itself (Collection, getAlbumArt) that fails
 *     to load is reported to the art pipeline, and the retry's late answer
 *     paints only the album the card still shows (the old CollectionAlbumCard
 *     guard);
 *   - a dead list cover (onArtError) is handed back to the grid, and the
 *     grid's fresh URL shows in a new img (what keying the img on its URL
 *     used to do).
 */

global.React = global.React || require('react');
global.ReactDOM = global.ReactDOM || require('react-dom');
const React = global.React;
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const { AlbumCard } = require('../../src/renderer/components/album-card');

global.IS_REACT_ACT_ENVIRONMENT = true;

const render = (ui) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const update = (next) => act(() => { root.render(next); });
  update(ui);
  return { host, update, cleanup: () => { act(() => root.unmount()); host.remove(); } };
};

const card = (host) => host.querySelector('.card-button');
const imgSrcs = (host) => Array.from(host.querySelectorAll('img')).map((el) => el.getAttribute('src'));
// React's onMouseEnter / onMouseLeave listen for mouseover / mouseout.
const hover = (el) => act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
const unhover = (el) => act(() => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
const fail = (img) => act(() => { img.dispatchEvent(new Event('error')); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const ALBUM = { id: 'a1', title: 'Frog', artist: 'Hovvdy', imageUrl: 'https://img.example/frog.jpg' };

describe('hover prefetch', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('runs only after the pointer rests 250ms on the card', () => {
    const onHoverPrefetch = jest.fn();
    const { host, cleanup } = render(React.createElement(AlbumCard, { album: ALBUM, onHoverPrefetch }));
    hover(card(host));
    act(() => { jest.advanceTimersByTime(249); });
    expect(onHoverPrefetch).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onHoverPrefetch).toHaveBeenCalledTimes(1);
    expect(onHoverPrefetch.mock.calls[0][0]).toMatchObject({ id: 'a1' });
    cleanup();
  });

  test('a card the pointer only passes over never prefetches', () => {
    const onHoverPrefetch = jest.fn();
    const { host, cleanup } = render(React.createElement(AlbumCard, { album: ALBUM, onHoverPrefetch }));
    hover(card(host));
    act(() => { jest.advanceTimersByTime(100); });
    unhover(card(host));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(onHoverPrefetch).not.toHaveBeenCalled();
    cleanup();
  });

  test('an unmount (the view changed) cancels a pending prefetch', () => {
    const onHoverPrefetch = jest.fn();
    const { host, cleanup } = render(React.createElement(AlbumCard, { album: ALBUM, onHoverPrefetch }));
    hover(card(host));
    cleanup();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(onHoverPrefetch).not.toHaveBeenCalled();
  });
});

describe('a cover the card looked up itself (getAlbumArt)', () => {
  afterEach(() => { delete globalThis.reportBrokenAlbumArt; });

  test('a dead cover is reported and the retry shows', async () => {
    let answer;
    globalThis.reportBrokenAlbumArt = jest.fn(() => new Promise((r) => { answer = r; }));
    const getAlbumArt = jest.fn(async () => 'https://img.example/dead.jpg');
    const album = { id: 'a1', title: 'Frog', artist: 'Hovvdy' };
    const { host, cleanup } = render(React.createElement(AlbumCard, { album, getAlbumArt }));
    await flush();
    expect(imgSrcs(host)).toEqual(['https://img.example/dead.jpg']);
    fail(host.querySelector('img'));
    expect(globalThis.reportBrokenAlbumArt).toHaveBeenCalledWith('https://img.example/dead.jpg', { artist: 'Hovvdy', album: 'Frog' });
    expect(imgSrcs(host)).toEqual([]);
    await act(async () => { answer('https://img.example/fresh.jpg'); });
    expect(imgSrcs(host)).toEqual(['https://img.example/fresh.jpg']);
    cleanup();
  });

  test('a late broken-art answer only paints the album the card still shows', async () => {
    let answer;
    globalThis.reportBrokenAlbumArt = jest.fn(() => new Promise((r) => { answer = r; }));
    const getAlbumArt = jest.fn(async (artist) => (artist === 'Hovvdy' ? 'https://img.example/dead.jpg' : 'https://img.example/other.jpg'));
    const first = { title: 'Frog', artist: 'Hovvdy' };
    const second = { title: 'Heavy Lifter', artist: 'Hovvdy Too' };
    const { host, update, cleanup } = render(React.createElement(AlbumCard, { album: first, getAlbumArt }));
    await flush();
    fail(host.querySelector('img'));
    // The card moves on to another album before the retry answers.
    update(React.createElement(AlbumCard, { album: second, getAlbumArt }));
    await flush();
    expect(imgSrcs(host)).toEqual(['https://img.example/other.jpg']);
    await act(async () => { answer('https://img.example/fresh-frog.jpg'); });
    expect(imgSrcs(host)).toEqual(['https://img.example/other.jpg']);
    cleanup();
  });
});

describe("a list's cover (onArtError)", () => {
  test('a dead cover goes to the grid, and the fresh URL shows in a new img', () => {
    const onArtError = jest.fn();
    const { host, update, cleanup } = render(React.createElement(AlbumCard, { album: ALBUM, onArtError }));
    const dead = host.querySelector('img');
    fail(dead);
    expect(onArtError).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    // The dead img is gone, never left hidden in place.
    expect(imgSrcs(host)).toEqual([]);
    // The grid's retry patched its list: the card gets the fresh URL.
    update(React.createElement(AlbumCard, { album: { ...ALBUM, imageUrl: 'https://img.example/fresh.jpg' }, onArtError }));
    const img = host.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://img.example/fresh.jpg');
    expect(img).not.toBe(dead);
    cleanup();
  });
});
