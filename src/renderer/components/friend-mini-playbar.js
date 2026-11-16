// src/renderer/components/friend-mini-playbar.js: the pill under a friend
// in the sidebar while they're listening: their track's art, and its title
// and artist (scrolling when too long); a click plays it. Always dark
// (--surface-dark). Moved out of settings-cards.js, which re-exports it.
// Props-driven; loads under plain Node.

// FriendMiniPlaybar component - shows friend's current track with album art lookup
const FriendMiniPlaybar = ({ track, getAlbumArt, onPlay, onContextMenu }) => {
  // States: undefined (fetching), null (no art found), string (URL)
  // Don't use Last.fm placeholder art as initial state - only use our cache
  const [artUrl, setArtUrl] = React.useState(undefined);
  const [isOverflowing, setIsOverflowing] = React.useState(false);
  const textRef = React.useRef(null);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    // Always try our cache system - never use Last.fm placeholder art
    if (!track.album || !track.artist) {
      // No album/artist info - show generic placeholder
      setArtUrl(null);
      return;
    }

    let cancelled = false;
    const loadArt = async () => {
      const fetchedArt = await getAlbumArt(track.artist, track.album);
      if (!cancelled) {
        // Only use our cached art, show generic placeholder if not found
        setArtUrl(fetchedArt || null);
      }
    };
    loadArt();
    return () => { cancelled = true; };
  }, [track.name, track.artist, track.album]);

  // Check if text overflows container (after render completes)
  React.useEffect(() => {
    // Use requestAnimationFrame to ensure DOM is fully rendered and measured
    const checkOverflow = () => {
      if (textRef.current && containerRef.current) {
        const textWidth = textRef.current.scrollWidth;
        const containerWidth = containerRef.current.clientWidth;
        setIsOverflowing(textWidth > containerWidth);
      }
    };

    // Run after paint to get accurate measurements
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(checkOverflow);
    });

    return () => cancelAnimationFrame(rafId);
  }, [track.name, track.artist]);

  return React.createElement('button', { type: 'button',
    className: 'text-left mt-1 flex items-center rounded cursor-pointer transition-colors pr-2',
    style: { maxWidth: '180px', height: '20px', backgroundColor: 'var(--surface-dark)', color: 'var(--on-dark-primary)' },
    onClick: onPlay,
    onContextMenu: onContextMenu
  },
    // Mini album art
    React.createElement('div', {
      className: 'flex-shrink-0',
      style: { width: '20px', height: '20px' }
    },
      artUrl
        ? React.createElement('img', {
            src: artUrl,
            alt: '',
            className: 'w-full h-full object-cover rounded-l'
          })
        : React.createElement('div', {
            className: 'w-full h-full rounded-l flex items-center justify-center',
            style: { backgroundColor: 'var(--surface-dark-placeholder)' } // on-dark
          },
            React.createElement('span', { 'aria-hidden': 'true', style: { fontSize: '11px', color: 'var(--on-dark-tertiary)' } }, '\u266A')
          )
    ),
    // Track info - only scrolls if overflowing
    React.createElement('div', {
      ref: containerRef,
      className: `flex-1 min-w-0 pl-2 flex items-center ${isOverflowing ? 'marquee-container' : ''}`,
      style: { overflow: 'hidden', height: '100%' }
    },
      React.createElement('span', {
        ref: textRef,
        className: `whitespace-nowrap inline-block ${isOverflowing ? 'animate-marquee' : ''}`,
        style: { fontSize: '11px', lineHeight: '20px' }
      },
        React.createElement('span', { className: 'text-white font-medium' }, track.name),
        // The pill is always dark (--surface-dark): a fixed on-dark colour,
        // never the theme's ink (text-ink-tertiary was 2.6:1 in light mode).
        React.createElement('span', { style: { color: 'var(--on-dark-secondary)' } }, ` - ${track.artist}`)
      )
    )
  );
};

module.exports = { FriendMiniPlaybar };
