/**
 * A ListenBrainz listen carries its MBID identity — recording_mbid /
 * release_mbid / artist_mbids in additional_info — so LB pins the listen to
 * the exact recording and release and skips its own mapping hop.
 *
 * The identity reaches the payload two ways, and both are pinned here:
 *
 *  1. Fields already on the played track: the MBID Mapper batch enrichment
 *     writes them on the queue/collection track record, and the playback
 *     engine copies them onto the played track (use-playback-engine.js
 *     mbidIdentity — they used to be dropped there, so almost no listen
 *     carried them even when the mapper had resolved the track).
 *  2. The scrobble-time backstop (_ensureMbidIdentity): a track that
 *     reaches the threshold with no identity (played straight from search,
 *     before its batch enrichment landed, or a queued retry) gets one last
 *     lookup through window.resolveRecordingMbid, filling only what's
 *     missing.
 *
 * Last.fm scrobbles get the same identity as the track.scrobble `mbid[0]`
 * parameter (the docs have claimed this since the mapper landed; the code
 * never sent it).
 */

const { ListenBrainzScrobbler, LastFmScrobbler } = require('../../scrobbler-loader');

const RECORDING = 'b2f3dc71-0f80-4b22-a1a4-d8f8cbd9e5f0';
const RELEASE = 'ed286309-6e64-48e3-835b-61aaf86cdb86';
const ARTIST = '39ab1aed-75e0-4140-bd47-540276886b60';

const mapperHit = {
  status: 'hit',
  result: {
    recording_mbid: RECORDING,
    artist_credit_mbids: [ARTIST],
    release_mbid: RELEASE,
    confidence: 0.95,
  },
};

function installWindow({ resolveRecordingMbid } = {}) {
  const bodies = [];
  global.window = {
    electron: {
      store: { get: async () => ({ enabled: true, userToken: 'tok' }) },
      proxyFetch: async (_url, opts) => {
        bodies.push(opts.body.startsWith('{') ? JSON.parse(opts.body) : opts.body);
        return { success: true, text: '{"ok":true}' };
      },
      crypto: { md5: async () => 'sig' },
    },
    ...(resolveRecordingMbid ? { resolveRecordingMbid } : {}),
  };
  return bodies;
}

const lbInfoOf = (body) => body.payload[0].track_metadata.additional_info;
const lastfmParamsOf = (body) => new URLSearchParams(body);

afterEach(() => {
  delete global.window;
});

describe('ListenBrainz listen MBID identity', () => {
  test('a track carrying the enrichment scrobbles recording_mbid, release_mbid and artist_mbids', async () => {
    const bodies = installWindow();
    const lb = new ListenBrainzScrobbler();
    await lb.scrobble({ title: 'T', artist: 'A', album: 'Al', duration: 200, mbid: RECORDING, releaseMbid: RELEASE, artistMbids: [ARTIST] }, 1700000000);
    const info = lbInfoOf(bodies[0]);
    expect(info.recording_mbid).toBe(RECORDING);
    expect(info.release_mbid).toBe(RELEASE);
    expect(info.artist_mbids).toEqual([ARTIST]);
  });

  test('a track with no identity asks the mapper once and scrobbles what it answered', async () => {
    const resolveRecordingMbid = jest.fn(async () => mapperHit);
    const bodies = installWindow({ resolveRecordingMbid });
    const lb = new ListenBrainzScrobbler();
    const track = { title: 'T', artist: 'A', album: 'Al', duration: 200 };
    await lb.scrobble(track, 1700000000);
    // Background lane: a scrobble-time ask never competes with a
    // user-initiated lookup (handlePlay) for the labs gate's foreground slot.
    expect(resolveRecordingMbid).toHaveBeenCalledWith('A', 'T', 'Al', { background: true });
    const info = lbInfoOf(bodies[0]);
    expect(info.recording_mbid).toBe(RECORDING);
    expect(info.release_mbid).toBe(RELEASE);
    expect(info.artist_mbids).toEqual([ARTIST]);
    // The track itself is filled, so a later submit (Achordion's, a love
    // push) sees the same identity without asking again.
    expect(track.mbid).toBe(RECORDING);
    expect(track.releaseMbid).toBe(RELEASE);
  });

  test('a recording MBID without a release asks the mapper and fills only the release', async () => {
    // The ISRC fallback enrichment sets only track.mbid.
    const resolveRecordingMbid = jest.fn(async () => mapperHit);
    const bodies = installWindow({ resolveRecordingMbid });
    const lb = new ListenBrainzScrobbler();
    const track = { title: 'T', artist: 'A', album: 'Al', duration: 200, mbid: RECORDING };
    await lb.scrobble(track, 1700000000);
    expect(resolveRecordingMbid).toHaveBeenCalledWith('A', 'T', 'Al', { background: true });
    const info = lbInfoOf(bodies[0]);
    expect(info.recording_mbid).toBe(RECORDING);
    expect(info.release_mbid).toBe(RELEASE);
  });

  test('a track with both MBIDs never asks the mapper', async () => {
    const resolveRecordingMbid = jest.fn(async () => mapperHit);
    const bodies = installWindow({ resolveRecordingMbid });
    const lb = new ListenBrainzScrobbler();
    await lb.scrobble({ title: 'T', artist: 'A', duration: 200, mbid: RECORDING, releaseMbid: RELEASE }, 1700000000);
    expect(resolveRecordingMbid).not.toHaveBeenCalled();
    expect(lbInfoOf(bodies[0]).release_mbid).toBe(RELEASE);
  });

  test('a mapper miss still scrobbles, without MBIDs, and does not throw', async () => {
    const bodies = installWindow({ resolveRecordingMbid: async () => ({ status: 'miss', result: null }) });
    const lb = new ListenBrainzScrobbler();
    await expect(lb.scrobble({ title: 'T', artist: 'A', duration: 200 }, 1700000000)).resolves.toBe(true);
    expect(lbInfoOf(bodies[0]).recording_mbid).toBeUndefined();
    expect(lbInfoOf(bodies[0]).release_mbid).toBeUndefined();
  });

  test('a mapper that throws or is absent never fails the scrobble', async () => {
    const thrown = installWindow({ resolveRecordingMbid: async () => { throw new Error('mapper down'); } });
    const lb = new ListenBrainzScrobbler();
    await expect(lb.scrobble({ title: 'T', artist: 'A', duration: 200 }, 1700000000)).resolves.toBe(true);
    expect(lbInfoOf(thrown[0]).recording_mbid).toBeUndefined();

    const absent = installWindow();
    await expect(lb.scrobble({ title: 'T2', artist: 'A', duration: 200 }, 1700000060)).resolves.toBe(true);
    expect(lbInfoOf(absent[0]).recording_mbid).toBeUndefined();
  });

  test('a garbage MBID on the track is not sent and does not block the lookup', async () => {
    const resolveRecordingMbid = jest.fn(async () => mapperHit);
    const bodies = installWindow({ resolveRecordingMbid });
    const lb = new ListenBrainzScrobbler();
    await lb.scrobble({ title: 'T', artist: 'A', duration: 200, mbid: 'not-a-uuid', releaseMbid: 'also-not' }, 1700000000);
    const info = lbInfoOf(bodies[0]);
    expect(info.recording_mbid).toBe(RECORDING);
    expect(info.release_mbid).toBe(RELEASE);
  });

  test('now-playing sends the identity already on the track but never asks the mapper', async () => {
    const resolveRecordingMbid = jest.fn(async () => mapperHit);
    const bodies = installWindow({ resolveRecordingMbid });
    const lb = new ListenBrainzScrobbler();
    // No identity: the ping goes out as it is (the backstop is scrobble-only).
    await lb.updateNowPlaying({ title: 'T', artist: 'A', duration: 200 });
    expect(resolveRecordingMbid).not.toHaveBeenCalled();
    expect(lbInfoOf(bodies[0]).recording_mbid).toBeUndefined();

    await lb.updateNowPlaying({ title: 'T', artist: 'A', duration: 200, mbid: RECORDING, releaseMbid: RELEASE, artistMbids: [ARTIST] });
    expect(lbInfoOf(bodies[1]).recording_mbid).toBe(RECORDING);
    expect(lbInfoOf(bodies[1]).release_mbid).toBe(RELEASE);
    expect(lbInfoOf(bodies[1]).artist_mbids).toEqual([ARTIST]);
  });

  test('queuedTrack keeps the identity for a retry', () => {
    const lb = new ListenBrainzScrobbler();
    expect(lb.queuedTrack({ title: 'T', artist: 'A', mbid: RECORDING, releaseMbid: RELEASE, artistMbids: [ARTIST] }))
      .toEqual({ mbid: RECORDING, releaseMbid: RELEASE });
    expect(lb.queuedTrack({ title: 'T', artist: 'A' })).toEqual({});
  });
});

describe('Last.fm scrobble mbid', () => {
  test('a track with a recording MBID scrobbles it as mbid[0]', async () => {
    const bodies = installWindow();
    const lastfm = new LastFmScrobbler();
    lastfm.setApiCredentials('key', 'secret');
    await lastfm.scrobble({ title: 'T', artist: 'A', album: 'Al', duration: 200, mbid: RECORDING }, 1700000000);
    const params = lastfmParamsOf(bodies[0]);
    expect(params.get('mbid[0]')).toBe(RECORDING);
    expect(params.get('track[0]')).toBe('T');
  });

  test('a track without one sends no mbid parameter at all', async () => {
    const bodies = installWindow();
    const lastfm = new LastFmScrobbler();
    lastfm.setApiCredentials('key', 'secret');
    await lastfm.scrobble({ title: 'T', artist: 'A', album: 'Al', duration: 200 }, 1700000000);
    const params = lastfmParamsOf(bodies[0]);
    expect(params.get('mbid[0]')).toBeNull();
  });

  test('a garbage MBID is not sent', async () => {
    const bodies = installWindow();
    const lastfm = new LastFmScrobbler();
    lastfm.setApiCredentials('key', 'secret');
    await lastfm.scrobble({ title: 'T', artist: 'A', duration: 200, mbid: 'not-a-uuid' }, 1700000000);
    expect(lastfmParamsOf(bodies[0]).get('mbid[0]')).toBeNull();
  });
});

