/**
 * getArtistImage reads the Spotify token from spotifyTokenRef at call time.
 * ChatCard (the Shuffleupagus chat's track/album/artist card) is created once,
 * on the first render, so the getArtistImage it closes over is that render's,
 * where the spotifyToken state is still null. Reading the state there meant
 * every chat artist card came back without a photo (2026-10-27).
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

const body = (startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  return start === -1 || end === -1 ? '' : src.slice(start, end);
};

const getArtistImage = body('const getArtistImage = async (artistName, { mbid = null } = {}) => {', '\n  };\n');
const chatCard = body('chatCardRef.current = React.memo(', 'const ChatCard = chatCardRef.current;');

describe('getArtistImage token', () => {
  test('the markers this test depends on exist', () => {
    expect(getArtistImage.length).toBeGreaterThan(0);
    expect(chatCard).toContain('await getArtistImage(title)');
  });

  test('reads the token from the ref, with the state only as a fallback', () => {
    expect(getArtistImage).toContain('const token = spotifyTokenRef.current || spotifyToken;');
    // Every other use goes through the call-time token.
    const uses = getArtistImage.match(/\bspotifyToken\b/g) || [];
    expect(uses).toHaveLength(1);
    expect(getArtistImage).toContain('`Bearer ${token}`');
  });

  test('spotifyTokenRef is kept in sync with the state', () => {
    expect(src).toContain('useEffect(() => { spotifyTokenRef.current = spotifyToken; }, [spotifyToken]);');
  });
});
