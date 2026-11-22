// A playlist's saved XSPF text is used only while it lists the playlist's own
// tracks. A sync pull rewrites `tracks` in the main process and leaves the
// text as it was, so the playlist page showed the last renderer save's list
// (Daily Brew showed Nov 19's tracks on Nov 22, after the pull had landed).
const fs = require('fs');
const path = require('path');
const { storedXspfFor } = require('../../src/renderer/lib/stored-xspf');

const docFor = (tracks) => `<playlist>${tracks.map(t => `<track><creator>${t.artist}</creator><title>${t.title}</title></track>`).join('')}</playlist>`;
// A stand-in for app.js's parseXSPF: reads back what docFor wrote.
const parse = (xml) => ({
  tracks: [...xml.matchAll(/<creator>(.*?)<\/creator><title>(.*?)<\/title>/g)].map(m => ({ artist: m[1], title: m[2] }))
});

const nov19 = [{ artist: 'Bad Books', title: 'Please Move' }, { artist: 'Elephant Stone', title: 'Andromeda' }];
const nov22 = [{ artist: 'Courtney Barnett', title: 'History Eraser' }, { artist: 'Kurt Vile', title: 'When Your Lonely Heart Breaks' }];

describe('storedXspfFor', () => {
  test('a pull that changed the tracks makes the saved text stale: it is not used', () => {
    expect(storedXspfFor({ tracks: nov22, xspf: docFor(nov19) }, parse)).toBeNull();
  });

  test('saved text that lists the same tracks is used (an export keeps the file as it was)', () => {
    const xspf = docFor(nov22);
    expect(storedXspfFor({ tracks: nov22.map(t => ({ ...t, albumArt: 'x' })), xspf }, parse)).toBe(xspf);
  });

  test('a playlist with only the text (no stored tracks) uses the text', () => {
    const xspf = docFor(nov19);
    expect(storedXspfFor({ xspf }, parse)).toBe(xspf);
    expect(storedXspfFor({ tracks: [], xspf }, parse)).toBe(xspf);
  });

  test('no text, or text that does not parse, is nothing to use', () => {
    expect(storedXspfFor({ tracks: nov22 }, parse)).toBeNull();
    expect(storedXspfFor({ tracks: nov22, xspf: 'not xml' }, () => null)).toBeNull();
    expect(storedXspfFor(null, parse)).toBeNull();
  });
});

describe('the readers go through it', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('opening a playlist parses the saved text only when storedXspfFor allows it', () => {
    expect(app).toMatch(/const storedXspf = storedXspfFor\(playlist, parseXSPF\);\s*if \(storedXspf\) \{\s*const parsed = parseXSPF\(storedXspf\);/);
    expect(app).not.toMatch(/\n\s*if \(playlist\.xspf\) \{\s*const parsed = parseXSPF\(playlist\.xspf\);/);
  });

  test('Export writes the saved text only when storedXspfFor allows it', () => {
    expect(app).toMatch(/withPlaylistImage\(storedXspfFor\(playlist, parseXSPF\) \|\| generateXSPF\(/);
  });
});
