// A hosted XSPF re-import (the launch reload, the 5-minute poll, Refresh)
// decides whether the playlist already exists BEFORE it touches React state
// (src/renderer/lib/hosted-import-target.js). It used to decide inside a
// setPlaylists updater and read the answer as soon as setPlaylists returned;
// React runs an updater then only when nothing else is waiting to render, so
// at launch the answer was always "new": every hosted playlist was rebuilt
// from its link on every launch (local edits lost, "modified" now, every
// track counted as added; 16 playlists, 2026-11-22).
const fs = require('fs');
const path = require('path');
const { existingHostedRecord } = require('../../src/renderer/lib/hosted-import-target');

describe('existingHostedRecord', () => {
  const url = 'https://example.com/list.xspf';
  const inState = { id: 'hosted-1', sourceUrl: url, title: 'state' };
  const onDisk = { id: 'hosted-1', sourceUrl: url, title: 'disk' };

  test('the copy in state first, then the one on disk', () => {
    expect(existingHostedRecord({ stateList: [inState], diskList: [onDisk], url, id: 'hosted-1' })).toBe(inState);
    expect(existingHostedRecord({ stateList: [], diskList: [onDisk], url, id: 'hosted-1' })).toBe(onDisk);
  });

  test('matches by link or by id', () => {
    expect(existingHostedRecord({ stateList: [{ id: 'hosted-1' }], url, id: 'hosted-1' })).toEqual({ id: 'hosted-1' });
    expect(existingHostedRecord({ stateList: [{ id: 'other', sourceUrl: url }], url, id: 'hosted-1' })).toEqual({ id: 'other', sourceUrl: url });
  });

  test('nothing found, or lists not loaded yet, is null', () => {
    expect(existingHostedRecord({ stateList: [], diskList: [], url, id: 'hosted-1' })).toBeNull();
    expect(existingHostedRecord({ stateList: null, diskList: undefined, url, id: 'hosted-1' })).toBeNull();
  });
});

describe('handleImportPlaylistFromUrl decides before it sets state', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = app.indexOf('const handleImportPlaylistFromUrl = async (');
  const body = app.slice(start, app.indexOf('\n  };\n', start));

  test('existing comes from existingHostedRecord, outside any updater', () => {
    expect(body).toMatch(/const existing = existingHostedRecord\(\{ stateList: playlistsRef\.current, diskList: onDisk, url, id \}\);/);
    expect(body).toMatch(/if \(existing\) \{/);
  });

  test('no answer is read back out of a setPlaylists updater', () => {
    expect(body).not.toMatch(/didUpdate = true/);
    expect(body).not.toMatch(/if \(didUpdate\)/);
  });
});
