/**
 * YouTube lookupPlaylist: a pasted or dropped youtube.com/playlist link.
 *
 * The playlist page carries its videos in the ytInitialData JSON. In 2026 each
 * video became a lockupViewModel, and the old regex (playlistVideoRenderer's
 * "shortBylineText") matched none of them, so every import returned null
 * ("0 matches" on a live 72-video playlist, 2026-11-14). The plugin now walks
 * the parsed JSON and reads both shapes.
 */

const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/youtube.axe'), 'utf8'));
const lookupPlaylist = new Function('return ' + axe.implementation.lookupPlaylist)();

const URL = 'https://www.youtube.com/playlist?list=PLtfJT7Fg2lKXLksdwqftx0ZaQ2ilxWpEr';

// A lockupViewModel trimmed to the fields the plugin reads, nested the way
// the live page nests them.
const lockup = (id, title, channel, badge) => ({
  lockupViewModel: {
    contentId: id,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: {
      thumbnailViewModel: {
        overlays: [
          { thumbnailBottomOverlayViewModel: { badges: badge ? [{ thumbnailBadgeViewModel: { text: badge } }] : [] } },
          { thumbnailHoverOverlayToggleActionsViewModel: { buttons: [] } },
        ],
      },
    },
    metadata: {
      lockupMetadataViewModel: {
        title: { content: title },
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [
              { metadataParts: [{ text: { content: channel } }] },
              { metadataParts: [{ text: { content: '5.8M' } }, { text: { content: '10y ago' } }] },
            ],
          },
        },
      },
    },
  },
});

const page = (items, { title = 'Radiohead Playlist', extra = {} } = {}) => {
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [{ itemSectionRenderer: { contents: items } }],
              },
            },
          },
        }],
      },
    },
    metadata: { playlistMetadataRenderer: { title } },
    ...extra,
  };
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script><script>var other = 1;</script></html>`;
};

const reply = (html, ok = true) => ({ ok, text: async () => html });

afterEach(() => { delete global.fetch; });

describe('YouTube lookupPlaylist', () => {
  test("reads today's lockup entries, in page order, with their lengths", async () => {
    global.fetch = jest.fn(async () => reply(page([
      lockup('OzL7u5teZhg', 'You', 'Radiohead', '3:29'),
      lockup('zFYEYRcjK2g', 'Radiohead - Creep', 'RadioheadVEVO', '3:59'),
      lockup('aaaaaaaaaaa', 'Paranoid Android', 'Radiohead - Topic', '1:02:03'),
      lockup('bbbbbbbbbbb', 'Live at Glastonbury', 'Radiohead', 'LIVE'),
    ])));
    const result = await lookupPlaylist(URL, {});
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.youtube.com/playlist?list=PLtfJT7Fg2lKXLksdwqftx0ZaQ2ilxWpEr',
      expect.anything(),
    );
    expect(result.type).toBe('playlist');
    expect(result.name).toBe('Radiohead Playlist');
    expect(result.albumArt).toBe('https://i.ytimg.com/vi/OzL7u5teZhg/mqdefault.jpg');
    expect(result.tracks.map((t) => [t.youtubeId, t.artist, t.title, t.duration])).toEqual([
      ['OzL7u5teZhg', 'Radiohead', 'You', 209],
      // "Artist - Title" in the video title wins over the channel.
      ['zFYEYRcjK2g', 'Radiohead', 'Creep', 239],
      // An auto-generated "Artist - Topic" channel is the artist.
      ['aaaaaaaaaaa', 'Radiohead', 'Paranoid Android', 3723],
      // A live badge is no length.
      ['bbbbbbbbbbb', 'Radiohead', 'Live at Glastonbury', null],
    ]);
    expect(result.tracks[0].youtubeUrl).toBe('https://www.youtube.com/watch?v=OzL7u5teZhg');
  });

  test('still reads the older playlistVideoRenderer shape', async () => {
    global.fetch = jest.fn(async () => reply(page([
      {
        playlistVideoRenderer: {
          videoId: 'zFYEYRcjK2g',
          title: { runs: [{ text: 'Creep' }] },
          shortBylineText: { runs: [{ text: 'Radiohead' }] },
          lengthSeconds: '239',
        },
      },
      {
        playlistVideoRenderer: {
          videoId: 'OzL7u5teZhg',
          title: { simpleText: 'You' },
          shortBylineText: { runs: [{ text: 'Radiohead' }] },
          lengthText: { simpleText: '3:29' },
        },
      },
    ])));
    const result = await lookupPlaylist(URL, {});
    expect(result.tracks.map((t) => [t.youtubeId, t.artist, t.title, t.duration])).toEqual([
      ['zFYEYRcjK2g', 'Radiohead', 'Creep', 239],
      ['OzL7u5teZhg', 'Radiohead', 'You', 209],
    ]);
  });

  test('ignores lockups outside the main list, non-video lockups and repeats', async () => {
    const channelLockup = lockup('ccccccccccc', 'A channel', 'Someone', null);
    channelLockup.lockupViewModel.contentType = 'LOCKUP_CONTENT_TYPE_PLAYLIST';
    global.fetch = jest.fn(async () => reply(page(
      [lockup('OzL7u5teZhg', 'You', 'Radiohead', '3:29'), channelLockup, lockup('OzL7u5teZhg', 'You', 'Radiohead', '3:29')],
      { extra: { sidebar: { lockupViewModel: lockup('ddddddddddd', 'Sidebar video', 'Other', '1:00').lockupViewModel } } },
    )));
    const result = await lookupPlaylist(URL, {});
    expect(result.tracks.map((t) => t.youtubeId)).toEqual(['OzL7u5teZhg']);
  });

  test('stops at 100 videos', async () => {
    const items = [];
    for (let i = 0; i < 120; i++) items.push(lockup(`vid${String(i).padStart(8, '0')}`, `Song ${i}`, 'Band', '3:00'));
    global.fetch = jest.fn(async () => reply(page(items)));
    const result = await lookupPlaylist(URL, {});
    expect(result.tracks).toHaveLength(100);
    expect(result.tracks[0].title).toBe('Song 0');
  });

  test('null for a non-playlist link, a failed fetch, a page without data, or an empty list', async () => {
    global.fetch = jest.fn(async () => reply(page([])));
    expect(await lookupPlaylist('https://www.youtube.com/watch?v=OzL7u5teZhg', {})).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    expect(await lookupPlaylist(URL, {})).toBeNull();

    global.fetch = jest.fn(async () => reply('', false));
    expect(await lookupPlaylist(URL, {})).toBeNull();

    global.fetch = jest.fn(async () => reply('<html>consent page</html>'));
    expect(await lookupPlaylist(URL, {})).toBeNull();

    global.fetch = jest.fn(async () => reply('<script>var ytInitialData = {broken;</script>'));
    expect(await lookupPlaylist(URL, {})).toBeNull();
  });
});
