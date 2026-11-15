// Source of truth for plugins/youtube.axe v1.0.4.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
    try {
      console.log('Searching YouTube for:', query);
      const response = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' music')}&sp=EgIQAQ%253D%253D`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        },
      );
      if (!response.ok) {
        console.error('YouTube search failed:', response.status);
        return [];
      }
      const html = await response.text();
      const results = [];
      const videoDataMatches = html.matchAll(
        /"videoId":"([^"]+)","thumbnail".*?"title":\{"runs":\[\{"text":"([^"]+)"\}\].*?"ownerText":\{"runs":\[\{"text":"([^"]+)"/g,
      );
      // A video's length is its renderer's lengthText ("3:57", "1:02:03"),
      // which sits between its videoId and the next video's renderer (today
      // between title and ownerText, so inside the match above). Live streams
      // and premieres have none, so their length is unknown (null), never a
      // made-up 180 that track lists would show as the track's length.
      const lengthAfter = function (from) {
        const next = html.indexOf('"videoRenderer":{', from);
        const end = next === -1 ? Math.min(html.length, from + 20000) : next;
        const chunk = html.slice(from, end);
        const at = chunk.indexOf('"lengthText":');
        if (at === -1) return null;
        const m = chunk.slice(at, at + 400).match(/"simpleText":"(\d+(?::\d{1,2}){1,2})"/);
        if (!m) return null;
        const parts = m[1].split(':').map(Number);
        let seconds = 0;
        for (const part of parts) seconds = seconds * 60 + part;
        return seconds > 0 ? seconds : null;
      };
      let count = 0;
      for (const match of videoDataMatches) {
        if (count >= 20) break;
        const [, videoId, title, channel] = match;
        if (videoId && title && channel) {
          results.push({
            id: `youtube-${videoId}`,
            title: title,
            artist: channel,
            duration: lengthAfter(match.index),
            sources: ['youtube'],
            youtubeId: videoId,
            youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
            albumArt: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          });
          count++;
        }
      }
      console.log(`Found ${results.length} YouTube results`);
      return results;
    } catch (error) {
      console.error('YouTube search error:', error);
      return [];
    }
  },
  resolve: async function (artist, track, album, config) {
    const query = `${artist} ${track}`;
    const results = await this.search(query, config);
    return results[0] || null;
  },
  play: async function (track, config) {
    if (!track.youtubeUrl) {
      console.error('No YouTube URL found');
      return false;
    }
    try {
      if (window.electron?.shell?.openExternal) {
        const result = await window.electron.shell.openExternal(track.youtubeUrl);
        return result && result.success;
      } else {
        const newWindow = window.open(track.youtubeUrl, '_blank');
        return !!newWindow;
      }
    } catch (error) {
      console.error('Failed to open YouTube link:', error);
      return false;
    }
  },
  init: async function (config) {
    console.log('YouTube resolver initialized');
  },
  cleanup: async function () {
    console.log('YouTube resolver cleanup');
  },
  lookupUrl: async function (url, config) {
    try {
      let videoId = null;
      if (url.includes('youtu.be/')) {
        const match = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
        if (match) videoId = match[1];
      } else {
        const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
        if (match) videoId = match[1];
      }
      if (!videoId) return null;
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const response = await fetch(oembedUrl);
      if (!response.ok) return null;
      const data = await response.json();
      let title = data.title || '';
      let artist = data.author_name || 'Unknown Artist';
      const dashMatch = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashMatch) {
        artist = dashMatch[1].trim();
        title = dashMatch[2].trim();
      }
      return {
        title: title || 'Unknown Title',
        artist,
        // oEmbed carries no length, and the watch page is a megabyte: unknown.
        duration: null,
        albumArt: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        sourceUrl: url,
        youtubeId: videoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    } catch (error) {
      console.error('YouTube URL lookup error:', error);
      return null;
    }
  },
  lookupPlaylist: async function (url, config) {
    // The playlist page embeds its first page of videos (up to 100) in the
    // ytInitialData JSON. Since 2026 each video is a lockupViewModel
    // (contentId, title.content, the channel in the first metadata row, the
    // length in the thumbnail badge); older pages used playlistVideoRenderer
    // (videoId, title.runs, shortBylineText.runs, lengthSeconds). The regex
    // this replaced matched only the old shape, so every import came back
    // empty. Both shapes are read, by walking the parsed JSON, not by regex.
    try {
      const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
      if (!listMatch) return null;
      const playlistId = listMatch[1];
      const response = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      if (!response.ok) return null;
      const html = await response.text();
      const marker = html.indexOf('ytInitialData = ');
      if (marker === -1) return null;
      const start = html.indexOf('{', marker);
      const end = html.indexOf(';</script>', start);
      if (start === -1 || end === -1) return null;
      let data;
      try {
        data = JSON.parse(html.slice(start, end));
      } catch (e) {
        console.error('YouTube playlist page data did not parse');
        return null;
      }
      const textOf = function (t) {
        if (!t) return '';
        if (typeof t === 'string') return t;
        if (typeof t.content === 'string') return t.content;
        if (typeof t.simpleText === 'string') return t.simpleText;
        if (Array.isArray(t.runs)) return t.runs.map(function (r) { return r.text || ''; }).join('');
        return '';
      };
      // "3:57" / "1:02:03" → seconds; anything else (a live badge) → null.
      const clockSeconds = function (text) {
        if (!/^\d+(?::\d{1,2}){1,2}$/.test(text || '')) return null;
        let seconds = 0;
        const parts = text.split(':');
        for (let p = 0; p < parts.length; p++) seconds = seconds * 60 + Number(parts[p]);
        return seconds > 0 ? seconds : null;
      };
      const videos = [];
      const seen = {};
      const add = function (videoId, title, channel, duration) {
        if (!videoId || !title || seen[videoId]) return;
        seen[videoId] = true;
        videos.push({ videoId: videoId, title: title, channel: channel, duration: duration });
      };
      const fromLockup = function (l) {
        if (l.contentType && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return;
        const md = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
        const rows =
          (md.metadata && md.metadata.contentMetadataViewModel && md.metadata.contentMetadataViewModel.metadataRows) || [];
        const firstPart = rows[0] && rows[0].metadataParts && rows[0].metadataParts[0];
        let duration = null;
        const overlays = (l.contentImage && l.contentImage.thumbnailViewModel && l.contentImage.thumbnailViewModel.overlays) || [];
        for (let o = 0; o < overlays.length && duration === null; o++) {
          const badges = (overlays[o].thumbnailBottomOverlayViewModel && overlays[o].thumbnailBottomOverlayViewModel.badges) || [];
          for (let b = 0; b < badges.length && duration === null; b++) {
            duration = clockSeconds(badges[b].thumbnailBadgeViewModel && badges[b].thumbnailBadgeViewModel.text);
          }
        }
        add(l.contentId, textOf(md.title), firstPart ? textOf(firstPart.text) : '', duration);
      };
      const fromRenderer = function (r) {
        const seconds = Number(r.lengthSeconds);
        add(
          r.videoId,
          textOf(r.title),
          textOf(r.shortBylineText),
          seconds > 0 ? seconds : clockSeconds(textOf(r.lengthText)),
        );
      };
      // Only the page's main list: the sidebar and menus can hold lockups too.
      const tabs =
        (data.contents && data.contents.twoColumnBrowseResultsRenderer && data.contents.twoColumnBrowseResultsRenderer.tabs) || [];
      const root = tabs.length ? tabs : data;
      const stack = [root];
      while (stack.length && videos.length < 100) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (node.lockupViewModel) fromLockup(node.lockupViewModel);
        else if (node.playlistVideoRenderer) fromRenderer(node.playlistVideoRenderer);
        else {
          const keys = Object.keys(node);
          // Reverse so the stack pops children in page order.
          for (let k = keys.length - 1; k >= 0; k--) stack.push(node[keys[k]]);
        }
      }
      if (videos.length === 0) return null;
      const playlistName =
        (data.metadata && data.metadata.playlistMetadataRenderer && data.metadata.playlistMetadataRenderer.title) ||
        'YouTube Playlist';
      const tracks = videos.map(function (v) {
        let trackTitle = v.title;
        // An auto-generated "Artist - Topic" channel is the artist's.
        let artist = (v.channel || '').replace(/\s+-\s+Topic$/, '') || 'Unknown Artist';
        const dashMatch = v.title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
        if (dashMatch) {
          artist = dashMatch[1].trim();
          trackTitle = dashMatch[2].trim();
        }
        return {
          title: trackTitle,
          artist: artist,
          duration: v.duration,
          albumArt: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          youtubeId: v.videoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
        };
      });
      return {
        type: 'playlist',
        name: playlistName,
        albumArt: tracks[0].albumArt,
        tracks: tracks,
      };
    } catch (error) {
      console.error('YouTube playlist lookup error:', error);
      return null;
    }
  },
};
