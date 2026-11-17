// src/renderer/lib/ai-generate.js: an AI playlist from any AI plug-in.
//
// A plug-in with `generate` (ChatGPT, Gemini, Custom LLM) builds the
// playlist itself. A plug-in with only `chat` (Claude, Ollama, any future
// chat plug-in) gets the same request through chat: the same system prompt
// as chatgpt's generate, sent as [system, user] with no tools, and the JSON
// array read out of the reply the same way. Routed by capability, never by
// plug-in name, so a new chat plug-in makes AI playlists with no code of its
// own (2026-11-17).
//
// Pure; loads under plain Node.

'use strict';

const { userError } = require('./error-copy');

const PLAYLIST_SYSTEM_PROMPT =
  'You are a music expert. Generate a playlist based on the user\'s request. Return ONLY a JSON array of objects with "title" and "artist" fields. No explanations, just the JSON array. Example: [{"title": "Song Name", "artist": "Artist Name"}]';

// The system prompt, with the listening history appended when given.
function playlistSystemPrompt(listeningContext) {
  return listeningContext
    ? `${PLAYLIST_SYSTEM_PROMPT}\n\nUser's listening history for context:\n${JSON.stringify(listeningContext)}`
    : PLAYLIST_SYSTEM_PROMPT;
}

// The [system, user] messages a chat plug-in gets.
function playlistMessages(prompt, listeningContext) {
  return [
    { role: 'system', content: playlistSystemPrompt(listeningContext) },
    { role: 'user', content: prompt },
  ];
}

const PARSE_ERROR = 'Couldn’t read a playlist from the AI’s answer. Try again, or try a different prompt.';

// The track array in a reply: the first [ {…} ] in it (inside a ``` fence or
// around prose), else the whole reply as JSON.
function parsePlaylist(content) {
  const text = typeof content === 'string' ? content : '';
  let parsed;
  try {
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    parsed = JSON.parse(match ? match[0] : text);
  } catch (e) {
    throw userError(PARSE_ERROR);
  }
  if (!Array.isArray(parsed)) throw userError(PARSE_ERROR);
  return parsed;
}

// An AI playlist through a chat-only plug-in.
async function generateViaChat(service, prompt, config, listeningContext) {
  const response = await service.chat(playlistMessages(prompt, listeningContext), [], config || {});
  return parsePlaylist(response && response.content);
}

// Whether a plug-in can make an AI playlist: its own generate, or chat.
function canMakePlaylist(service) {
  const caps = (service && service.capabilities) || {};
  return !!(caps.generate || caps.chat);
}

// An AI playlist from `service`: its own generate when it has one, else the
// chat fallback.
async function generateAiPlaylist(service, prompt, config, listeningContext) {
  if (service?.capabilities?.generate && typeof service.generate === 'function') {
    return service.generate(prompt, config, listeningContext);
  }
  if (service?.capabilities?.chat && typeof service.chat === 'function') {
    return generateViaChat(service, prompt, config, listeningContext);
  }
  throw userError(`${service?.name || 'This plug-in'} isn’t ready yet. Try again in a moment.`);
}

module.exports = { generateAiPlaylist, generateViaChat, parsePlaylist, playlistMessages, playlistSystemPrompt, canMakePlaylist, PLAYLIST_SYSTEM_PROMPT };
