// src/renderer/components/cards.js — the card family, extracted from app.js's
// module scope (maintainability plan Track 2b, presentational slice 3).
//
// Presentational cards for artists/albums/releases across search, collection
// and artist pages. All props-driven (getAlbumArt / getArtistImage /
// navigation callbacks arrive via props); no app state. generateArtistPattern
// (the artist-name fuzzy matcher the artist cards use for search-space
// filtering) moves with its pre-component consumers and is exported back to
// app.js for the in-component call sites; PlayTop10Icon / QueueTop10Icon are
// cards-only (the playtop-10 / queue-top-10 affordances).
const { ResolverIcon, PlaybackProgress } = require('./ui-atoms');
const { getBestSourceConfidence } = require('./track-lists');
const Icons = require('./icons');
const { Play } = Icons;
// hashString (module scope in app.js) is used by generateArtistPattern;
// exported back so app.js's own call sites keep the same binding.
const hashString = require('../lib/hash-string');
const { trackSlug, slug } = require('../lib/track-slug');

// Generate a unique pattern/gradient for an artist based on their name
// Returns an object with CSS gradient and optional SVG pattern
const generateArtistPattern = (artistName) => {
  const hash = hashString(artistName.toLowerCase());

  // Color palettes - warm, cool, earthy, vibrant, muted - avoiding generic purple/pink
  const palettes = [
    ['#1a1a2e', '#16213e', '#0f3460', '#e94560'], // Deep blue/red
    ['#2d3436', '#636e72', '#b2bec3', '#dfe6e9'], // Slate monochrome
    ['#0c0c0c', '#1c1c1c', '#2d2d2d', '#ff6b35'], // Dark with orange
    ['#1e3a5f', '#3d5a80', '#98c1d9', '#e0fbfc'], // Ocean blues
    ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c'], // Navy/red
    ['#003049', '#d62828', '#f77f00', '#fcbf49'], // French flag warm
    ['#0a0908', '#22333b', '#eae0d5', '#c6ac8f'], // Coffee tones
    ['#10002b', '#240046', '#3c096c', '#5a189a'], // Deep purple (different from old)
    ['#1b4332', '#2d6a4f', '#40916c', '#52b788'], // Forest green
    ['#212529', '#343a40', '#495057', '#adb5bd'], // Cool gray
    ['#003459', '#007ea7', '#00a8e8', '#ffffff'], // Bright blue
    ['#1d3557', '#457b9d', '#a8dadc', '#f1faee'], // Teal slate
    ['#283618', '#606c38', '#dda15e', '#bc6c25'], // Earth tones
    ['#231942', '#5e548e', '#9f86c0', '#be95c4'], // Lavender depth
    ['#0b090a', '#161a1d', '#660708', '#a4161a'], // Dark red
  ];

  const paletteIndex = hash % palettes.length;
  const palette = palettes[paletteIndex];

  // Different gradient patterns based on hash
  const patternType = (hash >> 4) % 6;
  const angle = ((hash >> 8) % 12) * 30; // 0, 30, 60, ... 330 degrees

  let gradient;
  switch (patternType) {
    case 0: // Linear gradient
      gradient = `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[1]} 50%, ${palette[2]} 100%)`;
      break;
    case 1: // Radial gradient
      gradient = `radial-gradient(circle at ${30 + (hash % 40)}% ${30 + ((hash >> 2) % 40)}%, ${palette[2]} 0%, ${palette[1]} 40%, ${palette[0]} 100%)`;
      break;
    case 2: // Diagonal split
      gradient = `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[0]} 45%, ${palette[2]} 45%, ${palette[2]} 55%, ${palette[1]} 55%, ${palette[1]} 100%)`;
      break;
    case 3: // Soft radial
      gradient = `radial-gradient(ellipse at ${(hash % 80) + 10}% ${((hash >> 3) % 80) + 10}%, ${palette[3] || palette[2]} 0%, ${palette[1]} 50%, ${palette[0]} 100%)`;
      break;
    case 4: // Corner gradient
      const corners = ['top left', 'top right', 'bottom left', 'bottom right'];
      const corner = corners[(hash >> 6) % 4];
      gradient = `radial-gradient(circle at ${corner}, ${palette[2]} 0%, ${palette[1]} 40%, ${palette[0]} 100%)`;
      break;
    default: // Mesh-like
      gradient = `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[1]} 25%, ${palette[2]} 50%, ${palette[1]} 75%, ${palette[0]} 100%)`;
  }

  // Generate initials for overlay
  const initials = artistName.split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

  return {
    gradient,
    initials,
    textColor: palette[3] || palette[2], // Lighter color for text
    accentColor: palette[3] || palette[2]
  };
};

// Custom PlayTop10Icon - Play button with "10" badge for artist top tracks
const PlayTop10Icon = ({ size = 24, className = '' }) => {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    className
  },
    // Play triangle (slightly offset left to make room for badge)
    React.createElement('path', {
      d: 'M6 4.75L17.5 12L6 19.25V4.75Z',
      fill: 'currentColor',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    }),
    // Badge circle background
    React.createElement('circle', {
      cx: 19,
      cy: 17,
      r: 6,
      fill: '#10b981'
    }),
    // "10" text in badge
    React.createElement('text', {
      x: 19,
      y: 17,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      fill: 'white',
      fontSize: 7,
      fontWeight: 'bold',
      fontFamily: 'var(--font-sans)'
    }, '10')
  );
};

// Custom QueueTop10Icon - Queue/list icon with "10" badge for artist top tracks
const QueueTop10Icon = ({ size = 24, className = '' }) => {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className
  },
    // Queue/list lines
    React.createElement('line', { x1: '8', y1: '6', x2: '18', y2: '6' }),
    React.createElement('line', { x1: '8', y1: '12', x2: '18', y2: '12' }),
    React.createElement('line', { x1: '8', y1: '18', x2: '14', y2: '18' }),
    React.createElement('line', { x1: '3', y1: '6', x2: '3.01', y2: '6' }),
    React.createElement('line', { x1: '3', y1: '12', x2: '3.01', y2: '12' }),
    React.createElement('line', { x1: '3', y1: '18', x2: '3.01', y2: '18' }),
    // Badge circle background (no stroke)
    React.createElement('circle', {
      cx: 19,
      cy: 17,
      r: 5.5,
      fill: '#10b981',
      stroke: 'none'
    }),
    // "10" text in badge
    React.createElement('text', {
      x: 19,
      y: 17,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      fill: 'white',
      fontSize: 6.5,
      fontWeight: 'bold',
      fontFamily: 'var(--font-sans)',
      stroke: 'none'
    }, '10')
  );
};

// RelatedArtistCard component - Shows artist image with name below
const RelatedArtistCard = ({ artist, getArtistImage, onNavigate }) => {
  // undefined = loading, null = no image found, string = image URL
  const [imageUrl, setImageUrl] = React.useState(undefined);

  // Generate unique pattern for this artist (memoized)
  const pattern = React.useMemo(() => generateArtistPattern(artist.name), [artist.name]);

  React.useEffect(() => {
    let cancelled = false;
    setImageUrl(undefined); // Reset to loading state on artist change
    const loadImage = async () => {
      const result = await getArtistImage(artist.name);
      if (!cancelled) {
        setImageUrl(result?.url || null); // null = no image, string = image URL
      }
    };
    loadImage();
    return () => { cancelled = true; };
    // Note: getArtistImage excluded from deps - function identity changes but behavior doesn't
  }, [artist.name]);

  return React.createElement('button', {
    onClick: onNavigate,
    className: 'text-left group cursor-grab active:cursor-grabbing',
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'artist',
        artist: {
          id: slug(artist.name || 'unknown'),
          name: artist.name,
          image: imageUrl
        }
      }));
    },
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.electron?.contextMenu?.showTrackMenu) {
        window.electron.contextMenu.showTrackMenu({
          type: 'artist',
          artist: {
            id: slug(artist.name || 'unknown'),
            name: artist.name,
            image: imageUrl
          }
        });
      }
    }
  },
    // Artist image square - gray bg while loading, pattern only when no image found
    React.createElement('div', {
      className: 'w-full aspect-square mb-2 relative overflow-hidden rounded-lg',
      style: { background: imageUrl === null ? pattern.gradient : 'var(--placeholder-bg)' }
    },
      // Loading shimmer (only while fetching - imageUrl is undefined)
      imageUrl === undefined && React.createElement('div', {
        className: 'absolute inset-0 shimmer-strong animate-shimmer',
        style: { backgroundSize: '200% 100%' }
      }),
      // Image (fades in when loaded - imageUrl is a string)
      typeof imageUrl === 'string' && React.createElement('img', {
        src: imageUrl,
        alt: artist.name,
        className: 'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
        style: { opacity: 0 },
        ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
        onLoad: (e) => { e.target.style.opacity = '1'; }
      }),
      // Initials fallback when no image found (imageUrl is null)
      imageUrl === null && React.createElement('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: { color: pattern.textColor, opacity: 0.4 }
      },
        React.createElement('span', {
          className: 'font-bold tracking-wider',
          style: { fontSize: '2rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }
        }, pattern.initials)
      )
    ),
    // Artist name
    React.createElement('div', { className: 'text-sm font-medium text-gray-900 truncate' }, artist.name)
  );
};

// SearchArtistCard component - Square card design with rounded corners
const SearchArtistCard = ({ artist, getArtistImage, onClick, onContextMenu, onPlayTopTracks, onAddToQueue, itemWidth, animationDelay = 0 }) => {
  // undefined = loading, null = no image found, string = image URL
  const [imageUrl, setImageUrl] = React.useState(undefined);

  // Generate unique pattern for this artist (memoized)
  const pattern = React.useMemo(() => generateArtistPattern(artist.name), [artist.name]);

  React.useEffect(() => {
    let cancelled = false;
    setImageUrl(undefined); // Reset to loading state on artist change
    const loadImage = async () => {
      const result = await getArtistImage(artist.name);
      if (!cancelled) {
        setImageUrl(result?.url || null); // null = no image, string = image URL
      }
    };
    loadImage();
    return () => { cancelled = true; };
  }, [artist.name]);

  return React.createElement('div', {
    onClick: onClick,
    className: 'rounded-lg overflow-hidden cursor-pointer group release-card card-fade-up flex-shrink-0',
    style: { backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', animationDelay: `${animationDelay}ms`, width: itemWidth || 160 },
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'artist',
        artist: {
          id: slug(artist.name || 'unknown'),
          name: artist.name,
          image: imageUrl
        }
      }));
    },
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onContextMenu) {
        onContextMenu(artist);
      }
    }
  },
    // Square image container - gray bg while loading, pattern only when no image found
    React.createElement('div', {
      className: 'aspect-square relative group/art overflow-hidden',
      style: { background: imageUrl === null ? pattern.gradient : 'var(--placeholder-bg)' }
    },
      // Initials overlay (only show when no image found - imageUrl is null)
      imageUrl === null && React.createElement('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: { color: pattern.textColor, opacity: 0.4 }
      },
        React.createElement('span', {
          className: 'font-bold tracking-wider',
          style: { fontSize: '2.5rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }
        }, pattern.initials)
      ),
      // Image (fades in on load - imageUrl is a string)
      typeof imageUrl === 'string' && React.createElement('img', {
        src: imageUrl,
        alt: artist.name,
        className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover/art:scale-105',
        style: { opacity: 0 },
        ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
        onLoad: (e) => { e.target.style.opacity = '1'; },
        onError: (e) => { e.target.style.display = 'none'; }
      }),
      // Shimmer loading state (only while fetching - imageUrl is undefined)
      imageUrl === undefined && React.createElement('div', {
        className: 'absolute inset-0 shimmer-strong animate-shimmer',
        style: { backgroundSize: '200% 100%' }
      }),
      // Hover overlay with action buttons (Play, Queue)
      React.createElement('div', {
        className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
        style: { pointerEvents: 'auto' }
      },
        // Play top 10 button (center, larger)
        onPlayTopTracks && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onPlayTopTracks(artist);
          },
          className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
          style: { border: 'none', cursor: 'pointer' },
          title: 'Play top 10 tracks'
        },
          React.createElement(PlayTop10Icon, { size: 26, className: 'text-gray-800' })
        ),
        // Add top 10 to Queue button
        onAddToQueue && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onAddToQueue(artist);
          },
          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
          title: 'Add top 10 to queue'
        },
          React.createElement(QueueTop10Icon, { size: 20 })
        )
      )
    ),
    // Artist name section
    React.createElement('div', { className: 'p-3' },
      React.createElement('p', {
        className: 'font-medium text-gray-900 truncate text-sm'
      }, artist.name)
    )
  );
};

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

  return React.createElement('div', {
    className: 'flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 group transition-colors cursor-pointer',
    onClick: handleRowClick
  },
    // Result thumbnail or search icon
    selectedResult?.imageUrl ?
      React.createElement('img', {
        src: selectedResult.imageUrl,
        className: 'w-12 h-12 rounded object-cover',
        onError: (e) => { e.target.style.display = 'none'; }
      }) :
      React.createElement('div', {
        className: 'w-12 h-12 rounded bg-gray-100 flex items-center justify-center'
      },
        React.createElement('svg', {
          className: 'w-5 h-5 text-gray-400',
          fill: 'none',
          stroke: 'currentColor',
          viewBox: '0 0 24 24'
        },
          React.createElement('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: 2,
            d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
          })
        )
      ),

    // Query and result info
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('button', {
        onClick: (e) => { e.stopPropagation(); onQueryClick(query); },
        className: 'text-sm font-medium text-gray-900 hover:text-blue-600 truncate block text-left w-full'
      }, `"${query}"`),
      selectedResult && React.createElement('button', {
        onClick: (e) => { e.stopPropagation(); onResultClick(selectedResult); },
        className: 'text-xs text-gray-500 hover:text-blue-600 truncate block text-left w-full'
      },
        `${selectedResult.type}: ${selectedResult.name}${selectedResult.artist ? ` • ${selectedResult.artist}` : ''}`
      )
    ),

    // Remove button
    React.createElement('button', {
      onClick: (e) => { e.stopPropagation(); onRemove(query); },
      className: 'opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity'
    },
      React.createElement('svg', {
        className: 'w-4 h-4',
        fill: 'none',
        stroke: 'currentColor',
        viewBox: '0 0 24 24'
      },
        React.createElement('path', {
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: 2,
          d: 'M6 18L18 6M6 6l12 12'
        })
      )
    )
  );
};

// CollectionArtistCard component - Square card design with rounded corners
const CollectionArtistCard = ({ artist, getArtistImage, onNavigate, onPlayTopTracks, onAddToQueue, animationDelay = 0 }) => {
  // States: undefined (fetching), null (no image found), string (URL)
  const [imageUrl, setImageUrl] = React.useState(undefined);

  // Generate unique pattern for this artist (memoized)
  const pattern = React.useMemo(() => generateArtistPattern(artist.name), [artist.name]);

  React.useEffect(() => {
    let cancelled = false;
    setImageUrl(undefined); // Reset to loading state immediately on artist change
    const loadImage = async () => {
      const result = await getArtistImage(artist.name);
      if (!cancelled) {
        setImageUrl(result?.url || null); // null if not found
      }
    };
    loadImage();
    return () => { cancelled = true; };
  }, [artist.name]);

  return React.createElement('div', {
    onClick: onNavigate,
    className: 'rounded-lg overflow-hidden cursor-pointer group release-card card-fade-up',
    style: { backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', animationDelay: `${animationDelay}ms` }
  },
    // Square image container - gray bg while loading, pattern only when no image found
    React.createElement('div', {
      className: 'aspect-square relative group/art overflow-hidden',
      style: { background: imageUrl === null ? pattern.gradient : 'var(--placeholder-bg)' }
    },
      // Initials overlay (only show when no image found, not while loading)
      imageUrl === null && React.createElement('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: { color: pattern.textColor, opacity: 0.4 }
      },
        React.createElement('span', {
          className: 'font-bold tracking-wider',
          style: { fontSize: '3rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }
        }, pattern.initials)
      ),
      // Image (fades in on load)
      imageUrl && typeof imageUrl === 'string' && React.createElement('img', {
        src: imageUrl,
        alt: artist.name,
        className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover/art:scale-105',
        style: { opacity: 0 },
        ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
        onLoad: (e) => { e.target.style.opacity = '1'; },
        onError: (e) => { e.target.style.display = 'none'; }
      }),
      // Shimmer loading state (only while fetching)
      imageUrl === undefined && React.createElement('div', {
        className: 'absolute inset-0 shimmer-strong animate-shimmer',
        style: { backgroundSize: '200% 100%' }
      }),
      // Hover overlay with action buttons (Play, Queue)
      React.createElement('div', {
        className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
        style: { pointerEvents: 'auto' }
      },
        // Play top 10 button (center, larger)
        onPlayTopTracks && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onPlayTopTracks(artist);
          },
          className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
          style: { border: 'none', cursor: 'pointer' },
          title: 'Play top 10 tracks'
        },
          React.createElement(PlayTop10Icon, { size: 26, className: 'text-gray-800' })
        ),
        // Add top 10 to Queue button
        onAddToQueue && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onAddToQueue(artist);
          },
          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
          title: 'Add top 10 to queue'
        },
          React.createElement(QueueTop10Icon, { size: 20 })
        )
      )
    ),
    // Artist name and track count section
    React.createElement('div', { className: 'p-3' },
      React.createElement('p', {
        className: 'font-medium text-gray-900 truncate text-sm transition-colors'
      }, artist.name),
      // Track count (only show if > 0)
      artist.trackCount > 0 && React.createElement('p', {
        className: 'text-xs text-gray-400 mt-1'
      }, `${artist.trackCount} track${artist.trackCount !== 1 ? 's' : ''}`)
    )
  );
};

// CollectionAlbumCard component - Cinematic Light design
const CollectionAlbumCard = ({ album, getAlbumArt, onNavigate, onAddToPlaylist, onPlay, onAddToQueue, onContextMenu, animationDelay = 0 }) => {
  // States: undefined (fetching), null (no art found), string (URL)
  const [imageUrl, setImageUrl] = React.useState(album.art || undefined);

  React.useEffect(() => {
    // If we already have embedded art, don't fetch
    if (album.art) {
      setImageUrl(album.art);
      return;
    }

    let cancelled = false;
    const loadImage = async () => {
      setImageUrl(undefined); // Loading state
      const artUrl = await getAlbumArt(album.artist, album.title);
      if (!cancelled) {
        setImageUrl(artUrl || null); // null if not found
      }
    };
    loadImage();
    return () => { cancelled = true; };
  }, [album.artist, album.title, album.art]);

  return React.createElement('button', {
    onClick: onNavigate,
    onContextMenu: onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, album); } : undefined,
    className: 'group text-left release-card card-fade-up',
    style: {
      padding: '10px',
      borderRadius: '10px',
      backgroundColor: 'var(--card-bg)',
      border: 'none',
      boxShadow: 'var(--card-shadow)',
      animationDelay: `${animationDelay}ms`
    }
  },
    // Album art - shimmer while fetching, dark placeholder if no art
    React.createElement('div', {
      className: `album-art-container group/art ${imageUrl === undefined ? 'animate-shimmer' : ''}`,
      style: {
        width: '100%',
        aspectRatio: '1',
        borderRadius: '6px',
        marginBottom: '10px',
        overflow: 'hidden',
        position: 'relative',
        background: imageUrl === null
          ? 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)'
          : imageUrl === undefined
            ? 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))'
            : 'var(--placeholder-bg-light)',
        backgroundSize: imageUrl === undefined ? '200% 100%' : undefined
      }
    },
      // Show image when URL exists (fades in when loaded)
      imageUrl && typeof imageUrl === 'string' && React.createElement('img', {
        src: imageUrl,
        alt: album.title,
        className: 'group-hover/art:scale-105',
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0,
          transition: 'opacity 0.35s ease-out, transform 0.3s ease'
        },
        ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
        onLoad: (e) => { e.target.style.opacity = '1'; },
        // A dead cached URL: placeholder now, the art pipeline's retry if it finds one.
        onError: () => {
          const broken = imageUrl;
          setImageUrl(null);
          const report = globalThis.reportBrokenAlbumArt;
          if (report) report(broken, { artist: album.artist, album: album.title }).then((url) => { if (url) setImageUrl(url); });
        }
      }),
      // Placeholder icon when no art found
      imageUrl === null && React.createElement('div', {
        style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }
      },
        React.createElement('svg', {
          style: { width: '36px', height: '36px', color: 'rgba(255, 255, 255, 0.2)' },
          fill: 'none',
          viewBox: '0 0 24 24',
          stroke: 'currentColor'
        },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
        )
      ),
      // Hover overlay with action buttons
      React.createElement('div', {
        className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 pointer-events-none group-hover/art:pointer-events-auto transition-opacity duration-200 flex items-center justify-center gap-3',
        style: { borderRadius: '6px', zIndex: 20 }
      },
        // Add to Playlist button
        onAddToPlaylist && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onAddToPlaylist(album);
          },
          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
          title: 'Add to Playlist'
        },
          React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
          )
        ),
        // Play album button
        onPlay && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onPlay(album);
          },
          className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
          style: { border: 'none', cursor: 'pointer' },
          title: 'Play album'
        },
          React.createElement(Play, { size: 22, className: 'text-gray-800 ml-0.5' })
        ),
        // Add to queue button
        onAddToQueue && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onAddToQueue(album);
          },
          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
          title: 'Add album to queue'
        },
          React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
          )
        )
      )
    ),
    // Album title
    React.createElement('h3', {
      style: {
        fontWeight: '500',
        fontSize: '13px',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginBottom: '2px',
        transition: 'color 0.2s ease'
      },
      className: ''
    }, album.title),
    // Artist name
    React.createElement('p', {
      style: { fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
    }, album.artist),
    // Year and track count
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' } },
      album.year && React.createElement('span', {
        style: { fontSize: '11px', color: 'var(--text-tertiary)' }
      }, album.year),
      React.createElement('span', {
        style: { fontSize: '11px', color: 'var(--text-tertiary)' }
      }, `${album.trackCount} track${album.trackCount !== 1 ? 's' : ''}`)
    )
  );
};

// ReleaseCard component - Cinematic Light design
const ReleaseCard = ({ release, currentArtist, fetchReleaseData, onContextMenu, onHoverFetch, isVisible = true, animationDelay = 0, onPlay, onAddToQueue, onAddToPlaylist, prefetchedReleasesRef, onCardRef }) => {
  const year = release.date ? release.date.split('-')[0] : '';
  const [imageFailed, setImageFailed] = React.useState(false);
  const [imageLoaded, setImageLoaded] = React.useState(false);
  // A fresh cover found after the cached one failed to load (see onArtError).
  const [replacementArt, setReplacementArt] = React.useState(null);
  const art = replacementArt || release.albumArt;

  // Reset image states when album art URL changes
  React.useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
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
      setImageLoaded(false);
    });
  };

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    const albumData = {
      type: 'album',
      album: {
        id: trackSlug(currentArtist?.name || release.artist?.name || 'unknown', release.title || 'untitled'),
        title: release.title,
        artist: currentArtist?.name || release.artist?.name,
        year: year ? parseInt(year) : null,
        art,
        trackCount: release.tracks?.length || null
      }
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(albumData));
  };

  const handleClick = () => {
    console.log('🎵 Card clicked:', release.title);
    fetchReleaseData(release, currentArtist);
  };

  // Badge colors - refined palette matching app aesthetic
  const badgeStyles = {
    album: { bg: 'rgba(99, 102, 241, 0.08)', color: 'rgb(99, 102, 241)' },
    ep: { bg: 'rgba(168, 85, 247, 0.08)', color: '#a855f7' },
    single: { bg: 'rgba(236, 72, 153, 0.08)', color: '#db2777' },
    live: { bg: 'rgba(245, 158, 11, 0.08)', color: '#d97706' },
    compilation: { bg: 'rgba(16, 201, 180, 0.08)', color: '#0eb3a0' }
  };
  const badge = badgeStyles[release.releaseType] || badgeStyles.album;

  return React.createElement('button', {
    className: `no-drag release-card card-fade-up`,
    draggable: true,
    onDragStart: handleDragStart,
    'data-release-id': release.id,
    ref: onCardRef,
    style: {
      width: '100%',
      textAlign: 'left',
      display: isVisible ? 'block' : 'none',
      backgroundColor: 'var(--card-bg)',
      borderRadius: '10px',
      padding: '10px',
      cursor: 'grab',
      border: 'none',
      boxShadow: 'var(--card-shadow)',
      animationDelay: `${animationDelay}ms`
    },
    onClick: handleClick,
    onContextMenu: (e) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu(release);
      }
    },
    onMouseEnter: (e) => {
      // Prefetch release tracks on hover
      if (onHoverFetch) {
        onHoverFetch(release);
      }
    }
  },
    // Album art container with inner shadow overlay
    React.createElement('div', {
      className: `album-art-container group/art ${(art === null || imageFailed || imageLoaded) ? '' : 'animate-shimmer'}`,
      style: {
        width: '100%',
        aspectRatio: '1',
        borderRadius: '6px',
        background: art === null || imageFailed
          ? 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)'
          : imageLoaded
            ? 'var(--placeholder-bg-light)'
            : 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
        backgroundSize: (art === null || imageFailed || imageLoaded) ? undefined : '200% 100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '10px',
        overflow: 'hidden',
        position: 'relative'
      }
    },
      // Album art image with fade-in
      art && !imageFailed && React.createElement('img', {
        src: art,
        alt: release.title,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          opacity: imageLoaded ? 1 : 0,
          transition: 'opacity 0.35s ease-out'
        },
        ref: (el) => {
          if (el && el.complete && el.naturalWidth > 0 && !imageLoaded) {
            setImageLoaded(true);
          }
        },
        onLoad: () => setImageLoaded(true),
        onError: onArtError
      }),

      // Music icon placeholder - refined dark style
      (art === null || imageFailed) && React.createElement('svg', {
        style: {
          width: '36px',
          height: '36px',
          color: 'rgba(255, 255, 255, 0.2)',
          pointerEvents: 'none'
        },
        fill: 'none',
        viewBox: '0 0 24 24',
        stroke: 'currentColor',
        strokeWidth: 1.5
      },
        React.createElement('path', {
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
        })
      ),

      // Hover overlay with action buttons (Add to Playlist, Play, Queue)
      (onPlay || onAddToQueue || onAddToPlaylist) && React.createElement('div', {
        className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
        style: { pointerEvents: 'auto' }
      },
        // Add to Playlist button
        onAddToPlaylist && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onAddToPlaylist(release);
          },
          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
          title: 'Add to Playlist'
        },
          React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
          )
        ),
        // Play button (center, larger)
        onPlay && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onPlay(release);
          },
          className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
          style: { border: 'none', cursor: 'pointer' },
          title: 'Play'
        },
          React.createElement(Play, { size: 22, className: 'text-gray-800 ml-0.5' })
        ),
        // Add to Queue button
        onAddToQueue && React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            onAddToQueue(release);
          },
          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
          title: 'Add to Queue'
        },
          React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
          )
        )
      )
    ),

    // Title - refined typography
    React.createElement('h3', {
      style: {
        fontWeight: '500',
        fontSize: '13px',
        lineHeight: '1.4',
        marginBottom: '3px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--text-primary)',
        letterSpacing: '0.005em',
        pointerEvents: 'none'
      },
      title: release.title
    }, release.title),

    // Year and badge row
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        pointerEvents: 'none'
      }
    },
      // Year
      year && React.createElement('span', {
        style: {
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          fontWeight: '400'
        }
      }, year),
      // Badge - refined style
      React.createElement('span', {
        className: 'release-badge',
        style: {
          backgroundColor: badge.bg,
          color: badge.color
        }
      }, release.releaseType.toUpperCase())
    )
  );
};

// ReleasePage component - Shows full album/EP/single with tracklist
const ReleasePage = ({
  release,
  handleSearch,
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
  shareDropdownOpen,
  setShareDropdownOpen,
  publishCollectionSmartLink,
  copyCollectionEmbedCode,
  // A load that failed (release._loadError) offers a retry
  onRetryLoad
}) => {
  // A fresh cover found after the cached one failed to load (header image onError).
  const [replacementArt, setReplacementArt] = React.useState(null);
  React.useEffect(() => { setReplacementArt(null); }, [release.albumArt]);
  const headerArt = replacementArt || release.albumArt;

  const formatDuration = (ms) => {
    if (!ms) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format full date nicely
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

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

  // Responsive sizes based on container width
  const isCompact = containerWidth < 700;
  const albumArtSize = isCompact ? 160 : 192; // 160px or 192px (w-40 or w-48)
  const columnWidth = isCompact ? 180 : 240;

  return React.createElement('div', { ref: containerRef, className: 'flex gap-0 px-6 pb-6', style: { flex: 1, minHeight: 0 } },
    // LEFT COLUMN: Album card - matching ReleaseCard styling
    (() => {
      const year = release.date ? release.date.split('-')[0] : '';
      // Badge colors - matching ReleaseCard palette
      const badgeStyles = {
        album: { bg: 'rgba(99, 102, 241, 0.08)', color: 'rgb(99, 102, 241)' },
        ep: { bg: 'rgba(233, 30, 99, 0.08)', color: '#db2777' },
        single: { bg: 'rgba(168, 85, 247, 0.08)', color: '#a855f7' },
        live: { bg: 'rgba(245, 158, 11, 0.08)', color: '#d97706' },
        compilation: { bg: 'rgba(16, 201, 180, 0.08)', color: '#0eb3a0' }
      };
      const releaseType = release.releaseType || 'album';
      const badge = badgeStyles[releaseType] || badgeStyles.album;

      return React.createElement('div', {
        className: 'flex-shrink-0 pr-4 md:pr-8 pt-6 scrollable-content',
        style: {
          width: `${columnWidth}px`,
          transition: 'width 300ms ease',
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
            transition: 'width 300ms ease'
          },
          onContextMenu: onAlbumContextMenu ? (e) => {
            e.preventDefault();
            onAlbumContextMenu(release);
          } : undefined
        },
          // Album art container
          React.createElement('div', {
            className: 'album-art-container group/art',
            style: {
              width: '100%',
              aspectRatio: '1',
              borderRadius: '6px',
              background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '10px',
              overflow: 'hidden',
              position: 'relative'
            }
          },
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
                transition: 'opacity 0.35s ease-out'
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
            // Placeholder icon (always behind) - dark theme
            React.createElement('svg', {
              style: {
                width: '36px',
                height: '36px',
                color: 'rgba(255, 255, 255, 0.2)',
                pointerEvents: 'none'
              },
              fill: 'none',
              viewBox: '0 0 24 24',
              stroke: 'currentColor',
              strokeWidth: 1.5
            },
              React.createElement('path', {
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
              })
            ),

            // Hover overlay with action buttons (Add to Playlist, Play, Queue)
            (onAlbumPlay || onAlbumAddToQueue || onAlbumAddToPlaylist) && React.createElement('div', {
              className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
              style: { pointerEvents: 'auto' }
            },
              // Add to Playlist button
              onAlbumAddToPlaylist && React.createElement('button', {
                onClick: (e) => {
                  e.stopPropagation();
                  onAlbumAddToPlaylist(release);
                },
                className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                title: 'Add to Playlist'
              },
                React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                )
              ),
              // Play button (center, larger)
              onAlbumPlay && React.createElement('button', {
                onClick: (e) => {
                  e.stopPropagation();
                  onAlbumPlay(release);
                },
                className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                style: { border: 'none', cursor: 'pointer' },
                title: 'Play'
              },
                React.createElement(Play, { size: 22, className: 'text-gray-800 ml-0.5' })
              ),
              // Add to Queue button
              onAlbumAddToQueue && React.createElement('button', {
                onClick: (e) => {
                  e.stopPropagation();
                  onAlbumAddToQueue(release);
                },
                className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                title: 'Add to Queue'
              },
                React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                )
              )
            )
          ),

          // Title - matching ReleaseCard typography
          React.createElement('h3', {
            style: {
              fontWeight: '500',
              fontSize: '13px',
              lineHeight: '1.4',
              marginBottom: '3px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-primary)',
              letterSpacing: '0.005em',
              pointerEvents: 'none'
            },
            title: release.title
          }, release.title),

          // Year and badge row - matching ReleaseCard
          React.createElement('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'none'
            }
          },
            // Year
            year && React.createElement('span', {
              style: {
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                fontWeight: '400'
              }
            }, year),
            // Badge - matching ReleaseCard style
            React.createElement('span', {
              className: 'release-badge',
              style: {
                backgroundColor: badge.bg,
                color: badge.color
              }
            }, releaseType.toUpperCase())
          )
        ),

        // Additional metadata below card
        React.createElement('div', { className: 'mt-3 space-y-1', style: { paddingLeft: '2px' } },
          React.createElement('p', {
            className: 'text-gray-500',
            style: {
              fontSize: isCompact ? '0.75rem' : '0.875rem',
              transition: 'font-size 300ms ease'
            }
          }, formatDate(release.date)),
          React.createElement('p', {
            className: 'text-gray-500',
            style: {
              fontSize: isCompact ? '0.75rem' : '0.875rem',
              transition: 'font-size 300ms ease'
            }
          }, release.tracks ? `${release.tracks.length.toString().padStart(2, '0')} Songs` : (release._loadError ? '' : 'Loading...')),
          // A track list from a service's catalog, not MusicBrainz (the
          // album-page catalog fallback): say where it came from.
          release._catalogSource && React.createElement('p', {
            className: 'text-gray-500',
            style: { fontSize: '0.75rem', marginTop: '2px' },
            title: 'MusicBrainz could not supply this album, so its track list came from another catalog'
          }, `Track list from ${release._catalogSource.name}`),
          // Share button
          React.createElement('div', { className: 'relative mt-5 flex justify-start', style: { width: `${albumArtSize}px` } },
            React.createElement('button', {
              onClick: (e) => { e.stopPropagation(); setShareDropdownOpen(shareDropdownOpen === 'album' ? false : 'album'); },
              className: 'px-2 py-1 bg-pink-600 hover:bg-pink-700 text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1 no-drag'
            },
              React.createElement('svg', { className: 'w-3 h-3', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z' })
              ),
              'Share'
            ),
            shareDropdownOpen === 'album' && React.createElement('div', {
              className: 'absolute left-0 top-full mt-1 rounded-lg py-1 min-w-[160px] z-30',
              style: { backgroundColor: 'var(--tooltip-bg)', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' },
              onClick: (e) => e.stopPropagation()
            },
              React.createElement('button', {
                onClick: () => {
                  setShareDropdownOpen(false);
                  // Harvest any available MBID. release.id is typically the
                  // release-group MBID for MB-derived discography; for Spotify
                  // / Apple Music fallback paths it's prefixed (e.g.
                  // "spotify-..."), so rely on the UUID-shape check inside
                  // publishCollectionSmartLink to gate validity. First track's
                  // releaseMbid (mapper-enriched) is a reliable fallback —
                  // Achordion server-side maps release MBIDs to release-groups.
                  const albumMbid = release.releaseGroupMbid
                    || release.mbid
                    || release.id
                    || release.tracks?.[0]?.releaseMbid
                    || null;
                  const collectionData = {
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
                  publishCollectionSmartLink(collectionData);
                },
                className: 'w-full px-3 py-2 text-left text-white hover:bg-white/10 flex items-center gap-2 no-drag',
                style: { fontSize: '12px', fontWeight: 500 }
              },
                React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' })
                ),
                'Copy Link'
              )
            )
          )
        )
      );
    })(),

    // RIGHT COLUMN: Tracklist
    React.createElement('div', { className: 'flex-1 min-w-0 pt-6 scrollable-content', style: { overflowY: 'auto' } },
      // A load that failed: the reason and a retry, in place of the skeleton
      !release.tracks && release._loadError ? React.createElement('div', {
        className: 'flex flex-col items-start gap-3 py-6 px-4',
        role: 'alert'
      },
        React.createElement('p', { style: { color: 'var(--text-primary)', fontSize: '0.9375rem', fontWeight: 500 } },
          "Couldn't load this album's tracks"),
        React.createElement('p', { style: { color: 'var(--text-secondary)', fontSize: '0.875rem', maxWidth: '32rem' } },
          release._loadError),
        onRetryLoad && React.createElement('button', {
          onClick: (e) => { e.stopPropagation(); onRetryLoad(); },
          className: 'px-4 py-2 text-white rounded-lg text-sm transition-opacity hover:opacity-90',
          style: { backgroundColor: 'var(--accent-primary)' }
        }, 'Try Again')
      ) :
      // Show skeleton while tracks are loading
      !release.tracks ? React.createElement('div', { className: 'space-y-0' },
        [75, 60, 85, 55, 70, 80, 50, 65, 90, 58].map((width, i) =>
          React.createElement('div', {
            key: `track-skeleton-${i}`,
            className: 'flex items-center gap-4 py-3 px-4',
            style: { borderRadius: '8px', marginBottom: '2px' }
          },
            // Track number
            React.createElement('div', {
              className: 'w-6 h-4 rounded shimmer-light animate-shimmer',
              style: { backgroundSize: '200% 100%' }
            }),
            // Track title
            React.createElement('div', { className: 'flex-1' },
              React.createElement('div', {
                className: 'h-4 rounded shimmer-light animate-shimmer',
                style: { width: `${width}%`, backgroundSize: '200% 100%' }
              })
            ),
            // Duration
            React.createElement('div', {
              className: 'w-10 h-4 rounded shimmer-light animate-shimmer',
              style: { backgroundSize: '200% 100%' }
            })
          )
        )
      ) :
      release.tracks.length > 0 ?
        React.createElement('div', { className: 'space-y-0' },
          release.tracks.map((track, index) => {
            // Build track ID first, then use it to look up resolved sources
            const trackId = trackSlug(release.artist.name || 'unknown', track.title || 'untitled', release.title || 'noalbum');
            const sources = trackSources[trackId] || {};
            const availableResolvers = Object.keys(sources).filter(id => activeResolvers.includes(id) && !sources[id]?.noMatch);
            // Tri-state for badge area: still-loading vs resolved-with-no-matches vs playable.
            // Set to true ONLY when resolution definitively completed across all enabled
            // resolvers and none returned a real match. Drives gray-out + skip-shimmer below.
            const hasNoMatches = sources.__noMatchAll === true;

            // Build track object for drag/drop and playback
            const trackForDrag = {
              ...track,
              id: trackId,
              artist: release.artist.name,
              album: release.title,
              albumArt: release.albumArt,
              sources: sources
            };

            // Check if this track is currently playing from this album
            const isCurrentTrack = currentTrack?.id === trackId;
            const isNowPlaying = isCurrentTrack && playbackContext?.type === 'album' && playbackContext?.id === release.id;

            return React.createElement('div', {
              key: index,
              'data-track-id': trackId,
              ref: (el) => {
                if (releaseTrackRowRefs) {
                  if (el) {
                    releaseTrackRowRefs.current.set(trackId, el);
                    if (releaseObserverRef?.current) {
                      releaseObserverRef.current.observe(el);
                    }
                  } else {
                    releaseTrackRowRefs.current.delete(trackId);
                  }
                }
              },
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track: trackForDrag }));
                if (onDragStart) {
                  onDragStart(trackForDrag);
                }
              },
              onDragEnd: () => {
                if (onDragEnd) {
                  onDragEnd();
                }
              },
              className: `flex items-center gap-4 py-3 px-4 cursor-grab active:cursor-grabbing transition-all no-drag group ${isNowPlaying ? 'bg-purple-50' : 'hover:bg-gray-50/80'}`,
              style: {
                borderRadius: '8px',
                marginBottom: '2px'
              },
              onClick: () => {
                console.log('Track row clicked:', track.title);

                // Play track with sources if resolved
                if (availableResolvers.length > 0) {
                  // Build queue from remaining tracks (after this one)
                  const tracksAfter = release.tracks.slice(index + 1).map((t, i) => {
                    const tId = trackSlug(release.artist.name || 'unknown', t.title || 'untitled', release.title || 'noalbum');
                    const tSources = trackSources[tId] || {};
                    return {
                      ...t,
                      id: tId,
                      artist: release.artist.name,
                      album: release.title,
                      albumArt: release.albumArt,
                      sources: tSources
                    };
                  });

                  if (onTrackPlay) {
                    onTrackPlay(trackForDrag, tracksAfter);
                  } else {
                    handlePlay(trackForDrag);
                  }
                } else {
                  // No resolved sources yet, fall back to search
                  console.log('No resolved sources, searching...');
                  handleSearch(`${release.artist.name} ${track.title}`);
                }
              },
              onContextMenu: (e) => {
                e.preventDefault();
                if (onTrackContextMenu) {
                  onTrackContextMenu(trackForDrag);
                }
              }
            },
              // Track number or playing indicator
              React.createElement('span', {
                className: 'w-6 flex-shrink-0 text-right',
                style: {
                  pointerEvents: 'none',
                  fontSize: '12px',
                  fontWeight: '500',
                  color: isNowPlaying ? 'var(--accent-secondary)' : 'var(--text-tertiary)'
                }
              }, isNowPlaying ? '▶' : String(track.position).padStart(2, '0')),

              // Track title — grays out when resolution definitively
              // completed with no matches on any enabled service. Stays
              // full-color while loading (sources empty but no __noMatchAll
              // marker) so the user doesn't see a flash of "unavailable"
              // before resolution finishes.
              React.createElement('span', {
                className: 'flex-1 truncate transition-colors',
                style: {
                  pointerEvents: 'none',
                  fontSize: '13px',
                  fontWeight: isNowPlaying ? '500' : '400',
                  color: isNowPlaying
                    ? 'var(--accent-primary)'
                    : (hasNoMatches ? 'var(--text-tertiary)' : 'var(--text-primary)'),
                  opacity: hasNoMatches ? 0.6 : 1
                }
              }, track.title),

              // Duration — also dims for unavailable rows so the whole row
              // reads as "not playable" at a glance.
              track.length && React.createElement('span', {
                className: 'flex-shrink-0 tabular-nums',
                style: {
                  pointerEvents: 'none',
                  fontSize: '12px',
                  color: 'var(--text-tertiary)',
                  opacity: hasNoMatches ? 0.6 : 1
                }
              }, formatDuration(track.length)),
              
              // Resolver icons (sources available for this track)
              React.createElement('div', {
                className: 'flex items-center gap-1 flex-shrink-0 ml-auto',
                style: { pointerEvents: 'none', minHeight: '24px', width: '140px', justifyContent: 'flex-end' }
              },
                (() => {
                  // Use availableResolvers from outer scope (already looked up via trackId)
                  const availableResolverIds = availableResolvers;

                  if (availableResolverIds.length === 0) {
                    // Resolution definitively completed with no matches →
                    // render nothing in the badge area. The grayed-out track
                    // title in the row already conveys "this track isn't
                    // playable from any enabled service" — a redundant label
                    // would just add noise.
                    if (hasNoMatches) return null;
                    // Otherwise: still resolving — show shimmer skeletons.
                    return React.createElement('div', {
                      className: 'flex items-center gap-1'
                    },
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded animate-shimmer',
                        style: {
                          background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
                          backgroundSize: '200% 100%'
                        },
                        title: 'Resolving track...'
                      }),
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded animate-shimmer',
                        style: {
                          background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
                          backgroundSize: '200% 100%',
                          animationDelay: '0.1s'
                        }
                      })
                    );
                  }

                  // Sort resolvers by priority order (left to right = highest to lowest priority)
                  const sortedResolverIds = [...availableResolverIds].sort((a, b) => {
                    const aIndex = resolvers.findIndex(r => r.id === a);
                    const bIndex = resolvers.findIndex(r => r.id === b);
                    return aIndex - bIndex;
                  });

                  // Show resolver icons for available sources (only if they support playback)
                  const bestConf = getBestSourceConfidence(sources);
                  return sortedResolverIds.map(resolverId => {
                    const resolver = resolvers.find(r => r.id === resolverId);
                    if (!resolver || !resolver.play) return null;

                    const source = sources[resolverId];
                    const confidence = source.confidence || 0;

                    return React.createElement('button', {
                      key: resolverId,
                      className: 'no-drag',
                      onClick: (e) => {
                        e.stopPropagation(); // Don't trigger row click
                        console.log(`Playing from ${resolver.name}:`, source);

                        // Create track with preferred resolver
                        const trackWithResolver = { ...trackForDrag, preferredResolver: resolverId };

                        // Build queue from remaining tracks (after this one)
                        const tracksAfter = release.tracks.slice(index + 1).map((t, i) => {
                          const tId = trackSlug(release.artist.name || 'unknown', t.title || 'untitled', release.title || 'noalbum');
                          const tSources = trackSources[tId] || {};
                          return {
                            ...t,
                            id: tId,
                            artist: release.artist.name,
                            album: release.title,
                            albumArt: release.albumArt,
                            sources: tSources
                          };
                        });

                        if (onTrackPlay) {
                          onTrackPlay(trackWithResolver, tracksAfter);
                        } else {
                          handlePlay(trackWithResolver);
                        }
                      },
                      style: {
                        width: '20px',
                        height: '20px',
                        borderRadius: '4px',
                        backgroundColor: resolver.color,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'auto',
                        opacity: confidence < bestConf ? 0.6 : 1,
                        transition: 'transform 0.1s'
                      },
                      onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                      onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                      title: `Play from ${resolver.name} (${Math.round(confidence * 100)}% match)`
                    }, React.createElement(ResolverIcon, { resolverId, size: 12 }));
                  });
                })()
              )
            );
          })
        )
      :
        React.createElement('div', { className: 'text-center py-12 text-gray-400' },
          'No track information available'
        )
    )
  );
};

module.exports = {
  generateArtistPattern,
  PlayTop10Icon,
  QueueTop10Icon,
  RelatedArtistCard,
  SearchArtistCard,
  SearchHistoryItem,
  CollectionArtistCard,
  CollectionAlbumCard,
  ReleaseCard,
  ReleasePage,
};
