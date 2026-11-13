// src/renderer/components/playlist-cover.js — a playlist's own cover image.
//
// A playlist record can carry `coverArt`: the image the provider gave for the
// playlist itself (an Amazon Music recommended playlist's image — the same one
// the Recommendations page's card shows — or a Spotify / Apple Music playlist
// lookup's `albumArt`; see "the resolver contract" in
// docs/architecture/plugins.md). It is NOT album art: it never goes through the
// album-art pipeline (getAlbumArt) and never into albumArtCache, and a track
// never carries it as its own albumArt — that is the 4×-tiled-mosaic bug: the
// playlist cover used to be stamped on every track, and the 2×2 mosaic built
// from those tracks showed the same image four times.
//
// Rendered as a layer OVER the surface's own fallback (the 2×2 mosaic of
// track covers, or the placeholder): it fades in when it loads, and a URL
// that fails to load removes itself so the layer underneath shows again — a
// dead cover degrades to the mosaic, never to a blank box (the broken-art
// rule's spirit; reportBrokenAlbumArt's cache keys are album-shaped, and the
// playlist cover lives on the playlist record, not in a cache, so the
// fallback here is visual only). The parent box must be `relative` (every
// playlist-cover box already is). Purely presentational: no app state.
// React is the renderer's vendor global (loaded by index.html before app.js;
// jest and the smoke test set it before requiring this module).

// `url`: the playlist's cover URL, or null/undefined (nothing renders, the
// caller's fallback layer shows alone).
const PlaylistCoverImage = ({ url }) => {
  const [broken, setBroken] = React.useState(false);
  // A fresh URL (a refresh swapped the playlist's cover) retries instead of
  // staying dropped.
  React.useEffect(() => { setBroken(false); }, [url]);
  if (!url || broken) return null;
  return React.createElement('img', {
    // Keyed on the URL: React reuses the element (and its cached load) when
    // the playlist is re-rendered with the same cover, and remounts it when
    // a refresh swaps the URL, so the fade-in plays again.
    key: url,
    src: url,
    alt: '',
    className: 'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
    style: { opacity: 0 },
    ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
    onLoad: (e) => { e.target.style.opacity = '1'; },
    onError: () => setBroken(true),
  });
};

module.exports = { PlaylistCoverImage };
