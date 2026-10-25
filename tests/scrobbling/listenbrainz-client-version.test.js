/**
 * ListenBrainz additional_info.submission_client_version carries the real
 * app version and platform ("0.9.10 (desktop)"), not the old hard-coded
 * "1.1.0", so duplicate-listen reports can tell which Parachord client
 * submitted a row (parachord#1125; mobile sends "<version> (android|ios)",
 * parachord-mobile#418). submission_client and media_player stay "Parachord":
 * Achordion's importer detection reads submission_client only.
 */

const { ListenBrainzScrobbler, formatSubmissionClientVersion } = require('../../scrobbler-loader');

function installWindow({ getVersion } = {}) {
  const bodies = [];
  global.window = {
    electron: {
      store: { get: async () => ({ enabled: true, userToken: 'tok' }) },
      proxyFetch: async (_url, opts) => {
        bodies.push(JSON.parse(opts.body));
        return { success: true };
      },
      updater: getVersion ? { getVersion } : undefined,
    },
  };
  return bodies;
}

const infoOf = (body) => body.payload[0].track_metadata.additional_info;
const track = { title: 'T', artist: 'A', album: 'Al', duration: 200 };

afterEach(() => {
  delete global.window;
});

describe('formatSubmissionClientVersion', () => {
  test('appends the desktop platform', () => {
    expect(formatSubmissionClientVersion('0.9.10')).toBe('0.9.10 (desktop)');
  });

  test('a missing or blank version reads unknown, not an invented one', () => {
    expect(formatSubmissionClientVersion(undefined)).toBe('unknown (desktop)');
    expect(formatSubmissionClientVersion('  ')).toBe('unknown (desktop)');
  });
});

describe('ListenBrainz submission_client_version', () => {
  test('scrobble and now-playing send the app version with the platform', async () => {
    const bodies = installWindow({ getVersion: async () => '0.9.10' });
    const lb = new ListenBrainzScrobbler();
    await lb.updateNowPlaying(track);
    await lb.scrobble(track, 1700000000);
    for (const body of bodies) {
      const info = infoOf(body);
      expect(info.submission_client_version).toBe('0.9.10 (desktop)');
      expect(info.submission_client).toBe('Parachord');
      expect(info.media_player).toBe('Parachord');
    }
    expect(bodies).toHaveLength(2);
  });

  test('asks main for the version once per session', async () => {
    const getVersion = jest.fn(async () => '0.9.10');
    installWindow({ getVersion });
    const lb = new ListenBrainzScrobbler();
    await lb.updateNowPlaying(track);
    await lb.scrobble(track, 1700000000);
    await lb.scrobble(track, 1700000300);
    expect(getVersion).toHaveBeenCalledTimes(1);
  });

  test('a failed version lookup still submits, as unknown, and retries next time', async () => {
    const getVersion = jest.fn()
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValue('0.9.10');
    const bodies = installWindow({ getVersion });
    const lb = new ListenBrainzScrobbler();
    await lb.scrobble(track, 1700000000);
    await lb.scrobble(track, 1700000300);
    expect(infoOf(bodies[0]).submission_client_version).toBe('unknown (desktop)');
    expect(infoOf(bodies[1]).submission_client_version).toBe('0.9.10 (desktop)');
  });

  test('no updater bridge reads unknown', async () => {
    const bodies = installWindow();
    await new ListenBrainzScrobbler().scrobble(track, 1700000000);
    expect(infoOf(bodies[0]).submission_client_version).toBe('unknown (desktop)');
  });
});
