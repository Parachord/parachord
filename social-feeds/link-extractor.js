// social-feeds/link-extractor.js
// Extracts music service URLs from social media post text.
// Recognises Spotify, Apple Music, YouTube, SoundCloud, Bandcamp,
// Tidal, Deezer, and Parachord smart-link URLs.

// Each pattern maps a service id to a regex that matches its track/album/playlist URLs.
const SERVICE_PATTERNS = [
  {
    service: 'spotify',
    // open.spotify.com/track|album|playlist/ID  or  spotify:track:ID
    patterns: [
      /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/[A-Za-z0-9]+[^\s)}\]"]*/g,
      /spotify:(track|album|playlist):[A-Za-z0-9]+/g
    ]
  },
  {
    service: 'applemusic',
    // music.apple.com links (various country-code paths)
    patterns: [
      /https?:\/\/music\.apple\.com\/[a-z]{2}\/(album|playlist|song)\/[^\s)}\]"]*/g
    ]
  },
  {
    service: 'youtube',
    // youtube.com/watch, youtu.be shortlinks, and youtube music
    patterns: [
      /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s)}\]"]*/g,
      /https?:\/\/youtu\.be\/[A-Za-z0-9_-]+[^\s)}\]"]*/g,
      /https?:\/\/music\.youtube\.com\/watch\?[^\s)}\]"]*/g
    ]
  },
  {
    service: 'soundcloud',
    patterns: [
      /https?:\/\/(?:www\.)?soundcloud\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+[^\s)}\]"]*/g
    ]
  },
  {
    service: 'bandcamp',
    // *.bandcamp.com/track|album
    patterns: [
      /https?:\/\/[A-Za-z0-9_-]+\.bandcamp\.com\/(track|album)\/[^\s)}\]"]*/g
    ]
  },
  {
    service: 'tidal',
    patterns: [
      /https?:\/\/(?:www\.)?tidal\.com\/(?:browse\/)?(track|album|playlist)\/[^\s)}\]"]*/g
    ]
  },
  {
    service: 'deezer',
    patterns: [
      /https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist)\/[^\s)}\]"]*/g
    ]
  },
  {
    service: 'parachord',
    // Parachord smart links (parachord.link and go.parachord.com)
    patterns: [
      /https?:\/\/(?:www\.)?parachord\.link\/[^\s)}\]"]*/g,
      /https?:\/\/go\.parachord\.com\/[^\s)}\]"]*/g
    ]
  }
];

/**
 * Extract all music links from a text string.
 * Returns an array of { url, service, type } objects.
 *   type is one of 'track', 'album', 'playlist', or 'unknown'.
 */
function extractMusicLinks(text) {
  if (!text || typeof text !== 'string') return [];

  const results = [];
  const seen = new Set();

  for (const { service, patterns } of SERVICE_PATTERNS) {
    for (const pattern of patterns) {
      // Reset lastIndex for global regexps
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const url = match[0];
        if (seen.has(url)) continue;
        seen.add(url);

        results.push({
          url,
          service,
          type: inferLinkType(url, service)
        });
      }
    }
  }

  return results;
}

/**
 * Try to determine whether a link points to a track, album, or playlist.
 */
function inferLinkType(url, service) {
  const lower = url.toLowerCase();

  if (lower.includes('/track/') || lower.includes(':track:') || lower.includes('/song/')) {
    return 'track';
  }
  if (lower.includes('/album/')) {
    return 'album';
  }
  if (lower.includes('/playlist/') || lower.includes(':playlist:')) {
    return 'playlist';
  }
  // YouTube watch links are typically single tracks
  if (service === 'youtube') {
    return 'track';
  }
  // SoundCloud individual track URLs (artist/track)
  if (service === 'soundcloud') {
    return 'track';
  }

  return 'unknown';
}

/**
 * Process an array of social posts and return all music links found.
 * Each returned item includes the originating post metadata.
 *
 * @param {Array<{id, text, author, createdAt, url}>} posts
 * @returns {Array<{url, service, type, post: {id, author, createdAt, url}}>}
 */
function extractLinksFromPosts(posts) {
  const allLinks = [];

  for (const post of posts) {
    const links = extractMusicLinks(post.text);
    for (const link of links) {
      allLinks.push({
        ...link,
        post: {
          id: post.id,
          author: post.author,
          createdAt: post.createdAt,
          url: post.url
        }
      });
    }
  }

  return allLinks;
}

module.exports = {
  extractMusicLinks,
  extractLinksFromPosts,
  inferLinkType,
  SERVICE_PATTERNS
};
