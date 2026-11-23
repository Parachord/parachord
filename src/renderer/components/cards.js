// src/renderer/components/cards.js — the card family, extracted from app.js's
// module scope (maintainability plan Track 2b, presentational slice 3).
//
// Presentational cards for artists/albums/releases across search, collection
// and artist pages. All props-driven (getAlbumArt / getArtistImage /
// navigation callbacks arrive via props); no app state. generateArtistPattern
// (the artist-name fuzzy matcher the artist cards use for search-space
// filtering) moves with its pre-component consumers and is exported back to
// app.js for the in-component call sites; PlayTop10Icon is
// cards-only (the playtop-10 / queue-top-10 affordances).
const { ResolverIcon, PlaybackProgress, ShareButton } = require('./ui-atoms');
const { transition } = require('../lib/motion');
const { TrackRow, TrackRowSkeleton } = require('./track-lists');
const { AlbumCard } = require('./album-card');
const { useReveal, ArtOverlay } = require('./card-art');
const Icons = require('./icons');
const { EmptyState, ErrorState } = require('./states');
const { Menu } = require('./menu');
const { CardButton } = require('./card-button');
const { OptionTile } = require('./option-tile');
const { artistMenu } = require('../lib/item-menus');
const { Play } = Icons;
// hashString is exported back so app.js's own call sites keep the same
// binding (generateArtistPattern, now lib/artist-pattern.js, has its own).
const hashString = require('../lib/hash-string');
const { trackSlug, slug } = require('../lib/track-slug');
// A compilation's tracks under their own artists (lib/album-track-artist.js).
const { playableAlbumTrack, hasTrackArtists, isVariousArtists } = require('../lib/album-track-artist');
const { formatCalendarDate } = require('../lib/calendar-date');
const { normalizeAlbumTitle, albumVersionsKey } = require('../lib/album-catalog');
// A MusicBrainz country code as a readable name, for the source card's
// region ("DE" → "Germany"), the X-codes and the gone countries included.
const { regionName } = require('../lib/mb-region');

// Generate a unique pattern/gradient for an artist based on their name
// Returns an object with CSS gradient and optional SVG pattern
// Release-type badge colours, shared by the release cards and the release
// page (the filter chips use the same colours). The release page had EP and
// Single swapped (audit bug 4).
// The colours are lib/release-types.js (one palette for every badge and chip).
const { RELEASE_TYPE_COLORS } = require('../lib/release-types');
const RELEASE_BADGE_STYLES = Object.fromEntries(Object.entries(RELEASE_TYPE_COLORS)
  .map(([type, color]) => [type, { bg: `color-mix(in srgb, ${color} 8%, transparent)`, color }]));

const { generateArtistPattern } = require('../lib/artist-pattern');

// Custom PlayTop10Icon - Play button with "10" badge for artist top tracks
// Play Top 10's icon lives in icons.js (Icons.PlayTop10); exported here as before.
const PlayTop10Icon = Icons.PlayTop10;

// Artist cards live in components/artist-card.js (ArtistCard).

// Search history item for empty search page
const SearchHistoryItem = ({ entry, onQueryClick, onResultClick, onRemove }) => {
  const { query, selectedResult, timestamp } = entry;

  // Click handler for the whole row - navigate to result if available, otherwise search
  const handleRowClick = () => {
    if (selectedResult) {
      onResultClick(selectedResult);
    } else {
      onQueryClick(query);
    }
  };

  return React.createElement(CardButton, { label: selectedResult ? selectedResult.name : `Search for ${query}`,
    className: 'flex items-center gap-3 p-3 rounded-lg hover:bg-surface-hover group transition-colors cursor-pointer',
    onActivate: handleRowClick
  },
    // Result thumbnail or search icon
    selectedResult?.imageUrl ?
      React.createElement('img', {
        src: selectedResult.imageUrl,
        className: 'w-12 h-12 rounded object-cover',
        onError: (e) => { e.target.style.display = 'none'; }
      }) :
      React.createElement('div', {
        className: 'w-12 h-12 rounded bg-surface-subtle flex items-center justify-center'
      },
        React.createElement(Icons.Search, { className: 'w-5 h-5 text-ink-tertiary' })
      ),

    // Query and result info
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('button', {
        onClick: (e) => { e.stopPropagation(); onQueryClick(query); },
        className: 'text-sm font-medium text-ink-primary hover:text-accent truncate block text-left w-full'
      }, `"${query}"`),
      selectedResult && React.createElement('button', {
        onClick: (e) => { e.stopPropagation(); onResultClick(selectedResult); },
        className: 'text-xs text-ink-secondary hover:text-accent truncate block text-left w-full'
      },
        `${selectedResult.type}: ${selectedResult.name}${selectedResult.artist ? ` • ${selectedResult.artist}` : ''}`
      )
    ),

    // Remove button
    React.createElement('button', {
      onClick: (e) => { e.stopPropagation(); onRemove(query); },
      className: 'opacity-0 group-hover:opacity-100 card-reveal p-1 text-ink-tertiary hover:text-ink-danger transition-opacity'
    },
      React.createElement(Icons.X, { className: 'w-4 h-4' })
    )
  );
};

// Album cards are components/album-card.js (AlbumCard).

// ReleaseCard component - Cinematic Light design
const ReleaseCard = ({ release, currentArtist, fetchReleaseData, onContextMenu, onHoverFetch, isVisible = true, animationDelay = 0, onPlay, onAddToQueue, onAddToPlaylist, prefetchedReleasesRef, onCardRef }) => {
  const year = release.date ? release.date.split('-')[0] : '';
  const [imageFailed, setImageFailed] = React.useState(false);
  // A fresh cover found after the cached one failed to load (see onArtError).
  const [replacementArt, setReplacementArt] = React.useState(null);
  const art = replacementArt || release.albumArt;

  // Reset image states when album art URL changes
  React.useEffect(() => {
    setImageFailed(false);
    setReplacementArt(null);
  }, [release.albumArt]);

  // The cached URL is dead (e.g. a Bandcamp cover the artist replaced): show
  // the placeholder, and swap in whatever the art pipeline finds on a retry.
  const onArtError = () => {
    setImageFailed(true);
    const report = globalThis.reportBrokenAlbumArt;
    const artistName = currentArtist?.name || release.artist?.name || (typeof release.artist === 'string' ? release.artist : null);
    if (!report) return;
    report(art, { artist: artistName, album: release.title, releaseId: release.id }).then((url) => {
      if (!url) return;
      setReplacementArt(url);
      setImageFailed(false);
    });
  };

  // The shared album card (components/album-card.js): the cover (a
  // placeholder when there is none, a shimmer while it is looked up), the
  // release-type badge, the year under the title, the overlay. It was a
  // <button> holding the overlay's buttons, which HTML doesn't allow.
  return React.createElement(AlbumCard, {
    album: { id: release.id, title: release.title, imageUrl: imageFailed ? null : art },
    imageLoading: art === undefined,
    releaseType: release.releaseType,
    subtitle: year,
    animationDelay,
    // A card the type filter hides stays mounted (its art and ref keep).
    hidden: !isVisible,
    cardRef: onCardRef,
    cardProps: { 'data-release-id': release.id },
    dragData: () => {
      const albumData = { type: 'album', album: {
        id: trackSlug(currentArtist?.name || release.artist?.name || 'unknown', release.title || 'untitled'),
        title: release.title,
        artist: currentArtist?.name || release.artist?.name,
        year: year ? parseInt(year) : null,
        art,
        trackCount: release.tracks?.length || null
      } };
      return albumData;
    },
    onOpen: () => fetchReleaseData(release, currentArtist),
    onContextMenu: () => { if (onContextMenu) onContextMenu(release); },
    onHoverPrefetch: onHoverFetch ? () => onHoverFetch(release) : undefined,
    onArtError,
    onPlay: onPlay ? () => onPlay(release) : undefined,
    onQueue: onAddToQueue ? () => onAddToQueue(release) : undefined,
    onAddToPlaylist: onAddToPlaylist ? () => onAddToPlaylist(release) : undefined
  });
};

// ── The album page's source picker (#1238) ──
// Which edition of the album the page shows, and the picker for another one.
// Two pieces, both built from the helpers just below: ReleasePage renders the
// CLOSED card (the source's badge and name on the first line, chevron right,
// then one line per detail: MusicBrainz edition, date, region, song count), and
// AlbumVersionsMenu is the OPEN panel under it ("Your services" editions,
// then "MusicBrainz editions").

// "18 songs" / "1 song": an edition's track count as a human count.
const songCount = (n) => `${n} ${n === 1 ? 'song' : 'songs'}`;

// "a · b · c" where a part may be a React element (the song-count shimmer):
// the separators go between the parts that are actually there.
const joinDetails = (parts) => parts.filter(Boolean).map((part, i) => React.createElement(
  React.Fragment, { key: `detail-${i}` }, i > 0 ? ' · ' : '', part
));

// A short shimmer bar standing in for one detail ("Nov 6, 2026", "12 songs")
// while it is looked up; sized to the text it replaces, on the dark panel.
const detailShimmer = (kind) => React.createElement('span', {
  key: `shimmer-${kind}`,
  className: 'inline-block rounded shimmer-light animate-shimmer align-middle',
  role: 'status',
  'aria-label': kind === 'date' ? 'Loading release date' : 'Loading track count',
  style: { width: kind === 'date' ? '4.5em' : '3.5em', height: '0.8em', backgroundSize: '200% 100%', opacity: 0.6 }
});

// A service's badge, row size: the resolver's colour with its white icon
// (the track-list badge kit, ui-atoms' ResolverIcon).
const editionServiceBadge = (resolverId, color, size = 18) => React.createElement('span', {
  style: {
    width: `${size}px`, height: `${size}px`, borderRadius: '4px', flexShrink: 0,
    backgroundColor: color || 'var(--fill-neutral)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
  }
}, React.createElement(ResolverIcon, { resolverId, size: Math.round(size * 0.66) }));

// MusicBrainz's badge is neutral — the service has no brand colour: a
// bordered box with the disc icon. onDark flips it for the open panel.
const editionMusicBrainzBadge = (size = 18, onDark = false) => React.createElement('span', {
  style: {
    width: `${size}px`, height: `${size}px`, borderRadius: '4px', flexShrink: 0,
    boxSizing: 'border-box',
    backgroundColor: onDark ? 'transparent' : 'var(--card-bg)',
    border: onDark ? '1px solid var(--on-color-border)' : '1px solid var(--border-default)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
  }
}, React.createElement(ResolverIcon, { resolverId: 'musicbrainz', size: Math.round(size * 0.66), fill: onDark ? 'var(--on-dark-secondary)' : 'var(--text-secondary)' }));

// The MusicBrainz edition list folds after this many rows behind a
// "N more editions" row — a busy classical group can have dozens, and an
// endless panel runs past the column.
const MB_EDITIONS_FOLD = 5;

// AlbumVersionsMenu — the open panel of the album page's source card
// (#1238): the OTHER editions of the album the page can show, in two
// sections: "Your services" (one row per service edition, grouped per
// service), then "MusicBrainz editions" (the release group's official
// releases). The panel keeps the dark dropdown style (var(--tooltip-bg)).
// All presentational, props-driven:
//   release: the release on screen (its id / _catalogSource mark the current
//             edition, its title disambiguates same-titled releases)
//   versions: the app's loaded list ({ loading, mb: { releases } | null,
//             catalogs: [{ resolverId, resolverName, albums }], failures:
//             [resolverId] }) — already keyed to this album by ReleasePage,
//             or null while it loads
//   resolvers: the resolver list (badge colors for the service rows)
//   onSelect(version): { kind: 'mb', release } | { kind: 'catalog',
//             resolverId, resolverName, album }
//   onClose:    close the dropdown after a pick
const AlbumVersionsMenu = ({ release, versions, resolvers = [], onSelect, onClose }) => {
  // The "N more editions" row expands in place; the menu unmounts with the
  // card, so the fold is back on the next open.
  const [showAllMbEditions, setShowAllMbEditions] = React.useState(false);

  // One edition row: its badge, the main line (the edition), the secondary
  // line (date · region · song count), and the check at the right when it is
  // the edition on screen — which is accent-tinted and doesn't re-click
  // (re-picking it would flash the skeleton for the same list).
  const versionRow = ({ current, badge, main, secondary, onPick, rowKey }) => React.createElement('button', {
    key: rowKey,
    onClick: (e) => {
      e.stopPropagation();
      if (current || !onPick) return;
      onPick();
      if (onClose) onClose();
    },
    className: `w-full px-3 py-1.5 text-left flex items-center gap-2 no-drag ${current ? 'cursor-default' : 'text-white hover:bg-white/10'}`,
    style: {
      fontSize: '12px', border: 'none',
      backgroundColor: current ? 'var(--accent-primary-alpha-10)' : 'transparent'
    }
  },
    badge,
    // The text wraps rather than truncating: the panel is only as wide as
    // the card (#1312), and a cut-off edition name or region hides exactly
    // what tells two editions apart.
    React.createElement('span', { className: 'min-w-0', style: { flex: '1 1 0', overflowWrap: 'anywhere' } },
      React.createElement('span', {
        className: 'block',
        style: { fontWeight: 500, color: current ? 'var(--accent-soft)' : 'var(--on-dark-primary)' }
      }, main),
      secondary && React.createElement('span', {
        className: 'block',
        style: { fontSize: '11px', color: 'var(--on-dark-tertiary)', marginTop: '1px' }
      }, secondary)
    ),
    current && React.createElement('span', {
      style: { flexShrink: 0, fontSize: '11px', color: 'var(--accent-soft)' }
    }, React.createElement(Icons.Check, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }))
  );
  const sectionHeader = (title, key) => React.createElement('div', {
    key,
    className: 'px-3 pt-2 pb-1',
    style: { fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--on-dark-tertiary)' }
  }, title);
  const shimmerRows = (key) => [0, 1].map((i) => React.createElement('div', {
    key: `${key}-shimmer-${i}`,
    className: 'flex items-center gap-2 px-3 py-2'
  },
    React.createElement('div', {
      className: 'rounded shimmer-light animate-shimmer',
      style: { width: '82%', height: '10px', backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
    })
  ));

  const mbCurrent = !release._catalogSource;
  const catalogSections = versions?.catalogs || [];
  // Nothing to pick: the list settled and no source contributed a section (a
  // MusicBrainz part that is still pending, or an absent one, is not
  // "nothing" — and a list that never loaded isn't either). A part that
  // FAILED isn't an answer either: the panel can't say there are no other
  // versions when it never heard back, so the retry hint below speaks instead.
  const anyFailed = !!versions && (!!versions.mb?.failed || (versions.failures || []).length > 0);
  const nothingLoaded = !!versions && !versions.loading && !anyFailed
    && (!versions.mb || (versions.mb.releases || []).length === 0)
    && catalogSections.length === 0;

  // Your services: one row per service edition, grouped per service (the app
  // answers in the user's priority order). A service with ONE edition names
  // itself on the row; with several (Standard / Deluxe / …) each row names
  // its own edition, or every row would read the same.
  const servicesRows = [];
  catalogSections.forEach((section) => {
    const color = resolvers.find(r => r.id === section.resolverId)?.color || 'var(--fill-neutral)';
    section.albums.forEach((album, i) => {
      const isCurrent = release._catalogSource?.resolverId === section.resolverId
        && release._catalogSource?.url && release._catalogSource.url === album.url;
      // Every row shows its date and song count (#1312). A service whose
      // album search carries neither gets them from a lookup the app runs
      // when the menu opens (detailsPending): a shimmer stands in meanwhile.
      // Apple answers full timestamps — the date is the first ten chars.
      const date = formatCalendarDate(album.releaseDate?.slice(0, 10), 'short', '');
      const secondaryParts = [
        date || (album.detailsPending ? detailShimmer('date') : null),
        album.trackCount ? songCount(album.trackCount) : (album.detailsPending ? detailShimmer('count') : null)
      ];
      const secondary = secondaryParts.some(Boolean) ? joinDetails(secondaryParts) : '';
      servicesRows.push(versionRow({
        current: isCurrent,
        badge: editionServiceBadge(section.resolverId, color),
        main: section.albums.length === 1 ? (section.resolverName || section.resolverId) : album.name,
        secondary,
        onPick: () => onSelect && onSelect({ kind: 'catalog', resolverId: section.resolverId, resolverName: section.resolverName, album }),
        rowKey: `catalog-${section.resolverId}-${album.id || i}`
      }));
    });
  });
  // While the searches are out and none has answered yet the section is a
  // shimmer stand-in; settled with nothing, it is simply absent (a service
  // that doesn't carry the album isn't news). The section only exists when
  // there are candidate services to ask at all (versions.serviceCount — the
  // entry's count; a user with no album-search service must not see a
  // shimmering "Your services" header that can never fill).
  const hasServices = catalogSections.length > 0 || (versions?.serviceCount || 0) > 0;
  const servicesSection = hasServices && (catalogSections.length > 0 || (versions && versions.loading))
    ? [
        sectionHeader('Your services', 'services-header'),
        ...servicesRows,
        ...(versions && versions.loading && catalogSections.length === 0 ? shimmerRows('services') : [])
      ]
    : [];

  // MusicBrainz: the group's official releases. The row's main line is the
  // disambiguation when there is one, else the release's own title when it
  // differs from the album's, else the formats — most releases share the
  // album's title, so the formats tell editions apart. mb.releases === null
  // is the part still on its way (shimmer under the header).
  let mbSection = [];
  if (versions?.mb) {
    if (!versions.mb.releases) {
      mbSection = [sectionHeader('MusicBrainz editions', 'mb-header'), ...shimmerRows('mb')];
    } else if (versions.mb.releases.length > 0) {
      const editions = versions.mb.releases.map((row) => {
        const isCurrent = mbCurrent && release.id === row.id;
        const formats = row.formats && row.formats.length ? row.formats.join(' + ') : null;
        const differingTitle = row.title && normalizeAlbumTitle(row.title) !== normalizeAlbumTitle(release.title) ? row.title : null;
        const main = row.disambiguation || differingTitle || formats || 'Release';
        const secondary = [
          formatCalendarDate(row.date, 'short', ''),
          regionName(row.country),
          row.trackCount ? songCount(row.trackCount) : null
        ].filter(Boolean).join(' · ');
        return { row, isCurrent, main, secondary };
      });
      // Two rows identical line-for-line get the first track's title
      // appended (summary.firstTrack when the browse carried recordings):
      // it tells two same-format same-day editions apart — the classic case
      // is a pair of disc-at-a-time CD releases with no disambiguation.
      const lineCounts = {};
      editions.forEach((edition) => {
        const k = `${edition.main} ¤ ${edition.secondary}`;
        lineCounts[k] = (lineCounts[k] || 0) + 1;
      });
      editions.forEach((edition) => {
        const k = `${edition.main} ¤ ${edition.secondary}`;
        if (lineCounts[k] > 1 && edition.row.firstTrack) {
          edition.secondary = [edition.secondary, edition.row.firstTrack].filter(Boolean).join(' · ');
        }
      });
      // The fold keeps the first few rows — and always the CURRENT edition
      // (the accent row is the user's orientation cue; it must not hide
      // behind the fold). The count on the fold row is what stays hidden.
      const first = editions.slice(0, MB_EDITIONS_FOLD);
      const currentBeyondFold = (!showAllMbEditions && editions.length > MB_EDITIONS_FOLD)
        ? editions.slice(MB_EDITIONS_FOLD).find(e => e.isCurrent) || null
        : null;
      const rows = showAllMbEditions
        ? editions
        : (currentBeyondFold ? [...first, currentBeyondFold] : first);
      const hiddenCount = editions.length - rows.length;
      mbSection = [
        sectionHeader('MusicBrainz editions', 'mb-header'),
        ...rows.map((edition) => versionRow({
          current: edition.isCurrent,
          badge: editionMusicBrainzBadge(18, true),
          main: edition.main,
          secondary: edition.secondary,
          onPick: () => onSelect && onSelect({ kind: 'mb', release: edition.row }),
          rowKey: `mb-${edition.row.id}`
        })),
        ...(!showAllMbEditions && hiddenCount > 0
          ? [React.createElement('button', {
              key: 'mb-more-editions',
              onClick: (e) => { e.stopPropagation(); setShowAllMbEditions(true); },
              className: 'w-full px-3 py-1.5 text-left no-drag text-white hover:bg-white/10',
              style: { fontSize: '11px', border: 'none', backgroundColor: 'transparent', color: 'var(--on-dark-tertiary)' }
            }, `${hiddenCount} more ${hiddenCount === 1 ? 'edition' : 'editions'}`)]
          : [])
      ];
    }
  }

  // A list that never loaded for this key (the state update hasn't landed,
  // or the page changed under the open dropdown) is shimmer alone — no
  // headers for parts that may not exist. A PARTIAL retry (a failed service
  // re-running under answered sections) gets a shimmer footer under them.
  const pendingShimmer = !versions
    ? shimmerRows('pending')
    : (versions.loading && (catalogSections.length > 0 || (versions.mb && versions.mb.releases)) ? shimmerRows('more') : []);

  const emptyNote = nothingLoaded
    ? [React.createElement(EmptyState, {
        key: 'no-versions', tone: 'dark', compact: true, icon: null,
        title: 'No other editions',
        body: 'MusicBrainz and your services have no other edition of this album.'
      })]
    : [];

  // Searches that failed or timed out (versions.failures, or a failed
  // MusicBrainz browse, mb.failed): shimmer covered them while loading; once
  // settled, a quiet hint — reopening retries them (openAlbumVersions retries
  // a failed part on the next open).
  const failuresNote = versions && !versions.loading && anyFailed
    ? [React.createElement('div', {
        key: 'failures-hint',
        className: 'px-3 py-1.5',
        style: { fontSize: '11px', color: 'var(--on-dark-tertiary)' }
      }, "Some services didn't answer — reopen to retry")]
    : [];

  return React.createElement('div', {
    // The editions panel: its clicks stay in it.
    role: 'dialog', 'aria-label': 'Other editions',
    className: 'absolute left-0 top-full mt-1 rounded-lg py-1 z-30 no-drag scrollable-content',
    style: {
      backgroundColor: 'var(--tooltip-bg)',
      boxShadow: 'var(--shadow-popover)',
      // The card's own width (#1312): the album column hides anything wider
      // (overflow-x: hidden), so a 280px panel under a 160-192px card had
      // its right side cut off. Rows wrap instead (versionRow).
      width: '100%', maxHeight: '320px',
      overflowY: 'auto', overflowX: 'hidden'
    },
    onClick: (e) => e.stopPropagation()
  },
    ...servicesSection,
    ...mbSection,
    ...pendingShimmer,
    ...emptyNote,
    ...failuresNote
  );
};

// ReleasePage component - Shows full album/EP/single with tracklist
const ReleasePage = ({
  release,
  handlePlay,
  onTrackPlay,
  onTrackContextMenu,
  trackSources = {},
  resolvers = [],
  activeResolvers = [],
  // Drag and drop props (for adding tracks to playlists)
  onDragStart,
  onDragEnd,
  // Now playing props
  currentTrack,
  playbackContext,
  isPlaying,
  // Visibility tracking props for resolution scheduler
  releaseTrackRowRefs,
  releaseObserverRef,
  // Album action props (hover buttons)
  onAlbumPlay,
  onAlbumAddToQueue,
  onAlbumAddToPlaylist,
  onAlbumContextMenu,
  // Opens a track's artist from a compilation's artist column.
  onOpenArtist,
  publishCollectionSmartLink,
  copyCollectionEmbedCode,
  // The album source dropdown (#1238): the editions of this album (the
  // MusicBrainz release group's releases and the resolvers' editions).
  // albumVersions is the app's loaded list (keyed by the album — artist +
  // title, the sameAlbumIdentity key); onOpenAlbumVersions loads it lazily
  // when the dropdown opens; onSelectAlbumVersion switches the page.
  albumVersions,
  onOpenAlbumVersions,
  onSelectAlbumVersion,
  // A load that failed (release._loadError) offers a retry
  onRetryLoad
}) => {
  // A fresh cover found after the cached one failed to load (header image onError).
  const [replacementArt, setReplacementArt] = React.useState(null);
  React.useEffect(() => { setReplacementArt(null); }, [release.albumArt]);
  // A compilation's tracklist names each track's artist (2026-11-23). Before
  // the tracks land, the skeleton takes the column when the album is credited
  // to Various Artists, so the rows that replace it don't shift.
  const showTrackArtists = hasTrackArtists(release.tracks);
  const compilationLayout = isVariousArtists(release.artist);
  const headerArt = replacementArt || release.albumArt;

  // The cover's actions show on hover or keyboard focus (card-art useReveal).
  const coverReveal = useReveal();

  // Use a ref to track container width for responsive layout
  const [containerWidth, setContainerWidth] = React.useState(800);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // ── The album source dropdown (#1238) ──
  // Which edition of this album the page shows: another official release of
  // the MusicBrainz release group, or an edition one of the user's services
  // carries. Opens lazily (onOpenAlbumVersions loads the list), one dropdown
  // at a time with Share, and closes on an outside click like Share does.
  const [sourceOpen, setSourceOpen] = React.useState(false);
  React.useEffect(() => {
    if (!sourceOpen) return undefined;
    const close = () => setSourceOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [sourceOpen]);

  // The loaded list belongs to this album and this release group only (the
  // app keys it that way, albumVersionsKey). A page that changes key under
  // the open dropdown — another album, or the same album learning its group
  // id mid-load — closes it, so a stale list never renders and the reopen
  // loads the right one.
  const versionsKey = albumVersionsKey(release);
  React.useEffect(() => { setSourceOpen(false); }, [versionsKey]);
  const versions = (albumVersions && versionsKey && albumVersions.key === versionsKey) ? albumVersions : null;
  const toggleSourceOpen = (e) => {
    e.stopPropagation();
    const next = !sourceOpen;
    setSourceOpen(next);
    if (next && onOpenAlbumVersions) onOpenAlbumVersions();
  };
  // ── The closed source card's content (#1238, #1312) ──
  // The top line is only the source: its badge and name. Each of the
  // edition's details is its own line under it, so nothing is cut off at the
  // card's width: the MusicBrainz edition (its formats, "Digital Media"),
  // the date, the region (MusicBrainz releases have one, catalog ones
  // don't) and the song count, a shimmer bar while the track list is still
  // on its way and left out when its load failed. The date goes through
  // formatCalendarDate: it's a calendar date, and new Date("2026-11-06") is
  // still November 5 in the Americas (#1288).
  const catalogSource = release._catalogSource || null;
  const sourceLine = catalogSource ? catalogSource.name : 'MusicBrainz';
  const sourceBadge = catalogSource
    ? editionServiceBadge(catalogSource.resolverId, resolvers.find(r => r.id === catalogSource.resolverId)?.color)
    : editionMusicBrainzBadge();
  const editionLines = [
    !catalogSource && release.formats && release.formats.length ? release.formats.join(' + ') : null,
    formatCalendarDate(release.date, 'short', ''),
    regionName(release.country),
    release.tracks
      ? songCount(release.tracks.length)
      : (release._loadError ? null : React.createElement('span', {
          className: 'inline-block rounded shimmer-light animate-shimmer align-middle',
          role: 'status',
          'aria-label': 'Loading track count',
          style: { width: '4rem', height: '0.8em', backgroundSize: '200% 100%' }
        }))
  ].filter(Boolean);

  // Responsive sizes based on container width
  const isCompact = containerWidth < 700;
  const albumArtSize = isCompact ? 160 : 192; // 160px or 192px (w-40 or w-48)
  const columnWidth = isCompact ? 180 : 240;

  return React.createElement('div', { ref: containerRef, className: 'flex gap-0 pl-6', style: { flex: 1, minHeight: 0 } },
    // LEFT COLUMN: Album card - matching ReleaseCard styling
    (() => {
      const year = release.date ? release.date.split('-')[0] : '';
      const badgeStyles = RELEASE_BADGE_STYLES;
      const releaseType = release.releaseType || 'album';
      const badge = badgeStyles[releaseType] || badgeStyles.album;

      return React.createElement('div', {
        className: 'flex-shrink-0 pr-4 md:pr-8 pt-6 pb-6 scrollable-content',
        style: {
          width: `${columnWidth}px`,
          transition: transition('width', 'slow'),
          overflowY: 'auto',
          overflowX: 'hidden'
        }
      },
        // Card wrapper - matching ReleaseCard styling
        React.createElement('div', {
          draggable: true,
          onDragStart: (e) => {
            e.dataTransfer.effectAllowed = 'copy';
            const albumData = {
              type: 'album',
              album: {
                id: trackSlug(release.artist?.name || 'unknown', release.title || 'untitled'),
                title: release.title,
                artist: release.artist?.name,
                year: year ? parseInt(year) : null,
                art: release.albumArt,
                trackCount: release.tracks?.length || null
              }
            };
            e.dataTransfer.setData('text/plain', JSON.stringify(albumData));
          },
          className: 'no-drag cursor-grab active:cursor-grabbing',
          style: {
            width: `${albumArtSize}px`,
            backgroundColor: 'var(--card-bg)',
            borderRadius: '10px',
            padding: '10px',
            boxShadow: 'var(--card-shadow)',
            transition: transition('width', 'slow')
          },
          onContextMenu: onAlbumContextMenu ? (e) => {
            e.preventDefault();
            onAlbumContextMenu(release);
          } : undefined
        },
          // Album art container
          React.createElement('div', Object.assign({
            className: 'album-art-container',
            style: {
              width: '100%',
              aspectRatio: '1',
              borderRadius: '6px',
              background: 'var(--placeholder-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '10px',
              overflow: 'hidden',
              position: 'relative'
            }
          }, coverReveal.props),
            // Image (absolute positioned, fades in on load, hides on error)
            headerArt && React.createElement('img', {
              key: headerArt,
              src: headerArt,
              alt: release.title,
              style: {
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                pointerEvents: 'none',
                position: 'absolute',
                top: 0,
                left: 0,
                opacity: 0,
                transition: transition('opacity', 'slow', 'out')
              },
              ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
              onLoad: (e) => { e.target.style.opacity = '1'; },
              onError: (e) => {
                e.target.style.display = 'none';
                // A dead cached URL: retry the art pipeline once (lib/broken-art.js).
                const report = globalThis.reportBrokenAlbumArt;
                const artistName = release.artist?.name || (typeof release.artist === 'string' ? release.artist : null);
                if (report) report(headerArt, { artist: artistName, album: release.title, releaseId: release.id }).then((url) => { if (url) setReplacementArt(url); });
              }
            }),
            // Placeholder icon (always behind)
            React.createElement(Icons.Music, { style: {
                width: '36px',
                height: '36px',
                color: 'var(--text-tertiary)',
                pointerEvents: 'none'
              }, strokeWidth: 1.5 }),

            // The app's art overlay (card-art ArtOverlay): Add to playlist,
            // Play, Add to queue, on hover or keyboard focus.
            (onAlbumPlay || onAlbumAddToQueue || onAlbumAddToPlaylist) && React.createElement(ArtOverlay, {
              shown: coverReveal.shown,
              title: release.title,
              onAddToPlaylist: onAlbumAddToPlaylist ? () => onAlbumAddToPlaylist(release) : undefined,
              onPlay: onAlbumPlay ? () => onAlbumPlay(release) : undefined,
              onQueue: onAlbumAddToQueue ? () => onAlbumAddToQueue(release) : undefined
            })
          ),

          // The title, up to two lines (it was cut off beside the badge in
          // the narrow column), then the release-type badge under it
          // (#1238): the source card below carries the year, and "Album"
          // isn't worth a badge; only Live, EP, Single and Compilation say
          // what they are. The badge's class draws the capitals.
          React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', marginBottom: '3px', pointerEvents: 'none' }
          },
            React.createElement('h3', {
              style: {
                fontWeight: 500,
                fontSize: '13px',
                lineHeight: '1.4',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                color: 'var(--text-primary)',
                letterSpacing: '0.005em'
              },
              'data-tooltip': release.title
            }, release.title),
            releaseType !== 'album' && React.createElement('span', {
              className: 'release-badge',
              style: { backgroundColor: badge.bg, color: badge.color }
            }, releaseType === 'ep' ? 'EP' : releaseType)
          )
        ),

        // The source card and Share, below the album card. The card carries
        // the edition's details that the old metadata lines did (the date,
        // the region, the song count, which catalog the track list came
        // from) — and opens the edition picker (#1238).
        React.createElement('div', { className: 'mt-3', style: { paddingLeft: '2px' } },
          // Album source card (#1238): pick another edition of this album —
          // another official release of the MusicBrainz release group, or an
          // edition one of the user's services carries. Sits above Share.
          React.createElement('div', { className: 'relative', style: { width: `${albumArtSize}px`, transition: transition('width', 'slow') } },
            React.createElement(OptionTile, {
              compact: true,
              onClick: toggleSourceOpen,
              'aria-expanded': sourceOpen,
              'data-tooltip': 'Pick another edition of this album (MusicBrainz releases, or an edition your services carry)'
            },
              // First line: the source's badge and name, chevron at the right
              React.createElement('span', {
                style: { display: 'flex', alignItems: 'center', gap: '7px' }
              },
                sourceBadge,
                React.createElement('span', {
                  className: 'block truncate',
                  style: { flex: '1 1 0', minWidth: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' },
                  title: sourceLine
                }, sourceLine),
                React.createElement('span', {
                  style: { fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0 }
                }, sourceOpen ? React.createElement(Icons.ChevronUp, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }) : React.createElement(Icons.ChevronDown, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }))
              ),
              // Then one line per detail, aligned under the name
              ...editionLines.map((line, i) => React.createElement('span', {
                key: `edition-line-${i}`,
                className: 'block truncate',
                style: {
                  marginTop: i === 0 ? '3px' : '1px', marginLeft: '25px',
                  fontSize: '12px', lineHeight: '17px', color: 'var(--text-secondary)'
                },
                title: typeof line === 'string' ? line : undefined
              }, line))
            ),
            sourceOpen && React.createElement(AlbumVersionsMenu, {
              release,
              versions,
              resolvers,
              onSelect: onSelectAlbumVersion,
              onClose: () => setSourceOpen(false)
            })
          ),

          // Share button
          React.createElement('div', { className: 'relative mt-5 flex justify-start', style: { width: `${albumArtSize}px` } },
            // Share menu (components/menu.js).
            React.createElement(Menu, {
              label: 'Share',
              renderTrigger: (t) => React.createElement(ShareButton, Object.assign({}, t, {
                onClick: (ev) => { setSourceOpen(false); t.onClick(ev); },
              })),
              items: (() => {
                // What Copy link and View on Achordion both send.
                const albumLink = () => {
                  // Harvest any available MBID. release.id is typically the
                  // release-group MBID for MB-derived discography; for Spotify
                  // / Apple Music fallback paths it's prefixed (e.g.
                  // "spotify-..."), so rely on the UUID-shape check inside
                  // publishCollectionSmartLink to gate validity. The release
                  // group comes first: once MusicBrainz's list loads,
                  // release.id is a release, and Achordion doesn't map a
                  // release to its group (the link would 404).
                  const albumMbid = release.releaseGroupMbid
                    || release.mbid
                    || release.id
                    || release.tracks?.[0]?.releaseMbid
                    || null;
                  return {
                    title: release.title,
                    artist: release.artist?.name || release.artist,
                    albumArt: release.albumArt,
                    type: 'album',
                    mbid: albumMbid,
                    tracks: (release.tracks || []).map((t, i) => ({
                      title: t.title || 'Unknown',
                      artist: t.artist || release.artist?.name || null,
                      duration: t.duration || null,
                      trackNumber: t.trackNumber || (i + 1)
                    }))
                  };
                };
                return [{
                  key: 'copy-link',
                  label: 'Copy link',
                  icon: React.createElement(Icons.Link, { size: 16 }),
                  onSelect: () => publishCollectionSmartLink(albumLink()),
                }, {
                  key: 'view-on-achordion',
                  label: 'View on Achordion',
                  icon: React.createElement(Icons.ExternalLink, { size: 16 }),
                  onSelect: () => publishCollectionSmartLink(albumLink(), { openInBrowser: true }),
                }];
              })(),
            })
          )
        )
      );
    })(),

    // RIGHT COLUMN: Tracklist. It carries the right and bottom padding itself
    // (the wrapper has only the left), so its scrollbar sits at the window edge.
    React.createElement('div', { className: 'flex-1 min-w-0 pt-6 pr-6 pb-6 scrollable-content', style: { overflowY: 'auto' } },
      // A load that failed: the reason and a retry, in place of the skeleton
      !release.tracks && release._loadError ? React.createElement(ErrorState, { align: 'start', compact: true, title: 'Couldn’t load this album’s tracks', body: release._loadError, onRetry: onRetryLoad || undefined }) :
      // Show skeleton while tracks are loading
      !release.tracks ? React.createElement('div', { className: 'space-y-0' },
        [75, 60, 85, 55, 70, 80, 50, 65, 90, 58].map((width, i) =>
          // An album credited to Various Artists will have an artist column.
          React.createElement(TrackRowSkeleton, { key: `track-skeleton-${i}`, index: i, duration: true, showArtist: compilationLayout })
        )
      ) :
      release.tracks.length > 0 ?
        React.createElement('div', { role: 'list', className: 'space-y-0' },
          release.tracks.map((track, index) => {
            // The track as it plays, drags and resolves: a compilation's
            // track under its own artist (lib/album-track-artist.js), and its
            // id the one its resolved sources are kept under.
            const albumTrack = playableAlbumTrack(track, { albumArtist: release.artist.name, album: release.title, albumArt: release.albumArt });
            const trackId = albumTrack.id;
            const sources = trackSources[trackId] || {};
            const trackForDrag = { ...albumTrack, sources };

            // Check if this track is currently playing from this album
            const isCurrentTrack = currentTrack?.id === trackId;
            const isNowPlaying = isCurrentTrack && playbackContext?.type === 'album' && playbackContext?.id === release.id;

            return React.createElement(TrackRow, {
              role: 'listitem',
              key: index,
              label: track.title,
              // MusicBrainz's length (ms) first, then the resolved sources'.
              track: { ...trackForDrag, duration: track.length ? track.length / 1000 : null },
              number: String(track.position).padStart(2, '0'),
              isNowPlaying,
              sources: { trackSources, playbackResolvers: activeResolvers, resolverOrder: resolvers.map(r => r.id) },
              allResolvers: resolvers,
              // A compilation's tracks each name their artist; an album by
              // one artist doesn't repeat it on every row.
              showArtist: showTrackArtists,
              onOpenArtist: showTrackArtists && onOpenArtist ? onOpenArtist : undefined,
              duration: true,
              // No flash of "unavailable" before the lookup finishes.
              dimResolving: false,
              rowRef: (el) => {
                if (!releaseTrackRowRefs) return;
                if (el) {
                  releaseTrackRowRefs.current.set(trackId, el);
                  if (releaseObserverRef?.current) releaseObserverRef.current.observe(el);
                } else {
                  releaseTrackRowRefs.current.delete(trackId);
                }
              },
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track: trackForDrag }));
                if (onDragStart) onDragStart(trackForDrag);
              },
              onDragEnd: () => { if (onDragEnd) onDragEnd(); },
              // Play it, resolved or not: a row the page hasn't resolved yet
              // resolves on demand in handlePlay, in the priority lane.
              onPlay: (resolverId) => {
                const toPlay = resolverId ? { ...trackForDrag, preferredResolver: resolverId } : trackForDrag;
                const tracksAfter = release.tracks.slice(index + 1).map((t) => {
                  const next = playableAlbumTrack(t, { albumArtist: release.artist.name, album: release.title, albumArt: release.albumArt });
                  return { ...next, sources: trackSources[next.id] || {} };
                });
                if (onTrackPlay) onTrackPlay(toPlay, tracksAfter);
                else handlePlay(toPlay);
              },
              onContextMenu: () => { if (onTrackContextMenu) onTrackContextMenu(trackForDrag); }
            });
          })
        )
      :
        React.createElement(EmptyState, {
          title: 'No tracklist for this album',
          body: 'Its tracks couldn’t be found.'
        })
    )
  );
};

module.exports = {
  RELEASE_BADGE_STYLES,
  generateArtistPattern,
  PlayTop10Icon,
  SearchHistoryItem,
  AlbumVersionsMenu,
  ReleaseCard,
  ReleasePage,
};
