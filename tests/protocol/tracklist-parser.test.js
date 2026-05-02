const { parseProtocolTracklist } = require('../helpers/tracklist-parser');

describe('parseProtocolTracklist', () => {
  test('parses LB lb-radio JSPF response', () => {
    const body = JSON.stringify({
      playlist: {
        title: 'Shoegaze radio',
        track: [
          { title: 'Sometimes', creator: 'My Bloody Valentine', album: 'Loveless' },
          { title: 'Vapour Trail', creator: 'Ride', album: 'Nowhere',
            identifier: ['https://musicbrainz.org/recording/abc-123'] },
        ]
      }
    });
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.displayName).toBe('Shoegaze radio');
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0]).toMatchObject({ artist: 'My Bloody Valentine', title: 'Sometimes', album: 'Loveless' });
    expect(r.tracks[1].mbid).toBe('abc-123');
  });

  test('parses generic { tracks: [...] } JSON', () => {
    const body = JSON.stringify({
      tracks: [{ artist: 'X', title: 'Y', album: 'Z', mbid: 'aaa' }]
    });
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]).toMatchObject({ artist: 'X', title: 'Y', mbid: 'aaa' });
  });

  test('parses XSPF from text/xml', () => {
    const xml = `<?xml version="1.0"?>
      <playlist xmlns="http://xspf.org/ns/0/" version="1">
        <title>Test</title>
        <trackList>
          <track><title>Song A</title><creator>Artist A</creator><album>Album A</album></track>
        </trackList>
      </playlist>`;
    const r = parseProtocolTracklist(xml, 'application/xspf+xml');
    expect(r.displayName).toBe('Test');
    expect(r.tracks).toEqual([{ artist: 'Artist A', title: 'Song A', album: 'Album A' }]);
  });

  test('returns empty tracks when JSON has no recognizable shape', () => {
    const r = parseProtocolTracklist(JSON.stringify({ foo: 'bar' }), 'application/json');
    expect(r.tracks).toEqual([]);
  });

  test('returns empty tracks on parse failure', () => {
    const r = parseProtocolTracklist('not json', 'application/json');
    expect(r.tracks).toEqual([]);
  });

  test('strips MBID from MusicBrainz URL identifier', () => {
    const body = JSON.stringify({ playlist: { track: [
      { title: 'T', creator: 'A',
        identifier: ['https://musicbrainz.org/recording/55555-aaaa-bbbb'] }
    ]}});
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks[0].mbid).toBe('55555-aaaa-bbbb');
  });
});
