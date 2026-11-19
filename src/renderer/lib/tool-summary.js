// src/renderer/lib/tool-summary.js: the chat's reply when Shuffleupagus ran
// DJ tools but wrote no text of its own ("Added 3 tracks to queue. Shuffle
// enabled."). Was AIChatService.summarizeToolResults in app.js, with a copy
// in tests/chat/ai-chat-service.test.js; both use this now, so the test
// reads the app's words.
//
// Counts go through countOf (lib/plural.js): "1 track", never "1 track(s)".
//
// Pure; loads under plain Node.

'use strict';

const { countOf } = require('./plural');

function summarizeToolResults(toolResults) {
  if (!toolResults || toolResults.length === 0) return 'Done.';
  return toolResults.map(({ tool, result }) => {
    if (!result.success) return `Failed to ${tool}: ${result.error}`;
    switch (tool) {
      case 'play': return result.track ? `Now playing "${result.track.title}" by ${result.track.artist}` : 'Started playback';
      case 'control': return `Playback ${result.action}`;
      case 'search': return `Found ${countOf(result.results?.length, 'result')}`;
      case 'queue_add': {
        const skipped = (result.notFound || []).map((t) => `"${t.title}" by ${t.artist}`).join(', ');
        return `Added ${countOf(result.added, 'track')} to queue${skipped ? `. Could not find ${skipped}` : ''}`;
      }
      case 'queue_clear': return 'Queue cleared';
      case 'create_playlist': return `Created playlist "${result.playlist?.name}"`;
      case 'shuffle': return `Shuffle ${result.shuffle ? 'enabled' : 'disabled'}`;
      case 'collection_radio': return `Started Collection Radio with ${countOf(result.trackCount, 'track')}`;
      case 'get_playlists': return `Found ${countOf(result.total, 'playlist')}`;
      case 'get_playlist_tracks': return `Loaded ${countOf(result.playlist?.trackCount, 'track')} from "${result.playlist?.name}"`;
      case 'add_to_playlist': return `Added ${countOf(result.added, 'track')} to "${result.playlist?.name}"`;
      case 'remove_from_playlist': return `Removed "${result.removed?.title}" from "${result.playlist?.name}"`;
      case 'reorder_playlist': return `Moved track in "${result.playlist?.name}"`;
      case 'rename_playlist': return `Renamed "${result.oldName}" to "${result.newName}"`;
      case 'delete_playlist': return `Deleted playlist "${result.deleted?.name}"`;
      default: return `${tool} completed`;
    }
  }).join('. ') + '.';
}

module.exports = { summarizeToolResults };
