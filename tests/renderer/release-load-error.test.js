/**
 * An album whose tracks could not load (release._loadError) shows the reason
 * and a Try Again button in place of the track skeleton, instead of keeping
 * the skeleton up behind a dialog or jumping to the artist page.
 */

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const { renderToStaticMarkup } = require('react-dom/server');
const { ReleasePage } = require('../../src/renderer/components/cards');

const base = {
  id: 'f075d022-497c-4bbb-b4a2-25bf38c18ca5',
  title: 'Still Coming Down',
  artist: { id: null, name: 'Wild Pink' },
  releaseType: 'album',
  albumArt: null,
  tracks: null,
  _isPartial: true,
};

const render = (release, extra = {}) => renderToStaticMarkup(React.createElement(ReleasePage, {
  release,
  ...extra,
}));

describe('ReleasePage load error', () => {
  test('a failed load shows the reason and a retry, not the skeleton', () => {
    const html = render(
      { ...base, _loadError: "Couldn't reach MusicBrainz. It may be down for a moment; try again in a few minutes." },
      { onRetryLoad: () => {} }
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Couldn&#x27;t reach MusicBrainz');
    expect(html).toContain('>Try again</button>');
    expect(html).not.toContain('track-skeleton');
    expect(html).not.toContain('animate-shimmer');
    expect(html).not.toContain('Loading...');
    expect(html).not.toContain('Loading track count');
  });

  test('without a retry handler the button is left out', () => {
    const html = render({ ...base, _loadError: 'MusicBrainz is busy right now. Try again in a minute.' });
    expect(html).toContain('MusicBrainz is busy');
    expect(html).not.toContain('Try Again');
  });

  test('a catalog track list names its source on the source card', () => {
    const html = render({
      ...base,
      tracks: [{ position: 1, title: 'Still Coming Down', length: 200000, mediumIndex: 1 }],
      _catalogSource: { resolverId: 'bandcamp', name: 'Bandcamp' }
    });
    // the source card (#1238) names the catalog the list came from — the old
    // "Track list from …" line is part of it now
    expect(html).toContain('title="Bandcamp">Bandcamp</span>');
    expect(html).not.toContain('Track list from');
    expect(render({ ...base, tracks: [] })).not.toContain('Track list from');
  });

  test('still loading shows the skeleton, the track count included', () => {
    const html = render(base);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('animate-shimmer');
    // the left rail's track count is a shimmer bar, not "Loading..." text
    expect(html).not.toContain('Loading...');
    expect(html).toContain('aria-label="Loading track count"');
  });
});
