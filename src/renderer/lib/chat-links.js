// src/renderer/lib/chat-links.js: what a link in a Shuffleupagus reply may
// open (#1581).
//
// A reply's text can be steered by what the model reads (track and playlist
// names, plug-in data), so a link labelled "Spotify" could point anywhere.
// A link is clickable only when it is
//   - http(s), opened in the browser; or
//   - parachord:// with one of the commands the chat handles itself
//     (CHAT_PARACHORD_COMMANDS), parsed here into { command, segments,
//     params }.
// Anything else (file:, tel:, sms:, javascript:, another app's scheme, a
// parachord:// command the chat doesn't handle) is null: renderChatContent
// shows the link's text as plain text, with no href.
//
// Android and iOS share a port of this parser and keep the same links.
// Plain module; loads under plain Node.

const CHAT_PARACHORD_COMMANDS = ['artist', 'album', 'play', 'queue', 'playlist', 'search'];

function chatLinkTarget(raw) {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  let parsed;
  try { parsed = new URL(url); } catch (_e) { return null; }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme === 'http:' || scheme === 'https:') return { kind: 'external', url: parsed.href };
  if (scheme !== 'parachord:') return null;

  // parachord://artist/Radiohead has the command as its host;
  // parachord:///artist/Radiohead has it as the first path segment.
  let segments;
  try {
    segments = parsed.pathname.replace(/^\/+/, '').split('/').map((s) => decodeURIComponent(s)).filter(Boolean);
  } catch (_e) { return null; }
  let command;
  if (parsed.host) command = parsed.host;
  else [command, ...segments] = segments;
  command = String(command || '').toLowerCase();
  if (!CHAT_PARACHORD_COMMANDS.includes(command)) return null;
  return { kind: 'parachord', url, command, segments, params: Object.fromEntries(parsed.searchParams) };
}

module.exports = { chatLinkTarget, CHAT_PARACHORD_COMMANDS };
