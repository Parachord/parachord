/**
 * Protocol URL Handler for parachord:// deep links
 *
 * Parses and routes parachord:// URLs to appropriate handlers
 * for playback control, navigation, and AI chat.
 */

/**
 * Parse a parachord:// URL into a structured command object
 * @param {string} url - The full parachord:// URL
 * @returns {{ command: string, segments: string[], params: Record<string, string> }}
 */
function parseProtocolUrl(url) {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname
      .replace(/^\/+/, '')
      .split('/')
      .map(s => decodeURIComponent(s))
      .filter(Boolean);

    // Handle host as command (parachord://play vs parachord:///play)
    const host = parsed.host;
    let command, segments;

    if (host && host !== '') {
      // parachord://play?artist=X -> host is 'play', pathname might be empty or '/'
      command = host;
      segments = pathSegments;
    } else {
      // parachord:///artist/Big%20Thief -> no host, command in pathname
      [command, ...segments] = pathSegments;
    }

    const params = Object.fromEntries(parsed.searchParams);

    return { command: command || '', segments, params };
  } catch (error) {
    console.error('[ProtocolHandler] Failed to parse URL:', url, error);
    return { command: '', segments: [], params: {} };
  }
}

/**
 * Validate a parsed protocol command
 * @param {{ command: string, segments: string[], params: Record<string, string> }} parsed
 * @returns {{ valid: boolean, error?: string }}
 */
function validateProtocolCommand(parsed) {
  const { command, segments, params } = parsed;

  if (!command) {
    return { valid: false, error: 'No command specified' };
  }

  // Validate specific commands
  switch (command) {
    case 'play':
      // Requires at least artist or title
      if (!params.artist && !params.title) {
        return { valid: false, error: 'play requires artist and/or title parameters' };
      }
      break;

    case 'control':
      // Requires action segment
      const validActions = ['pause', 'resume', 'play', 'skip', 'previous', 'next'];
      if (!segments[0] || !validActions.includes(segments[0])) {
        return { valid: false, error: `control requires action: ${validActions.join(', ')}` };
      }
      break;

    case 'queue':
      // Requires sub-command
      const validQueueCommands = ['add', 'clear'];
      if (!segments[0] || !validQueueCommands.includes(segments[0])) {
        return { valid: false, error: `queue requires sub-command: ${validQueueCommands.join(', ')}` };
      }
      if (segments[0] === 'add' && !params.artist && !params.title) {
        return { valid: false, error: 'queue/add requires artist and/or title parameters' };
      }
      break;

    case 'shuffle':
      // Requires on/off segment
      if (segments[0] && !['on', 'off'].includes(segments[0])) {
        return { valid: false, error: 'shuffle requires on or off' };
      }
      break;

    case 'volume':
      // Requires numeric segment 0-100
      const vol = parseInt(segments[0], 10);
      if (isNaN(vol) || vol < 0 || vol > 100) {
        return { valid: false, error: 'volume requires a number between 0 and 100' };
      }
      break;

    case 'artist':
      // Requires artist name segment
      if (!segments[0]) {
        return { valid: false, error: 'artist requires artist name' };
      }
      break;

    case 'album':
      // Requires artist and album title segments
      if (!segments[0] || !segments[1]) {
        return { valid: false, error: 'album requires artist and album title' };
      }
      break;

    case 'friend':
      // Requires friend ID
      if (!segments[0]) {
        return { valid: false, error: 'friend requires friend ID' };
      }
      break;

    case 'playlist':
      // Requires playlist ID
      if (!segments[0]) {
        return { valid: false, error: 'playlist requires playlist ID' };
      }
      break;

    // Navigation commands that don't require validation
    case 'home':
    case 'library':
    case 'history':
    case 'recommendations':
    case 'charts':
    case 'critics-picks':
    case 'playlists':
    case 'settings':
    case 'now-playing':
    case 'search':
    case 'chat':
      break;

    default:
      return { valid: false, error: `Unknown command: ${command}` };
  }

  return { valid: true };
}

/**
 * Map URL-friendly tab names to internal tab names
 */
const tabMappings = {
  history: {
    'top-tracks': 'topTracks',
    'top-albums': 'topAlbums',
    'top-artists': 'topArtists',
    'recent': 'recent'
  },
  friend: {
    'top-tracks': 'topTracks',
    'top-artists': 'topArtists',
    'recent': 'recent'
  }
};

/**
 * Get internal tab name from URL-friendly name
 * @param {string} context - The command context (history, friend, etc.)
 * @param {string} tab - The URL-friendly tab name
 * @returns {string} - The internal tab name
 */
function mapTabName(context, tab) {
  return tabMappings[context]?.[tab] || tab;
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseProtocolUrl, validateProtocolCommand, mapTabName };
}

// Also export for ES modules / browser
if (typeof window !== 'undefined') {
  window.ProtocolHandler = { parseProtocolUrl, validateProtocolCommand, mapTabName };
}
