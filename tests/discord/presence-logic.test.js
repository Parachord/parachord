/**
 * Discord Rich Presence — pure logic (see discord-presence-logic.js).
 *
 * These are the decisions that would otherwise only be observable by
 * launching Discord and staring at a profile card: what the two lines say,
 * which image URLs Discord can actually fetch, what happens to the elapsed
 * clock on pause, and when a reconnect is pointless.
 */

const {
  DEFAULT_DISCORD_CLIENT_ID,
  isValidDiscordClientId,
  resolveDiscordClientId,
  clampPresenceText,
  isFetchablePresenceImageUrl,
  looksLikeCredentialBearingUrl,
  pickPresenceArtUrl,
  formatPresenceLines,
  buildDiscordActivity,
  sameActivityPayload,
  describePresenceClose,
  presenceStatus,
  nextReconnectDelay,
  ACTIVITY_TYPES,
  PRESENCE_ART_ASSET_KEY,
} = require('../../discord-presence-logic');

const NOW = 1_780_000_000;

describe('Discord Application id resolution', () => {
  test('a snowflake is the only accepted shape', () => {
    expect(isValidDiscordClientId('123456789012345678')).toBe(true);
    expect(isValidDiscordClientId(' Parachord ')).toBe(false);
    expect(isValidDiscordClientId('123456789012345678901234')).toBe(false);
    expect(isValidDiscordClientId('')).toBe(false);
    expect(isValidDiscordClientId(undefined)).toBe(false);
  });

  test('.env beats the shipped id, and the shipped id is the default', () => {
    const env = '222222222222222222';
    const shipped = '333333333333333333';
    expect(resolveDiscordClientId({ env, fallback: shipped })).toBe(env);
    expect(resolveDiscordClientId({ fallback: shipped })).toBe(shipped);
  });

  test('a half-typed env var falls back instead of killing the presence', () => {
    const shipped = '333333333333333333';
    expect(resolveDiscordClientId({ env: '12345', fallback: shipped })).toBe(shipped);
    expect(resolveDiscordClientId({ env: '   ', fallback: shipped })).toBe(shipped);
  });

  test('the shipped default is the registered Parachord application', () => {
    // Discord renders the "Listening to Parachord" headline from this id and
    // refuses the handshake (close 4000) without it, so a wrong value makes the
    // feature inert on every install. Pinned to the real application.
    expect(DEFAULT_DISCORD_CLIENT_ID).toBe('1561699064683167862');
    expect(isValidDiscordClientId(DEFAULT_DISCORD_CLIENT_ID)).toBe(true);
    expect(resolveDiscordClientId({ fallback: DEFAULT_DISCORD_CLIENT_ID })).toBe(DEFAULT_DISCORD_CLIENT_ID);
  });

  test('a build with no id anywhere resolves to empty, not a bogus id', () => {
    expect(resolveDiscordClientId({ fallback: '' })).toBe('');
  });
});

describe('presence text sanitising', () => {
  test('collapses whitespace and trims', () => {
    expect(clampPresenceText('  Song \n名  ')).toBe('Song 名');
  });

  test('under 2 characters is dropped, not sent', () => {
    // Discord's window is 2-128; a 1-char line fails payload validation and
    // would take the whole SET_ACTIVITY down with it.
    expect(clampPresenceText('X')).toBeNull();
    expect(clampPresenceText('')).toBeNull();
    expect(clampPresenceText(null)).toBeNull();
  });

  test('over 128 characters is clamped inside the limit, never mid-surrogate', () => {
    const long = 'a'.repeat(400);
    const clamped = clampPresenceText(long);
    expect(clamped.length).toBe(128);
    expect(clamped.endsWith('\u2026')).toBe(true);

    const emoji = `${'\u{1F600}'.repeat(200)} tail`;
    const emojiClamped = clampPresenceText(emoji);
    expect(Array.from(emojiClamped).length).toBe(128);
    expect(emojiClamped).not.toMatch(/\uFFFD/);
  });
});

describe('album art gate', () => {
  test('only https URLs are fetchable by Discord', () => {
    expect(isFetchablePresenceImageUrl('https://is1-ssl.mzstatic.com/x/cover.jpg')).toBe(true);
    // Local/embedded art and Parachord's own protocols resolve to nothing on
    // Discord's side — a broken image tile where "no image" looked fine.
    expect(isFetchablePresenceImageUrl('http://example.com/cover.jpg')).toBe(false);
    expect(isFetchablePresenceImageUrl('file:///home/theli/Music/cover.jpg')).toBe(false);
    expect(isFetchablePresenceImageUrl('local-audio:///home/theli/Music/a.flac')).toBe(false);
    expect(isFetchablePresenceImageUrl('data:image/jpeg;base64,AAAA')).toBe(false);
    expect(isFetchablePresenceImageUrl('blob:https://x/y')).toBe(false);
    expect(isFetchablePresenceImageUrl('not a url')).toBe(false);
  });

  test('a cover URL carrying credentials is refused — the activity is public', () => {
    // Everyone who can see the user's Discord profile sees the activity
    // payload, so a music-server art URL with its session in the query string
    // would hand out a working credential. Plex uses X-Plex-Token,
    // Subsonic/OpenSubsonic uses the u + t (token) + s (salt) tuple with sig as
    // the digest. Refusing the URL costs nothing: the cover falls back to the
    // Parachord asset.
    const denied = [
      'https://plex.example.com/photo/1234/cover_200.jpg?X-Plex-Token=abcDEF123',
      'https://sub.example.com/rest/getAlbumCover.view?id=7&u=admin&t=deadbeef&s=c0ffee&v=1.16.1&c=parachord',
      'https://navsub.example.com/rest/getCoverArt.view?id=9&u=me&p=plaintextpw',
      'https://cdn.example.com/cover.jpg?signature=badsig',
      'https://cdn.example.com/cover.jpg?access_token=whatever',
      'https://cdn.example.com/cover.jpg?key=whatever',
      'https://user:pw@example.com/cover.jpg',
    ];
    for (const url of denied) {
      expect(isFetchablePresenceImageUrl(url)).toBe(false);
      expect(pickPresenceArtUrl({ albumArt: url })).toBeNull();
    }

    // Ordinary art URLs with a benign query still work — the rule is about
    // credential-shaped parameters, not about queries in general.
    expect(isFetchablePresenceImageUrl('https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg?w=600&h=600')).toBe(true);
    expect(isFetchablePresenceImageUrl('https://i.scdn.co/image/ab67616d0000b273abc123')).toBe(true);
  });

  test('the credential detector reads parameter names, not values', () => {
    expect(looksLikeCredentialBearingUrl(new URL('https://x/y?t=12345'))).toBe(true);
    expect(looksLikeCredentialBearingUrl(new URL('https://x/y?X-Plex-Token=z'))).toBe(true);
    expect(looksLikeCredentialBearingUrl(new URL('https://x/y?width=600&cam=1'))).toBe(false);
  });

  test('picks the first fetchable cover across sources', () => {
    const track = {
      albumArt: 'file:///cache/embedded-abc.jpg',
      sources: { applemusic: { albumArt: 'https://music.apple.com/cover.jpg' } },
    };
    expect(pickPresenceArtUrl(track)).toBe('https://music.apple.com/cover.jpg');
    expect(pickPresenceArtUrl({ albumArt: 'file:///x.jpg' })).toBeNull();
    expect(pickPresenceArtUrl(null)).toBeNull();
  });
});

describe('the two presence lines', () => {
  test('title on details, artist on state — never the album', () => {
    // Three slots, one fact each: details = title, state = artist, and the
    // album lives in assets.large_text. Joining it onto state printed it twice
    // ("Clearwater / Sigur Rós — ( ) / ( )") in the profile card.
    const track = { title: ' stations warning', artist: 'The Soft Moon', album: 'Criminal' };
    expect(formatPresenceLines(track)).toEqual({
      details: 'stations warning',
      state: 'The Soft Moon',
    });
  });

  test('artist alone when there is no album', () => {
    expect(formatPresenceLines({ title: 'One', artist: 'Two' })).toEqual({
      details: 'One',
      state: 'Two',
    });
  });

  test('an empty artist slot takes the album rather than a blank line', () => {
    expect(formatPresenceLines({ title: 'Track', artist: '', album: 'Album' })).toEqual({
      details: 'Track',
      state: 'Album',
    });
  });

  test('never repeats the same text on both lines', () => {
    expect(formatPresenceLines({ title: 'Same', artist: 'Same' })).toEqual({
      details: 'Same',
      state: null,
    });
  });

  test('nothing usable at all means no presence', () => {
    expect(formatPresenceLines({ title: 'A', artist: '' })).toBeNull();
    expect(formatPresenceLines(null)).toBeNull();
  });
});

describe('SET_ACTIVITY payload', () => {
  const track = { title: 'Clearwater', artist: 'Sigur Rós', album: '( )', duration: 420000 };

  test('playing sends a start back-computed from the position', () => {
    const activity = buildDiscordActivity(track, {
      isPlaying: true, positionSeconds: 42, nowSeconds: NOW,
    });
    expect(activity.type).toBe(ACTIVITY_TYPES.listening);
    expect(activity.details).toBe('Clearwater');
    expect(activity.state).toBe('Sigur Rós');
    expect(activity.timestamps).toEqual({ start: NOW - 42 });
    expect(activity.instance).toBe(false);
  });

  test('a paused track has no presence at all', () => {
    // The simple rule: the presence is up while something is playing, and gone
    // otherwise. Freezing the clock instead (timestamps: {} replaces a stored
    // start - confirmed against a live client) was more moving parts than the
    // feature is worth, and a paused card with a stopped counter was ambiguous
    // to read anyway. null means "caller, clear it".
    expect(buildDiscordActivity(track, { isPlaying: false, positionSeconds: 42, nowSeconds: NOW })).toBeNull();
    expect(buildDiscordActivity({ ...track }, { nowSeconds: NOW })).toBeNull();
  });

  test('no track means no activity, so the caller clears', () => {
    expect(buildDiscordActivity(null, { isPlaying: true })).toBeNull();
    expect(buildDiscordActivity({ title: '' }, { isPlaying: true })).toBeNull();
  });

  test('album art rides along only when Discord may fetch it', () => {
    const withArt = { ...track, albumArt: 'https://example.com/cover.jpg' };
    const activity = buildDiscordActivity(withArt, { isPlaying: true, nowSeconds: NOW });
    expect(activity.assets.large_image).toBe('https://example.com/cover.jpg');
    expect(activity.assets.large_text).toBe('( )');

    // Local/off-server art is not a URL Discord can fetch; the registered
    // Parachord asset is the fallback, and the album still rides as its hover
    // text.
    const localOnly = { ...track, albumArt: 'file:///cache/cover.jpg' };
    const localActivity = buildDiscordActivity(localOnly, { isPlaying: true, nowSeconds: NOW });
    expect(localActivity.assets.large_image).toBe(PRESENCE_ART_ASSET_KEY);
    expect(localActivity.assets.large_text).toBe('( )');

    const optedOut = buildDiscordActivity(withArt, { isPlaying: true, nowSeconds: NOW, includeAlbumArt: false });
    expect('assets' in optedOut).toBe(false);
  });

  test('the album hover text is dropped when it would only repeat a line', () => {
    const selfTitled = { title: 'Nothing', artist: 'Someone', album: 'Nothing' };
    expect(buildDiscordActivity(selfTitled, { isPlaying: true, nowSeconds: NOW }).assets.large_text).toBeUndefined();

    // The fallback that puts the album on the state line when the artist is
    // missing must not then repeat it under the image.
    const noArtist = { title: 'Someone', artist: '', album: 'Same' };
    const payload = buildDiscordActivity(noArtist, { isPlaying: true, nowSeconds: NOW });
    expect(payload.state).toBe('Same');
    expect(payload.assets.large_text).toBeUndefined();
  });

  test('no small image is ever sent: the application registers none', () => {
    // assets.small_image must name an art asset uploaded to the application,
    // and the shipped Parachord application has exactly one asset (the large
    // logo). Nothing to overlay - and no paused state left to mark.
    const playing = buildDiscordActivity(track, { isPlaying: true, nowSeconds: NOW });
    expect('small_image' in (playing.assets || {})).toBe(false);
    expect('small_text' in (playing.assets || {})).toBe(false);
  });

  test('type:null omits the field (the retry for clients that reject Listening)', () => {
    const activity = buildDiscordActivity(track, { isPlaying: true, nowSeconds: NOW, type: null });
    expect('type' in activity).toBe(false);
  });

  test('start is now minus position, and never negative', () => {
    const start = (opts) => buildDiscordActivity(track, { isPlaying: true, nowSeconds: NOW, ...opts }).timestamps.start;
    expect(start({})).toBe(NOW);
    expect(start({ positionSeconds: 42 })).toBe(NOW - 42);
    // A bogus position (NaN / negative / absurd) must not produce a timestamp
    // Discord would read as an activity that started before the epoch.
    expect(start({ positionSeconds: NaN })).toBe(NOW);
    expect(start({ positionSeconds: -5 })).toBe(NOW);
    expect(start({ positionSeconds: NOW * 2 })).toBe(0);
  });
});

describe('payload de-duplication', () => {
  test('identical payloads compare equal so a re-render does not re-send', () => {
    const a = buildDiscordActivity({ title: 'Alpha', artist: 'Bravo' }, { isPlaying: true, nowSeconds: NOW });
    const b = buildDiscordActivity({ title: 'Alpha', artist: 'Bravo' }, { isPlaying: true, nowSeconds: NOW });
    expect(sameActivityPayload(a, b)).toBe(true);
    const c = buildDiscordActivity({ title: 'Alpha', artist: 'Bravo' }, { isPlaying: false, nowSeconds: NOW });
    expect(sameActivityPayload(a, c)).toBe(false);
    expect(sameActivityPayload(null, null)).toBe(true);
  });
});

describe('connection status reporting', () => {
  test('RPC close codes map to something a settings row can say', () => {
    expect(describePresenceClose(4000)).toBe('invalid-client-id');
    expect(describePresenceClose(4002)).toBe('rate-limited');
    expect(describePresenceClose(4004)).toBe('invalid-version');
    expect(describePresenceClose('nope')).toBe('disconnected');
  });

  test('configuration problems outrank "Discord is not running"', () => {
    // Telling someone to start Discord when their Application id is refused
    // sends them in a useless direction.
    expect(presenceStatus({ enabled: false })).toBe('off');
    expect(presenceStatus({ enabled: true, clientId: '' })).toBe('not-configured');
    expect(presenceStatus({ enabled: true, clientId: '12ab', lastError: { code: 2 } })).toBe('invalid-client-id');
    expect(presenceStatus({ enabled: true, clientId: '123456789012345678', lastError: { code: 4000 } }))
      .toBe('invalid-client-id');
    expect(presenceStatus({ enabled: true, clientId: '123456789012345678', lastError: { code: 2, kind: 'discord-not-running' } }))
      .toBe('discord-not-running');
    expect(presenceStatus({ enabled: true, clientId: '123456789012345678', connected: true })).toBe('connected');
    expect(presenceStatus({ enabled: true, clientId: '123456789012345678', connecting: true })).toBe('connecting');
    expect(presenceStatus({ enabled: true, clientId: '123456789012345678' })).toBe('discord-not-running');
  });

  test('backoff grows and caps', () => {
    expect(nextReconnectDelay(0)).toBe(5000);
    expect(nextReconnectDelay(1)).toBe(10000);
    expect(nextReconnectDelay(3)).toBe(40000);
    expect(nextReconnectDelay(12)).toBe(300000);
    expect(nextReconnectDelay(0, { baseMs: 1000, maxMs: 4000 })).toBe(1000);
    expect(nextReconnectDelay(-3)).toBe(5000);
  });
});
