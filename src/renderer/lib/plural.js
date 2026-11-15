// src/renderer/lib/plural.js: "1 track", "2 tracks", "1,204 tracks". Every
// count in UI text goes through countOf, so a single item never reads
// "1 tracks" (#1388). Plain module; loads under plain Node.

// The number, grouped for the reader, and the word in the form it takes.
// pluralForm defaults to singular + "s".
function countOf(n, singular, pluralForm) {
  const num = Number(n) || 0;
  const word = num === 1 ? singular : (pluralForm || `${singular}s`);
  return `${num.toLocaleString('en-US')} ${word}`;
}

module.exports = { countOf };
