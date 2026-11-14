/**
 * @jest-environment jsdom
 *
 * Home's playlist-card art (ArtBox, src/renderer/components/home-sections.js):
 * a playlist's own cover (the record's coverArt, fed to ArtBox as imageUrl)
 * that fails to load falls back to the track mosaic, and a playlist cover
 * never reports into the album-art pipeline (reportBrokenAlbumArt's retry is
 * for album covers; a playlist cover is not any album's art). An album cover
 * keeps reporting — that retry is how a dead album cover heals. The requested
 * review test (PR #1394): a real render, a real `error` event on the image.
 */

// The component modules use the vendor-global React (index.html loads it
// before app.js; tests set it before requiring them), so it must be on the
// global before home-sections is required.
global.React = global.React || require('react');
global.ReactDOM = global.ReactDOM || require('react-dom');
const React = global.React;
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const { ArtBox } = require('../../src/renderer/components/home-sections');

const TILES = [
  'https://img.example/tile1.jpg',
  'https://img.example/tile2.jpg',
  'https://img.example/tile3.jpg',
  'https://img.example/tile4.jpg',
];

const render = (ui) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const update = (next) => act(() => { root.render(next); });
  update(ui);
  return {
    host,
    update,
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
};

const imgSrcs = (host) => Array.from(host.querySelectorAll('img')).map((el) => el.getAttribute('src'));

describe('ArtBox: a playlist cover that fails to load degrades to the mosaic', () => {
  test('a playlist card: the error event swaps the cover for the mosaic tiles, no album-art report', () => {
    const onArtError = jest.fn();
    const { host, cleanup } = render(React.createElement(ArtBox, {
      imageUrl: 'https://img.example/cover.jpg',
      mosaic: TILES,
      item: { id: 'p1', title: 'My Discovery Mix', coverArt: 'https://img.example/cover.jpg' },
      onArtError,
      placeholder: 'playlist',
    }));

    // The cover shows first — ArtBox prefers imageUrl over the mosaic.
    expect(imgSrcs(host)).toEqual(['https://img.example/cover.jpg']);

    act(() => {
      host.querySelector('img').dispatchEvent(new Event('error'));
    });

    // The dead cover dropped out and the four mosaic tiles show instead.
    expect(imgSrcs(host)).toEqual(TILES);
    // A playlist cover never reaches the album-art pipeline.
    expect(onArtError).not.toHaveBeenCalled();

    cleanup();
  });

  test('a playlist card with no mosaic shows the placeholder glyph, not a broken image', () => {
    const { host, cleanup } = render(React.createElement(ArtBox, {
      imageUrl: 'https://img.example/cover.jpg',
      mosaic: null,
      item: { id: 'p1', title: 'My Discovery Mix' },
      placeholder: 'playlist',
    }));
    expect(imgSrcs(host)).toEqual(['https://img.example/cover.jpg']);
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')); });
    expect(imgSrcs(host)).toEqual([]);
    cleanup();
  });

  test('a fresh cover URL after the death retries (a refresh swapped the image)', () => {
    const props = {
      imageUrl: 'https://img.example/cover.jpg',
      mosaic: TILES,
      item: { id: 'p1', title: 'My Discovery Mix' },
      placeholder: 'playlist',
    };
    const { host, update, cleanup } = render(React.createElement(ArtBox, props));
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')); });
    expect(imgSrcs(host)).toEqual(TILES);

    // The parent swaps in a fresh URL (the usual retry/refresh flow): the
    // dead-URL state resets and the new cover is tried.
    update(React.createElement(ArtBox, { ...props, imageUrl: 'https://img.example/cover-fresh.jpg' }));
    expect(imgSrcs(host)).toEqual(['https://img.example/cover-fresh.jpg']);
    cleanup();
  });

  test('an album cover still reports through onArtError (the album-art retry)', () => {
    const onArtError = jest.fn();
    const { host, cleanup } = render(React.createElement(ArtBox, {
      imageUrl: 'https://img.example/album-cover.jpg',
      item: { artist: 'Artist', title: 'Album', imageUrl: 'https://img.example/album-cover.jpg' },
      onArtError,
    }));
    expect(imgSrcs(host)).toEqual(['https://img.example/album-cover.jpg']);
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')); });
    expect(onArtError).toHaveBeenCalledTimes(1);
    // Albums carry no mosaic; the report-driven retry is the healing path.
    expect(imgSrcs(host)).toEqual([]);
    cleanup();
  });
});
