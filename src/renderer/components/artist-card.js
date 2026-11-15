// src/renderer/components/artist-card.js: the artist card. Every grid of
// artists uses it: Collection, Search (its row and its Artists tab),
// Recommendations, History's and a friend's top artists, and the artist
// page's related artists.
//
// There were seven copies (two components in cards.js and five built inline),
// so each had drifted: some queued from the hover and some didn't, the play
// buttons were white on some and the card surface on others, one never
// opened a menu, and one played without the queue's context.
//
// Square photo (a shimmer while it loads, the name's pattern and initials
// when there's none), the name, an optional subtitle and corner badge, and on
// hover or keyboard focus one Play button: the artist's top 10. Queueing them
// is in the artist menu (onContextMenu), not the hover.
//
// Props:
//   artist         { id?, name, image? }
//   image, imageLoaded  the photo when the page already has it (imageLoaded
//                  false shows the shimmer); or
//   getArtistImage name => Promise<{ url }>: the card fetches its own photo
//   onOpen         opens the artist
//   onPlay         plays their top 10 (no Play button without it)
//   onContextMenu  (event) => opens the artist menu
//   badge          a node at the photo's top left (a rank, a reason badge)
//   subtitle       a line under the name ("123 plays")
//   tooltip        a note for the whole card (CardButton's tooltip)
//   width          a fixed width, for a horizontal row
//   animationDelay ms, for the fade-up
// Props-driven; hooks are qualified; loads under plain Node.

const { CardButton } = require('./card-button');
const { generateArtistPattern, PlayTop10Icon } = require('./cards');
const { slug } = require('../lib/track-slug');

function ArtistCard({ artist, image, imageLoaded, getArtistImage, onOpen, onPlay, onContextMenu, badge, subtitle, tooltip, width, animationDelay = 0, role }) {
  const e = React.createElement;
  const name = artist.name || '';
  const pattern = React.useMemo(() => generateArtistPattern(name), [name]);
  // A card that fetches its own photo: undefined while loading, null when
  // there's none, else the URL.
  const [fetched, setFetched] = React.useState(undefined);
  React.useEffect(() => {
    if (!getArtistImage) return undefined;
    let cancelled = false;
    setFetched(undefined);
    Promise.resolve(getArtistImage(name))
      .then((result) => { if (!cancelled) setFetched((result && result.url) || null); })
      .catch(() => { if (!cancelled) setFetched(null); });
    return () => { cancelled = true; };
  }, [name, !!getArtistImage]);
  const url = getArtistImage ? fetched : (image || null);
  const loading = getArtistImage ? fetched === undefined : imageLoaded === false;
  const noImage = !loading && !url;

  return e(CardButton, {
    label: name,
    role,
    tooltip,
    onActivate: onOpen,
    onContextMenu: onContextMenu ? (ev) => { ev.preventDefault(); ev.stopPropagation(); onContextMenu(ev); } : undefined,
    className: 'rounded-lg overflow-hidden group release-card card-fade-up' + (width ? ' flex-shrink-0' : ''),
    style: Object.assign(
      { backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', animationDelay: `${animationDelay}ms` },
      width ? { width } : null
    ),
    draggable: true,
    onDragStart: (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'artist',
        // The page's id, else the Unicode-safe slug of the name.
        artist: { id: artist.id || slug(name || 'unknown'), name, image: url || null },
      }));
    },
  },
    e('div', {
      'data-artist-art': '',
      className: 'aspect-square relative overflow-hidden',
      style: { background: noImage ? pattern.gradient : 'var(--placeholder-bg)' },
    },
      loading && e('div', { className: 'absolute inset-0 shimmer-strong animate-shimmer', style: { backgroundSize: '200% 100%' } }),
      noImage && e('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: { color: pattern.textColor, opacity: 0.4 },
      }, e('span', { className: 'font-bold tracking-wider', style: { fontSize: '48px', textShadow: '0 2px 8px rgba(0,0,0,0.3)' } }, pattern.initials)),
      url && e('img', {
        src: url,
        alt: '',
        className: 'card-zoom absolute inset-0 w-full h-full object-cover',
        style: { opacity: 0 },
        ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
        onLoad: (ev) => { ev.target.style.opacity = '1'; },
        onError: (ev) => { ev.target.style.display = 'none'; },
      }),
      badge,
      onPlay && e('div', {
        // CardButton's actions: shown on hover or keyboard focus.
        className: 'card-actions absolute inset-0 bg-black/50 flex items-center justify-center',
      },
        e('button', {
          type: 'button',
          onClick: (ev) => { ev.stopPropagation(); onPlay(artist); },
          className: 'w-12 h-12 bg-surface-card rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110',
          style: { border: 'none', cursor: 'pointer', padding: 0 },
          'aria-label': `Play ${name}’s top 10 tracks`, 'data-tooltip': 'Play top 10 tracks',
        }, e(PlayTop10Icon, { size: 26, className: 'text-ink-primary' })))),
    e('div', { className: 'p-3' },
      e('p', { className: 'font-medium text-ink-primary truncate text-sm', style: { margin: 0 } }, name),
      subtitle && e('p', { className: 'text-xs text-ink-tertiary mt-1', style: { marginBottom: 0 } }, subtitle))
  );
}

// The rank badge History and a friend's top artists put on the photo.
function RankBadge({ rank }) {
  return React.createElement('div', {
    className: 'absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded text-xs text-white font-medium',
    style: { zIndex: 2 },
  }, `#${rank}`);
}

module.exports = { ArtistCard, RankBadge };
