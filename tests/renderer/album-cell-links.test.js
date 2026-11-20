// An album column in a track list opens the album, on every page (#1563):
// History's Recent plays and Top tracks (and a friend's) showed the album as
// plain text, so a click on it fell through to the row and played the song,
// while Collection and Search already opened the album. TrackRow makes a cell
// with onClick a link (components/track-lists.js).
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../../src/renderer/components');

test('every track-list album cell with content is a link', () => {
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\{ key: 'album', content:[^}]*\}/g)) {
      if (!/onClick:/.test(m[0])) offenders.push(`${f}: ${m[0].slice(0, 80)}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('History and a friend\'s history open the album the row names', () => {
  for (const f of ['history-page.js', 'friend-history-page.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    expect((src.match(/onClick: track\.album \? \(\) => openTopAlbum\(\{ artist: track\.artist, name: track\.album, image: track\.albumArt \}\) : undefined/g) || []).length).toBe(2);
  }
});
