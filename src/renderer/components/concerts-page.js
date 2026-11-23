// src/renderer/components/concerts-page.js: the Concerts page (activeView
// 'concerts'): upcoming shows from artists in the Collection, filtered by
// ticket source, a location and radius, and the filter box (#1451, moved
// out of app.js).
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters and refs by value, plain functions through useStableHandlers
// (CONCERTS_PAGE_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was; window is read only inside handlers.

const Icons = require('./icons');
const { Chip, FilterChips } = require('./filter-chips');
const { FilterBox } = require('./filter-box');
const { PageHero } = require('./page-hero');
const { PAGE_COLORS, pageTint } = require('../lib/page-colors');
const { TicketsButton } = require('./tickets-button');
const { ConcertListSkeleton } = require('./concert-skeletons');
const { Button } = require('./button');
const { ListRow } = require('./list-row');
const { Slider, TextField } = require('./fields');
const { EmptyState, ErrorState } = require('./states');
const { SellerBadges } = require('./seller-badges');
const { concertMatchesSource, concertSourceKeys, venueMatchesLocationText } = require('../lib/concert-events');

const CONCERTS_PAGE_HANDLERS = [
  'copyParachordLink',
  'fetchArtistData',
  'geocodeLocation',
  'getBrowserGeolocation',
  'handleConcertsScroll',
  'haversineDistance',
  'loadConcerts',
  'navigateTo',
  'reverseGeocode',
  'searchLocationSuggestions',
];

const ConcertsPage = React.memo(function ConcertsPage(props) {
  const {
    cacheLoaded,
    concerts,
    concertsArtistImages,
    concertsError,
    concertsGeocodingLoading,
    concertsHeaderCollapsed,
    concertsLoaded,
    concertsLoading,
    concertsLocation,
    concertsLocationCoords,
    concertsLocationOpen,
    concertsLocationRadius,
    concertsLocationSearchTimer,
    concertsLocationSuggestions,
    concertsSearch,
    concertsSearchOpen,
    concertsSourceFilter,
    copyParachordLink,
    fetchArtistData,
    geocodeLocation,
    getBrowserGeolocation,
    handleConcertsScroll,
    haversineDistance,
    loadConcerts,
    navigateTo,
    pendingProtocolTabRef,
    resolverLoaderRef,
    reverseGeocode,
    searchLocationSuggestions,
    setConcertsGeocodingLoading,
    setConcertsLocation,
    setConcertsLocationCoords,
    setConcertsLocationOpen,
    setConcertsLocationRadius,
    setConcertsLocationSuggestions,
    setConcertsSearch,
    setConcertsSearchOpen,
    setConcertsSourceFilter,
    setSettingsTab,
    showToast,
  } = props;

          // Pre-compute filtered count so the header reflects active filters
          const _searchL = concertsSearch.toLowerCase().trim();
          const _locL = concertsLocation.toLowerCase().trim();
          const filteredConcertsCount = concerts.filter(event => {
            if (!concertMatchesSource(event, concertsSourceFilter)) return false;
            if (concertsLocationCoords) {
              const vLat = event.venue?.latitude, vLng = event.venue?.longitude;
              if (vLat != null && vLng != null) {
                if (haversineDistance(concertsLocationCoords.lat, concertsLocationCoords.lng, vLat, vLng) > concertsLocationRadius) return false;
              } else {
                if (!venueMatchesLocationText(event.venue, _locL)) return false;
              }
            } else if (_locL) {
              if (!venueMatchesLocationText(event.venue, _locL)) return false;
            }
            if (_searchL) {
              const m = [event.artist, ...(event.lineup || []), event.venue?.name, event.venue?.city, event.title]
                .some(s => s && s.toLowerCase().includes(_searchL));
              if (!m) return false;
            }
            return true;
          }).length;
          return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Header section (outside scrollable area)
          React.createElement(PageHero, {
collapsed: concertsHeaderCollapsed,
page: 'concerts',
title: 'Concerts',
onTitleContextMenu: copyParachordLink,
expanded: React.createElement(React.Fragment, null,
React.createElement('div', {
                  className: 'flex items-center gap-1 mt-6',
                  style: { textShadow: 'var(--hero-text-shadow-line)' }
                },
                  React.createElement('span', {
                    className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white'
                  }, filteredConcertsCount > 0 ? `${filteredConcertsCount} Upcoming Shows` : '')
                ),
React.createElement('p', {
                  className: 'mt-2 text-white/80 text-sm'
                }, 'Upcoming concerts from artists you love')),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement('div', { className: 'flex-1' }),
React.createElement('span', {
                  className: 'text-sm font-medium uppercase tracking-wider text-white/80'
                }, filteredConcertsCount > 0 ? `${filteredConcertsCount} Upcoming Shows` : ''))
}),
          // Filter bar (outside scrollable area)
          (() => {
            return React.createElement('div', {
            className: 'flex items-center px-6 py-3',
            style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Source filter: the app's filter chips (FilterChips), as on Home
            // and Recommendations. All neutral; each service that lists a show
            // (including those merged into another service's row, its
            // ticketSources, lib/concert-events.js) in its plugin's colour.
            (() => {
              // Read at render; the call site passes _allResolvers and
              // _metaServices so this re-renders once the plug-ins load.
              const allResolvers = resolverLoaderRef.current ? resolverLoaderRef.current.getAllResolvers() : [];
              const chips = [{ id: 'all', label: 'All' }];
              const seen = new Set();
              for (const event of concerts) {
                for (const key of concertSourceKeys(event)) {
                  if (seen.has(key)) continue;
                  seen.add(key);
                  if (key.startsWith('ai:')) {
                    const aiId = key.slice(3);
                    const named = [event, ...(event.ticketSources || [])].find(s => s && s.source === 'ai' && s.aiProvider === aiId);
                    const resolver = allResolvers.find(r => r.id === aiId);
                    chips.push({ id: key, label: (named && named.aiProviderName) || resolver?.name || aiId, color: resolver?.color || undefined });
                  } else {
                    const resolver = allResolvers.find(r => r.id === key);
                    chips.push({ id: key, label: resolver?.name || key, color: resolver?.color || undefined });
                  }
                }
              }
              // One source, or none yet: nothing to pick between.
              if (chips.length < 3) return null;
              const value = chips.some(c => c.id === concertsSourceFilter) ? concertsSourceFilter : 'all';
              return React.createElement(FilterChips, {
                chips, value, onChange: setConcertsSourceFilter,
                pageColor: PAGE_COLORS.concerts.color, label: 'Filter concerts by source',
              });
            })(),
            // Location filter
            React.createElement('div', { className: 'relative ml-2 flex items-center gap-1.5' },
              // Location chip (shown when a location is active)
              // The shared chip (components/filter-chips.js), in the page's
              // colour; its ✕ is a button beside it (it was a button inside
              // the chip's button, which HTML doesn't allow).
              concertsLocationCoords && React.createElement(Chip, {
                label: concertsLocation,
                icon: React.createElement(Icons.MapPin, { className: 'w-4 h-4 flex-shrink-0' }),
                fill: pageTint('concerts'),
                color: PAGE_COLORS.concerts.color,
                tooltip: `${concertsLocation} (${concertsLocationRadius} mi radius)`,
                onClick: (e) => { e.stopPropagation(); setConcertsLocationOpen(!concertsLocationOpen); },
                onRemove: () => { setConcertsLocation(''); setConcertsLocationCoords(null); setConcertsLocationRadius(50); },
                removeLabel: 'Clear location'
              }, React.createElement('span', { style: { opacity: 0.7 } }, `${concertsLocationRadius}mi`)),
              // Location pin button (shown when no location is active)
              !concertsLocationCoords && React.createElement('button', {
                onClick: (e) => { e.stopPropagation(); setConcertsLocationOpen(!concertsLocationOpen); },
                className: 'p-1.5 transition-colors',
                style: { color: concertsLocation ? PAGE_COLORS.concerts.color : 'var(--text-tertiary)' },
                'aria-label': concertsLocation ? `Filtered: ${concertsLocation}` : 'Filter by location', 'data-tooltip': concertsLocation ? `Filtered: ${concertsLocation}` : 'Filter by location'
              },
                React.createElement(Icons.MapPin, { className: 'w-4 h-4' })
              ),
              // Location dropdown panel
              concertsLocationOpen && React.createElement('div', {
                // A popover: its clicks stay in it.
                role: 'dialog', 'aria-label': 'Filter by location',
                className: 'absolute left-0 top-full mt-1 z-30',
                style: { width: '300px', padding: '16px 20px', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-default)', borderRadius: '16px', boxShadow: 'var(--shadow-dialog)' },
                onClick: (e) => e.stopPropagation()
              },
                // Header
                React.createElement('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '12px' } }, 'Filter by location'),
                // Text input row
                React.createElement('div', { className: 'flex items-center gap-2 mb-3' },
                  React.createElement(TextField, {
                    value: concertsLocation,
                    onChange: (val) => {
                      setConcertsLocation(val);
                      if (!val.trim()) {
                        setConcertsLocationCoords(null);
                        setConcertsLocationSuggestions([]);
                        if (concertsLocationSearchTimer.current) clearTimeout(concertsLocationSearchTimer.current);
                        return;
                      }
                      // Debounced search
                      if (concertsLocationSearchTimer.current) clearTimeout(concertsLocationSearchTimer.current);
                      concertsLocationSearchTimer.current = setTimeout(async () => {
                        const results = await searchLocationSuggestions(val.trim());
                        setConcertsLocationSuggestions(results);
                      }, 350);
                    },
                    onKeyDown: async (e) => {
                      if (e.key === 'Enter' && concertsLocation.trim()) {
                        setConcertsLocationSuggestions([]);
                        setConcertsGeocodingLoading(true);
                        const result = await geocodeLocation(concertsLocation.trim());
                        setConcertsGeocodingLoading(false);
                        if (result) {
                          setConcertsLocationCoords({ lat: result.lat, lng: result.lng });
                          setConcertsLocation(result.displayName);
                        }
                      }
                    },
                    autoFocus: true,
                    placeholder: 'City or region…',
                    // The shared text field (components/fields.js): one focus ring.
                    className: 'flex-1 min-w-0',
                    'aria-label': 'City or region'
                  }),
                  // "Use my location" button
                  React.createElement(Button, { variant: 'icon', className: 'flex-shrink-0 border border-line bg-surface-inset hover:!text-page-concerts', onClick: async () => {
                      setConcertsGeocodingLoading(true);
                      setConcertsLocationSuggestions([]);
                      try {
                        const pos = await getBrowserGeolocation();
                        setConcertsLocationCoords({ lat: pos.lat, lng: pos.lng });
                        const name = await reverseGeocode(pos.lat, pos.lng);
                        setConcertsLocation(name);
                      } catch (err) {
                        console.log('📍 Geolocation error:', err.message);
                        showToast('Could not determine your location', 'error');
                      }
                      setConcertsGeocodingLoading(false);
                    }, disabled: concertsGeocodingLoading, 'aria-label': 'Use my location', 'data-tooltip': 'Use my location' }, concertsGeocodingLoading
                      ? React.createElement(Icons.RefreshCw, { className: 'w-4 h-4 animate-spin' })
                      : React.createElement(Icons.LocateFixed, { className: 'w-4 h-4' }))
                ),
                // Location search suggestions
                concertsLocationSuggestions.length > 0 && !concertsLocationCoords && React.createElement('div', {
                  className: 'rounded-lg overflow-hidden mb-3',
                  style: { maxHeight: '160px', overflowY: 'auto', backgroundColor: 'var(--bg-inset)', border: '1px solid var(--border-default)', borderRadius: '10px' }
                },
                  concertsLocationSuggestions.map((suggestion, i) =>
                    React.createElement(ListRow, {
                      key: i,
                      size: 'sm',
                      divider: true,
                      className: 'text-ink-secondary',
                      onClick: () => {
                        setConcertsLocationCoords({ lat: suggestion.lat, lng: suggestion.lng });
                        setConcertsLocation(suggestion.displayName);
                        setConcertsLocationSuggestions([]);
                      },
                    },
                      React.createElement(Icons.MapPin, { className: 'w-4 h-4 flex-shrink-0', style: { color: 'var(--text-tertiary)' } }),
                      React.createElement('span', { className: 'truncate' }, suggestion.region)
                    )
                  )
                ),
                // Status line
                concertsLocationCoords && React.createElement('div', {
                  className: 'flex items-center gap-1.5 mb-3',
                  style: { fontSize: '13px', color: 'var(--text-success)' }
                },
                  React.createElement(Icons.Check, { className: 'w-4 h-4' }),
                  React.createElement('span', null, concertsLocation)
                ),
                // Radius slider
                React.createElement('div', { style: { marginBottom: '12px' } },
                  React.createElement('div', { className: 'flex items-center justify-between', style: { marginBottom: '8px' } },
                    React.createElement('span', { style: { fontSize: '13px', color: 'var(--text-tertiary)' } }, 'Radius'),
                    React.createElement('span', { style: { fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' } }, `${concertsLocationRadius} mi`)
                  ),
                  React.createElement(Slider, {
                    min: 10,
                    max: 500,
                    step: 10,
                    value: concertsLocationRadius,
                    onChange: (v) => setConcertsLocationRadius(v),
                    color: PAGE_COLORS.concerts.color,
                    className: 'w-full',
                    'aria-label': 'Radius',
                    'aria-valuetext': `${concertsLocationRadius} miles`
                  })
                ),
                // Action buttons row
                React.createElement('div', { className: 'flex items-center justify-between', style: { paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' } },
                  // Clear button
                  React.createElement('button', {
                    onClick: () => {
                      setConcertsLocation('');
                      setConcertsLocationCoords(null);
                      setConcertsLocationRadius(50);
                      setConcertsLocationOpen(false);
                    },
                    className: 'transition-colors hover:!text-[var(--text-secondary)]',
                    style: { fontSize: '13px', color: 'var(--text-tertiary)' },
                  }, 'Clear'),
                  // Apply button (geocode if needed)
                  React.createElement(Button, { variant: 'primary', size: 'sm', pageColor: PAGE_COLORS.concerts.color, onClick: async () => {
                      if (concertsLocation.trim() && !concertsLocationCoords) {
                        setConcertsGeocodingLoading(true);
                        const result = await geocodeLocation(concertsLocation.trim());
                        setConcertsGeocodingLoading(false);
                        if (result) {
                          setConcertsLocationCoords({ lat: result.lat, lng: result.lng });
                          setConcertsLocation(result.displayName);
                        }
                      }
                      setConcertsLocationOpen(false);
                    }, disabled: concertsGeocodingLoading }, concertsGeocodingLoading ? 'Looking up…' : 'Apply')
                )
              )
            ),
            React.createElement('div', { className: 'flex-1' }),
            // Search
            React.createElement(FilterBox, { value: concertsSearch, onChange: setConcertsSearch, open: concertsSearchOpen, onOpenChange: setConcertsSearchOpen })
          );
          })(),
          // Scrollable content area
          React.createElement('div', {
            className: 'flex-1 overflow-y-auto scroll-edge',
            style: { minHeight: 0 },
            onScroll: handleConcertsScroll
          },
            // Error state - no concert services configured
            concertsError === 'no_services' && !concertsLoading && concertsError === 'no_services' && !concertsLoading && React.createElement(EmptyState, {
              title: 'No concert plug-ins enabled',
              body: 'Enable a concert plug-in (Bandsintown, Songkick, SeatGeek or Ticketmaster) to see upcoming shows for artists you love.',
              actions: [{ label: 'Open Plug-Ins', onClick: () => { navigateTo('settings'); setSettingsTab('plugins'); } }]
            }),

            // Error state - generic error
            concertsError && concertsError !== 'no_services' && !concertsLoading && concertsError && concertsError !== 'no_services' && !concertsLoading && React.createElement(ErrorState, { title: 'Couldn’t load concerts', body: concertsError, onRetry: () => loadConcerts(true) }),

            // Loading skeleton: the page's own row, photo included
            // (components/concert-skeletons.js).
            (concertsLoading || !cacheLoaded) && !concertsError && concerts.length === 0 && React.createElement('div', { className: 'p-6' },
              React.createElement(ConcertListSkeleton, { count: 8, photo: true })
            ),

            // Empty state
            // The shared empty state (components/states.js).
            !concertsLoading && concertsLoaded && !concertsError && concerts.length === 0 && React.createElement(EmptyState, {
              icon: Icons.Ticket,
              title: 'No upcoming concerts',
              body: 'Add artists to your Collection or listen to more music, and shows from artists you love appear here.',
              actions: [{ label: 'Check again', variant: 'secondary', onClick: () => loadConcerts(true) }]
            }),

            // Concert list
            !concertsError && concerts.length > 0 && (() => {
              const searchLower = concertsSearch.toLowerCase().trim();
              const locationLower = concertsLocation.toLowerCase().trim();
              const filtered = concerts.filter(event => {
                // Source filter ('all', a service id, or 'ai:providerId'). A
                // show several services list matches each of them
                // (lib/concert-events.js concertSourceKeys).
                if (!concertMatchesSource(event, concertsSourceFilter)) return false;
                // Location filter — coordinate-based distance when available, text fallback
                if (concertsLocationCoords) {
                  const vLat = event.venue?.latitude;
                  const vLng = event.venue?.longitude;
                  if (vLat != null && vLng != null) {
                    const dist = haversineDistance(concertsLocationCoords.lat, concertsLocationCoords.lng, vLat, vLng);
                    if (dist > concertsLocationRadius) return false;
                  } else {
                    // No venue coordinates: match by name, whole names only
                    // (lib/concert-events.js, #1568).
                    if (!venueMatchesLocationText(event.venue, locationLower)) return false;
                  }
                } else if (locationLower) {
                  // No geocoded coords: match by name, whole names only.
                  if (!venueMatchesLocationText(event.venue, locationLower)) return false;
                }
                // Search filter
                if (searchLower) {
                  const matchesArtist = event.artist?.toLowerCase().includes(searchLower);
                  const matchesLineup = event.lineup && event.lineup.some(a => a.toLowerCase().includes(searchLower));
                  const matchesVenue = event.venue?.name?.toLowerCase().includes(searchLower);
                  const matchesCity = event.venue?.city?.toLowerCase().includes(searchLower);
                  const matchesTitle = event.title?.toLowerCase().includes(searchLower);
                  if (!matchesArtist && !matchesLineup && !matchesVenue && !matchesCity && !matchesTitle) return false;
                }
                return true;
              });

              // Group events by month
              const grouped = {};
              for (const event of filtered) {
                const date = event.date ? new Date(event.date + 'T00:00:00') : null;
                const monthKey = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : 'unknown';
                const monthLabel = date ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Date TBA';
                if (!grouped[monthKey]) {
                  grouped[monthKey] = { label: monthLabel, events: [] };
                }
                grouped[monthKey].events.push(event);
              }

              const sortedMonths = Object.keys(grouped).sort();

              return React.createElement('div', { key: `concerts-${concertsLocationCoords ? `${concertsLocationCoords.lat},${concertsLocationCoords.lng}` : 'none'}-${concertsLocationRadius}-${concertsLocation}`, className: 'p-6' },

                filtered.length === 0 && searchLower && React.createElement('div', {
                  className: 'flex flex-col items-center justify-center py-12'
                },
                  React.createElement('p', { className: 'text-sm text-ink-tertiary' }, `No concerts matching "${concertsSearch}"`)
                ),

                filtered.length === 0 && locationLower && !searchLower && React.createElement('div', {
                  className: 'flex flex-col items-center justify-center py-12'
                },
                  React.createElement('p', { className: 'text-sm text-ink-tertiary' }, `No concerts found near "${concertsLocation}"`)
                ),

                sortedMonths.map(monthKey =>
                  React.createElement('div', { key: monthKey, className: 'mb-8' },
                    // Month header
                    React.createElement('h2', {
                      className: 'text-sm font-semibold text-ink-tertiary uppercase tracking-wider mb-3 px-1'
                    }, grouped[monthKey].label),

                    // Events in this month
                    React.createElement('div', { className: 'space-y-3' },
                      grouped[monthKey].events.map((event, eventIdx) => {
                        const eventDate = event.date ? new Date(event.date + 'T00:00:00') : null;
                        const dayOfWeek = eventDate ? eventDate.toLocaleDateString('en-US', { weekday: 'short' }) : '';
                        const dayNum = eventDate ? eventDate.getDate() : '?';
                        const monthShort = eventDate ? eventDate.toLocaleDateString('en-US', { month: 'short' }) : '';
                        const location = [event.venue?.city, event.venue?.region, event.venue?.country].filter(Boolean).join(', ');
                        const artistImg = event.artist ? concertsArtistImages[event.artist.trim().toLowerCase()] : null;
                        // Why this concert is here: the row's tooltip (it was a
                        // column of its own; Fresh Drops' cards say why the same way).
                        const reasonText = (() => {
                          const src = event.artistSource;
                          if (src === 'collection') return 'In your Collection';
                          if (src === 'library') return 'In your library';
                          if (src === 'history') return 'From your listening history';
                          if (event.description && event.description !== 'AI-suggested event') return event.description;
                          return null;
                        })();

                        return React.createElement('div', {
                          key: event.id || `${monthKey}-${eventIdx}`,
                          className: 'flex items-center rounded-xl border cursor-default bg-surface-card border-line-light',
                          style: {
                            animation: 'fadeIn 300ms ease-out both',
                            animationDelay: `${eventIdx * 30}ms`,
                            position: 'relative',
                            zIndex: 1
                          }
                        },
                          // Date column
                          React.createElement('div', {
                            className: 'flex flex-col items-center justify-center text-center flex-shrink-0 px-4',
                            style: { minWidth: '100px' }
                          },
                            React.createElement('span', {
                              className: 'text-xs font-medium text-page-concerts uppercase'
                            }, monthShort),
                            React.createElement('span', {
                              className: 'text-2xl font-bold leading-tight text-ink-primary'
                            }, dayNum),
                            React.createElement('span', {
                              className: 'text-xs text-ink-tertiary uppercase'
                            }, dayOfWeek)
                          ),

                          // Artist image — full-bleed rectangle
                          React.createElement('button', { type: 'button', 'aria-label': event.artist ? `Open ${event.artist}` : 'Artist',
                            className: 'flex-shrink-0 overflow-hidden cursor-pointer bg-surface-inset',
                            style: { width: '100px', height: '100px', alignSelf: 'stretch' },
                            onClick: () => { if (event.artist) { pendingProtocolTabRef.current = 'on-tour'; fetchArtistData(event.artist); } }
                          },
                            artistImg?.url
                              ? React.createElement('img', {
                                  src: artistImg.url,
                                  alt: event.artist,
                                  className: 'w-full h-full object-cover',
                                  style: artistImg.facePosition ? { objectPosition: artistImg.facePosition } : undefined,
                                  loading: 'lazy'
                                })
                              : React.createElement('div', {
                                  className: 'w-full h-full flex items-center justify-center text-ink-tertiary'
                                },
                                  React.createElement(Icons.User, { className: 'w-8 h-8' })
                                )
                          ),

                          // Event details column
                          React.createElement('div', { className: 'flex-1 min-w-0 flex items-center px-4 py-3' },
                            React.createElement('div', { className: 'flex-1 min-w-0' },
                              React.createElement('div', { className: 'flex items-center gap-2 mb-0.5' },
                                // Why it's here sits on the artist's name: on the
                                // whole row the tooltip floated over its middle.
                                React.createElement('button', { type: 'button',
                                  'data-tooltip': reasonText || undefined,
                                  className: 'text-left font-semibold truncate cursor-pointer hover:text-page-concerts transition-colors text-ink-primary',
                                  onClick: () => {
                                    if (event.artist) { pendingProtocolTabRef.current = 'on-tour'; fetchArtistData(event.artist); }
                                  }
                                }, event.artist),
                                // Where the tickets come from (components/seller-badges.js).
                                ...SellerBadges({ sources: event.ticketSources || [{ source: event.source, aiProviderName: event.aiProviderName }] })
                              ),
                              React.createElement('div', {
                                className: 'text-sm truncate text-ink-secondary'
                              }, event.venue?.name || 'Venue TBA'),
                              location && React.createElement('div', {
                                className: 'text-xs truncate mt-0.5 text-ink-tertiary'
                              }, location),
                              // Lineup
                              event.lineup && event.lineup.length > 1 && React.createElement('div', {
                                className: 'text-xs mt-0.5 text-ink-tertiary'
                              }, 'with ' + event.lineup.filter(a => a.toLowerCase() !== event.artist.toLowerCase()).join(', '))
                            )
                          ),

                          // Ticket button column — fixed width for alignment
                          React.createElement('div', {
                            className: 'flex-shrink-0 flex items-center justify-center mr-4',
                            style: { width: '100px' }
                          },
                          // The shared teal Tickets button (components/tickets-button.js).
                          React.createElement(TicketsButton, { sources: event.ticketSources, artist: event.artist })
                          )
                        );
                      })
                    )
                  )
                ),

                // Loading indicator at bottom during refresh
                concertsLoading && concerts.length > 0 && React.createElement('div', {
                  className: 'flex items-center justify-center py-4'
                },
                  React.createElement(Icons.Spinner, { className: 'w-5 h-5 text-page-concerts mr-2' }),
                  React.createElement('span', { className: 'text-sm text-ink-tertiary' }, 'Refreshing concerts…')
                )
              );
            })()
          )
        );
});

module.exports = { ConcertsPage, CONCERTS_PAGE_HANDLERS };
