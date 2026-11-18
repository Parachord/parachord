// src/renderer/lib/ai-provider-errors.js: what Shuffleupagus says when the
// AI plug-in's request fails.
//
// The plug-in words its own failures first: an AI plug-in may implement
// describeError(error, config) and return { message, serverUnavailable } (or
// null to leave it to the app). Ollama names its local server and the
// `ollama pull` fix; Custom LLM's errors already carry endpoint-specific hints
// (the /v1 path on a 404), so it passes them through. This used to be four
// branches on the provider's id in AIChatService (#1523); now a new AI
// plug-in brings its own wording and the app needs no change
// (CLAUDE.md "Route by the plugin registry").
//
// `serverUnavailable: true` means "the model runs in a server on this
// computer and it isn't answering": the chat panel then offers to start it.
//
// Pure; loads under plain Node.

'use strict';

// The plug-in's own wording, or null when it has none (no describeError, a
// throw, or a reply without a message).
function pluginDescription(error, provider) {
  if (!provider || typeof provider.describeError !== 'function') return null;
  let described = null;
  try {
    described = provider.describeError(error, provider.config || {});
  } catch (e) {
    console.error('AI plug-in describeError failed:', e);
    return null;
  }
  if (!described || typeof described.message !== 'string' || !described.message) return null;
  return { message: described.message, serverUnavailable: described.serverUnavailable === true };
}

// describeProviderError(error, provider) → { message, serverUnavailable }
function describeProviderError(error, provider) {
  const own = pluginDescription(error, provider);
  if (own) return own;

  const message = (error && error.message) || '';
  const lowerMessage = message.toLowerCase();
  const say = (text) => ({ message: text, serverUnavailable: false });

  // Connection errors (network issues)
  if (lowerMessage.includes('failed to fetch') || lowerMessage.includes('econnrefused') || lowerMessage.includes('network')) {
    return say("Can't connect to the AI service. Check your internet connection.");
  }

  // Quota/rate limit errors (Gemini, OpenAI)
  if (lowerMessage.includes('quota') || lowerMessage.includes('exceeded')) {
    return say('API quota exceeded. Check your plan limits or try again later.');
  }
  if (message.includes('429') || lowerMessage.includes('rate limit')) {
    return say('Rate limit reached. Please wait a moment and try again.');
  }

  // Auth errors
  if (message.includes('401') || lowerMessage.includes('unauthorized') || lowerMessage.includes('invalid api key')) {
    return say('Invalid API key. Please check your settings.');
  }

  // Model not found
  if (message.includes('404') || lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
    return say('AI model not found. Check your settings or try a different model.');
  }

  // Content policy errors
  if (lowerMessage.includes('content policy') || lowerMessage.includes('safety')) {
    return say('Request was blocked by content policy. Try rephrasing.');
  }

  // Generic error - truncate long messages
  const shortMessage = message.length > 100 ? message.substring(0, 100) + '…' : message;
  return say(`Error: ${shortMessage}`);
}

module.exports = { describeProviderError };
