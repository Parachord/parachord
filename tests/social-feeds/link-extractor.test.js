/**
 * Link Extractor Tests
 *
 * Tests for extracting music service URLs from social media post text.
 */

const { extractMusicLinks, extractLinksFromPosts, inferLinkType } = require('../../social-feeds/link-extractor');

describe('extractMusicLinks', () => {
  test('extracts Spotify track URLs', () => {
    const text = 'Check out this song https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6 so good!';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('spotify');
    expect(links[0].type).toBe('track');
    expect(links[0].url).toBe('https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6');
  });

  test('extracts Spotify album URLs', () => {
    const text = 'New album dropped https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('spotify');
    expect(links[0].type).toBe('album');
  });

  test('extracts Spotify playlist URLs', () => {
    const text = 'My playlist https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('spotify');
    expect(links[0].type).toBe('playlist');
  });

  test('extracts Spotify URIs', () => {
    const text = 'Listen to spotify:track:6rqhFgbbKwnb9MLmUQDhG6';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('spotify');
    expect(links[0].type).toBe('track');
  });

  test('extracts Apple Music URLs', () => {
    const text = 'Check this out https://music.apple.com/us/album/dark-matter/1234567890';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('applemusic');
    expect(links[0].type).toBe('album');
  });

  test('extracts YouTube URLs', () => {
    const text = 'Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('youtube');
    expect(links[0].type).toBe('track');
  });

  test('extracts YouTube shortlinks', () => {
    const text = 'Listen https://youtu.be/dQw4w9WgXcQ';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('youtube');
    expect(links[0].url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  test('extracts YouTube Music URLs', () => {
    const text = 'Vibes https://music.youtube.com/watch?v=dQw4w9WgXcQ';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('youtube');
  });

  test('extracts SoundCloud URLs', () => {
    const text = 'New upload https://soundcloud.com/artist-name/track-name';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('soundcloud');
    expect(links[0].type).toBe('track');
  });

  test('extracts Bandcamp track URLs', () => {
    const text = 'Buy this https://artist.bandcamp.com/track/some-song';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('bandcamp');
    expect(links[0].type).toBe('track');
  });

  test('extracts Bandcamp album URLs', () => {
    const text = 'Full album https://artist.bandcamp.com/album/some-album';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('bandcamp');
    expect(links[0].type).toBe('album');
  });

  test('extracts Tidal URLs', () => {
    const text = 'Listen on Tidal https://tidal.com/browse/track/12345678';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('tidal');
    expect(links[0].type).toBe('track');
  });

  test('extracts Deezer URLs', () => {
    const text = 'On Deezer https://www.deezer.com/track/12345678';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('deezer');
    expect(links[0].type).toBe('track');
  });

  test('extracts Parachord smart link URLs', () => {
    const text = 'Share link https://parachord.link/abc123';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].service).toBe('parachord');
  });

  test('extracts multiple links from a single post', () => {
    const text = 'Spotify: https://open.spotify.com/track/abc123 and YouTube: https://www.youtube.com/watch?v=xyz789';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(2);
    expect(links.map(l => l.service)).toEqual(expect.arrayContaining(['spotify', 'youtube']));
  });

  test('deduplicates identical URLs', () => {
    const text = 'https://open.spotify.com/track/abc123 and again https://open.spotify.com/track/abc123';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
  });

  test('returns empty array for text with no music links', () => {
    const text = 'Just a regular post with no music links at all.';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(0);
  });

  test('returns empty array for null/undefined/empty input', () => {
    expect(extractMusicLinks(null)).toHaveLength(0);
    expect(extractMusicLinks(undefined)).toHaveLength(0);
    expect(extractMusicLinks('')).toHaveLength(0);
  });

  test('handles URLs at end of text without trailing space', () => {
    const text = 'Check this https://open.spotify.com/track/abc123';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
  });

  test('handles URLs in parentheses', () => {
    const text = 'Great song (https://open.spotify.com/track/abc123)';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    // URL should not include the closing paren
    expect(links[0].url).not.toContain(')');
  });

  test('handles Spotify URLs with query parameters', () => {
    const text = 'Share https://open.spotify.com/track/abc123?si=xyz789';
    const links = extractMusicLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].url).toContain('?si=xyz789');
  });
});

describe('inferLinkType', () => {
  test('identifies track links', () => {
    expect(inferLinkType('https://open.spotify.com/track/abc', 'spotify')).toBe('track');
    expect(inferLinkType('spotify:track:abc', 'spotify')).toBe('track');
    expect(inferLinkType('https://music.apple.com/us/song/abc', 'applemusic')).toBe('track');
  });

  test('identifies album links', () => {
    expect(inferLinkType('https://open.spotify.com/album/abc', 'spotify')).toBe('album');
    expect(inferLinkType('https://artist.bandcamp.com/album/abc', 'bandcamp')).toBe('album');
  });

  test('identifies playlist links', () => {
    expect(inferLinkType('https://open.spotify.com/playlist/abc', 'spotify')).toBe('playlist');
    expect(inferLinkType('spotify:playlist:abc', 'spotify')).toBe('playlist');
  });

  test('defaults youtube to track', () => {
    expect(inferLinkType('https://www.youtube.com/watch?v=abc', 'youtube')).toBe('track');
  });

  test('defaults soundcloud to track', () => {
    expect(inferLinkType('https://soundcloud.com/artist/track', 'soundcloud')).toBe('track');
  });
});

describe('extractLinksFromPosts', () => {
  test('extracts links from multiple posts with metadata', () => {
    const posts = [
      {
        id: 'post1',
        text: 'Check out https://open.spotify.com/track/abc123',
        author: 'alice',
        createdAt: '2025-01-15T10:00:00Z',
        url: 'https://threads.net/@alice/post/post1'
      },
      {
        id: 'post2',
        text: 'No music here, just vibes.',
        author: 'bob',
        createdAt: '2025-01-15T11:00:00Z',
        url: 'https://threads.net/@bob/post/post2'
      },
      {
        id: 'post3',
        text: 'Two links: https://youtu.be/xyz789 and https://artist.bandcamp.com/track/cool-song',
        author: 'charlie',
        createdAt: '2025-01-15T12:00:00Z',
        url: 'https://threads.net/@charlie/post/post3'
      }
    ];

    const results = extractLinksFromPosts(posts);
    expect(results).toHaveLength(3);

    // First post: Spotify track
    expect(results[0].service).toBe('spotify');
    expect(results[0].post.id).toBe('post1');
    expect(results[0].post.author).toBe('alice');

    // Third post: YouTube + Bandcamp
    const post3Links = results.filter(r => r.post.id === 'post3');
    expect(post3Links).toHaveLength(2);
    expect(post3Links.map(l => l.service)).toEqual(expect.arrayContaining(['youtube', 'bandcamp']));
  });

  test('returns empty array for posts with no music links', () => {
    const posts = [
      { id: '1', text: 'Hello world', author: 'user', createdAt: new Date().toISOString(), url: 'url' }
    ];
    expect(extractLinksFromPosts(posts)).toHaveLength(0);
  });

  test('handles empty posts array', () => {
    expect(extractLinksFromPosts([])).toHaveLength(0);
  });
});
