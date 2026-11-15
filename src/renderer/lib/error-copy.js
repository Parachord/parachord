// src/renderer/lib/error-copy.js: what an error says to the reader (#1388).
//
// A raw error.message ("Last.fm API error: 500", "Failed to fetch",
// "Cannot read properties of undefined") never reaches UI text. Code that
// throws something a person should read throws userError("…"); every toast
// or dialog shows errorText(error, fallback), which is that message or the
// caller's own "Couldn't X. What to do." line. Log the raw error separately.
// Plain module; loads under plain Node.

// An Error whose message is written for the reader.
function userError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

// The reader's text for an error: its userMessage, or the fallback.
function errorText(error, fallback) {
  return (error && typeof error.userMessage === 'string' && error.userMessage) || fallback;
}

module.exports = { userError, errorText };
