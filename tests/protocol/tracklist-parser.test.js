const { parseProtocolTracklist } = require('../helpers/tracklist-parser');

describe('parseProtocolTracklist', () => {
  test('parses LB lb-radio JSPF response', () => {
    const body = JSON.stringify({
      playlist: {
        title: 'Shoegaze radio',
        track: [
          { title: 'Sometimes', creator: 'My Bloody Valentine', album: 'Loveless' },
          { title: 'Vapour Trail', creator: 'Ride', album: 'Nowhere',
            identifier: ['https://musicbrainz.org/recording/c6f76443-9f1a-4f0b-b8b1-22ddc5a25b7e'] },
        ]
      }
    });
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.displayName).toBe('Shoegaze radio');
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0]).toMatchObject({ artist: 'My Bloody Valentine', title: 'Sometimes', album: 'Loveless' });
    expect(r.tracks[1].mbid).toBe('c6f76443-9f1a-4f0b-b8b1-22ddc5a25b7e');
  });

  test('parses generic { tracks: [...] } JSON', () => {
    const body = JSON.stringify({
      tracks: [{ artist: 'X', title: 'Y', album: 'Z', mbid: 'c6f76443-9f1a-4f0b-b8b1-22ddc5a25b7e' }]
    });
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]).toMatchObject({ artist: 'X', title: 'Y', mbid: 'c6f76443-9f1a-4f0b-b8b1-22ddc5a25b7e' });
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
        identifier: ['https://musicbrainz.org/recording/c6f76443-9f1a-4f0b-b8b1-22ddc5a25b7e'] }
    ]}});
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks[0].mbid).toBe('c6f76443-9f1a-4f0b-b8b1-22ddc5a25b7e');
  });

  test('rejects MBID-shaped identifiers that are not 36-char UUID', () => {
    const body = JSON.stringify({ playlist: { track: [
      { title: 'T', creator: 'A', identifier: ['https://musicbrainz.org/recording/abc-123'] }
    ]}});
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks[0].mbid).toBeUndefined();
  });

  test('handles JSPF creator as array (joined with comma-space)', () => {
    const body = JSON.stringify({ playlist: { track: [
      { title: 'Duet', creator: ['Artist A', 'Artist B'] }
    ]}});
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks[0].artist).toBe('Artist A, Artist B');
  });

  test('rejects whitespace-only artist or title', () => {
    const body = JSON.stringify({ playlist: { track: [
      { title: '   ', creator: 'Real Artist' },
      { title: 'Real Title', creator: '  ' },
      { title: 'OK Track', creator: 'OK Artist' },
    ]}});
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]).toMatchObject({ artist: 'OK Artist', title: 'OK Track' });
  });

  test('trims leading/trailing whitespace from values', () => {
    const body = JSON.stringify({ playlist: { track: [
      { title: '  Spacey Title  ', creator: '\tArtist\n', album: '  Album  ' }
    ]}});
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks[0]).toMatchObject({ artist: 'Artist', title: 'Spacey Title', album: 'Album' });
  });

  test('caps track count at 500', () => {
    const tracks = Array.from({ length: 600 }, (_, i) => ({ artist: 'A', title: `Track ${i}` }));
    const r = parseProtocolTracklist(JSON.stringify({ tracks }), 'application/json');
    expect(r.tracks).toHaveLength(500);
  });

  test('rejects malformed mbid in generic shape', () => {
    const body = JSON.stringify({ tracks: [{ artist: 'A', title: 'T', mbid: 'not-a-uuid' }] });
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks[0].mbid).toBeUndefined();
  });

  test('XSPF with no title defaults displayName to "Tracks"', () => {
    const xml = `<?xml version="1.0"?><playlist xmlns="http://xspf.org/ns/0/" version="1"><trackList><track><title>X</title><creator>Y</creator></track></trackList></playlist>`;
    const r = parseProtocolTracklist(xml, 'application/xspf+xml');
    expect(r.displayName).toBe('Tracks');
  });
});
