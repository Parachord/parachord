/**
 * docs/DESIGN_SYSTEM.md names every shared component, so a new one can't ship
 * undocumented (the doc fell behind the 2026-11-15 consolidation: it still
 * described the old TrackRow and ReleaseCard and named none of the new cards).
 */
global.React = require('react');
global.ReactVirtual = global.ReactVirtual || {};
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const doc = fs.readFileSync(path.join(ROOT, 'docs/DESIGN_SYSTEM.md'), 'utf8');

const SHARED = {
  'album-card': ['AlbumCard', 'AlbumRankBadge'],
  'playlist-card': ['PlaylistCard'],
  'artist-card': ['ArtistCard', 'RankBadge'],
  'listener-card': ['ListenerCard'],
  'card-art': ['ArtOverlay', 'useReveal', 'ArtBox'],
  'card-button': ['CardButton'],
  'track-lists': ['TrackRow', 'TrackRowSkeleton', 'TrackSources', 'SourceIconButton', 'VirtualizedQueueList', 'VirtualizedTrackList'],
  'home-skeletons': ['CardSkeleton', 'CardRowSkeleton'],
  'page-hero': ['PageHero'],
  'filter-box': ['FilterBox', 'StickyBar'],
  'filter-chips': ['FilterChips', 'Chip'],
  'section-header': ['SectionHeader'],
  'hero-tabs': ['HeroTabs'],
  'header-control': ['HeaderControl'],
  'badge': ['Badge'],
  'button': ['Button'],
  'modal': ['Modal'],
  'menu': ['Menu'],
  'sort-menu': ['SortMenu'],
  'states': ['EmptyState', 'ErrorState'],
  'reason-badge': ['ReasonBadge'],
};

test.each(Object.entries(SHARED))('%s: every shared export is exported and documented', (mod, names) => {
  const exported = require(path.join(ROOT, 'src/renderer/components', mod));
  for (const name of names) {
    expect([mod, name, name in exported]).toEqual([mod, name, true]);
    expect([name, new RegExp(`\`${name}\``).test(doc)]).toEqual([name, true]);
  }
});

test('the doc lists the icon set as icons.js has it', () => {
  const Icons = require(path.join(ROOT, 'src/renderer/components/icons'));
  for (const name of Icons.ICON_NAMES) expect([name, doc.includes(name)]).toEqual([name, true]);
});

test('the doc names the layers and props the shared pieces rely on', () => {
  expect(doc).toContain('`--z-scroll-edge`');
  expect(doc).toContain('`hidden` for a card a filter hides');
  expect(doc).toContain('`.source-quiet`');
});

test('the doc no longer describes the old copies', () => {
  expect(doc).not.toMatch(/Nothing renders `TrackRow`/);
  expect(doc).not.toMatch(/CollectionAlbumCard|RelatedArtistCard|SearchArtistCard|CollectionArtistCard/);
});
