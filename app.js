// Parachord Desktop App - Electron Version
const { useState, useEffect, useRef, useCallback, useMemo } = React;

// Global Set to track prefetch in-progress state (on window to survive any reloads)
window._prefetchInProgress = window._prefetchInProgress || new Set();
const prefetchInProgress = window._prefetchInProgress;

// Use lucide-react icons if available, otherwise fallback to emoji
const Icons = typeof lucideReact !== 'undefined' ? lucideReact : {
  Play: () => React.createElement('span', null, '▶'),
  Pause: () => React.createElement('span', null, '⏸'),
  SkipForward: () => React.createElement('span', null, '⏭'),
  SkipBack: () => React.createElement('span', null, '⏮'),
  Volume2: () => React.createElement('span', null, '🔊'),
  Music: () => React.createElement('span', null, '♫'),
  List: () => React.createElement('span', null, '☰'),
  Users: () => React.createElement('span', null, '👥'),
  Radio: () => React.createElement('span', null, '📻'),
  Heart: () => React.createElement('span', null, '♥'),
  Search: () => React.createElement('span', null, '🔍'),
  Settings: () => React.createElement('span', null, '⚙'),
  Plus: () => React.createElement('span', null, '+'),
  X: () => React.createElement('span', null, '✕'),
};

const { Play, Pause, SkipForward, SkipBack, Volume2, Search, List, Settings, Plus, Music, Radio, Users, Heart, X } = Icons;

// Function to load built-in resolvers from resolvers/builtin/ directory
const loadBuiltinResolvers = async () => {
  // Check if we're in Electron
  if (window.electron?.resolvers?.loadBuiltin) {
    console.log('📁 Loading resolvers via Electron IPC...');
    try {
      const resolvers = await window.electron.resolvers.loadBuiltin();
      return resolvers;
    } catch (error) {
      console.error('❌ Failed to load via Electron IPC:', error);
      return [];
    }
  } else {
    // Fallback for web/dev environment - try fetch
    console.log('📁 Loading resolvers via fetch (web mode)...');
    const resolverFiles = [
      'resolvers/builtin/spotify.axe',
      'resolvers/builtin/bandcamp.axe',
      'resolvers/builtin/qobuz.axe'
    ];
    
    const resolvers = [];
    
    for (const file of resolverFiles) {
      try {
        const response = await fetch(file);
        if (!response.ok) {
          console.error(`❌ Failed to load ${file}: ${response.status}`);
          continue;
        }
        const axe = await response.json();
        resolvers.push(axe);
        console.log(`✅ Loaded ${axe.manifest.name} resolver from ${file}`);
      } catch (error) {
        console.error(`❌ Error loading ${file}:`, error);
      }
    }
    
    return resolvers;
  }
};

// Fallback embedded resolvers (used if .axe files can't be loaded)
const FALLBACK_RESOLVERS = [
  {"manifest":{"id":"spotify","name":"Spotify","version":"1.0.0","author":"Parachord Team","description":"Stream from Spotify via Spotify Connect API. Requires Spotify Premium for remote playback.","icon":"♫","color":"#1DB954","homepage":"https://spotify.com","email":"support@harmonix.app"},"capabilities":{"resolve":true,"search":true,"stream":true,"browse":false,"urlLookup":false},"settings":{"requiresAuth":true,"authType":"oauth","scopes":["user-read-playback-state","user-modify-playback-state","user-read-currently-playing"],"configurable":{"clientId":{"type":"text","label":"Client ID","default":"c040c0ee133344b282e6342198bcbeea","readonly":true}}},"implementation":{"search":"async function(query, config) { if (!config.token) return []; try { const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=20`, { headers: { 'Authorization': `Bearer ${config.token}` } }); if (!response.ok) { console.error('Spotify search failed:', response.status); return []; } const data = await response.json(); return data.tracks.items.map(track => ({ id: `spotify-${track.id}`, title: track.name, artist: track.artists.map(a => a.name).join(', '), album: track.album.name, duration: Math.floor(track.duration_ms / 1000), sources: ['spotify'], spotifyUri: track.uri, spotifyId: track.id, albumArt: track.album.images[0]?.url })); } catch (error) { console.error('Spotify search error:', error); return []; } }","resolve":"async function(artist, track, album, config) { const query = `artist:${artist} track:${track}`; const results = await this.search(query, config); return results[0] || null; }","play":"async function(track, config) { if (!config.token) { console.error('Spotify not connected'); return false; } try { const devicesResponse = await fetch('https://api.spotify.com/v1/me/player/devices', { headers: { 'Authorization': `Bearer ${config.token}` } }); if (!devicesResponse.ok) return false; const devicesData = await devicesResponse.json(); const devices = devicesData.devices || []; if (devices.length === 0) { console.error('No Spotify devices found'); return false; } const activeDevice = devices.find(d => d.is_active) || devices[0]; if (!activeDevice.is_active) { const transferResponse = await fetch('https://api.spotify.com/v1/me/player', { method: 'PUT', headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ device_ids: [activeDevice.id], play: false }) }); if (!transferResponse.ok && transferResponse.status !== 204) { console.error('Failed to transfer playback'); } await new Promise(resolve => setTimeout(resolve, 500)); } const playResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${activeDevice.id}`, { method: 'PUT', headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: [track.spotifyUri] }) }); return playResponse.ok || playResponse.status === 204; } catch (error) { console.error('Spotify play error:', error); return false; } }","init":"async function(config) { console.log('Spotify resolver initialized'); }","cleanup":"async function() { console.log('Spotify resolver cleanup'); }"}},
  {"manifest":{"id":"bandcamp","name":"Bandcamp","version":"1.0.0","author":"Parachord Team","description":"Find and purchase music on Bandcamp. Opens tracks in browser for streaming.","icon":"🎸","color":"#629AA9","homepage":"https://bandcamp.com","email":"support@harmonix.app"},"capabilities":{"resolve":true,"search":true,"stream":false,"browse":false,"urlLookup":true},"settings":{"requiresAuth":false,"authType":"none","configurable":{}},"implementation":{"search":"async function(query, config) { try { console.log('Searching Bandcamp for:', query); const response = await fetch(`https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=t`, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }); if (!response.ok) { console.error('Bandcamp search failed:', response.status); return []; } const html = await response.text(); const results = []; const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); const searchResults = doc.querySelectorAll('.searchresult'); searchResults.forEach((item, index) => { if (index >= 20) return; try { const heading = item.querySelector('.heading'); const subhead = item.querySelector('.subhead'); const itemUrl = item.querySelector('.itemurl'); if (heading && itemUrl) { const title = heading.textContent.trim(); const artistInfo = subhead ? subhead.textContent.trim() : 'Unknown Artist'; const byMatch = artistInfo.match(/by\\\\s+([^,]+)/); const fromMatch = artistInfo.match(/from\\\\s+(.+)/); const artist = byMatch ? byMatch[1].trim() : 'Unknown Artist'; const album = fromMatch ? fromMatch[1].trim() : (byMatch ? byMatch[1].trim() : 'Single'); const url = itemUrl.textContent.trim(); results.push({ id: `bandcamp-${Date.now()}-${index}`, title: title, artist: artist, album: album, duration: 210, sources: ['bandcamp'], bandcampUrl: url }); } } catch (itemError) { console.error('Error parsing Bandcamp result:', itemError); } }); console.log(`Found ${results.length} Bandcamp results`); return results; } catch (error) { console.error('Bandcamp search error:', error); return []; } }","resolve":"async function(artist, track, album, config) { const query = `${artist} ${track}`; const results = await this.search(query, config); return results[0] || null; }","play":"async function(track, config) { if (!track.bandcampUrl) { console.error('No Bandcamp URL found'); return false; } try { if (window.electron?.shell?.openExternal) { const result = await window.electron.shell.openExternal(track.bandcampUrl); return result && result.success; } else { const newWindow = window.open(track.bandcampUrl, '_blank'); return !!newWindow; } } catch (error) { console.error('Failed to open Bandcamp link:', error); return false; } }","init":"async function(config) { console.log('Bandcamp resolver initialized'); }","cleanup":"async function() { console.log('Bandcamp resolver cleanup'); }"}},
  {"manifest":{"id":"qobuz","name":"Qobuz","version":"1.0.0","author":"Parachord Team","description":"High-quality audio streaming with 30-second previews. Subscription required for full playback.","icon":"🎵","color":"#0E7EBF","homepage":"https://qobuz.com","email":"support@harmonix.app"},"capabilities":{"resolve":true,"search":true,"stream":true,"browse":false,"urlLookup":false},"settings":{"requiresAuth":false,"authType":"apikey","configurable":{"appId":{"type":"text","label":"App ID","default":"285473059","readonly":true,"description":"Public demo app ID"}}},"implementation":{"search":"async function(query, config) { try { console.log('Searching Qobuz for:', query); const appId = config.appId || '285473059'; const response = await fetch(`https://www.qobuz.com/api.json/0.2/track/search?query=${encodeURIComponent(query)}&limit=20&app_id=${appId}`, { headers: { 'User-Agent': 'Parachord/1.0.0' } }); if (!response.ok) { console.error('Qobuz search failed:', response.status); return []; } const data = await response.json(); if (!data.tracks || !data.tracks.items) { console.log('No Qobuz results found'); return []; } const results = data.tracks.items.map(track => ({ id: `qobuz-${track.id}`, title: track.title, artist: track.performer?.name || track.album?.artist?.name || 'Unknown Artist', album: track.album?.title || 'Unknown Album', duration: track.duration || 180, sources: ['qobuz'], qobuzId: track.id, albumArt: track.album?.image?.small || track.album?.image?.thumbnail, previewUrl: track.preview_url, streamable: track.streamable, quality: track.maximum_bit_depth ? `${track.maximum_bit_depth}bit/${track.maximum_sampling_rate}kHz` : 'CD Quality' })); console.log(`Found ${results.length} Qobuz results`); return results; } catch (error) { console.error('Qobuz search error:', error); return []; } }","resolve":"async function(artist, track, album, config) { const query = `${artist} ${track}`; const results = await this.search(query, config); return results[0] || null; }","play":"async function(track, config) { if (!track.previewUrl) { console.error('No Qobuz preview URL'); return false; } try { const audio = new Audio(track.previewUrl); audio.volume = config.volume || 0.7; await audio.play(); console.log('Playing Qobuz 30-second preview'); return true; } catch (error) { console.error('Failed to play Qobuz preview:', error); return false; } }","init":"async function(config) { console.log('Qobuz resolver initialized'); }","cleanup":"async function() { console.log('Qobuz resolver cleanup'); }"}},
  {"manifest":{"id":"musicbrainz","name":"MusicBrainz","version":"1.0.0","author":"Parachord Team","description":"Open music encyclopedia providing metadata and artist information. Does not provide streaming.","icon":"📚","color":"#BA478F","homepage":"https://musicbrainz.org","email":"support@harmonix.app"},"capabilities":{"resolve":false,"search":true,"stream":false,"browse":false,"urlLookup":false},"settings":{"requiresAuth":false,"authType":"none","configurable":{}},"implementation":{"search":"async function(query, config) { try { const response = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&limit=20&fmt=json`, { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }); if (!response.ok) { console.error('MusicBrainz search failed:', response.status); return []; } const data = await response.json(); return data.recordings.map(recording => ({ id: `musicbrainz-${recording.id}`, title: recording.title, artist: recording['artist-credit']?.map(ac => ac.name).join(', ') || 'Unknown Artist', album: recording.releases?.[0]?.title || 'Unknown Album', duration: recording.length ? Math.floor(recording.length / 1000) : 180, sources: ['musicbrainz'], musicbrainzId: recording.id })); } catch (error) { console.error('MusicBrainz search error:', error); return []; } }","resolve":"async function(artist, track, album, config) { return null; }","play":"async function(track, config) { console.log('MusicBrainz provides metadata only, no playback'); return false; }","init":"async function(config) { console.log('MusicBrainz resolver initialized'); }","cleanup":"async function() { console.log('MusicBrainz resolver cleanup'); }"}}
];



// TrackRow component - defined outside to prevent recreation on every render
const TrackRow = React.memo(({ track, isPlaying, handlePlay, onArtistClick, onContextMenu, allResolvers, resolverOrder, activeResolvers }) => {
  // Get available sources (track.sources is an object with resolver IDs as keys)
  // Sort by priority order (left to right = highest to lowest priority)
  const availableSources = track.sources && typeof track.sources === 'object' && !Array.isArray(track.sources)
    ? Object.keys(track.sources).sort((a, b) => {
        const aIndex = resolverOrder?.indexOf(a) ?? 999;
        const bIndex = resolverOrder?.indexOf(b) ?? 999;
        return aIndex - bIndex;
      })
    : [];

  // Resolver metadata for badge display
  const resolverMeta = {
    spotify: { label: '♫ Spotify', bgColor: 'bg-green-600/20', textColor: 'text-green-400' },
    youtube: { label: '🎥 YouTube', bgColor: 'bg-red-600/20', textColor: 'text-red-400' },
    bandcamp: { label: '▶ Bandcamp', bgColor: 'bg-cyan-600/20', textColor: 'text-cyan-400' },
    qobuz: { label: '◆ Qobuz', bgColor: 'bg-blue-600/20', textColor: 'text-blue-400' }
  };

  // Determine which resolver will be used (based on priority)
  const getPrimaryResolver = () => {
    if (!availableSources.length || !resolverOrder || !activeResolvers || !allResolvers) return null;

    const sortedSources = availableSources
      .map(resId => ({
        resolverId: resId,
        priority: resolverOrder.indexOf(resId)
      }))
      .filter(s => activeResolvers.includes(s.resolverId))
      .sort((a, b) => a.priority - b.priority);

    if (sortedSources.length === 0) return null;

    const primaryResolverId = sortedSources[0].resolverId;
    return allResolvers.find(r => r.id === primaryResolverId);
  };

  const primaryResolver = getPrimaryResolver();

  return React.createElement('div', {
    className: 'group flex items-center gap-4 p-3 rounded-lg hover:bg-gray-100 transition-colors no-drag',
    onContextMenu: (e) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu(track);
      }
    }
  },
    // Album art or play button
    React.createElement('div', { className: 'relative w-12 h-12 flex-shrink-0' },
      React.createElement('div', {
        className: 'w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded flex items-center justify-center overflow-hidden'
      },
        track.albumArt && React.createElement('img', {
          src: track.albumArt,
          alt: track.album,
          className: 'absolute inset-0 w-full h-full object-cover',
          onError: (e) => { e.target.style.display = 'none'; }
        }),
        React.createElement(Music)
      ),
      React.createElement('button', {
        onClick: () => handlePlay(track),
        className: 'absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity'
      },
        React.createElement('div', { className: 'w-8 h-8 flex items-center justify-center rounded-full bg-purple-600 text-sm' },
          isPlaying ? React.createElement(Pause) : React.createElement(Play)
        )
      )
    ),
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('div', { className: `text-xs font-medium truncate ${isPlaying ? 'text-purple-600' : 'text-gray-900'}` }, track.title),
      React.createElement('div', { className: 'flex items-center gap-2' },
        React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            if (onArtistClick) {
              onArtistClick(track.artist);
            }
          },
          className: 'text-xs text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
          title: `View ${track.artist}'s discography`
        }, track.artist),
        // Resolver badges - clickable for manual override
        ...availableSources.map(resolverId => {
          const meta = resolverMeta[resolverId];
          if (!meta) return null;

          return React.createElement('button', {
            key: resolverId,
            onClick: (e) => {
              e.stopPropagation();
              // Play from this specific resolver
              handlePlay(track.sources[resolverId]);
            },
            className: `text-xs px-2 py-0.5 ${meta.bgColor} ${meta.textColor} rounded-full hover:opacity-80 transition-opacity cursor-pointer`,
            title: `Play from ${meta.label} (manual override)`
          }, meta.label);
        })
      ),
      primaryResolver && React.createElement('div', { className: 'text-xs text-gray-400 mt-0.5' }, `via ${primaryResolver.name}`)
    ),
    React.createElement('div', { className: 'text-xs text-gray-500 truncate max-w-[200px]' }, track.album),
    React.createElement('div', { className: 'text-xs text-gray-500 w-12 text-right' },
      `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}`
    )
  );
});

// Service logo SVGs - white versions for colored backgrounds
const SERVICE_LOGOS = {
  spotify: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z' })
  ),
  bandcamp: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M0 18.75l7.437-13.5H24l-7.438 13.5H0z' })
  ),
  qobuz: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-7c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5z' })
  ),
  youtube: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' })
  ),
  soundcloud: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.052-.1-.084-.1zm-.899.828c-.06 0-.091.037-.104.094L0 14.479l.165 1.308c.014.057.045.094.09.094.049 0 .084-.037.09-.094l.195-1.308-.196-1.332c-.006-.057-.04-.094-.068-.094zm1.83-1.229c-.06 0-.12.037-.12.1l-.21 2.563.225 2.458c0 .06.045.1.105.1.074 0 .12-.04.12-.1l.24-2.458-.24-2.563c0-.06-.03-.1-.12-.1zm.945-.089c-.075 0-.135.045-.15.105l-.18 2.647.18 2.456c.015.06.075.105.15.105.075 0 .135-.045.15-.105l.21-2.456-.21-2.647c-.015-.06-.075-.105-.15-.105zm1.065.285c-.09 0-.15.045-.165.105l-.15 2.382.15 2.423c.015.075.075.12.165.12.09 0 .15-.045.165-.12l.18-2.423-.195-2.382c-.015-.06-.06-.105-.15-.105zm1.08-1.5c-.09 0-.18.06-.18.135l-.15 3.762.15 2.4c0 .09.09.149.18.149.09 0 .165-.06.18-.135l.165-2.414-.165-3.762c-.015-.09-.09-.135-.18-.135zm1.05-.706c-.105 0-.195.075-.195.165l-.12 4.333.12 2.37c0 .09.09.165.195.165.09 0 .18-.075.195-.165l.135-2.37-.135-4.333c-.015-.09-.09-.165-.195-.165zm1.14-.255c-.105 0-.21.075-.21.165l-.105 4.59.105 2.34c.015.09.105.165.21.165.105 0 .195-.075.21-.165l.12-2.355-.12-4.575c0-.09-.09-.165-.21-.165zm1.11-.165c-.12 0-.225.09-.225.18l-.09 4.74.09 2.31c.015.105.105.18.225.18.12 0 .21-.075.225-.18l.105-2.31-.105-4.74c-.015-.09-.105-.18-.225-.18zm1.17-.225c-.135 0-.24.09-.24.195l-.075 4.785.075 2.28c0 .12.105.21.24.21.12 0 .225-.09.24-.21l.09-2.28-.09-4.785c-.015-.105-.12-.195-.24-.195zm1.2.045c-.135 0-.255.105-.255.21l-.06 4.545.06 2.25c.015.12.12.21.255.21.15 0 .255-.09.27-.21l.075-2.25-.075-4.545c-.015-.105-.12-.21-.27-.21zm1.2.375c-.15 0-.27.105-.285.225l-.045 4.17.045 2.22c.015.12.135.225.285.225.135 0 .27-.105.27-.225l.06-2.22-.06-4.17c0-.12-.12-.225-.27-.225zm3.98-1.62c-.36 0-.705.06-1.035.18-.21-2.37-2.19-4.215-4.59-4.215-.615 0-1.2.135-1.725.36-.195.09-.255.18-.255.36v8.94c0 .18.15.345.33.36h7.275c1.665 0 3.015-1.35 3.015-3.015 0-1.665-1.35-3.015-3.015-3.015v.045z' })
  ),
  applemusic: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z' })
  ),
  localfiles: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10h-4v-4H8l4-4 4 4h-2v4z' })
  ),
  musicbrainz: React.createElement('svg', { viewBox: '0 0 24 24', className: 'w-16 h-16', fill: 'white' },
    React.createElement('path', { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' })
  )
};

// ResolverCard component - Tomahawk-style colored card with centered logo
const ResolverCard = React.memo(({
  resolver,
  isActive,
  isInstalled,
  hasUpdate,
  isInstalling,
  priorityNumber,
  onClick,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd,
  onContextMenu,
  draggable = false,
  isDragOver = false,
  isDragging = false
}) => {
  // Get the logo SVG or fall back to emoji icon
  const logo = SERVICE_LOGOS[resolver.id];

  return React.createElement('div', {
    className: `flex flex-col items-center relative ${isDragging ? 'opacity-50' : ''}`,
    draggable: draggable,
    onDragStart: draggable ? onDragStart : undefined,
    onDragOver: draggable ? onDragOver : undefined,
    onDragEnter: draggable ? onDragEnter : undefined,
    onDragLeave: draggable ? onDragLeave : undefined,
    onDrop: draggable ? onDrop : undefined,
    onDragEnd: draggable ? onDragEnd : undefined,
    onContextMenu: onContextMenu
  },
    // Drop indicator - shown when dragging over this card
    isDragOver && React.createElement('div', {
      className: 'absolute -left-3 top-0 bottom-6 w-1 bg-purple-500 rounded-full',
      style: {
        boxShadow: '0 0 8px rgba(147, 51, 234, 0.6)',
        zIndex: 10
      }
    }),
    // Card with colored background
    React.createElement('div', {
      className: `relative w-32 h-32 rounded-xl flex items-center justify-center cursor-pointer transition-all hover:scale-105 hover:shadow-lg ${
        isActive === false ? 'opacity-50 grayscale' : ''
      } ${isDragOver ? 'ring-2 ring-purple-500 ring-offset-2' : ''}`,
      style: { backgroundColor: resolver.color || '#6B7280' },
      onClick: onClick
    },
      // Priority number badge (top-left)
      priorityNumber && React.createElement('div', {
        className: 'absolute top-2 left-2 w-6 h-6 bg-white/90 rounded-full flex items-center justify-center text-xs font-bold text-gray-700 shadow-sm'
      }, priorityNumber),
      // Centered logo or emoji fallback
      logo ? logo : React.createElement('span', {
        className: 'text-5xl text-white drop-shadow-md'
      }, resolver.icon),
      // Status overlay for installed/update (marketplace view)
      isInstalled && React.createElement('div', {
        className: `absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
          hasUpdate ? 'bg-orange-500 text-white' : 'bg-white text-green-600'
        }`
      }, hasUpdate ? '↑' : '✓'),
      // Update badge for installed tab (top-right, only when not showing installed badge)
      !isInstalled && hasUpdate && React.createElement('div', {
        className: 'absolute top-2 right-2 w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-xs text-white'
      }, '↑'),
      // Installing spinner
      isInstalling && React.createElement('div', {
        className: 'absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center'
      },
        React.createElement('span', { className: 'text-white text-2xl animate-spin' }, '⏳')
      )
    ),
    // Name below card
    React.createElement('span', {
      className: 'mt-3 text-sm text-gray-900 font-medium text-center truncate w-32'
    }, resolver.name)
  );
});

// RelatedArtistCard component - Shows artist image with name below
const RelatedArtistCard = ({ artist, getArtistImage, onNavigate }) => {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadImage = async () => {
      setImageLoading(true);
      const result = await getArtistImage(artist.name);
      if (!cancelled && result?.url) {
        setImageUrl(result.url);
      }
      if (!cancelled) {
        setImageLoading(false);
      }
    };
    loadImage();
    return () => { cancelled = true; };
    // Note: getArtistImage excluded from deps - function identity changes but behavior doesn't
  }, [artist.name]);

  return React.createElement('button', {
    onClick: onNavigate,
    className: 'text-left group'
  },
    // Artist image square (matches SearchArtistCard)
    React.createElement('div', { className: 'w-full aspect-square bg-gray-100 mb-2 relative overflow-hidden' },
      imageLoading && React.createElement('div', {
        className: 'w-full h-full bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer',
        style: { backgroundSize: '200% 100%' }
      }),
      !imageLoading && imageUrl && React.createElement('img', {
        src: imageUrl,
        alt: artist.name,
        className: 'w-full h-full object-cover'
      }),
      !imageLoading && !imageUrl && React.createElement('div', {
        className: 'w-full h-full flex items-center justify-center text-gray-300'
      },
        React.createElement('svg', { className: 'w-10 h-10', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
        )
      )
    ),
    // Artist name
    React.createElement('div', { className: 'text-sm font-medium text-gray-900 truncate' }, artist.name)
  );
};

// SearchArtistCard component - for quick search results with artist image
const SearchArtistCard = ({ artist, getArtistImage, onClick, onContextMenu }) => {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadImage = async () => {
      setImageLoading(true);
      const result = await getArtistImage(artist.name);
      if (!cancelled && result?.url) {
        setImageUrl(result.url);
      }
      if (!cancelled) {
        setImageLoading(false);
      }
    };
    loadImage();
    return () => { cancelled = true; };
    // Note: getArtistImage excluded from deps - function identity changes but behavior doesn't
  }, [artist.name]);

  return React.createElement('button', {
    onClick: onClick,
    className: 'flex-shrink-0 w-28 text-left group cursor-grab active:cursor-grabbing',
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'artist',
        artist: {
          id: (artist.name || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, ''),
          name: artist.name,
          image: null
        }
      }));
    },
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onContextMenu) {
        onContextMenu(artist);
      }
    }
  },
    // Artist image square
    React.createElement('div', { className: 'w-28 h-28 bg-gray-100 mb-2 relative overflow-hidden' },
      imageLoading && React.createElement('div', {
        className: 'w-full h-full flex items-center justify-center'
      },
        React.createElement('div', {
          className: 'w-6 h-6 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin'
        })
      ),
      !imageLoading && imageUrl && React.createElement('img', {
        src: imageUrl,
        alt: artist.name,
        className: 'w-full h-full object-cover'
      }),
      !imageLoading && !imageUrl && React.createElement('div', {
        className: 'w-full h-full flex items-center justify-center text-gray-300'
      },
        React.createElement('svg', { className: 'w-10 h-10', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
        )
      )
    ),
    // Artist name
    React.createElement('div', { className: 'text-sm font-medium text-gray-900 truncate' }, artist.name),
    // Album and song counts
    React.createElement('div', { className: 'text-xs text-gray-500' },
      artist['release-count'] ? `${artist['release-count']} Albums` : ''
    ),
    React.createElement('div', { className: 'text-xs text-gray-500' },
      artist['recording-count'] ? `${artist['recording-count']} Songs` : ''
    )
  );
};

// CollectionArtistCard component - for Collection view artist grid with lazy image loading
const CollectionArtistCard = ({ artist, getArtistImage, onNavigate }) => {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadImage = async () => {
      setImageLoading(true);
      const result = await getArtistImage(artist.name);
      if (!cancelled && result?.url) {
        setImageUrl(result.url);
      }
      if (!cancelled) {
        setImageLoading(false);
      }
    };
    loadImage();
    return () => { cancelled = true; };
  }, [artist.name]);

  return React.createElement('button', {
    onClick: onNavigate,
    className: 'group text-left p-4 rounded-xl bg-white border border-gray-100 hover:border-purple-200 hover:shadow-md transition-all'
  },
    // Artist image (circular)
    React.createElement('div', {
      className: 'w-full aspect-square rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mb-3 flex items-center justify-center overflow-hidden'
    },
      imageLoading && React.createElement('div', {
        className: 'w-full h-full flex items-center justify-center'
      },
        React.createElement('div', {
          className: 'w-8 h-8 border-2 border-white/30 border-t-white/70 rounded-full animate-spin'
        })
      ),
      !imageLoading && imageUrl && React.createElement('img', {
        src: imageUrl,
        alt: artist.name,
        className: 'w-full h-full object-cover'
      }),
      !imageLoading && !imageUrl && React.createElement('svg', {
        className: 'w-12 h-12 text-white/70',
        fill: 'none',
        viewBox: '0 0 24 24',
        stroke: 'currentColor'
      },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
      )
    ),
    // Artist name
    React.createElement('h3', {
      className: 'font-medium text-gray-900 truncate group-hover:text-purple-600 transition-colors'
    }, artist.name),
    // Track count (only show if > 0)
    artist.trackCount > 0 && React.createElement('p', {
      className: 'text-sm text-gray-500'
    }, `${artist.trackCount} track${artist.trackCount !== 1 ? 's' : ''}`)
  );
};

// CollectionAlbumCard component - for Collection view album grid with lazy image loading
const CollectionAlbumCard = ({ album, getAlbumArt, onNavigate }) => {
  const [imageUrl, setImageUrl] = useState(album.art || null);
  const [imageLoading, setImageLoading] = useState(!album.art);

  useEffect(() => {
    // If we already have embedded art, don't fetch
    if (album.art) {
      setImageUrl(album.art);
      setImageLoading(false);
      return;
    }

    let cancelled = false;
    const loadImage = async () => {
      setImageLoading(true);
      const artUrl = await getAlbumArt(album.artist, album.title);
      if (!cancelled && artUrl) {
        setImageUrl(artUrl);
      }
      if (!cancelled) {
        setImageLoading(false);
      }
    };
    loadImage();
    return () => { cancelled = true; };
  }, [album.artist, album.title, album.art]);

  return React.createElement('button', {
    onClick: onNavigate,
    className: 'group text-left'
  },
    // Album card
    React.createElement('div', {
      className: 'p-4 rounded-xl bg-white border border-gray-100 hover:border-purple-200 hover:shadow-md transition-all'
    },
      // Album art
      React.createElement('div', {
        className: 'w-full aspect-square rounded-lg mb-3 overflow-hidden',
        style: {
          background: 'linear-gradient(135deg, #9333ea 0%, #ec4899 100%)'
        }
      },
        imageLoading && React.createElement('div', {
          className: 'w-full h-full flex items-center justify-center'
        },
          React.createElement('div', {
            className: 'w-8 h-8 border-2 border-white/30 border-t-white/70 rounded-full animate-spin'
          })
        ),
        !imageLoading && imageUrl && React.createElement('img', {
          src: imageUrl,
          alt: album.title,
          className: 'w-full h-full object-cover',
          onError: (e) => { e.target.style.display = 'none'; }
        }),
        !imageLoading && !imageUrl && React.createElement('div', { className: 'w-full h-full flex items-center justify-center' },
          React.createElement('svg', { className: 'w-12 h-12 text-white/50', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
          )
        )
      ),
      // Album title
      React.createElement('h3', {
        className: 'font-medium text-gray-900 truncate group-hover:text-purple-600 transition-colors text-sm'
      }, album.title),
      // Artist name
      React.createElement('p', {
        className: 'text-sm text-gray-500 truncate'
      }, album.artist),
      // Year and track count
      React.createElement('div', { className: 'flex items-center gap-2 mt-1' },
        album.year && React.createElement('span', {
          className: 'text-xs text-gray-400'
        }, album.year),
        React.createElement('span', {
          className: 'text-xs text-gray-400'
        }, `${album.trackCount} track${album.trackCount !== 1 ? 's' : ''}`)
      )
    )
  );
};

// ReleaseCard component - FRESH START - Ultra simple, no complications
const ReleaseCard = ({ release, currentArtist, fetchReleaseData, onContextMenu, onHoverFetch, isVisible = true }) => {
  const year = release.date ? release.date.split('-')[0] : 'Unknown';

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    const albumData = {
      type: 'album',
      album: {
        id: `${currentArtist?.name || release.artist?.name || 'unknown'}-${release.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
        title: release.title,
        artist: currentArtist?.name || release.artist?.name,
        year: year !== 'Unknown' ? parseInt(year) : null,
        art: release.albumArt
      }
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(albumData));
  };

  const cardStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    cursor: 'grab',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    transition: 'transform 0.2s, background-color 0.2s'
  };
  
  const handleClick = () => {
    console.log('🎵 Card clicked:', release.title);
    fetchReleaseData(release, currentArtist);
  };
  
  return React.createElement('button', {
    className: 'no-drag',
    draggable: true,
    onDragStart: handleDragStart,
    style: {
      ...cardStyle,
      width: '100%',
      textAlign: 'left',
      display: isVisible ? 'block' : 'none'  // Hide with CSS instead of destroying DOM
    },
    onClick: handleClick,
    onContextMenu: (e) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu(release);
      }
    },
    onMouseEnter: (e) => {
      e.currentTarget.style.transform = 'scale(1.05)';
      e.currentTarget.style.backgroundColor = 'rgba(124, 58, 237, 0.2)';
      // Prefetch release tracks on hover
      if (onHoverFetch) {
        onHoverFetch(release);
      }
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.transform = 'scale(1)';
      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    }
  },
    // Album art - shows image when loaded, gradient placeholder when not
    React.createElement('div', {
      style: {
        width: '100%',
        aspectRatio: '1',
        borderRadius: '8px',
        background: 'linear-gradient(135deg, #9333ea 0%, #ec4899 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '12px',
        pointerEvents: 'none',
        overflow: 'hidden',
        position: 'relative'
      }
    },
      // Album art image (if loaded) - onError hides broken image to show gradient behind
      release.albumArt && React.createElement('img', {
        src: release.albumArt,
        alt: release.title,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          left: 0
        },
        onError: (e) => {
          // Hide broken image to reveal gradient placeholder behind
          e.target.style.display = 'none';
        }
      }),

      // Music icon placeholder (always rendered, behind the image)
      React.createElement('svg', {
        style: { 
          width: '48px', 
          height: '48px', 
          color: 'rgba(255, 255, 255, 0.5)',
          pointerEvents: 'none'
        },
        fill: 'none',
        viewBox: '0 0 24 24',
        stroke: 'currentColor',
        strokeWidth: 2
      },
        React.createElement('path', {
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
        })
      )
    ),
    
    // Title
    React.createElement('h3', {
      style: {
        fontWeight: '600',
        fontSize: '14px',
        marginBottom: '4px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'black',
        pointerEvents: 'none'  // KEY FIX!
      },
      title: release.title
    }, release.title),
    
    // Year
    React.createElement('p', {
      style: {
        fontSize: '12px',
        color: '#9ca3af',
        marginBottom: '8px',
        pointerEvents: 'none'  // KEY FIX!
      }
    }, year),
    
    // Badge
    React.createElement('span', {
      style: {
        display: 'inline-block',
        padding: '2px 8px',
        fontSize: '11px',
        borderRadius: '9999px',
        backgroundColor: release.releaseType === 'album' ? 'rgba(37, 99, 235, 0.2)' :
                        release.releaseType === 'ep' ? 'rgba(22, 163, 74, 0.2)' :
                        'rgba(168, 85, 247, 0.2)',
        color: release.releaseType === 'album' ? '#60a5fa' :
              release.releaseType === 'ep' ? '#4ade80' :
              '#a78bfa',
        pointerEvents: 'none'  // KEY FIX!
      }
    }, release.releaseType.toUpperCase())
  );
};

// ReleasePage component - Shows full album/EP/single with tracklist
const ReleasePage = ({
  release,
  handleSearch,
  handlePlay,
  onTrackPlay,
  onTrackContextMenu,
  trackSources = {},
  resolvers = [],
  // Drag and drop props (for adding tracks to playlists)
  onDragStart,
  onDragEnd
}) => {
  const formatDuration = (ms) => {
    if (!ms) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format full date nicely
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return React.createElement('div', { className: 'flex gap-0 p-6' },
    // LEFT COLUMN: Album art and metadata
    React.createElement('div', {
      className: 'flex-shrink-0 pr-8',
      style: { width: '240px' }
    },
      // Album art container - make draggable
      React.createElement('div', {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = 'copy';
          const albumData = {
            type: 'album',
            album: {
              id: `${release.artist?.name || 'unknown'}-${release.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
              title: release.title,
              artist: release.artist?.name,
              year: release.date?.split('-')[0] || null,
              art: release.albumArt
            }
          };
          e.dataTransfer.setData('text/plain', JSON.stringify(albumData));
        },
        className: 'w-48 h-48 rounded bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-lg relative overflow-hidden cursor-grab active:cursor-grabbing'
      },
        // Image (absolute positioned, hides on error)
        release.albumArt && React.createElement('img', {
          src: release.albumArt,
          alt: release.title,
          className: 'absolute inset-0 w-full h-full object-cover',
          onError: (e) => { e.target.style.display = 'none'; }
        }),
        // Placeholder icon (always behind)
        React.createElement('svg', {
          className: 'w-16 h-16 text-white/50',
          fill: 'none',
          viewBox: '0 0 24 24',
          stroke: 'currentColor'
        },
          React.createElement('path', {
            strokeLinecap: 'round',
              strokeLinejoin: 'round',
              strokeWidth: 2,
              d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
            })
          )
        ),

      // Album title and metadata
      React.createElement('div', { className: 'mt-4 space-y-1' },
        React.createElement('h2', {
          className: 'font-bold text-gray-900 text-lg leading-tight'
        }, release.title),
        React.createElement('p', {
          className: 'text-sm text-gray-500'
        }, formatDate(release.date)),
        React.createElement('p', {
          className: 'text-sm text-gray-500'
        }, `${release.tracks.length.toString().padStart(2, '0')} Songs`)
      )
    ),

    // RIGHT COLUMN: Tracklist
    React.createElement('div', { className: 'flex-1 min-w-0' },
      release.tracks.length > 0 ?
        React.createElement('div', { className: 'space-y-0' },
          release.tracks.map((track, index) => {
            const trackKey = `${track.position}-${track.title}`;
            const sources = trackSources[trackKey] || {};
            const availableResolvers = Object.keys(sources);
            
            // Build track object for drag/drop and playback
            const trackId = `${release.artist.name || 'unknown'}-${track.title || 'untitled'}-${release.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            const trackForDrag = {
              ...track,
              id: trackId,
              artist: release.artist.name,
              album: release.title,
              albumArt: release.albumArt,
              sources: sources
            };

            return React.createElement('div', {
              key: index,
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track: trackForDrag }));
                if (onDragStart) {
                  onDragStart(trackForDrag);
                }
              },
              onDragEnd: () => {
                if (onDragEnd) {
                  onDragEnd();
                }
              },
              className: 'flex items-center gap-4 py-2 px-3 border-b border-gray-100 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors no-drag group',
              onClick: () => {
                console.log('Track row clicked:', track.title);

                // Play track with sources if resolved
                if (availableResolvers.length > 0) {
                  // Build queue from remaining tracks (after this one)
                  const tracksAfter = release.tracks.slice(index + 1).map((t, i) => {
                    const tKey = `${t.position}-${t.title}`;
                    const tSources = trackSources[tKey] || {};
                    const tId = `${release.artist.name || 'unknown'}-${t.title || 'untitled'}-${release.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                    return {
                      ...t,
                      id: tId,
                      artist: release.artist.name,
                      album: release.title,
                      albumArt: release.albumArt,
                      sources: tSources
                    };
                  });

                  if (onTrackPlay) {
                    onTrackPlay(trackForDrag, tracksAfter);
                  } else {
                    handlePlay(trackForDrag);
                  }
                } else {
                  // No resolved sources yet, fall back to search
                  console.log('No resolved sources, searching...');
                  handleSearch(`${release.artist.name} ${track.title}`);
                }
              },
              onContextMenu: (e) => {
                e.preventDefault();
                if (onTrackContextMenu) {
                  onTrackContextMenu(trackForDrag);
                }
              }
            },
              // Track number
              React.createElement('span', {
                className: 'text-sm text-gray-400 w-6 flex-shrink-0 text-right',
                style: { pointerEvents: 'none' }
              }, String(track.position).padStart(2, '0')),

              // Track title
              React.createElement('span', {
                className: 'text-sm text-gray-700 flex-1 truncate transition-colors group-hover:text-gray-900',
                style: { pointerEvents: 'none' }
              }, track.title),

              // Duration
              track.length && React.createElement('span', {
                className: 'text-sm text-gray-400 flex-shrink-0 tabular-nums',
                style: { pointerEvents: 'none' }
              }, formatDuration(track.length)),
              
              // Resolver icons (sources available for this track)
              React.createElement('div', {
                className: 'flex items-center gap-1 flex-shrink-0 ml-auto',
                style: { pointerEvents: 'none', minHeight: '24px', width: '100px', justifyContent: 'flex-end' }
              },
                (() => {
                  const trackKey = `${track.position}-${track.title}`;
                  const sources = trackSources[trackKey] || {};
                  const availableResolverIds = Object.keys(sources);

                  if (availableResolverIds.length === 0) {
                    // Show shimmer skeletons while resolving (match resolver icon size)
                    return React.createElement('div', {
                      className: 'flex items-center gap-1'
                    },
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                        title: 'Resolving track...'
                      }),
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                        style: { animationDelay: '0.1s' }
                      })
                    );
                  }

                  // Sort resolvers by priority order (left to right = highest to lowest priority)
                  const sortedResolverIds = [...availableResolverIds].sort((a, b) => {
                    const aIndex = resolvers.findIndex(r => r.id === a);
                    const bIndex = resolvers.findIndex(r => r.id === b);
                    return aIndex - bIndex;
                  });

                  // Show resolver icons for available sources (only if they support playback)
                  return sortedResolverIds.map(resolverId => {
                    const resolver = resolvers.find(r => r.id === resolverId);
                    if (!resolver || !resolver.play) return null;
                    
                    const source = sources[resolverId];
                    const confidence = source.confidence || 0;
                    
                    return React.createElement('button', {
                      key: resolverId,
                      className: 'no-drag',
                      onClick: (e) => {
                        e.stopPropagation(); // Don't trigger row click
                        console.log(`Playing from ${resolver.name}:`, source);

                        // Create track with preferred resolver
                        const trackWithResolver = { ...trackForDrag, preferredResolver: resolverId };

                        // Build queue from remaining tracks (after this one)
                        const tracksAfter = release.tracks.slice(index + 1).map((t, i) => {
                          const tKey = `${t.position}-${t.title}`;
                          const tSources = trackSources[tKey] || {};
                          const tId = `${release.artist.name || 'unknown'}-${t.title || 'untitled'}-${release.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                          return {
                            ...t,
                            id: tId,
                            artist: release.artist.name,
                            album: release.title,
                            albumArt: release.albumArt,
                            sources: tSources
                          };
                        });

                        if (onTrackPlay) {
                          onTrackPlay(trackWithResolver, tracksAfter);
                        } else {
                          handlePlay(trackWithResolver);
                        }
                      },
                      style: {
                        width: '24px',
                        height: '24px',
                        borderRadius: '4px',
                        backgroundColor: resolver.color,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        color: 'white',
                        pointerEvents: 'auto',
                        opacity: confidence > 0.8 ? 1 : 0.6,
                        transition: 'transform 0.1s'
                      },
                      onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                      onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                      title: `Play from ${resolver.name} (${Math.round(confidence * 100)}% match)`
                    }, (() => {
                      // Custom abbreviations for resolvers
                      const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM', localfiles: 'LO' };
                      return abbrevMap[resolverId] || resolver.name.slice(0, 2).toUpperCase();
                    })());
                  });
                })()
              ),
              
              // Play icon
              React.createElement('svg', {
                className: 'w-5 h-5 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0',
                fill: 'currentColor',
                viewBox: '0 0 24 24',
                style: { pointerEvents: 'none' }
              },
                React.createElement('path', {
                  d: 'M8 5v14l11-7z'
                })
              )
            );
          })
        )
      :
        React.createElement('div', { className: 'text-center py-12 text-gray-400' },
          'No track information available'
        )
    )
  );
};

const Parachord = () => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentQueue, setCurrentQueue] = useState([]); // Current playing queue
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(70);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({
    artists: [],
    albums: [],
    tracks: [],
    playlists: []
  });
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);
  // Pagination state - how many items to show per column
  const [displayLimits, setDisplayLimits] = useState({
    artists: 5,
    albums: 5,
    tracks: 8,
    playlists: 5
  });
  const [searchDetailCategory, setSearchDetailCategory] = useState(null); // null = main view, 'artists'|'tracks'|'albums'|'playlists' = detail view
  const [searchPreviewItem, setSearchPreviewItem] = useState(null); // Currently previewed item in detail view
  const [searchPreviewArtistImage, setSearchPreviewArtistImage] = useState(null); // Artist image for preview pane
  const [searchPreviewArtistBio, setSearchPreviewArtistBio] = useState(null); // Artist bio snippet for preview pane
  const [searchHeaderCollapsed, setSearchHeaderCollapsed] = useState(false); // Search detail header collapse state
  const [activeView, setActiveView] = useState('library');
  const [viewHistory, setViewHistory] = useState(['library']); // Navigation history for back button
  const [artistHistory, setArtistHistory] = useState([]); // Stack of previous artist names for back navigation
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [allPlaylistCovers, setAllPlaylistCovers] = useState({}); // { playlistId: [url1, url2, url3, url4] }
  const [draggedPlaylistTrack, setDraggedPlaylistTrack] = useState(null); // For playlist track reordering
  const [playlistDropTarget, setPlaylistDropTarget] = useState(null); // Index where track will be dropped
  const [currentArtist, setCurrentArtist] = useState(null); // Artist page data
  const [artistImage, setArtistImage] = useState(null); // Artist image from Spotify
  const [artistImagePosition, setArtistImagePosition] = useState('center 25%'); // Face-centered position
  const [artistReleases, setArtistReleases] = useState([]); // Discography
  const [releaseTypeFilter, setReleaseTypeFilter] = useState('album'); // album, ep, single, live, compilation
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false); // Artist page header collapse state
  const [artistPageTab, setArtistPageTab] = useState('music'); // music | biography | related
  const [artistSearchOpen, setArtistSearchOpen] = useState(false);
  const [artistSearch, setArtistSearch] = useState('');
  const [artistSortDropdownOpen, setArtistSortDropdownOpen] = useState(false);
  const [artistSort, setArtistSort] = useState('date-desc'); // date-desc, date-asc, alpha-asc, alpha-desc
  const [artistBio, setArtistBio] = useState(null); // Artist biography from Last.fm
  const [relatedArtists, setRelatedArtists] = useState([]); // Related artists from Last.fm
  const [loadingBio, setLoadingBio] = useState(false);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [loadingArtist, setLoadingArtist] = useState(false);
  const [currentRelease, setCurrentRelease] = useState(null); // Release/Album page data
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [prefetchedReleases, setPrefetchedReleases] = useState({}); // Cache for on-hover prefetched release tracks: { releaseId: { tracks: [...], title, albumArt } }
  const prefetchedReleasesRef = useRef(prefetchedReleases); // Ref to avoid stale closure in context menu handlers
  const prefetchInProgressRef = useRef(new Set()); // Track which releases are currently being prefetched

  // Critic's Picks state
  const [criticsPicks, setCriticsPicks] = useState([]);
  const [criticsPicksLoading, setCriticsPicksLoading] = useState(false);
  const criticsPicksLoaded = useRef(false);

  // Charts state
  const [charts, setCharts] = useState([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const chartsLoaded = useRef(false);

  const [trackSources, setTrackSources] = useState({}); // Resolved sources for each track: { trackId: { youtube: {...}, soundcloud: {...} } }
  const [activeResolvers, setActiveResolvers] = useState(['spotify', 'bandcamp', 'qobuz', 'youtube']);
  const [resolverOrder, setResolverOrder] = useState(['spotify', 'bandcamp', 'qobuz', 'youtube', 'soundcloud']);
  const resolverSettingsLoaded = useRef(false);  // Track if we've loaded settings from storage
  const activeResolversRef = useRef(activeResolvers);  // Ref to avoid stale closure in save
  const resolverOrderRef = useRef(resolverOrder);  // Ref to avoid stale closure in save
  const [draggedResolver, setDraggedResolver] = useState(null);
  const [dragOverResolver, setDragOverResolver] = useState(null);  // Which resolver is being dragged over
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [resolvingLibraryTracks, setResolvingLibraryTracks] = useState(new Set()); // Track filePaths currently being resolved
  const [audioContext, setAudioContext] = useState(null);
  const [currentSource, setCurrentSource] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const [isExternalPlayback, setIsExternalPlayback] = useState(false);
  const [showExternalPrompt, setShowExternalPrompt] = useState(false);
  const [pendingExternalTrack, setPendingExternalTrack] = useState(null);
  const externalTrackTimeoutRef = useRef(null);
  const playbackPollerRef = useRef(null);
  const pollingRecoveryRef = useRef(null); // Recovery interval for when Spotify polling fails
  const [settingsTab, setSettingsTab] = useState('installed'); // 'installed' | 'marketplace' | 'general' | 'about'
  const [marketplaceManifest, setMarketplaceManifest] = useState(null);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceSearchQuery, setMarketplaceSearchQuery] = useState('');
  const [marketplaceCategory, setMarketplaceCategory] = useState('all');
  const [installingResolvers, setInstallingResolvers] = useState(new Set());
  const [spotifyToken, setSpotifyToken] = useState(null);
  const spotifyTokenRef = useRef(null); // Ref for cleanup on unmount
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [queueDrawerHeight, setQueueDrawerHeight] = useState(350); // Default height in pixels
  const [draggedQueueTrack, setDraggedQueueTrack] = useState(null); // For queue reordering
  const [queueDropTarget, setQueueDropTarget] = useState(null); // Index where track will be dropped in queue
  const [droppingTrackId, setDroppingTrackId] = useState(null); // Track ID that's animating "drop" into player
  const [qobuzToken, setQobuzToken] = useState(null);
  const [qobuzConnected, setQobuzConnected] = useState(false);
  const [showUrlImportDialog, setShowUrlImportDialog] = useState(false);
  const [urlImportValue, setUrlImportValue] = useState('');
  const [urlImportLoading, setUrlImportLoading] = useState(false);

  // Local Files state
  const [localFilesStats, setLocalFilesStats] = useState({ totalTracks: 0, totalFolders: 0, lastScan: null });
  const [watchFolders, setWatchFolders] = useState([]);

  // Collection page state
  const [collectionTab, setCollectionTab] = useState('tracks'); // 'artists' | 'albums' | 'tracks'
  const [collectionHeaderCollapsed, setCollectionHeaderCollapsed] = useState(false);
  const [collectionSearchOpen, setCollectionSearchOpen] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionSortDropdownOpen, setCollectionSortDropdownOpen] = useState(false);
  const [collectionSort, setCollectionSort] = useState({
    artists: 'alpha-asc',
    albums: 'recent',
    tracks: 'recent'
  });

  // Playlists page state
  const [playlistsHeaderCollapsed, setPlaylistsHeaderCollapsed] = useState(false);
  const [playlistsSearchOpen, setPlaylistsSearchOpen] = useState(false);
  const [playlistsSearch, setPlaylistsSearch] = useState('');
  const [playlistsSortDropdownOpen, setPlaylistsSortDropdownOpen] = useState(false);
  const [playlistsSort, setPlaylistsSort] = useState('recent');

  // Charts (Pop of the Tops) page state
  const [chartsHeaderCollapsed, setChartsHeaderCollapsed] = useState(false);
  const [chartsSearchOpen, setChartsSearchOpen] = useState(false);
  const [chartsSearch, setChartsSearch] = useState('');
  const [chartsSortDropdownOpen, setChartsSortDropdownOpen] = useState(false);
  const [chartsSort, setChartsSort] = useState('rank');

  // Critics Picks page state
  const [criticsHeaderCollapsed, setCriticsHeaderCollapsed] = useState(false);
  const [criticsSearchOpen, setCriticsSearchOpen] = useState(false);
  const [criticsSearch, setCriticsSearch] = useState('');
  const [criticsSortDropdownOpen, setCriticsSortDropdownOpen] = useState(false);
  const [criticsSort, setCriticsSort] = useState('recent');

  // Sidebar badge state for visual feedback on additions
  const [sidebarBadges, setSidebarBadges] = useState({
    collection: null,
    playlists: null
  });
  const sidebarBadgeTimeouts = useRef({});

  // Show a "+N" badge on a sidebar item that auto-clears after animation
  const showSidebarBadge = useCallback((item, count = 1) => {
    // Clear any existing timeout for this item
    if (sidebarBadgeTimeouts.current[item]) {
      clearTimeout(sidebarBadgeTimeouts.current[item]);
    }
    // Show the badge
    setSidebarBadges(prev => ({ ...prev, [item]: count }));
    // Clear after animation completes (2s)
    sidebarBadgeTimeouts.current[item] = setTimeout(() => {
      setSidebarBadges(prev => ({ ...prev, [item]: null }));
    }, 2000);
  }, []);

  // Close collection sort dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setCollectionSortDropdownOpen(false);
    if (collectionSortDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [collectionSortDropdownOpen]);

  // Close playlists sort dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setPlaylistsSortDropdownOpen(false);
    if (playlistsSortDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [playlistsSortDropdownOpen]);

  // Close charts sort dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setChartsSortDropdownOpen(false);
    if (chartsSortDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [chartsSortDropdownOpen]);

  // Close critics sort dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setCriticsSortDropdownOpen(false);
    if (criticsSortDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [criticsSortDropdownOpen]);

  // Close artist sort dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setArtistSortDropdownOpen(false);
    if (artistSortDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [artistSortDropdownOpen]);


  // Collection page scroll handler for header collapse
  const handleCollectionScroll = useCallback((e) => {
    const { scrollTop } = e.target;
    const shouldCollapse = scrollTop > 50;
    setCollectionHeaderCollapsed(prev => prev !== shouldCollapse ? shouldCollapse : prev);
  }, []);

  // Track if we're opening a release (to prevent header reset during artist change)
  const openingReleaseRef = useRef(false);

  // Playlists page scroll handler for header collapse
  const playlistsCollapseLockedRef = useRef(false);
  const handlePlaylistsScroll = useCallback((e) => {
    const scrollTop = e.target.scrollTop;

    // If locked (during transition), ignore scroll events
    if (playlistsCollapseLockedRef.current) return;

    // Only collapse when scrolled down past threshold
    if (scrollTop > 50 && !playlistsHeaderCollapsed) {
      playlistsCollapseLockedRef.current = true;
      setPlaylistsHeaderCollapsed(true);
      // Unlock after transition completes
      setTimeout(() => { playlistsCollapseLockedRef.current = false; }, 350);
    }
    // Only expand when scrolled to very top
    else if (scrollTop === 0 && playlistsHeaderCollapsed) {
      playlistsCollapseLockedRef.current = true;
      setPlaylistsHeaderCollapsed(false);
      setTimeout(() => { playlistsCollapseLockedRef.current = false; }, 350);
    }
  }, [playlistsHeaderCollapsed]);

  // Charts page scroll handler for header collapse
  const handleChartsScroll = useCallback((e) => {
    const scrollTop = e.target.scrollTop;
    setChartsHeaderCollapsed(prev => {
      if (!prev && scrollTop > 50) return true;
      if (prev && scrollTop === 0) return false;
      return prev;
    });
  }, []);

  // Critics page scroll handler for header collapse
  const handleCriticsScroll = useCallback((e) => {
    const scrollTop = e.target.scrollTop;
    setCriticsHeaderCollapsed(prev => {
      if (!prev && scrollTop > 50) return true;
      if (prev && scrollTop === 0) return false;
      return prev;
    });
  }, []);

  // Reset collection header collapse when leaving library view
  useEffect(() => {
    if (activeView !== 'library') {
      setCollectionHeaderCollapsed(false);
      setCollectionSearchOpen(false);
      setCollectionSearch('');
    }
  }, [activeView]);

  // Reset playlists header collapse when leaving playlists view
  useEffect(() => {
    if (activeView !== 'playlists') {
      setPlaylistsHeaderCollapsed(false);
      setPlaylistsSearchOpen(false);
      setPlaylistsSearch('');
    }
  }, [activeView]);

  // Reset charts header collapse when leaving charts view
  useEffect(() => {
    if (activeView !== 'discover') {
      setChartsHeaderCollapsed(false);
      setChartsSearchOpen(false);
      setChartsSearch('');
    }
  }, [activeView]);

  // Reset critics header collapse when leaving critics view
  useEffect(() => {
    if (activeView !== 'critics-picks') {
      setCriticsHeaderCollapsed(false);
      setCriticsSearchOpen(false);
      setCriticsSearch('');
    }
  }, [activeView]);

  // Reset artist page filter bar when leaving artist view
  useEffect(() => {
    if (activeView !== 'artist') {
      setArtistSearchOpen(false);
      setArtistSearch('');
      setArtistSortDropdownOpen(false);
    }
  }, [activeView]);

  // Filter collection items by search query
  const filterCollectionItems = useCallback((items, type) => {
    if (!collectionSearch.trim()) return items;
    const query = collectionSearch.toLowerCase();

    if (type === 'artists') {
      return items.filter(a => a.name.toLowerCase().includes(query));
    }
    if (type === 'albums') {
      return items.filter(a =>
        a.title.toLowerCase().includes(query) ||
        a.artist.toLowerCase().includes(query)
      );
    }
    if (type === 'tracks') {
      return items.filter(t =>
        (t.title || '').toLowerCase().includes(query) ||
        (t.artist || '').toLowerCase().includes(query) ||
        (t.album || '').toLowerCase().includes(query)
      );
    }
    return items;
  }, [collectionSearch]);

  // Sort collection items
  const sortCollectionItems = useCallback((items, type) => {
    const sortKey = collectionSort[type];
    const sorted = [...items];

    if (type === 'artists') {
      switch (sortKey) {
        case 'alpha-asc': return sorted.sort((a, b) => a.name.localeCompare(b.name));
        case 'alpha-desc': return sorted.sort((a, b) => b.name.localeCompare(a.name));
        case 'tracks': return sorted.sort((a, b) => b.trackCount - a.trackCount);
        case 'recent': return sorted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        default: return sorted;
      }
    }
    if (type === 'albums') {
      switch (sortKey) {
        case 'alpha-asc': return sorted.sort((a, b) => a.title.localeCompare(b.title));
        case 'alpha-desc': return sorted.sort((a, b) => b.title.localeCompare(a.title));
        case 'artist': return sorted.sort((a, b) => a.artist.localeCompare(b.artist));
        case 'year-new': return sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
        case 'year-old': return sorted.sort((a, b) => (a.year || 9999) - (b.year || 9999));
        case 'recent': return sorted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        default: return sorted;
      }
    }
    if (type === 'tracks') {
      switch (sortKey) {
        case 'title-asc': return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        case 'title-desc': return sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        case 'artist': return sorted.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
        case 'album': return sorted.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
        case 'duration': return sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
        case 'recent': return sorted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        default: return sorted;
      }
    }
    return sorted;
  }, [collectionSort]);

  // Get sort options for current tab
  const getCollectionSortOptions = (tab) => {
    if (tab === 'artists') {
      return [
        { value: 'alpha-asc', label: 'A-Z' },
        { value: 'alpha-desc', label: 'Z-A' },
        { value: 'tracks', label: 'Most Tracks' },
        { value: 'recent', label: 'Recently Added' }
      ];
    }
    if (tab === 'albums') {
      return [
        { value: 'alpha-asc', label: 'A-Z' },
        { value: 'alpha-desc', label: 'Z-A' },
        { value: 'artist', label: 'Artist Name' },
        { value: 'year-new', label: 'Year (Newest)' },
        { value: 'year-old', label: 'Year (Oldest)' },
        { value: 'recent', label: 'Recently Added' }
      ];
    }
    return [
      { value: 'title-asc', label: 'Title A-Z' },
      { value: 'title-desc', label: 'Title Z-A' },
      { value: 'artist', label: 'Artist Name' },
      { value: 'album', label: 'Album Name' },
      { value: 'duration', label: 'Duration' },
      { value: 'recent', label: 'Recently Added' }
    ];
  };

  // Filter and sort playlists
  const filterPlaylists = useCallback((items) => {
    if (!playlistsSearch.trim()) return items;
    const query = playlistsSearch.toLowerCase();
    return items.filter(p => p.title.toLowerCase().includes(query));
  }, [playlistsSearch]);

  const sortPlaylists = useCallback((items) => {
    const sorted = [...items];
    switch (playlistsSort) {
      case 'alpha-asc': return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'alpha-desc': return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'tracks': return sorted.sort((a, b) => (b.tracks?.length || 0) - (a.tracks?.length || 0));
      case 'recent': return sorted; // Keep original order
      default: return sorted;
    }
  }, [playlistsSort]);

  const playlistsSortOptions = [
    { value: 'recent', label: 'Recently Added' },
    { value: 'alpha-asc', label: 'A-Z' },
    { value: 'alpha-desc', label: 'Z-A' },
    { value: 'tracks', label: 'Most Tracks' }
  ];

  // Filter artist releases by search query
  const filterArtistReleases = useCallback((releases) => {
    if (!artistSearch.trim()) return releases;
    const query = artistSearch.toLowerCase();
    return releases.filter(r => r.title.toLowerCase().includes(query));
  }, [artistSearch]);

  // Sort artist releases
  const sortArtistReleases = useCallback((releases) => {
    const sorted = [...releases];
    switch (artistSort) {
      case 'date-desc': return sorted.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      case 'date-asc': return sorted.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      case 'alpha-asc': return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'alpha-desc': return sorted.sort((a, b) => b.title.localeCompare(a.title));
      default: return sorted;
    }
  }, [artistSort]);

  const artistSortOptions = [
    { value: 'date-desc', label: 'Newest First' },
    { value: 'date-asc', label: 'Oldest First' },
    { value: 'alpha-asc', label: 'A-Z' },
    { value: 'alpha-desc', label: 'Z-A' }
  ];

  // Set smart default release type filter based on available releases
  const setSmartReleaseTypeFilter = useCallback((releases) => {
    const hasAlbums = releases.some(r => r.releaseType === 'album');
    const hasEPs = releases.some(r => r.releaseType === 'ep');
    const hasSingles = releases.some(r => r.releaseType === 'single');

    if (hasAlbums) {
      setReleaseTypeFilter('album');
    } else if (hasEPs) {
      setReleaseTypeFilter('ep');
    } else if (hasSingles) {
      setReleaseTypeFilter('single');
    } else {
      // Fallback to first available type
      const firstType = releases[0]?.releaseType;
      if (firstType) setReleaseTypeFilter(firstType);
    }
  }, []);

  // Filter and sort charts
  const filterCharts = useCallback((items) => {
    if (!chartsSearch.trim()) return items;
    const query = chartsSearch.toLowerCase();
    return items.filter(c =>
      c.title.toLowerCase().includes(query) ||
      c.artist.toLowerCase().includes(query)
    );
  }, [chartsSearch]);

  const sortCharts = useCallback((items) => {
    const sorted = [...items];
    switch (chartsSort) {
      case 'rank': return sorted.sort((a, b) => (a.rank || 999) - (b.rank || 999));
      case 'alpha-asc': return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'alpha-desc': return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'artist': return sorted.sort((a, b) => a.artist.localeCompare(b.artist));
      default: return sorted;
    }
  }, [chartsSort]);

  const chartsSortOptions = [
    { value: 'rank', label: 'Chart Rank' },
    { value: 'alpha-asc', label: 'A-Z' },
    { value: 'alpha-desc', label: 'Z-A' },
    { value: 'artist', label: 'Artist Name' }
  ];

  // Filter and sort critics picks
  const filterCriticsPicks = useCallback((items) => {
    if (!criticsSearch.trim()) return items;
    const query = criticsSearch.toLowerCase();
    return items.filter(c =>
      c.title.toLowerCase().includes(query) ||
      c.artist.toLowerCase().includes(query)
    );
  }, [criticsSearch]);

  const sortCriticsPicks = useCallback((items) => {
    const sorted = [...items];
    switch (criticsSort) {
      case 'recent': return sorted; // Keep original order (date added)
      case 'score-desc': return sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
      case 'artist': return sorted.sort((a, b) => a.artist.localeCompare(b.artist));
      default: return sorted;
    }
  }, [criticsSort]);

  const criticsSortOptions = [
    { value: 'recent', label: 'Date Added' },
    { value: 'score-desc', label: 'Score' },
    { value: 'artist', label: 'Artist Name' }
  ];

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, file: '' });

  // ID3 Tag Editor state
  const [id3EditorOpen, setId3EditorOpen] = useState(false);
  const [id3EditorTrack, setId3EditorTrack] = useState(null);
  const [id3EditorValues, setId3EditorValues] = useState({
    title: '',
    artist: '',
    album: '',
    trackNumber: '',
    year: ''
  });
  const [id3EditorSaving, setId3EditorSaving] = useState(false);
  const [id3ArtSuggestions, setId3ArtSuggestions] = useState([]);
  const [id3ArtLoading, setId3ArtLoading] = useState(false);
  const [id3SelectedArt, setId3SelectedArt] = useState(null);
  const [id3ArtFetchKey, setId3ArtFetchKey] = useState(''); // Track last fetch to avoid duplicates

  // Add to Playlist panel state
  const [addToPlaylistPanel, setAddToPlaylistPanel] = useState({
    open: false,
    tracks: [], // Tracks to add
    sourceName: '', // Name of source (track title, album name, or playlist name)
    sourceType: '' // 'track', 'album', 'playlist'
  });
  const [selectedPlaylistsForAdd, setSelectedPlaylistsForAdd] = useState([]); // Selected playlist IDs for multi-select
  const [newPlaylistFormOpen, setNewPlaylistFormOpen] = useState(false); // Accordion state for new playlist form
  const [newPlaylistName, setNewPlaylistName] = useState(''); // Input value for new playlist name
  const [draggingTrackForPlaylist, setDraggingTrackForPlaylist] = useState(null); // Track being dragged that could be dropped on playlist
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }
  const [collectionData, setCollectionData] = useState({ tracks: [], albums: [], artists: [] });
  const [collectionLoading, setCollectionLoading] = useState(true);
  const [collectionDropHighlight, setCollectionDropHighlight] = useState(false);
  const [dropTargetPlaylistId, setDropTargetPlaylistId] = useState(null); // Playlist being hovered during drag
  const [dropTargetNewPlaylist, setDropTargetNewPlaylist] = useState(false); // Hovering over "+ NEW" button during drag
  const [droppedTrackForNewPlaylist, setDroppedTrackForNewPlaylist] = useState(null); // Track dropped on "+ NEW" to be added after creating playlist

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    show: false,
    type: 'success', // 'success' | 'error' | 'info'
    title: '',
    message: '',
    onConfirm: null
  });

  // Helper to show styled confirmation dialogs
  const showConfirmDialog = (options) => {
    setConfirmDialog({
      show: true,
      type: options.type || 'info',
      title: options.title || '',
      message: options.message || '',
      onConfirm: options.onConfirm || null
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog(prev => ({ ...prev, show: false }));
  };
  const [refreshingPlaylist, setRefreshingPlaylist] = useState(null); // Track which playlist is refreshing

  // Drag & drop URL state
  const [isDraggingUrl, setIsDraggingUrl] = useState(false);
  const [dropZoneTarget, setDropZoneTarget] = useState(null); // 'now-playing' | 'queue' | null
  const queueAnimationRef = useRef(null);
  const [queueAnimating, setQueueAnimating] = useState(false);
  const queueContentRef = useRef(null); // Ref for queue content scrolling
  const resolverLoaderRef = useRef(null);

  // Browser extension state
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [browserPlaybackActive, setBrowserPlaybackActive] = useState(false);
  const [activeExtensionTabId, setActiveExtensionTabId] = useState(null);
  const pendingCloseTabIdRef = useRef(null);
  const streamingPlaybackActiveRef = useRef(false); // Track when playing via Spotify/streaming to ignore browser events

  // Refs to keep current values available in event handlers (avoids stale closure issues)
  const currentQueueRef = useRef([]);
  const currentTrackRef = useRef(null);
  const handleNextRef = useRef(null);
  const artistPageScrollRef = useRef(null); // Ref for artist page scroll container
  const audioRef = useRef(null); // HTML5 Audio element for local file playback
  const localFilePlaybackTrackRef = useRef(null); // Track being played for fallback handling
  const localFileFallbackInProgressRef = useRef(false); // Prevent duplicate error dialogs during fallback
  const queueResolutionActiveRef = useRef(false); // When true, queue resolution takes priority over page resolution
  const pageResolutionAbortRef = useRef(null); // AbortController for cancelling page resolution
  const [selectedResolver, setSelectedResolver] = useState(null); // Resolver detail modal

  // Keep refs in sync with state
  useEffect(() => { currentQueueRef.current = currentQueue; }, [currentQueue]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { spotifyTokenRef.current = spotifyToken; }, [spotifyToken]);

  // Scroll queue to bottom when opened (so track 1 is visible at the bottom)
  useEffect(() => {
    if (queueDrawerOpen && queueContentRef.current) {
      // Small delay to ensure the drawer has animated open
      setTimeout(() => {
        if (queueContentRef.current) {
          queueContentRef.current.scrollTop = queueContentRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [queueDrawerOpen]);

  // Artist page scroll handler for header collapse
  const artistCollapseLockedRef = useRef(false);
  const handleArtistPageScroll = useCallback((e) => {
    const scrollTop = e.target.scrollTop;

    // If locked (during transition), ignore scroll events
    if (artistCollapseLockedRef.current) return;

    // Only collapse when scrolled down past threshold
    if (scrollTop > 50 && !isHeaderCollapsed) {
      artistCollapseLockedRef.current = true;
      setIsHeaderCollapsed(true);
      // Unlock after transition completes
      setTimeout(() => { artistCollapseLockedRef.current = false; }, 350);
    }
    // Only expand when scrolled to very top
    else if (scrollTop === 0 && isHeaderCollapsed) {
      artistCollapseLockedRef.current = true;
      setIsHeaderCollapsed(false);
      setTimeout(() => { artistCollapseLockedRef.current = false; }, 350);
    }
  }, [isHeaderCollapsed]);

  // Search detail page scroll handler for header collapse and infinite scroll
  const handleSearchDetailScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    // Header collapse
    setSearchHeaderCollapsed(scrollTop > 100);
    // Infinite scroll - load more when within 200px of bottom
    if (scrollHeight - scrollTop - clientHeight < 200 && searchDetailCategory) {
      handleLoadMore(searchDetailCategory);
    }
  }, [searchDetailCategory]);

  // Reset search header collapse when leaving detail view
  useEffect(() => {
    if (!searchDetailCategory) {
      setSearchHeaderCollapsed(false);
    }
  }, [searchDetailCategory]);

  // Reset header collapse and tab when navigating to a new artist (but not when opening a release)
  useEffect(() => {
    // Don't reset header if we're opening a release - it should stay collapsed
    if (openingReleaseRef.current) {
      openingReleaseRef.current = false;
    } else {
      setIsHeaderCollapsed(false);
    }
    setArtistPageTab('music');
    setArtistBio(null);
    setRelatedArtists([]);
  }, [currentArtist]);

  // Load local files data when resolver modal is opened
  useEffect(() => {
    if (selectedResolver?.id === 'localfiles' && window.electron?.localFiles) {
      window.electron.localFiles.getStats().then(setLocalFilesStats);
      window.electron.localFiles.getWatchFolders().then(setWatchFolders);
    }
  }, [selectedResolver]);

  // Listen for local files scan progress and library changes
  useEffect(() => {
    if (window.electron?.localFiles?.onScanProgress) {
      window.electron.localFiles.onScanProgress((data) => {
        setScanProgress(data);
      });
    }
    if (window.electron?.localFiles?.onLibraryChanged) {
      window.electron.localFiles.onLibraryChanged((changes) => {
        // Refresh stats when library changes
        if (window.electron?.localFiles) {
          window.electron.localFiles.getStats().then(setLocalFilesStats);
          window.electron.localFiles.getWatchFolders().then(setWatchFolders);
        }
      });
    }
  }, []);

  // URL drag & drop helpers
  const isValidUrl = (string) => {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:' || string.startsWith('spotify:');
    } catch {
      return false;
    }
  };

  const extractUrlFromDrop = (dataTransfer) => {
    // Try text/uri-list first (standard for URL drops)
    let url = dataTransfer.getData('text/uri-list');
    if (url && isValidUrl(url.split('\n')[0])) {
      return url.split('\n')[0].trim();
    }

    // Fallback to text/plain
    url = dataTransfer.getData('text/plain');
    if (url && isValidUrl(url.trim())) {
      return url.trim();
    }

    return null;
  };

  const getUrlDomain = (url) => {
    try {
      if (url.startsWith('spotify:')) return 'spotify.com';
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  };

  // Handle URL drop - main entry point
  const handleUrlDrop = async (url, zone) => {
    console.log(`🔗 URL dropped on ${zone}:`, url);

    // Find resolver for this URL
    const resolverId = resolverLoaderRef.current?.findResolverForUrl(url);
    if (!resolverId) {
      console.error('❌ No resolver found for URL:', url);
      return;
    }

    console.log(`📎 Matched resolver: ${resolverId}`);

    // Create placeholder track
    const placeholderId = `pending-${Date.now()}`;
    const placeholder = {
      id: placeholderId,
      status: 'loading',
      sourceUrl: url,
      sourceDomain: getUrlDomain(url),
      title: null,
      artist: null,
      album: null,
      duration: null,
      albumArt: null,
      sources: {},
      errorMessage: null
    };

    // Determine where to insert
    const hasQueue = currentQueue.length > 0;
    const shouldPlayImmediately = zone === 'now-playing' || !hasQueue;

    if (shouldPlayImmediately) {
      // Set as current track (loading state)
      setCurrentTrack(placeholder);
    } else {
      // Insert at position 1 (next up)
      setCurrentQueue(prev => {
        const newQueue = [...prev];
        newQueue.splice(1, 0, placeholder);
        return newQueue;
      });
      // Trigger queue icon animation
      triggerQueueAnimation();
    }

    // Look up track metadata
    try {
      // Pass resolver config so Spotify has access to token
      const config = await getResolverConfig(resolverId);
      const result = await resolverLoaderRef.current.lookupUrl(url, config);

      if (!result || !result.track) {
        throw new Error('Could not load track metadata');
      }

      const { track: trackMeta } = result;
      console.log(`✅ URL lookup success:`, trackMeta.title, '-', trackMeta.artist);

      // Create proper track object
      const trackId = `${trackMeta.artist}-${trackMeta.title}-${trackMeta.album || 'Single'}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const resolvedTrack = {
        id: trackId,
        status: 'ready',
        title: trackMeta.title,
        artist: trackMeta.artist,
        album: trackMeta.album || 'Single',
        duration: trackMeta.duration || 180,
        albumArt: trackMeta.albumArt,
        sourceUrl: url,
        sources: {}
      };

      // Now resolve across all enabled resolvers for playable sources
      console.log(`🔍 Resolving playable sources...`);
      const enabledResolvers = resolverOrder
        .filter(id => activeResolvers.includes(id))
        .map(id => allResolvers.find(r => r.id === id))
        .filter(r => r && r.capabilities.resolve);

      const resolvePromises = enabledResolvers.map(async (resolver) => {
        try {
          const config = await getResolverConfig(resolver.id);
          const result = await resolver.resolve(trackMeta.artist, trackMeta.title, trackMeta.album, config);
          if (result) {
            resolvedTrack.sources[resolver.id] = {
              ...result,
              confidence: 0.9
            };
            console.log(`  ✅ ${resolver.name}: Found match`);
          }
        } catch (error) {
          console.error(`  ❌ ${resolver.name} resolve error:`, error);
        }
      });

      await Promise.all(resolvePromises);

      // Update the placeholder with resolved data
      if (shouldPlayImmediately) {
        setCurrentTrack(prev => {
          if (prev?.id === placeholderId) {
            return resolvedTrack;
          }
          return prev;
        });
        // Actually play it
        handlePlay(resolvedTrack);
      } else {
        setCurrentQueue(prev => prev.map(t =>
          t.id === placeholderId ? resolvedTrack : t
        ));
      }

    } catch (error) {
      console.error('❌ URL lookup failed:', error);

      // Update placeholder to error state
      const errorTrack = {
        ...placeholder,
        status: 'error',
        errorMessage: error.message || 'Could not load track'
      };

      if (shouldPlayImmediately) {
        setCurrentTrack(prev => {
          if (prev?.id === placeholderId) {
            return errorTrack;
          }
          return prev;
        });
      } else {
        setCurrentQueue(prev => prev.map(t =>
          t.id === placeholderId ? errorTrack : t
        ));
      }
    }
  };

  // Queue animation trigger
  const triggerQueueAnimation = () => {
    setQueueAnimating(true);
    if (queueAnimationRef.current) {
      clearTimeout(queueAnimationRef.current);
    }
    queueAnimationRef.current = setTimeout(() => {
      setQueueAnimating(false);
    }, 300);
  };

  // Drag event handlers for URL drops
  const handleDragEnter = (e, zone) => {
    e.preventDefault();
    e.stopPropagation();

    const url = extractUrlFromDrop(e.dataTransfer);
    if (!url) return;

    // Check if any resolver can handle this URL
    const resolverId = resolverLoaderRef.current?.findResolverForUrl(url);
    if (resolverId) {
      setIsDraggingUrl(true);
      setDropZoneTarget(zone);
    }
  };

  const handleDragOver = (e, zone) => {
    e.preventDefault();
    e.stopPropagation();

    // Update target if moving between zones
    if (isDraggingUrl && dropZoneTarget !== zone) {
      setDropZoneTarget(zone);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Only clear if leaving the app entirely
    const relatedTarget = e.relatedTarget;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDraggingUrl(false);
      setDropZoneTarget(null);
    }
  };

  const handleDrop = (e, zone) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDraggingUrl(false);
    setDropZoneTarget(null);

    const url = extractUrlFromDrop(e.dataTransfer);
    if (!url) {
      console.log('No valid URL in drop');
      return;
    }

    handleUrlDrop(url, zone);
  };

  // Drop zone overlay component
  const DropZoneOverlay = ({ zone, isActive }) => {
    if (!isActive) return null;

    const isNowPlaying = zone === 'now-playing';
    const icon = isNowPlaying ? '▶' : '📋';
    const text = isNowPlaying ? 'Drop to Play Now' : 'Drop to Play Next';

    return React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        borderRadius: '8px',
        border: '2px dashed rgba(147, 51, 234, 0.5)',
        pointerEvents: 'none'
      }
    },
      React.createElement('div', {
        style: {
          fontSize: '48px',
          marginBottom: '16px'
        }
      }, icon),
      React.createElement('div', {
        style: {
          fontSize: '18px',
          fontWeight: '600',
          color: '#a855f7'
        }
      }, text)
    );
  };

  // Resolver plugin system
  const resolverLoader = useRef(null);
  const [loadedResolvers, setLoadedResolvers] = useState([]);
  const loadedResolversRef = useRef([]);

  // Cleanup polling interval, external track timeout, and stop playback on unmount
  useEffect(() => {
    // Also handle beforeunload for when window closes
    const handleBeforeUnload = () => {
      if (spotifyTokenRef.current) {
        // Use sendBeacon for reliable delivery during page unload
        const url = 'https://api.spotify.com/v1/me/player/pause';
        // sendBeacon doesn't support PUT, so fall back to fetch with keepalive
        fetch(url, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyTokenRef.current}` },
          keepalive: true
        }).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (playbackPollerRef.current) {
        clearInterval(playbackPollerRef.current);
        playbackPollerRef.current = null;
      }
      if (pollingRecoveryRef.current) {
        clearInterval(pollingRecoveryRef.current);
        pollingRecoveryRef.current = null;
      }
      if (externalTrackTimeoutRef.current) {
        clearTimeout(externalTrackTimeoutRef.current);
        externalTrackTimeoutRef.current = null;
      }
      // Stop Spotify playback on app shutdown
      if (spotifyTokenRef.current) {
        fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyTokenRef.current}` },
          keepalive: true
        }).catch(() => {}); // Ignore errors on shutdown
      }
    };
  }, []);

  // Helper to determine resolver ID from track properties
  const determineResolverIdFromTrack = (track) => {
    if (track.spotifyUri || track.spotifyId) return 'spotify';
    if (track.bandcampUrl) return 'bandcamp';
    if (track.youtubeUrl || track.youtubeId) return 'youtube';
    if (track.qobuzId) return 'qobuz';
    return null;
  };

  // Cache for album art URLs (releaseId -> { url, timestamp })
  const albumArtCache = useRef({});
  const [cacheLoaded, setCacheLoaded] = useState(false); // Track when persistent cache is loaded

  // Cache for artist data (artistName -> { data, timestamp })
  const artistDataCache = useRef({});

  // Cache for track sources (trackKey -> { sources, timestamp })
  // trackKey format: "artist|title|album"
  const trackSourcesCache = useRef({});

  // Cache for artist images from Last.fm (artistName -> { url, timestamp })
  const artistImageCache = useRef({});

  // Cache for playlist cover art (playlistId -> { covers: [url1, url2, url3, url4], timestamp })
  const playlistCoverCache = useRef({});

  // API keys loaded from environment via IPC
  const lastfmApiKey = useRef(null);

  // Cache TTLs (in milliseconds)
  const CACHE_TTL = {
    albumArt: 90 * 24 * 60 * 60 * 1000,    // 90 days
    artistData: 30 * 24 * 60 * 60 * 1000,  // 30 days
    trackSources: 7 * 24 * 60 * 60 * 1000, // 7 days (track availability changes)
    artistImage: 90 * 24 * 60 * 60 * 1000, // 90 days
    playlistCover: 30 * 24 * 60 * 60 * 1000 // 30 days
  };

  // Generate a hash of current resolver settings for cache invalidation
  const getResolverSettingsHash = () => {
    const sortedActive = [...activeResolvers].sort().join(',');
    const sortedOrder = [...resolverOrder].join(',');
    return `${sortedActive}|${sortedOrder}`;
  };

  const sampleTracks = [
    { id: 1, title: 'Midnight Dreams', artist: 'Luna Echo', album: 'Nocturnal', duration: 245, sources: ['youtube', 'soundcloud'] },
    { id: 2, title: 'Electric Pulse', artist: 'Neon Waves', album: 'Synthwave', duration: 198, sources: ['youtube'] },
    { id: 3, title: 'Ocean Breeze', artist: 'Coastal Drift', album: 'Tides', duration: 267, sources: ['soundcloud', 'youtube'] },
    { id: 4, title: 'Urban Nights', artist: 'City Lights', album: 'Metropolitan', duration: 223, sources: ['youtube'] },
    { id: 5, title: 'Forest Path', artist: 'Nature Sound', album: 'Wilderness', duration: 301, sources: ['youtube', 'soundcloud'] },
  ];

  // Initialize resolver plugin system and load config
  useEffect(() => {
    const initResolvers = async () => {
      console.log('🔌 Initializing resolver plugin system...');

      // Load API keys from environment via IPC
      if (window.electron?.config?.get) {
        try {
          const lfmKey = await window.electron.config.get('LASTFM_API_KEY');
          if (lfmKey) {
            lastfmApiKey.current = lfmKey;
            console.log('🔑 Last.fm API key loaded from environment');
          } else {
            console.warn('⚠️ LASTFM_API_KEY not found in .env file');
          }
        } catch (error) {
          console.error('❌ Failed to load API keys from config:', error);
        }
      }

      // Check if ResolverLoader is available
      if (typeof ResolverLoader === 'undefined') {
        console.error('❌ ResolverLoader not found! Make sure resolver-loader.js is loaded.');
        return;
      }
      
      // Create resolver loader
      resolverLoader.current = new ResolverLoader();
      
      try {
        // Try to load built-in resolvers from resolvers/builtin/ directory
        console.log('📁 Loading resolver .axe files from resolvers/builtin/...');
        const builtinAxeFiles = await loadBuiltinResolvers();
        
        let resolversToLoad = builtinAxeFiles;
        
        if (builtinAxeFiles.length === 0) {
          console.warn('⚠️  No .axe files found in resolvers/builtin/');
          console.log('💾 Using embedded fallback resolvers');
          resolversToLoad = FALLBACK_RESOLVERS;
        } else {
          console.log(`✅ Loaded ${builtinAxeFiles.length} .axe files from disk`);
        }
        
        const resolvers = await resolverLoader.current.loadResolvers(resolversToLoad);
        setLoadedResolvers(resolvers);
        resolverLoaderRef.current = resolverLoader.current;
        console.log(`✅ Loaded ${resolvers.length} resolver plugins:`, resolvers.map(r => r.name).join(', '));
      } catch (error) {
        console.error('❌ Failed to load resolvers:', error);
        console.log('💾 Attempting to use fallback resolvers...');
        
        try {
          const resolvers = await resolverLoader.current.loadResolvers(FALLBACK_RESOLVERS);
          setLoadedResolvers(resolvers);
          resolverLoaderRef.current = resolverLoader.current;
          console.log(`✅ Loaded ${resolvers.length} fallback resolvers`);
        } catch (fallbackError) {
          console.error('❌ Even fallback resolvers failed:', fallbackError);
        }
      }
    };
    
    initResolvers();
  }, []);

  // Keep ref updated with latest resolver list
  useEffect(() => {
    loadedResolversRef.current = loadedResolvers;
  }, [loadedResolvers]);

  // Auto-add newly loaded resolvers to activeResolvers and resolverOrder
  // This runs when both resolvers are loaded AND settings are loaded from storage
  useEffect(() => {
    if (loadedResolvers.length === 0) return;
    if (!cacheLoaded) return; // Wait for settings to load first

    // Find resolvers that are loaded but not in resolverOrder
    const newResolverIds = loadedResolvers
      .map(r => r.id)
      .filter(id => !resolverOrder.includes(id));

    if (newResolverIds.length > 0) {
      console.log(`📋 Adding new resolvers to order/active: ${newResolverIds.join(', ')}`);
      setResolverOrder(prev => [...prev, ...newResolverIds]);
      setActiveResolvers(prev => [...prev, ...newResolverIds]);
    }
  }, [loadedResolvers, cacheLoaded, resolverOrder]);

  // Browser extension event handlers
  useEffect(() => {
    console.log('🔌 Setting up browser extension event handlers...');

    // Connection state handlers
    window.electron.extension.onConnected(() => {
      console.log('✅ Browser extension connected');
      setExtensionConnected(true);
    });

    window.electron.extension.onDisconnected(() => {
      console.log('❌ Browser extension disconnected');
      setExtensionConnected(false);
      setBrowserPlaybackActive(false);
      setActiveExtensionTabId(null);
    });

    // Message handler for extension events
    window.electron.extension.onMessage((message) => {
      if (message.type === 'event') {
        switch (message.event) {
          case 'connected':
            // Browser tab with media content connected
            console.log(`🎬 Browser playback connected: ${message.site}`);
            setActiveExtensionTabId(message.tabId);
            setBrowserPlaybackActive(true);
            setIsExternalPlayback(true);

            // Close previous tab if one was pending
            if (pendingCloseTabIdRef.current && pendingCloseTabIdRef.current !== message.tabId) {
              window.electron.extension.sendCommand({
                type: 'command',
                action: 'closeTab',
                tabId: pendingCloseTabIdRef.current
              });
              pendingCloseTabIdRef.current = null;
            }
            break;

          case 'playing':
            // Ignore browser events when streaming playback (Spotify) is active
            if (streamingPlaybackActiveRef.current) {
              console.log('▶️ Browser playback playing (ignored - streaming active)');
              break;
            }
            console.log('▶️ Browser playback playing');
            setIsPlaying(true);
            // Also ensure browser playback state is set (handles race condition where playing arrives before connected)
            setBrowserPlaybackActive(true);
            setIsExternalPlayback(true);
            break;

          case 'paused':
            // Ignore browser events when streaming playback (Spotify) is active
            if (streamingPlaybackActiveRef.current) {
              console.log('⏸️ Browser playback paused (ignored - streaming active)');
              break;
            }
            console.log('⏸️ Browser playback paused');
            setIsPlaying(false);
            break;

          case 'ended':
            console.log('⏹️ Browser playback ended');
            // Store tab ID to close when next track connects
            pendingCloseTabIdRef.current = message.tabId;
            setBrowserPlaybackActive(false);
            // Auto-advance to next track (use ref to avoid stale closure)
            if (handleNextRef.current) handleNextRef.current();
            break;

          case 'tabClosed':
            setBrowserPlaybackActive(false);
            setActiveExtensionTabId(null);
            // Check if this was a programmatic close (switching tracks)
            if (pendingCloseTabIdRef.current && message.tabId === pendingCloseTabIdRef.current) {
              console.log('🔄 Browser tab closed programmatically (switching tracks)');
              pendingCloseTabIdRef.current = null;
              // Don't call handleNext() - we're already loading the selected track
            } else {
              console.log('🚪 Browser tab closed by user');
              // Treat as skip to next (use ref to avoid stale closure)
              if (handleNextRef.current) handleNextRef.current();
            }
            break;

          case 'heartbeat':
            // Keep-alive from extension - silently maintain active state
            // Ignore when streaming playback (Spotify) is active
            if (message.tabId && !streamingPlaybackActiveRef.current) {
              setActiveExtensionTabId(message.tabId);
              setBrowserPlaybackActive(true);
              setIsExternalPlayback(true);
            }
            break;
        }
      }
    });

    // Check initial connection status
    window.electron.extension.getStatus().then(status => {
      setExtensionConnected(status.connected);
    });

    // Playback window event handlers (for Bandcamp embedded player, etc.)
    if (window.electron?.playbackWindow?.onEvent) {
      window.electron.playbackWindow.onEvent((eventType) => {
        console.log(`🎵 Playback window event: ${eventType}`);
        switch (eventType) {
          case 'playing':
            setIsPlaying(true);
            setBrowserPlaybackActive(true);
            setIsExternalPlayback(true);
            break;
          case 'paused':
            setIsPlaying(false);
            break;
          case 'ended':
            console.log('🎵 Playback window track ended, advancing to next');
            setBrowserPlaybackActive(false);
            handleNext();
            break;
        }
      });
    }

    if (window.electron?.playbackWindow?.onClosed) {
      window.electron.playbackWindow.onClosed(() => {
        console.log('🎵 Playback window closed');
        setBrowserPlaybackActive(false);
        // Don't auto-advance, just stop playback
        setIsPlaying(false);
      });
    }
  }, []);

  // Listen for context menu actions (only set up once)
  useEffect(() => {
    if (window.electron?.resolvers?.onContextMenuAction) {
      window.electron.resolvers.onContextMenuAction(async (data) => {
        console.log('Context menu action received:', data);
        if (data.action === 'uninstall') {
          await handleUninstallResolver(data.resolverId);
        }
      });
    }
  }, []);

  // Use loaded resolvers or fallback to empty array
  const allResolvers = loadedResolvers.length > 0 ? loadedResolvers : [];

  // Sync loaded resolvers with resolverOrder - add any new resolvers not yet in the order
  // This runs after both resolvers are loaded AND cache/settings are loaded from storage
  useEffect(() => {
    if (loadedResolvers.length === 0) return;
    if (!cacheLoaded) return; // Wait until storage settings are loaded

    const loadedIds = loadedResolvers.map(r => r.id);
    const missingIds = loadedIds.filter(id => !resolverOrder.includes(id));

    if (missingIds.length > 0) {
      console.log('📦 Adding new resolvers to order:', missingIds);
      // Use functional update to ensure we don't add duplicates
      setResolverOrder(prev => {
        const newIds = missingIds.filter(id => !prev.includes(id));
        return newIds.length > 0 ? [...prev, ...newIds] : prev;
      });
      // Also enable new resolvers by default
      setActiveResolvers(prev => {
        const newIds = missingIds.filter(id => !prev.includes(id));
        return newIds.length > 0 ? [...prev, ...newIds] : prev;
      });
    }
  }, [loadedResolvers, cacheLoaded]);

  // Get resolvers in priority order
  const resolvers = resolverOrder
    .map(id => allResolvers.find(r => r.id === id))
    .filter(Boolean);

  // Helper function to get resolver config (async for Spotify to ensure fresh token)
  const getResolverConfig = async (resolverId) => {
    // For Spotify, always get a fresh token from the IPC handler
    // This ensures we use a valid token even if the React state is stale
    if (resolverId === 'spotify') {
      let token = spotifyToken;

      // Always check with the IPC handler which will refresh if needed
      if (window.electron?.spotify) {
        const tokenData = await window.electron.spotify.checkToken();
        if (tokenData && tokenData.token) {
          token = tokenData.token;
          // Update React state if token changed
          if (token !== spotifyToken) {
            console.log('🔄 Token was refreshed, updating state');
            setSpotifyToken(token);
          }
        } else {
          token = null;
        }
      }

      console.log('🔑 Spotify token status:', {
        hasToken: !!token,
        tokenLength: token?.length,
        tokenPreview: token ? token.substring(0, 20) + '...' : 'null'
      });

      return { token };
    }

    const configs = {
      qobuz: { appId: '285473059', volume: volume / 100 },
      bandcamp: {}
    };
    return configs[resolverId] || {};
  };

  const SPOTIFY_CLIENT_ID = 'c040c0ee133344b282e6342198bcbeea';

  useEffect(() => {
    // Load local files into library instead of placeholder tracks
    const loadLocalFilesLibrary = async () => {
      setLibraryLoading(true);
      try {
        if (window.electron?.localFiles?.search) {
          const localTracks = await window.electron.localFiles.search('');
          if (localTracks && localTracks.length > 0) {
            console.log(`📚 Loaded ${localTracks.length} local tracks into library`);
            setLibrary(localTracks);
            // Mark all tracks as resolving immediately so LO + skeletons show together
            const trackKeys = localTracks
              .filter(t => {
                const sources = t.sources || {};
                return !Object.keys(sources).some(id => id !== 'localfiles');
              })
              .map(t => t.filePath || t.id);
            if (trackKeys.length > 0) {
              setResolvingLibraryTracks(new Set(trackKeys));
            }
          } else {
            console.log('📚 No local files found - library is empty');
            setLibrary([]);
          }
        } else {
          console.log('📚 Local Files API not available');
          setLibrary([]);
        }
      } catch (error) {
        console.error('Failed to load local files library:', error);
        setLibrary([]);
      } finally {
        setLibraryLoading(false);
      }
    };

    loadLocalFilesLibrary();

    const context = new (window.AudioContext || window.webkitAudioContext)();
    setAudioContext(context);
    
    // Load playlists from files
    const loadPlaylistsFromFiles = async () => {
      try {
        const loadedPlaylists = await window.electron.playlists.load();
        console.log(`📋 Loaded ${loadedPlaylists.length} playlist(s) from files`);
        
        if (loadedPlaylists.length > 0) {
          // Parse each playlist to get title, creator, and tracks
          const parsedPlaylists = loadedPlaylists.map(playlist => {
            const parsed = parseXSPF(playlist.xspf);
            return {
              ...playlist,
              title: parsed?.title || playlist.id,
              creator: parsed?.creator || 'Unknown',
              tracks: parsed?.tracks || [],
              createdAt: parsed?.date || playlist.createdAt || null, // Use XSPF date if available
              lastModified: playlist.lastModified || null
            };
          });

          setPlaylists(parsedPlaylists);
        } else {
          console.log('📋 No playlists found - playlists/ folder is empty');
        }
      } catch (error) {
        console.error('Failed to load playlists:', error);
      }
    };
    
    loadPlaylistsFromFiles();

    // Listen for local files library changes
    let libraryChangeCleanup = null;
    if (window.electron?.localFiles?.onLibraryChanged) {
      libraryChangeCleanup = window.electron.localFiles.onLibraryChanged((changes) => {
        console.log('📚 Library changed, reloading...', changes);
        loadLocalFilesLibrary();
      });
    }

    return () => {
      context.close();
      if (libraryChangeCleanup) libraryChangeCleanup();
    };
  }, []);

  // Load collection data on startup
  useEffect(() => {
    const loadCollection = async () => {
      if (window.electron?.collection?.load) {
        try {
          const data = await window.electron.collection.load();
          setCollectionData(data);
        } catch (error) {
          console.error('Failed to load collection:', error);
        }
      }
      setCollectionLoading(false);
    };
    loadCollection();
  }, []);

  useEffect(() => {
    // Skip progress tracking for streaming tracks (Spotify) - they have their own polling
    // Skip for local files - they use HTML5 Audio with timeupdate event
    // Also skip if duration is 0 or missing to prevent infinite handleNext loop
    const isStreamingTrack = currentTrack?.sources?.spotify || currentTrack?.spotifyUri;
    const isLocalFile = currentTrack?.filePath || currentTrack?.sources?.localfiles;
    const hasValidDuration = currentTrack?.duration && currentTrack.duration > 0;

    if (isPlaying && audioContext && currentTrack && !isStreamingTrack && !isLocalFile && hasValidDuration) {
      const interval = setInterval(() => {
        const elapsed = (audioContext.currentTime - startTime);
        if (elapsed >= currentTrack.duration) {
          // Use ref to avoid stale closure in interval callback
          if (handleNextRef.current) handleNextRef.current();
        } else {
          setProgress(elapsed);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isPlaying, audioContext, currentTrack, startTime]);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  // Save collection to disk
  const saveCollection = useCallback(async (newData) => {
    if (window.electron?.collection?.save) {
      try {
        const result = await window.electron.collection.save(newData);
        if (!result?.success) {
          console.error('Collection save failed:', result?.error);
        }
      } catch (error) {
        console.error('Collection save error:', error);
      }
    }
  }, []);

  // Add track to collection
  const addTrackToCollection = useCallback((track) => {
    const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

    setCollectionData(prev => {
      // Check for duplicate
      if (prev.tracks.some(t => t.id === trackId)) {
        showToast(`${track.title} is already in your collection`);
        return prev;
      }

      const newTrack = {
        id: trackId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        albumArt: track.albumArt,
        sources: track.sources || {},
        addedAt: Date.now()
      };

      const newData = { ...prev, tracks: [...prev.tracks, newTrack] };
      // Save async (don't block state update)
      saveCollection(newData);
      showToast(`Added ${track.title} to Collection`);
      showSidebarBadge('collection');
      return newData;
    });
  }, [saveCollection, showToast, showSidebarBadge]);

  // Add album to collection
  const addAlbumToCollection = useCallback((album) => {
    const albumId = `${album.artist || 'unknown'}-${album.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

    setCollectionData(prev => {
      // Check for duplicate
      if (prev.albums.some(a => a.id === albumId)) {
        showToast(`${album.title} is already in your collection`);
        return prev;
      }

      const newAlbum = {
        id: albumId,
        title: album.title,
        artist: album.artist,
        year: album.year || null,
        art: album.art || album.albumArt || null,
        addedAt: Date.now()
      };

      const newData = { ...prev, albums: [...prev.albums, newAlbum] };
      // Save async (don't block state update)
      saveCollection(newData);
      showToast(`Added ${album.title} to Collection`);
      showSidebarBadge('collection');
      return newData;
    });
  }, [saveCollection, showToast, showSidebarBadge]);

  // Add artist to collection
  const addArtistToCollection = useCallback((artist) => {
    const artistId = (artist.name || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, '');

    setCollectionData(prev => {
      // Check for duplicate
      if (prev.artists.some(a => a.id === artistId)) {
        showToast(`${artist.name} is already in your collection`);
        return prev;
      }

      const newArtist = {
        id: artistId,
        name: artist.name,
        image: artist.image || null,
        addedAt: Date.now()
      };

      const newData = { ...prev, artists: [...prev.artists, newArtist] };
      // Save async (don't block state update)
      saveCollection(newData);
      showToast(`Added ${artist.name} to Collection`);
      showSidebarBadge('collection');
      return newData;
    });
  }, [saveCollection, showToast, showSidebarBadge]);

  // Listen for track/playlist context menu actions
  useEffect(() => {
    if (window.electron?.contextMenu?.onAction) {
      window.electron.contextMenu.onAction(async (data) => {
        console.log('Track context menu action received:', data);
        if (data.action === 'add-to-queue' && data.tracks) {
          addToQueue(data.tracks);
        } else if (data.action === 'add-to-playlist' && data.tracks) {
          // Open the Add to Playlist panel
          console.log(`📋 Add to Playlist: ${data.tracks.length} track(s) - "${data.sourceName}" (type: ${data.sourceType})`);
          if (data.tracks.length > 0) {
            console.log(`   First track: ${data.tracks[0]?.artist} - ${data.tracks[0]?.title}`);
          }
          setAddToPlaylistPanel({
            open: true,
            tracks: data.tracks,
            sourceName: data.sourceName || 'Selected tracks',
            sourceType: data.sourceType || 'track'
          });
          setSelectedPlaylistsForAdd([]); // Reset selection
        } else if (data.action === 'remove-from-playlist' && data.playlistId !== undefined) {
          // Remove track from playlist
          const trackIndex = data.trackIndex;
          console.log(`🗑️ Removing track at index ${trackIndex} from playlist ${data.playlistId}`);

          // Update playlistTracks state (the displayed tracks)
          setPlaylistTracks(prev => {
            const newTracks = [...prev];
            newTracks.splice(trackIndex, 1);
            return newTracks;
          });

          // Update the playlist in playlists state and save to disk
          setPlaylists(prev => {
            const updatedPlaylists = prev.map(p => {
              if (p.id === data.playlistId) {
                const newTracks = [...(p.tracks || [])];
                newTracks.splice(trackIndex, 1);
                const updatedPlaylist = {
                  ...p,
                  tracks: newTracks,
                  lastModified: Date.now()
                };
                // Save to disk (async, non-blocking)
                savePlaylistToDisk(updatedPlaylist);
                return updatedPlaylist;
              }
              return p;
            });
            return updatedPlaylists;
          });

          // Update selectedPlaylist if viewing this playlist
          if (selectedPlaylist?.id === data.playlistId) {
            setSelectedPlaylist(prev => ({
              ...prev,
              lastModified: Date.now()
            }));
          }
        } else if (data.action === 'delete-playlist' && data.playlistId) {
          // Show confirmation alert
          const confirmed = window.confirm(`Are you sure you want to delete "${data.name}"?`);
          if (confirmed) {
            const result = await window.electron.playlists.delete(data.playlistId);
            if (result.success) {
              // Remove from state
              setPlaylists(prev => prev.filter(p => p.id !== data.playlistId));
              // Clear cover cache for deleted playlist
              setAllPlaylistCovers(prev => {
                const updated = { ...prev };
                delete updated[data.playlistId];
                return updated;
              });
            } else {
              alert(`Failed to delete playlist: ${result.error}`);
            }
          }
        } else if (data.action === 'edit-id3-tags' && data.track) {
          // Open ID3 tag editor modal
          console.log('🏷️ Opening ID3 tag editor for:', data.track.title);
          setId3EditorTrack(data.track);
          // Filter out "Unknown Album" placeholder - treat as empty
          const albumValue = data.track.album === 'Unknown Album' ? '' : (data.track.album || '');
          const newValues = {
            title: data.track.title || '',
            artist: data.track.artist || '',
            album: albumValue,
            trackNumber: data.track.trackNumber ? String(data.track.trackNumber) : '',
            year: data.track.year ? String(data.track.year) : ''
          };
          setId3EditorValues(newValues);
          setId3ArtSuggestions([]);
          setId3SelectedArt(null);
          setId3EditorOpen(true);

          // Auto-fetch album art if we have artist and album
          if (newValues.artist && newValues.album) {
            fetchAlbumArtSuggestions(newValues.artist, newValues.album);
          }
        } else if (data.action === 'add-to-collection') {
          // Add to collection based on type
          if (data.type === 'track' && data.track) {
            addTrackToCollection(data.track);
          } else if (data.type === 'album' && data.album) {
            addAlbumToCollection(data.album);
          } else if (data.type === 'artist' && data.artist) {
            addArtistToCollection(data.artist);
          }
        }
      });
    }
  }, [addTrackToCollection, addAlbumToCollection, addArtistToCollection]);

  // Add multiple tracks to collection
  const addTracksToCollection = useCallback((tracks) => {
    let addedCount = 0;

    setCollectionData(prev => {
      const newTracks = [...prev.tracks];

      tracks.forEach(track => {
        const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

        if (!newTracks.some(t => t.id === trackId)) {
          newTracks.push({
            id: trackId,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            albumArt: track.albumArt,
            sources: track.sources || {},
            addedAt: Date.now()
          });
          addedCount++;
        }
      });

      if (addedCount === 0) {
        showToast('Tracks are already in your collection');
        return prev;
      }

      const newData = { ...prev, tracks: newTracks };
      // Save async (don't block state update)
      saveCollection(newData);
      showToast(`Added ${addedCount} track${addedCount !== 1 ? 's' : ''} to Collection`);
      return newData;
    });
  }, [saveCollection, showToast]);

  // Handle drop on collection sidebar
  const handleCollectionDrop = useCallback((e) => {
    e.preventDefault();
    setCollectionDropHighlight(false);

    try {
      const data = e.dataTransfer.getData('text/plain');
      if (!data) return;

      const parsed = JSON.parse(data);

      if (parsed.type === 'track') {
        addTrackToCollection(parsed.track);
      } else if (parsed.type === 'album') {
        addAlbumToCollection(parsed.album);
      } else if (parsed.type === 'artist') {
        addArtistToCollection(parsed.artist);
      } else if (parsed.type === 'tracks') {
        addTracksToCollection(parsed.tracks);
      }
    } catch (error) {
      console.error('Failed to parse drop data:', error);
    }
  }, [addTrackToCollection, addAlbumToCollection, addArtistToCollection, addTracksToCollection]);

  // Re-resolve tracks when resolver settings change (enabled/priority)
  useEffect(() => {
    // Skip on initial mount (when both are empty)
    if (activeResolvers.length === 0 && resolverOrder.length === 0) return;

    // Re-resolve release tracks if viewing an artist release
    if (currentRelease && currentRelease.tracks) {
      console.log('🔄 Resolver settings changed, re-resolving release tracks...');
      const artistName = currentArtist?.name || 'Unknown Artist';
      currentRelease.tracks.forEach(track => {
        // Force refresh to bypass cache
        resolveTrack(track, artistName, true);
      });
    }

    // Re-resolve playlist tracks if viewing a playlist
    if (selectedPlaylist && playlistTracks.length > 0) {
      console.log('🔄 Resolver settings changed, re-resolving playlist tracks...');

      // Re-resolve each playlist track with new resolver settings
      const reResolvePlaylistTracks = async () => {
        const updatedTracks = [];

        for (const track of playlistTracks) {
          const trackWithSources = { ...track, sources: {} };

          // Query enabled resolvers in priority order
          for (const resolverId of activeResolvers) {
            const resolver = allResolvers.find(r => r.id === resolverId);
            if (!resolver || !resolver.capabilities.resolve) continue;

            try {
              const config = await getResolverConfig(resolverId);
              const resolved = await resolver.resolve(track.artist, track.title, track.album, config);

              if (resolved) {
                trackWithSources.sources[resolverId] = resolved;
              }
            } catch (error) {
              console.error(`Error resolving with ${resolver.name}:`, error);
            }
          }

          updatedTracks.push(trackWithSources);
        }

        setPlaylistTracks(updatedTracks);
        console.log('✅ Playlist tracks re-resolved');
      };

      reResolvePlaylistTracks();
    }
  }, [activeResolvers, resolverOrder]);

  // Save resolver settings when they change
  useEffect(() => {
    // Skip until we've loaded settings from storage to avoid overwriting saved settings
    if (!resolverSettingsLoaded.current) return;

    // Skip until resolvers are loaded and synced - this prevents saving before
    // new resolvers (like localfiles) are added to the settings
    if (loadedResolvers.length === 0) return;
    const loadedIds = loadedResolvers.map(r => r.id);
    const allResolversInOrder = loadedIds.every(id => resolverOrder.includes(id));
    if (!allResolversInOrder) {
      console.log('⏳ Waiting for resolver sync before saving...');
      return;
    }

    // Debounce the save to avoid saving too frequently
    const timeoutId = setTimeout(() => {
      saveCacheToStore();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [activeResolvers, resolverOrder, loadedResolvers]);

  // Keep refs updated for unmount save
  useEffect(() => {
    activeResolversRef.current = activeResolvers;
    resolverOrderRef.current = resolverOrder;
  }, [activeResolvers, resolverOrder]);

  // Keep prefetchedReleasesRef in sync for context menu handlers
  useEffect(() => {
    prefetchedReleasesRef.current = prefetchedReleases;
  }, [prefetchedReleases]);

  // Local Files handlers
  const handleAddWatchFolder = async () => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      const result = await window.electron.localFiles.addWatchFolder();
      if (result?.success) {
        setWatchFolders(await window.electron.localFiles.getWatchFolders());
        setLocalFilesStats(await window.electron.localFiles.getStats());
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveWatchFolder = async (folderPath) => {
    if (!window.electron?.localFiles) return;

    await window.electron.localFiles.removeWatchFolder(folderPath);
    setWatchFolders(await window.electron.localFiles.getWatchFolders());
    setLocalFilesStats(await window.electron.localFiles.getStats());
  };

  const handleRescanFolder = async (folderPath) => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      await window.electron.localFiles.rescanFolder(folderPath);
      setWatchFolders(await window.electron.localFiles.getWatchFolders());
      setLocalFilesStats(await window.electron.localFiles.getStats());
    } finally {
      setIsScanning(false);
    }
  };

  const handleRescanAll = async () => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      await window.electron.localFiles.rescanAll();
      setWatchFolders(await window.electron.localFiles.getWatchFolders());
      setLocalFilesStats(await window.electron.localFiles.getStats());
    } finally {
      setIsScanning(false);
    }
  };

  // Fetch playlist covers when viewing playlists page
  useEffect(() => {
    if (activeView !== 'playlists' || playlists.length === 0) return;

    // Fetch covers for playlists that don't have cached covers yet
    const fetchMissingCovers = async () => {
      for (const playlist of playlists) {
        // Skip if we already have covers for this playlist
        if (allPlaylistCovers[playlist.id]) continue;

        // Get tracks from playlist
        let tracks = playlist.tracks || [];

        // If no tracks array but has XSPF, parse it
        if (tracks.length === 0 && playlist.xspf) {
          const parsed = parseXSPF(playlist.xspf);
          if (parsed) {
            tracks = parsed.tracks;
          }
        }

        if (tracks.length === 0) continue;

        // Fetch covers using the existing function (which handles caching)
        const covers = await getPlaylistCovers(playlist.id, tracks);
        if (covers.length > 0) {
          setAllPlaylistCovers(prev => ({
            ...prev,
            [playlist.id]: covers
          }));
        }
      }
    };

    fetchMissingCovers();
  }, [activeView, playlists]);

  // Keyboard shortcuts - Escape navigates back from search view
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activeView === 'search') {
        navigateBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView]);

  const playDemoAudio = (track) => {
    if (!audioContext) return;
    if (currentSource) {
      try { currentSource.stop(); } catch (e) {}
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440 + (track.id * 100), audioContext.currentTime);
    gainNode.gain.setValueAtTime(volume / 100, audioContext.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    setCurrentSource(oscillator);
    setStartTime(audioContext.currentTime);
  };

  const handlePlay = async (trackOrSource) => {
    console.log('🎵 Playing track:', trackOrSource.title, 'by', trackOrSource.artist);

    // Determine if we were passed a track with multiple sources or a specific source
    let resolverId;
    let sourceToPlay = trackOrSource;

    if (trackOrSource.sources && typeof trackOrSource.sources === 'object' && !Array.isArray(trackOrSource.sources)) {
      // We have a track with multiple sources - select the best one
      let availableResolvers = Object.keys(trackOrSource.sources);

      if (availableResolvers.length === 0) {
        // No sources available - try resolving on-demand
        console.log('🔄 No sources found, attempting on-demand resolution...');

        const enabledResolvers = resolverOrder
          .filter(id => activeResolvers.includes(id))
          .map(id => allResolvers.find(r => r.id === id))
          .filter(Boolean);

        const resolverPromises = enabledResolvers.map(async (resolver) => {
          if (!resolver.capabilities.resolve) return;

          try {
            const config = await getResolverConfig(resolver.id);
            const result = await resolver.resolve(
              trackOrSource.artist,
              trackOrSource.title,
              trackOrSource.album || null,
              config
            );

            if (result) {
              trackOrSource.sources[resolver.id] = {
                ...result,
                confidence: calculateConfidence(trackOrSource, result)
              };
              console.log(`  ✅ ${resolver.name}: Found match`);
            }
          } catch (error) {
            console.error(`  ❌ ${resolver.name} resolve error:`, error);
          }
        });

        await Promise.all(resolverPromises);

        // Update availableResolvers after resolution
        availableResolvers = Object.keys(trackOrSource.sources);
        if (availableResolvers.length === 0) {
          console.error('❌ No resolver found for track after on-demand resolution');
          showConfirmDialog({
            type: 'error',
            title: 'No Source Found',
            message: 'Could not find a playable source for this track. Try enabling more resolvers in settings.'
          });
          return;
        }
      }

      // Sort sources by: 1) preferred resolver (if specified), 2) resolver priority, 3) confidence
      const preferredResolver = trackOrSource.preferredResolver;
      const sortedSources = availableResolvers.map(resId => ({
        resolverId: resId,
        source: trackOrSource.sources[resId],
        priority: resolverOrder.indexOf(resId),
        confidence: trackOrSource.sources[resId].confidence || 0
      }))
      .filter(s => activeResolvers.includes(s.resolverId)) // Only enabled resolvers
      .sort((a, b) => {
        // If a preferred resolver is specified, prioritize it
        if (preferredResolver) {
          if (a.resolverId === preferredResolver) return -1;
          if (b.resolverId === preferredResolver) return 1;
        }
        // Then sort by priority (lower index = higher priority)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // If same priority, sort by confidence (higher = better)
        return b.confidence - a.confidence;
      });

      if (sortedSources.length === 0) {
        console.error('❌ No enabled resolvers found for track');
        return;
      }

      const best = sortedSources[0];
      resolverId = best.resolverId;
      sourceToPlay = best.source;

      console.log(`🎵 Selected ${resolverId} (priority #${best.priority + 1}, confidence: ${(best.confidence * 100).toFixed(0)}%)`);
    } else {
      // We were passed a specific source object - detect resolver from it
      // Check which resolver this source came from by examining resolver-specific fields
      if (trackOrSource.spotifyId) resolverId = 'spotify';
      else if (trackOrSource.youtubeId) resolverId = 'youtube';
      else if (trackOrSource.bandcampUrl) resolverId = 'bandcamp';
      else if (trackOrSource.qobuzId) resolverId = 'qobuz';
      else if (trackOrSource.filePath || trackOrSource.fileUrl) resolverId = 'localfiles';
      else {
        console.error('❌ Could not determine resolver for source');
        return;
      }
    }

    const resolver = allResolvers.find(r => r.id === resolverId);
    if (!resolver) {
      console.error(`❌ Resolver ${resolverId} not found`);
      return;
    }

    // YouTube embedding is blocked in Electron, use resolver's play method instead
    // (which opens in external browser)

    // Handle local file playback directly with HTML5 Audio
    if (resolverId === 'localfiles') {
      console.log('🎵 Playing local file:', sourceToPlay.filePath || sourceToPlay.fileUrl);
      console.log('🎵 Source details:', JSON.stringify(sourceToPlay, null, 2));

      // Create audio element if needed
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.addEventListener('timeupdate', () => {
          if (audioRef.current) {
            setProgress(audioRef.current.currentTime);
          }
        });
        audioRef.current.addEventListener('loadedmetadata', () => {
          // Update current track duration from audio element once metadata loads
          const audioDuration = audioRef.current?.duration;
          if (audioDuration && !isNaN(audioDuration) && isFinite(audioDuration)) {
            console.log('🎵 Audio metadata loaded, duration:', audioDuration);
            setCurrentTrack(prev => prev ? { ...prev, duration: audioDuration } : prev);
          }
        });
        audioRef.current.addEventListener('durationchange', () => {
          // Also listen for duration changes (some formats report duration later)
          const audioDuration = audioRef.current?.duration;
          if (audioDuration && !isNaN(audioDuration) && isFinite(audioDuration)) {
            console.log('🎵 Audio duration changed:', audioDuration);
            setCurrentTrack(prev => prev ? { ...prev, duration: audioDuration } : prev);
          }
        });
        audioRef.current.addEventListener('ended', () => {
          console.log('🎵 Local file playback ended');
          handleNextRef.current?.();
        });
        audioRef.current.addEventListener('error', (e) => {
          console.error('🎵 Audio error:', e.target.error);
          // Don't show error dialog if fallback is in progress (it will be handled by the catch block)
          if (localFileFallbackInProgressRef.current) {
            console.log('🔄 Audio error during fallback attempt, skipping dialog');
            return;
          }
          showConfirmDialog({
            type: 'error',
            title: 'Playback Error',
            message: 'Could not play this file. It may have been moved or deleted.'
          });
        });
      }

      // Store the track for potential fallback handling
      localFilePlaybackTrackRef.current = trackOrSource;
      localFileFallbackInProgressRef.current = false;

      // Use custom local-audio:// protocol for secure local file playback
      const filePath = sourceToPlay.filePath || sourceToPlay.fileUrl?.replace('file://', '');
      const audioUrl = `local-audio://${filePath}`;
      console.log('🎵 Audio URL:', audioUrl);
      audioRef.current.src = audioUrl;
      audioRef.current.volume = volume / 100;

      // Explicitly load to trigger metadata events
      audioRef.current.load();

      try {
        await audioRef.current.play();

        // Set current track state
        // Duration from local files is already in seconds
        const duration = sourceToPlay.duration || trackOrSource.duration || 0;
        console.log('🎵 Track duration from source:', duration, 'sourceToPlay.duration:', sourceToPlay.duration, 'trackOrSource.duration:', trackOrSource.duration);
        const trackToSet = trackOrSource.sources ? {
          ...sourceToPlay,
          id: trackOrSource.id,
          artist: trackOrSource.artist,
          title: trackOrSource.title,
          album: trackOrSource.album,
          duration: duration,
          albumArt: sourceToPlay.albumArt || trackOrSource.albumArt,
          sources: trackOrSource.sources
        } : sourceToPlay;

        setCurrentTrack(trackToSet);
        setIsPlaying(true);
        setProgress(0);
        streamingPlaybackActiveRef.current = false;
        setBrowserPlaybackActive(false);
        setIsExternalPlayback(false);

        console.log('✅ Local file playing');
        console.log('🎵 Audio element duration after play:', audioRef.current?.duration);

        // If audio element has duration now, update the track
        const audioDuration = audioRef.current?.duration;
        if (audioDuration && !isNaN(audioDuration) && isFinite(audioDuration) && audioDuration > 0) {
          console.log('🎵 Setting duration from audio element:', audioDuration);
          setCurrentTrack(prev => prev ? { ...prev, duration: audioDuration } : prev);
        }
      } catch (error) {
        console.error('❌ Local file playback failed:', error);

        // Try fallback to next available source if we have the original track with sources
        if (trackOrSource.sources && Object.keys(trackOrSource.sources).length > 1) {
          const otherSources = Object.keys(trackOrSource.sources).filter(id => id !== 'localfiles');
          if (otherSources.length > 0) {
            console.log('🔄 Falling back to next available source...');
            // Set flag to prevent error event listener from showing duplicate dialog
            localFileFallbackInProgressRef.current = true;
            // Create a modified track without localfiles source to trigger fallback
            const fallbackTrack = {
              ...trackOrSource,
              sources: Object.fromEntries(
                Object.entries(trackOrSource.sources).filter(([id]) => id !== 'localfiles')
              )
            };
            handlePlay(fallbackTrack);
            return;
          }
        }

        localFileFallbackInProgressRef.current = false;
        showConfirmDialog({
          type: 'error',
          title: 'Playback Error',
          message: 'Could not play this file: ' + error.message
        });
      }
      return;
    }

    // Check if resolver can stream
    if (!resolver.capabilities.stream) {
      // For non-streaming resolvers (Bandcamp, YouTube), show prompt first
      console.log('🌐 External browser track detected, showing prompt...');
      streamingPlaybackActiveRef.current = false; // Allow browser events for external playback
      // CRITICAL: Update currentTrack BEFORE showing prompt so handleNext() can find it in queue
      // Merge source with original track, explicitly preserving queue-essential properties
      const trackToSet = trackOrSource.sources ?
        {
          ...sourceToPlay,
          id: trackOrSource.id,  // MUST preserve queue ID
          artist: trackOrSource.artist,
          title: trackOrSource.title,
          album: trackOrSource.album,
          duration: sourceToPlay.duration || trackOrSource.duration,
          sources: trackOrSource.sources
        } :
        sourceToPlay;
      console.log(`🔍 trackToSet.id="${trackToSet.id}", trackOrSource.id="${trackOrSource.id}", sourceToPlay.id="${sourceToPlay.id}"`);
      setCurrentTrack(trackToSet);
      showExternalTrackPromptUI(trackToSet);
      return; // Don't play yet, wait for user confirmation
    }

    // Use resolver's play method
    try {
      const config = await getResolverConfig(resolverId);
      console.log(`▶️ Using ${resolver.name} to play track...`);

      const success = await resolver.play(sourceToPlay, config);

      if (success) {
        console.log(`✅ Playing on ${resolver.name}`);

        // Reset browser playback state when playing via streaming resolver (Spotify, etc.)
        // This ensures we don't show "Playing in browser" for Spotify Connect playback
        if (resolver.capabilities.stream) {
          streamingPlaybackActiveRef.current = true; // Mark streaming active to ignore browser events
          setBrowserPlaybackActive(false);
          setIsExternalPlayback(false);
        }

        // Merge source with original track, explicitly preserving queue-essential properties
        const trackToSet = trackOrSource.sources ?
          {
            ...sourceToPlay,
            id: trackOrSource.id,  // MUST preserve queue ID
            artist: trackOrSource.artist,
            title: trackOrSource.title,
            album: trackOrSource.album,
            duration: sourceToPlay.duration || trackOrSource.duration,
            sources: trackOrSource.sources
          } :
          sourceToPlay;
        setCurrentTrack(trackToSet);
        setIsPlaying(true);
        setProgress(0);
        if (audioContext) {
          setStartTime(audioContext.currentTime);
        }
      }

      // Start auto-advance polling for streaming tracks
      if (resolver.capabilities.stream && success) {
        startAutoAdvancePolling(resolverId, sourceToPlay, config);
      }

      if (!success) {
        console.error(`❌ ${resolver.name} playback failed`);

        // For Spotify, retry once after a short delay (device may need to wake up)
        if (resolverId === 'spotify' && !sourceToPlay._spotifyRetried) {
          console.log('🔄 Spotify playback failed, retrying in 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Mark as retried to prevent infinite loop
          const retrySource = { ...sourceToPlay, _spotifyRetried: true };
          const retryTrack = trackOrSource.sources ? {
            ...trackOrSource,
            sources: { ...trackOrSource.sources, spotify: retrySource }
          } : retrySource;

          console.log('🔄 Retrying Spotify playback...');
          const retrySuccess = await resolver.play(retrySource, config);

          if (retrySuccess) {
            console.log('✅ Spotify retry successful');
            streamingPlaybackActiveRef.current = true;
            setBrowserPlaybackActive(false);
            setIsExternalPlayback(false);

            const trackToSet = trackOrSource.sources ? {
              ...sourceToPlay,
              id: trackOrSource.id,
              artist: trackOrSource.artist,
              title: trackOrSource.title,
              album: trackOrSource.album,
              duration: sourceToPlay.duration || trackOrSource.duration,
              sources: trackOrSource.sources
            } : sourceToPlay;
            setCurrentTrack(trackToSet);
            setIsPlaying(true);
            setProgress(0);
            if (audioContext) {
              setStartTime(audioContext.currentTime);
            }
            startAutoAdvancePolling(resolverId, sourceToPlay, config);
            return; // Success on retry, don't fall through to re-resolve
          }
          console.error('❌ Spotify retry also failed');
        }

        // Playback failed - cached source may be invalid
        // Try to re-resolve and find alternative sources
        if (sourceToPlay.artist && sourceToPlay.title) {
          console.log('🔄 Attempting to re-resolve track with fresh sources...');
          const artistName = sourceToPlay.artist;
          const trackData = { position: sourceToPlay.position || 1, title: sourceToPlay.title, length: sourceToPlay.duration };

          // Force refresh to bypass cache
          await resolveTrack(trackData, artistName, true);

          showConfirmDialog({
            type: 'info',
            title: 'Track Re-resolved',
            message: 'Playback failed. Track has been re-resolved. Please try playing again.'
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error playing with ${resolver.name}:`, error);

      // On error, also try to re-resolve
      if (sourceToPlay.artist && sourceToPlay.title) {
        console.log('🔄 Playback error - attempting to re-resolve...');
        const artistName = sourceToPlay.artist;
        const trackData = { position: sourceToPlay.position || 1, title: sourceToPlay.title, length: sourceToPlay.duration };
        await resolveTrack(trackData, artistName, true);
      }
    }
  };

  // Auto-advance: Start polling for track completion
  const startAutoAdvancePolling = (resolverId, track, config) => {
    // Clear any existing poller
    if (playbackPollerRef.current) {
      clearInterval(playbackPollerRef.current);
      playbackPollerRef.current = null;
    }
    // Clear recovery interval if we're starting fresh polling
    if (pollingRecoveryRef.current) {
      clearInterval(pollingRecoveryRef.current);
      pollingRecoveryRef.current = null;
    }

    if (resolverId === 'spotify' && config.token) {
      const trackUri = track.spotifyUri || track.uri;
      console.log(`🔄 Starting Spotify playback polling for auto-advance (5s interval)... trackUri=${trackUri}`);

      if (!trackUri) {
        console.warn('⚠️ No Spotify URI found on track, auto-advance may not work');
      }

      let errorCount = 0; // Track consecutive polling errors
      let lastTrackUri = trackUri; // Track what we started playing

      const pollInterval = setInterval(async () => {
        try {
          const response = await fetch('https://api.spotify.com/v1/me/player', {
            headers: {
              'Authorization': `Bearer ${config.token}`
            }
          });

          if (!response.ok) {
            if (response.status === 401) {
              // Token expired
              console.error('Spotify token expired during polling');
              clearInterval(pollInterval);
              playbackPollerRef.current = null;
              return;
            }
            throw new Error(`Spotify API error: ${response.status}`);
          }

          const data = await response.json();
          errorCount = 0; // Reset on success

          if (!data.item) {
            // No track playing - playback stopped
            console.log('⏹️ Spotify playback stopped');
            clearInterval(pollInterval);
            playbackPollerRef.current = null;
            return;
          }

          const currentUri = data.item.uri;
          const progressMs = data.progress_ms;
          const durationMs = data.item.duration_ms;

          // Check if we're still playing the same track we started with
          if (currentUri === lastTrackUri) {
            // If within 1 second of end, trigger next
            if (progressMs >= durationMs - 1000) {
              console.log('🎵 Track ending, auto-advancing to next...');
              clearInterval(pollInterval);
              playbackPollerRef.current = null;
              // Use ref to avoid stale closure in interval callback
              if (handleNextRef.current) handleNextRef.current();
            }
          } else {
            // Track changed - Spotify advanced on its own or user changed track
            // Advance to our next track to stay in sync
            console.log('🔄 Spotify track changed externally, advancing our queue...');
            clearInterval(pollInterval);
            playbackPollerRef.current = null;
            if (handleNextRef.current) handleNextRef.current();
          }
        } catch (error) {
          console.error('Spotify polling error:', error);

          // Track consecutive errors
          errorCount = (errorCount || 0) + 1;

          if (errorCount >= 3) {
            // After 3 consecutive errors, stop polling but start recovery
            console.error('❌ Too many Spotify polling errors, stopping auto-advance');
            clearInterval(pollInterval);
            playbackPollerRef.current = null;
            // Start recovery interval to retry when API becomes available
            startPollingRecovery(config);
          }
        }
      }, 5000); // Poll every 5 seconds (consistent with existing playback polling)

      playbackPollerRef.current = pollInterval;
    }
    // For future HTML5 audio resolvers, add event listener logic here
  };

  // Start recovery polling when Spotify auto-advance fails
  // Periodically checks if we should restart polling (queue has tracks, nothing playing)
  const startPollingRecovery = (config) => {
    // Clear any existing recovery interval
    if (pollingRecoveryRef.current) {
      clearInterval(pollingRecoveryRef.current);
      pollingRecoveryRef.current = null;
    }

    console.log('🔄 Starting polling recovery interval (20s)...');

    const recoveryInterval = setInterval(async () => {
      const queue = currentQueueRef.current;
      const track = currentTrackRef.current;

      // Stop recovery if queue is empty
      if (!queue || queue.length === 0) {
        console.log('🔄 Recovery: Queue empty, stopping recovery');
        clearInterval(recoveryInterval);
        pollingRecoveryRef.current = null;
        return;
      }

      // Stop recovery if no current track (nothing to monitor)
      if (!track) {
        console.log('🔄 Recovery: No current track, stopping recovery');
        clearInterval(recoveryInterval);
        pollingRecoveryRef.current = null;
        return;
      }

      // Try to check Spotify playback state
      try {
        const response = await fetch('https://api.spotify.com/v1/me/player', {
          headers: {
            'Authorization': `Bearer ${config.token}`
          }
        });

        if (response.ok) {
          const data = await response.json();

          // If Spotify is playing, restart proper polling
          if (data.is_playing && data.item) {
            console.log('🔄 Recovery: Spotify responding, restarting auto-advance polling');
            clearInterval(recoveryInterval);
            pollingRecoveryRef.current = null;
            startAutoAdvancePolling('spotify', track, config);
          } else if (!data.is_playing && queue.length > 0) {
            // Spotify not playing but we have queue - advance to next track
            console.log('🔄 Recovery: Spotify not playing, queue has tracks - advancing');
            clearInterval(recoveryInterval);
            pollingRecoveryRef.current = null;
            if (handleNextRef.current) handleNextRef.current();
          }
        } else if (response.status === 401) {
          // Token expired - stop recovery, user needs to re-auth
          console.log('🔄 Recovery: Token expired, stopping recovery');
          clearInterval(recoveryInterval);
          pollingRecoveryRef.current = null;
        }
        // Other errors: keep trying
      } catch (error) {
        console.log('🔄 Recovery: API still unavailable, will retry...', error.message);
        // Keep recovery interval running
      }
    }, 20000); // Check every 20 seconds

    pollingRecoveryRef.current = recoveryInterval;
  };

  // Stop Spotify playback (used when switching to external browser track)
  const stopSpotifyPlayback = async () => {
    if (!spotifyToken) return;

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${spotifyToken}`
        }
      });

      if (response.ok || response.status === 204) {
        console.log('⏸️ Stopped Spotify playback');
        setIsPlaying(false);
      }
    } catch (error) {
      console.error('Failed to stop Spotify playback:', error);
    }
  };

  // Show prompt for external browser track
  const showExternalTrackPromptUI = async (track) => {
    console.log('🌐 Showing external track prompt for:', track.title);

    // Stop any currently playing Spotify track before prompting
    await stopSpotifyPlayback();

    setPendingExternalTrack(track);
    setShowExternalPrompt(true);

    // Set 15-second auto-skip timeout
    const timeout = setTimeout(() => {
      console.log('⏱️ External track prompt timeout, auto-skipping...');
      handleSkipExternalTrack();
    }, 15000);

    externalTrackTimeoutRef.current = timeout;
  };

  // User confirmed opening external browser
  const handleOpenExternalTrack = async (track) => {
    console.log('✅ User confirmed, opening external track:', track.title);

    // Clear timeout FIRST
    if (externalTrackTimeoutRef.current) {
      clearTimeout(externalTrackTimeoutRef.current);
      externalTrackTimeoutRef.current = null;
    }

    // Determine resolver before state changes
    const resolverId = determineResolverIdFromTrack(track);
    if (!resolverId) {
      console.error('❌ Could not determine resolver for external track');
      setIsExternalPlayback(false);
      setPendingExternalTrack(null);
      setShowExternalPrompt(false);
      handleNext();
      return;
    }

    const resolver = allResolvers.find(r => r.id === resolverId);
    if (!resolver) {
      console.error(`❌ Resolver ${resolverId} not found`);
      setIsExternalPlayback(false);
      setPendingExternalTrack(null);
      setShowExternalPrompt(false);
      handleNext();
      return;
    }

    // Close previous browser tab if one is active
    if (activeExtensionTabId && extensionConnected) {
      console.log('🔄 Closing previous browser tab:', activeExtensionTabId);
      // Mark this as a programmatic close so tabClosed handler doesn't call handleNext()
      pendingCloseTabIdRef.current = activeExtensionTabId;
      window.electron.extension.sendCommand({
        type: 'command',
        action: 'closeTab',
        tabId: activeExtensionTabId
      });
      setActiveExtensionTabId(null);
      setBrowserPlaybackActive(false);
    }

    // Close previous playback window if one is active (for Bandcamp, etc.)
    if (window.electron?.playbackWindow?.close) {
      console.log('🔄 Closing previous playback window');
      await window.electron.playbackWindow.close();
    }

    // Open in external browser FIRST
    try {
      const config = await getResolverConfig(resolverId);
      await resolver.play(track, config);
      console.log(`🌐 Opened ${track.title} in browser via ${resolver.name}`);

      // Only update state AFTER successful browser open
      setShowExternalPrompt(false);
      setPendingExternalTrack(null);
      setIsExternalPlayback(true);
      setCurrentTrack(track);
    } catch (error) {
      console.error('❌ Failed to open external track:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Browser Error',
        message: `Failed to open browser: ${error.message}`
      });
      setIsExternalPlayback(false);
      setPendingExternalTrack(null);
      setShowExternalPrompt(false);
      handleNext();
    }
  };

  // Skip external track (manual or auto-timeout)
  const handleSkipExternalTrack = () => {
    console.log('⏭️ Skipping external track');

    // Clear timeout if exists
    if (externalTrackTimeoutRef.current) {
      clearTimeout(externalTrackTimeoutRef.current);
      externalTrackTimeoutRef.current = null;
    }

    setShowExternalPrompt(false);
    setPendingExternalTrack(null);

    // Show toast notification
    // (Simplified - full toast system out of scope)
    console.log('ℹ️ Skipped external track');

    // Use refs to get current values (avoids stale closure when called from event handlers)
    const queue = currentQueueRef.current;
    const track = currentTrackRef.current;

    // Find next track BEFORE removing current from queue
    if (queue.length === 0) {
      console.log('Queue is empty, cannot skip');
      return;
    }

    const currentIndex = queue.findIndex(t => t.id === track?.id);
    console.log(`🔍 Skip: currentIndex=${currentIndex}, queueLength=${queue.length}`);
    console.log(`🔍 currentTrack.id="${track?.id}", title="${track?.title}"`);
    console.log(`🔍 Queue track IDs:`, queue.map(t => `"${t.id}"`));
    console.log(`🔍 Queue track titles:`, queue.map(t => t.title));

    let nextTrack;
    if (currentIndex === -1) {
      // Track not found, play first
      nextTrack = queue[0];
    } else if (currentIndex === queue.length - 1) {
      // Last track, loop to first
      nextTrack = queue[0];
    } else {
      // Play next track
      nextTrack = queue[currentIndex + 1];
    }

    // Remove current track from queue
    const newQueue = queue.filter(t => t.id !== track?.id);
    setCurrentQueue(newQueue);
    console.log(`📋 Removed track. New queue length: ${newQueue.length}`);

    // Play the next track directly
    if (nextTrack) {
      handlePlay(nextTrack);
    }
  };

  // User finished with external track, move to next
  const handleDoneWithExternalTrack = () => {
    console.log('✅ User done with external track, moving to next');
    setIsExternalPlayback(false);
    setShowExternalPrompt(false);
    setPendingExternalTrack(null);

    // Use refs to get current values (avoids stale closure when called from event handlers)
    const queue = currentQueueRef.current;
    const track = currentTrackRef.current;

    // Find next track BEFORE removing current from queue
    if (queue.length === 0) {
      console.log('Queue is empty, nothing to play');
      return;
    }

    const currentIndex = queue.findIndex(t => t.id === track?.id);
    console.log(`🔍 Done: currentIndex=${currentIndex}, queueLength=${queue.length}`);
    console.log(`🔍 currentTrack.id="${track?.id}", title="${track?.title}"`);
    console.log(`🔍 Queue track IDs:`, queue.map(t => `"${t.id}"`));
    console.log(`🔍 Queue track titles:`, queue.map(t => t.title));

    let nextTrack;
    if (currentIndex === -1) {
      // Track not found, play first
      nextTrack = queue[0];
    } else if (currentIndex === queue.length - 1) {
      // Last track, loop to first
      nextTrack = queue[0];
    } else {
      // Play next track
      nextTrack = queue[currentIndex + 1];
    }

    // Remove current track from queue
    const newQueue = queue.filter(t => t.id !== track?.id);
    setCurrentQueue(newQueue);
    console.log(`📋 Removed track. New queue length: ${newQueue.length}`);

    // Play the next track directly
    if (nextTrack) {
      handlePlay(nextTrack);
    }
  };

  const handlePlayPause = async () => {
    if (!currentTrack) return;

    // Check if browser extension is controlling playback
    if (browserPlaybackActive && extensionConnected) {
      console.log('🌐 Sending play/pause to browser extension');
      window.electron.extension.sendCommand({
        type: 'command',
        action: isPlaying ? 'pause' : 'play'
      });
      // State will be updated when extension sends back playing/paused event
      return;
    }

    // Handle local file playback
    if (audioRef.current && currentTrack?.sources?.localfiles) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    const isSpotifyTrack = currentTrack.sources?.spotify || currentTrack.spotifyUri;

    if (isSpotifyTrack && spotifyToken) {
      // Control Spotify playback
      try {
        const endpoint = isPlaying ?
          'https://api.spotify.com/v1/me/player/pause' :
          'https://api.spotify.com/v1/me/player/play';

        const response = await fetch(endpoint, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${spotifyToken}`
          }
        });

        if (response.ok || response.status === 204) {
          setIsPlaying(!isPlaying);
          console.log(isPlaying ? 'Paused' : 'Resumed', 'Spotify playback');
        }
      } catch (error) {
        console.error('Spotify play/pause error:', error);
      }
    } else {
      // Toggle local playback
      if (!audioContext) return;
      if (isPlaying) {
        setIsPlaying(false);
        if (currentSource) {
          try { currentSource.stop(); setCurrentSource(null); } catch (e) {}
        }
      } else {
        if (audioContext.state === 'suspended') await audioContext.resume();
        setIsPlaying(true);
        playDemoAudio(currentTrack);
      }
    }
  };

  const handleNext = async () => {
    // Stop browser playback if active
    if (browserPlaybackActive && activeExtensionTabId) {
      console.log('⏹️ Stopping browser playback before next track');
      window.electron.extension.sendCommand({
        type: 'command',
        action: 'pause'
      });
      // Store the tab ID to close when next track connects
      pendingCloseTabIdRef.current = activeExtensionTabId;
      setBrowserPlaybackActive(false);
      setActiveExtensionTabId(null);
    }

    // Close playback window if active (for Bandcamp, etc.)
    if (window.electron?.playbackWindow?.close) {
      await window.electron.playbackWindow.close();
    }

    // Clean up any active polling or timeouts
    if (playbackPollerRef.current) {
      clearInterval(playbackPollerRef.current);
      playbackPollerRef.current = null;
    }
    if (pollingRecoveryRef.current) {
      clearInterval(pollingRecoveryRef.current);
      pollingRecoveryRef.current = null;
    }
    if (externalTrackTimeoutRef.current) {
      clearTimeout(externalTrackTimeoutRef.current);
      externalTrackTimeoutRef.current = null;
    }
    setIsExternalPlayback(false);
    setShowExternalPrompt(false);
    setPendingExternalTrack(null);

    // Always use our local queue for navigation
    // (Spotify doesn't know about our queue - tracks may resolve to different services)
    // Use refs to get current values (avoids stale closure when called from event handlers)
    const queue = currentQueueRef.current;
    const track = currentTrackRef.current;

    if (queue.length === 0) {
      console.log('No queue set, cannot go to next track');
      return;
    }

    console.log(`🔍 Queue navigation: currentTrack.id="${track?.id}", queueLength=${queue.length}`);

    // Queue represents upcoming tracks - current track is NOT in the queue
    // Find the first playable track in the queue
    const nextTrackIndex = queue.findIndex(t => t.status !== 'error');

    if (nextTrackIndex === -1) {
      console.log('⚠️ No playable tracks in queue');
      return;
    }

    const nextTrack = queue[nextTrackIndex];

    // Remove the track we're about to play from the queue
    const newQueue = queue.filter((_, index) => index !== nextTrackIndex);
    setCurrentQueue(newQueue);

    console.log(`➡️ Playing next track: "${nextTrack.title}", remaining queue: ${newQueue.length}`);
    handlePlay(nextTrack);
  };

  // Keep handleNextRef in sync so event handlers always call the latest version
  useEffect(() => { handleNextRef.current = handleNext; });

  const handlePrevious = async () => {
    // Use refs to get current values (avoids stale closure when called from event handlers)
    const track = currentTrackRef.current;

    if (!track) return;

    // Stop browser playback if active
    if (browserPlaybackActive && activeExtensionTabId) {
      console.log('⏹️ Stopping browser playback before restarting track');
      window.electron.extension.sendCommand({
        type: 'command',
        action: 'pause'
      });
      pendingCloseTabIdRef.current = activeExtensionTabId;
      setBrowserPlaybackActive(false);
      setActiveExtensionTabId(null);
    }

    // Clean up any active polling or timeouts
    if (playbackPollerRef.current) {
      clearInterval(playbackPollerRef.current);
      playbackPollerRef.current = null;
    }
    if (pollingRecoveryRef.current) {
      clearInterval(pollingRecoveryRef.current);
      pollingRecoveryRef.current = null;
    }
    if (externalTrackTimeoutRef.current) {
      clearTimeout(externalTrackTimeoutRef.current);
      externalTrackTimeoutRef.current = null;
    }
    setIsExternalPlayback(false);
    setShowExternalPrompt(false);
    setPendingExternalTrack(null);

    // In a queue-based system, "previous" restarts the current track
    // (we don't keep history of played tracks)
    console.log(`⬅️ Restarting current track: "${track.title}"`);
    handlePlay(track);
  };

  // Queue management functions
  const removeFromQueue = (trackId) => {
    setCurrentQueue(prev => prev.filter(t => t.id !== trackId));
    console.log(`🗑️ Removed track ${trackId} from queue`);
  };

  const moveInQueue = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setCurrentQueue(prev => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      console.log(`🔀 Moved track from index ${fromIndex} to ${toIndex}`);
      return newQueue;
    });
  };

  const moveInPlaylist = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;

    // Update displayed tracks
    setPlaylistTracks(prev => {
      const newTracks = [...prev];
      const [removed] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, removed);
      console.log(`🔀 Moved playlist track from index ${fromIndex} to ${toIndex}`);
      return newTracks;
    });

    // Update lastModified on the selected playlist and save to disk
    if (selectedPlaylist) {
      setSelectedPlaylist(prev => ({ ...prev, lastModified: Date.now() }));
      setPlaylists(prev => prev.map(p => {
        if (p.id === selectedPlaylist.id) {
          // Reorder tracks in the playlist data
          const newTracks = [...(p.tracks || [])];
          const [removed] = newTracks.splice(fromIndex, 1);
          newTracks.splice(toIndex, 0, removed);
          const updatedPlaylist = {
            ...p,
            tracks: newTracks,
            lastModified: Date.now()
          };
          // Save to disk
          savePlaylistToDisk(updatedPlaylist);
          return updatedPlaylist;
        }
        return p;
      }));
    }
  };

  const clearQueue = () => {
    setCurrentQueue([]);
    console.log('🗑️ Cleared queue');
  };

  const addToQueue = (tracks) => {
    const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
    setCurrentQueue(prev => [...prev, ...tracksArray]);
    // Trigger queue animation
    setQueueAnimating(true);
    setTimeout(() => setQueueAnimating(false), 600);
    console.log(`➕ Added ${tracksArray.length} track(s) to queue`);

    // Resolve queue tracks with priority over page resolution
    // Filter to only tracks that need resolution
    const tracksNeedingResolution = tracksArray.filter(track =>
      !track.sources || Object.keys(track.sources).length === 0
    );
    if (tracksNeedingResolution.length > 0) {
      resolveQueueTracks(tracksNeedingResolution);
    }
  };

  const handleSearchInput = (value) => {
    setSearchQuery(value);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Clear results if search cleared
    if (!value) {
      setSearchResults({ artists: [], albums: [], tracks: [], playlists: [] });
      setIsSearching(false);
      setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });
      return;
    }

    // Show loading state for responsive feel
    if (value.length >= 2) {
      setIsSearching(true);
    }

    // Reset pagination on new search
    setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });

    // Debounce search by 400ms
    searchTimeoutRef.current = setTimeout(() => {
      if (value.length >= 2) {
        performSearch(value);
      }
    }, 400);
  };

  // Load more results for a specific category
  const handleLoadMore = (category) => {
    setDisplayLimits(prev => ({
      ...prev,
      [category]: prev[category] + (category === 'tracks' ? 8 : 5)
    }));
  };

  const resolveRecording = async (recording) => {
    const track = {
      id: recording.id,
      title: recording.title,
      artist: recording['artist-credit']?.[0]?.name || 'Unknown',
      duration: Math.floor((recording.length || 180000) / 1000), // Convert ms to seconds
      album: recording.releases?.[0]?.title || '',
      releaseId: recording.releases?.[0]?.id || null, // Store release ID for album art
      length: recording.length, // Keep original length in ms for confidence calculation
      sources: {}
    };

    console.log(`🔍 Resolving recording: ${track.artist} - ${track.title}`);

    // Query enabled resolvers in priority order (limit to first 2 to avoid slow searches)
    const enabledResolvers = resolverOrder
      .filter(id => activeResolvers.includes(id))
      .map(id => allResolvers.find(r => r.id === id))
      .filter(Boolean)
      .slice(0, 2);

    // Parallel resolution with confidence scoring
    const resolverPromises = enabledResolvers.map(async (resolver) => {
      // Skip resolvers that can't resolve or can't play (no point resolving if we can't play)
      if (!resolver.capabilities.resolve || !resolver.play) return;

      try {
        const config = await getResolverConfig(resolver.id);
        const result = await resolver.resolve(track.artist, track.title, track.album, config);

        if (result) {
          track.sources[resolver.id] = {
            ...result,
            confidence: calculateConfidence(track, result)
          };
          console.log(`  ✅ ${resolver.name}: Found match (confidence: ${(track.sources[resolver.id].confidence * 100).toFixed(0)}%)`);
        }
      } catch (error) {
        console.error(`  ❌ ${resolver.name} resolve error:`, error);
      }
    });

    // Wait for all resolvers to complete
    await Promise.all(resolverPromises);

    if (Object.keys(track.sources).length > 0) {
      console.log(`✅ Found ${Object.keys(track.sources).length} source(s) for: ${track.title}`);
    }

    return track;
  };

  const performSearch = async (query) => {
    setIsSearching(true);
    const results = {
      artists: [],
      albums: [],
      tracks: [],
      playlists: []
    };

    try {
      // Search MusicBrainz for artists (fetch more than we initially display)
      const artistResponse = await fetch(
        `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&fmt=json&limit=25`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );
      if (artistResponse.ok) {
        const data = await artistResponse.json();
        results.artists = data.artists || [];
      }

      // Search MusicBrainz for albums (release-groups)
      const albumResponse = await fetch(
        `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=30`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );
      if (albumResponse.ok) {
        const data = await albumResponse.json();
        results.albums = data['release-groups'] || [];
      }

      // Search MusicBrainz for tracks (recordings)
      const trackResponse = await fetch(
        `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=50`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );
      if (trackResponse.ok) {
        const data = await trackResponse.json();
        const recordings = data.recordings || [];

        // Only resolve the first batch of tracks for performance
        // Rest will be resolved on-demand when "Load more" is clicked or when played
        const initialBatchSize = 8;
        const trackPromises = recordings.slice(0, initialBatchSize).map(recording => resolveRecording(recording));
        const resolvedTracks = await Promise.all(trackPromises);

        // Store unresolved tracks without sources (will resolve on-demand)
        const unresolvedTracks = recordings.slice(initialBatchSize).map(recording => ({
          id: recording.id,
          title: recording.title,
          artist: recording['artist-credit']?.[0]?.name || 'Unknown',
          duration: Math.floor((recording.length || 180000) / 1000),
          album: recording.releases?.[0]?.title || '',
          releaseId: recording.releases?.[0]?.id || null, // Store release ID for album art
          length: recording.length,
          sources: {}
        }));

        results.tracks = [...resolvedTracks, ...unresolvedTracks];
      }

      // Search local playlists
      results.playlists = playlists.filter(p =>
        p.title.toLowerCase().includes(query.toLowerCase())
      );

      setSearchResults(results);
      console.log('🔍 Search results:', results);

      // Fetch album art lazily in background (don't block search results)
      fetchSearchAlbumArt(results.albums, results.tracks);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Fetch album art for search results (albums and tracks)
  const fetchSearchAlbumArt = async (albums, tracks) => {
    // Fetch album art for albums (release-groups need to be converted to releases first)
    for (const album of albums.slice(0, 10)) { // Limit to first 10 for performance
      if (album.albumArt) continue; // Skip if already has art

      try {
        // Get first release for this release-group
        const releaseResponse = await fetch(
          `https://musicbrainz.org/ws/2/release?release-group=${album.id}&status=official&fmt=json&limit=1`,
          { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
        );

        if (releaseResponse.ok) {
          const releaseData = await releaseResponse.json();
          if (releaseData.releases && releaseData.releases.length > 0) {
            const releaseId = releaseData.releases[0].id;

            // Fetch album art for this release
            const artResponse = await fetch(
              `https://coverartarchive.org/release/${releaseId}`,
              { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
            );

            if (artResponse.ok) {
              const artData = await artResponse.json();
              const frontCover = artData.images.find(img => img.front);
              if (frontCover) {
                album.albumArt = frontCover.thumbnails?.['250'] || frontCover.thumbnails?.['500'] || frontCover.image;

                // Update search results to trigger re-render
                setSearchResults(prev => ({ ...prev, albums: [...prev.albums] }));
              }
            }
          }
        }
      } catch (error) {
        // Silently fail - album art is optional
      }
    }

    // Fetch album art for tracks (from their releases)
    for (const track of tracks.slice(0, 10)) { // Limit to first 10 for performance
      if (track.albumArt || !track.releaseId) continue; // Skip if already has art or no release ID

      try {
        const artResponse = await fetch(
          `https://coverartarchive.org/release/${track.releaseId}`,
          { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
        );

        if (artResponse.ok) {
          const artData = await artResponse.json();
          const frontCover = artData.images.find(img => img.front);
          if (frontCover) {
            track.albumArt = frontCover.thumbnails?.['250'] || frontCover.thumbnails?.['500'] || frontCover.image;

            // Update search results to trigger re-render
            setSearchResults(prev => ({ ...prev, tracks: [...prev.tracks] }));
          }
        }
      } catch (error) {
        // Silently fail - album art is optional
      }
    }
  };

  // Cache utility functions
  const loadCacheFromStore = async () => {
    if (!window.electron?.store) return;

    try {
      // Load album art cache (keep full { url, timestamp } structure)
      const albumArtData = await window.electron.store.get('cache_album_art');
      if (albumArtData) {
        // Filter out expired entries
        const now = Date.now();
        const validEntries = Object.entries(albumArtData).filter(
          ([_, entry]) => entry && entry.timestamp && (now - entry.timestamp) < CACHE_TTL.albumArt
        );
        albumArtCache.current = Object.fromEntries(validEntries);
        console.log(`📦 Loaded ${validEntries.length} album art entries from cache`);
      }

      // Load artist data cache
      // Cache version 2: Added release-group categorization (live, compilation)
      const ARTIST_CACHE_VERSION = 2;
      const artistData = await window.electron.store.get('cache_artist_data');
      if (artistData) {
        // Filter out expired entries and entries from old cache versions
        const now = Date.now();
        const validEntries = Object.entries(artistData).filter(
          ([_, entry]) => entry.cacheVersion === ARTIST_CACHE_VERSION &&
                         now - entry.timestamp < CACHE_TTL.artistData
        );
        artistDataCache.current = Object.fromEntries(validEntries);
        const invalidated = Object.keys(artistData).length - validEntries.length;
        console.log(`📦 Loaded ${validEntries.length} artist data entries from cache${invalidated > 0 ? ` (${invalidated} invalidated due to version change)` : ''}`);
      }

      // Load track sources cache
      const trackSourcesData = await window.electron.store.get('cache_track_sources');
      if (trackSourcesData) {
        // Filter out expired entries
        const now = Date.now();
        const validEntries = Object.entries(trackSourcesData).filter(
          ([_, entry]) => now - entry.timestamp < CACHE_TTL.trackSources
        );
        trackSourcesCache.current = Object.fromEntries(validEntries);
        console.log(`📦 Loaded ${validEntries.length} track source entries from cache`);
      }

      // Load artist image cache
      const artistImageData = await window.electron.store.get('cache_artist_images');
      if (artistImageData) {
        // Filter out expired entries
        const now = Date.now();
        const validEntries = Object.entries(artistImageData).filter(
          ([_, entry]) => now - entry.timestamp < CACHE_TTL.artistImage
        );
        artistImageCache.current = Object.fromEntries(validEntries);
        console.log(`📦 Loaded ${validEntries.length} artist image entries from cache`);
      }

      // Load album-to-release-ID mapping cache (for Critic's Picks and track art lookups)
      const albumReleaseIdData = await window.electron.store.get('cache_album_release_ids');
      if (albumReleaseIdData) {
        albumToReleaseIdCache.current = albumReleaseIdData;
        console.log(`📦 Loaded ${Object.keys(albumReleaseIdData).length} album-to-release-ID mappings from cache`);
      }

      // Load playlist cover cache
      const playlistCoverData = await window.electron.store.get('cache_playlist_covers');
      if (playlistCoverData) {
        // Filter out expired entries
        const now = Date.now();
        const validEntries = Object.entries(playlistCoverData).filter(
          ([_, entry]) => now - entry.timestamp < CACHE_TTL.playlistCover
        );
        playlistCoverCache.current = Object.fromEntries(validEntries);
        console.log(`📦 Loaded ${validEntries.length} playlist cover entries from cache`);
      }

      // Load resolver settings
      const savedActiveResolvers = await window.electron.store.get('active_resolvers');
      const savedResolverOrder = await window.electron.store.get('resolver_order');

      if (savedActiveResolvers) {
        // Deduplicate in case of corrupted data
        const dedupedActive = [...new Set(savedActiveResolvers)];
        setActiveResolvers(dedupedActive);
        console.log(`📦 Loaded ${dedupedActive.length} active resolvers from storage`);
      }

      if (savedResolverOrder) {
        // Deduplicate in case of corrupted data (preserving order of first occurrence)
        const dedupedOrder = [...new Set(savedResolverOrder)];
        setResolverOrder(dedupedOrder);
        console.log(`📦 Loaded resolver order from storage (${dedupedOrder.length} resolvers)`);
      }

      // Mark settings as loaded so save useEffect knows it's safe to save
      resolverSettingsLoaded.current = true;
      setCacheLoaded(true);
      console.log('📦 All caches loaded from persistent storage');
    } catch (error) {
      console.error('Failed to load cache from store:', error);
      // Even on error, mark as loaded so app can function
      resolverSettingsLoaded.current = true;
      setCacheLoaded(true);
    }
  };

  const saveCacheToStore = async () => {
    if (!window.electron?.store) return;

    try {
      // Save album art cache (already has timestamps from when items were added)
      await window.electron.store.set('cache_album_art', albumArtCache.current);

      // Save artist data cache (already has timestamps)
      await window.electron.store.set('cache_artist_data', artistDataCache.current);

      // Save track sources cache (already has timestamps)
      await window.electron.store.set('cache_track_sources', trackSourcesCache.current);

      // Save artist image cache (already has timestamps)
      await window.electron.store.set('cache_artist_images', artistImageCache.current);

      // Save album-to-release-ID mapping cache
      await window.electron.store.set('cache_album_release_ids', albumToReleaseIdCache.current);

      // Save playlist cover cache
      await window.electron.store.set('cache_playlist_covers', playlistCoverCache.current);

      // Save resolver settings (use refs to ensure we have current values, not stale closure)
      await window.electron.store.set('active_resolvers', activeResolversRef.current);
      await window.electron.store.set('resolver_order', resolverOrderRef.current);

      console.log('💾 Cache and resolver settings saved to persistent storage');
      console.log('   Saved resolver order:', resolverOrderRef.current);
    } catch (error) {
      console.error('Failed to save cache to store:', error);
    }
  };

  // Load cache on mount
  useEffect(() => {
    loadCacheFromStore();

    // Save cache periodically (every 5 minutes)
    const cacheInterval = setInterval(saveCacheToStore, 5 * 60 * 1000);

    // Save cache on unmount
    return () => {
      clearInterval(cacheInterval);
      saveCacheToStore();
    };
  }, []);

  // Fetch artist data and discography from MusicBrainz
  const fetchArtistData = async (artistName) => {
    console.log('Fetching artist data for:', artistName);

    // Clear any current release view when navigating to a new artist
    setCurrentRelease(null);

    // Only add to artist history if we're already on the artist view
    // This prevents search results from building up history
    if (activeView === 'artist' && currentArtist && currentArtist.name !== artistName) {
      setArtistHistory(prev => [...prev, currentArtist.name]);
    } else if (activeView !== 'artist') {
      // Clear artist history when coming from a different view (like search)
      setArtistHistory([]);
    }

    // Check cache first BEFORE clearing state
    const cacheKey = artistName.toLowerCase();
    const cachedData = artistDataCache.current[cacheKey];
    const now = Date.now();

    // Cache is valid if data exists and not expired
    // Note: Resolver settings don't affect artist/release metadata - tracks are re-resolved when loading a release
    const cacheValid = cachedData &&
                      (now - cachedData.timestamp) < CACHE_TTL.artistData;

    // Also check if artist image is in cache
    const normalizedName = artistName.trim().toLowerCase();
    const cachedImage = artistImageCache.current[normalizedName];
    const imageCacheValid = cachedImage && (now - cachedImage.timestamp) < CACHE_TTL.artistImage;

    if (cacheValid) {
      console.log('📦 Using cached artist data for:', artistName);

      // Set artist image immediately from cache if available
      if (imageCacheValid) {
        console.log('📦 Using cached artist image for:', artistName);
        setArtistImage(cachedImage.url);
        setArtistImagePosition(cachedImage.facePosition || 'center 25%');
      } else {
        // Clear image and fetch fresh
        setArtistImage(null);
        setArtistImagePosition('center 25%');
        getArtistImage(artistName).then(result => {
          if (result) {
            setArtistImage(result.url);
            setArtistImagePosition(result.facePosition || 'center 25%');
          }
        });
      }

      setCurrentArtist(cachedData.artist);

      // Pre-populate releases with cached album art
      const releasesWithCache = cachedData.releases.map(release => ({
        ...release,
        albumArt: albumArtCache.current[release.id]?.url || null
      }));

      setArtistReleases(releasesWithCache);
      setSmartReleaseTypeFilter(releasesWithCache);
      setLoadingArtist(false);
      navigateTo('artist');

      // Still fetch album art in background for any missing covers
      fetchAlbumArtLazy(cachedData.releases);
      return;
    }

    // No valid cache - clear state and show loading
    setLoadingArtist(true);
    setArtistImage(null);
    setArtistImagePosition('center 25%');
    navigateTo('artist');

    if (cachedData && cachedData.resolverHash !== currentResolverHash) {
      console.log('🔄 Resolver settings changed, invalidating cache for:', artistName);
    }

    console.log('🌐 Fetching fresh artist data from MusicBrainz...');

    try {
      // Step 1: Search for artist by name to get MBID
      // Helper function to fetch with retry on rate limit
      const fetchWithRetry = async (url, maxRetries = 3) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }
          });

          if (response.ok) {
            return response;
          }

          if (response.status === 503 || response.status === 429) {
            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
            console.log(`Rate limited (${response.status}), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            // Non-retryable error
            return response;
          }
        }
        // Return last response after all retries exhausted
        return fetch(url, {
          headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }
        });
      };

      const searchResponse = await fetchWithRetry(
        `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(artistName)}&fmt=json&limit=1`
      );

      if (!searchResponse.ok) {
        console.error('Artist search failed:', searchResponse.status);
        if (searchResponse.status === 503 || searchResponse.status === 429) {
          showConfirmDialog({
            type: 'error',
            title: 'Service Busy',
            message: 'MusicBrainz is temporarily unavailable. Please try again in a few seconds.'
          });
        }
        setLoadingArtist(false);
        return;
      }
      
      const searchData = await searchResponse.json();
      
      if (!searchData.artists || searchData.artists.length === 0) {
        console.log('Artist not found');
        showConfirmDialog({
          type: 'info',
          title: 'Artist Not Found',
          message: `"${artistName}" was not found in MusicBrainz`
        });
        setLoadingArtist(false);
        return;
      }
      
      const artist = searchData.artists[0];
      console.log('Found artist:', artist.name, 'MBID:', artist.id);

      // Set artist name immediately so header shows while releases load
      setCurrentArtist({
        name: artist.name,
        mbid: artist.id,
        country: artist.country,
        disambiguation: artist.disambiguation,
        type: artist.type
      });

      // Start fetching artist image early (non-blocking)
      getArtistImage(artistName).then(result => {
        if (result) {
          setArtistImage(result.url);
          setArtistImagePosition(result.facePosition || 'center 25%');
        }
      });

      // Step 2: Fetch artist's release-groups (albums, EPs, singles) with staggered requests
      // Using release-groups instead of releases to avoid duplicates (each album appears once)
      // MusicBrainz rate limits to ~1 req/sec, so we stagger by 500ms to stay under limit
      const releaseTypes = ['album', 'ep', 'single'];

      const releasePromises = releaseTypes.map(async (type, index) => {
        // Stagger requests by 500ms each to avoid rate limiting
        if (index > 0) {
          await new Promise(resolve => setTimeout(resolve, index * 500));
        }
        try {
          const releasesResponse = await fetchWithRetry(
            `https://musicbrainz.org/ws/2/release-group?artist=${artist.id}&type=${type}&fmt=json&limit=100`
          );

          if (releasesResponse.ok) {
            const releasesData = await releasesResponse.json();
            if (releasesData['release-groups']) {
              return releasesData['release-groups'].map(rg => {
                // Determine release type based on primary-type and secondary-types
                const primaryType = (rg['primary-type'] || '').toLowerCase();
                const secondaryTypes = (rg['secondary-types'] || []).map(t => t.toLowerCase());

                // Categorize: studio album, live, compilation, or the primary type (ep/single)
                let releaseType = primaryType || type;
                if (secondaryTypes.includes('live')) {
                  releaseType = 'live';
                } else if (secondaryTypes.includes('compilation')) {
                  releaseType = 'compilation';
                } else if (primaryType === 'album' && secondaryTypes.length === 0) {
                  releaseType = 'album'; // Studio album (no secondary types)
                }

                return {
                  id: rg.id,
                  title: rg.title,
                  date: rg['first-release-date'] || null,
                  releaseType: releaseType,
                  secondaryTypes: secondaryTypes,
                  disambiguation: rg.disambiguation
                };
              });
            }
          }
          return [];
        } catch (error) {
          console.error(`Error fetching ${type} release-groups:`, error);
          return [];
        }
      });

      const releaseResults = await Promise.all(releasePromises);
      const allReleases = releaseResults.flat();

      console.log(`Found ${allReleases.length} release-groups for ${artist.name}`);

      // Sort by date (newest first)
      const uniqueReleases = [...allReleases].sort((a, b) => {
        const dateA = a.date || '0000';
        const dateB = b.date || '0000';
        return dateB.localeCompare(dateA);
      });
      
      const artistData = {
        name: artist.name,
        mbid: artist.id,
        country: artist.country,
        disambiguation: artist.disambiguation,
        type: artist.type
      };

      // Cache the artist data (version 2: release-group categorization)
      artistDataCache.current[cacheKey] = {
        artist: artistData,
        releases: uniqueReleases,
        timestamp: Date.now(),
        cacheVersion: 2
      };
      console.log('💾 Cached artist data for:', artistName);

      // Pre-populate releases with cached album art
      const releasesWithCache = uniqueReleases.map(release => ({
        ...release,
        albumArt: albumArtCache.current[release.id]?.url || null
      }));

      // Show page immediately (with cached album art if available)
      setArtistReleases(releasesWithCache);
      setSmartReleaseTypeFilter(releasesWithCache);
      setLoadingArtist(false);

      // Fetch album art in background (lazy loading) - only for releases without cache
      fetchAlbumArtLazy(uniqueReleases);
      
    } catch (error) {
      console.error('Error fetching artist data:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Load Failed',
        message: 'Failed to load artist data. Please try again.'
      });
      setLoadingArtist(false);
    }
  };

  // Fetch release data (album/EP/single) with full track listing
  const fetchReleaseData = async (release, artist) => {
    setLoadingRelease(true);
    setCurrentRelease(null);
    // Collapse header smoothly when opening a release
    setIsHeaderCollapsed(true);

    // Helper to fetch with retry on rate limiting
    const fetchWithRetry = async (url, options, maxRetries = 3) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const response = await fetch(url, options);
        if (response.status === 503 || response.status === 429) {
          // Rate limited - wait and retry
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.log(`Rate limited, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return response;
      }
      // Final attempt
      return fetch(url, options);
    };

    try {
      console.log('Fetching release data for:', release.title);

      // Try fetching as a direct release ID first (for artist discography)
      let releaseId = release.id;
      let releaseDetailsResponse = await fetchWithRetry(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );

      // If that fails (404), it might be a release-group ID (from search)
      // Try converting release-group to release ID
      if (!releaseDetailsResponse.ok && releaseDetailsResponse.status === 404) {
        console.log('Not a release ID, trying as release-group...');

        const releaseGroupResponse = await fetchWithRetry(
          `https://musicbrainz.org/ws/2/release?release-group=${release.id}&status=official&fmt=json&limit=1`,
          { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
        );

        if (!releaseGroupResponse.ok) {
          throw new Error(`Failed to fetch release or release-group (HTTP ${releaseGroupResponse.status})`);
        }

        const releaseGroupData = await releaseGroupResponse.json();

        if (!releaseGroupData.releases || releaseGroupData.releases.length === 0) {
          throw new Error('No official releases found for this release-group');
        }

        // Use the first official release ID
        releaseId = releaseGroupData.releases[0].id;
        console.log('Converted release-group to release ID:', releaseId);

        // Fetch again with the converted ID
        releaseDetailsResponse = await fetchWithRetry(
          `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`,
          { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
        );
      }

      if (!releaseDetailsResponse.ok) {
        throw new Error('Release not found');
      }

      const releaseData = await releaseDetailsResponse.json();
      
      // Extract track listing from media
      const tracks = [];
      if (releaseData.media && releaseData.media.length > 0) {
        releaseData.media.forEach((medium, mediumIndex) => {
          if (medium.tracks) {
            medium.tracks.forEach(track => {
              tracks.push({
                position: track.position,
                title: track.title || track.recording?.title || 'Unknown Track',
                length: track.length,
                recording: track.recording,
                mediumIndex: mediumIndex + 1,
                mediumTitle: medium.title
              });
            });
          }
        });
      }
      
      // Try to fetch album art
      let albumArt = null;
      try {
        const artResponse = await fetch(
          `https://coverartarchive.org/release/${releaseId}`,
          { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
        );
        
        if (artResponse.ok) {
          const artData = await artResponse.json();
          const frontCover = artData.images.find(img => img.front);
          if (frontCover) {
            albumArt = frontCover.thumbnails?.['500'] || frontCover.image;
          }
        }
      } catch (error) {
        console.log('No album art found');
      }
      
      const releaseInfo = {
        id: releaseData.id,
        title: releaseData.title,
        artist: artist,
        date: releaseData.date || release.date,
        releaseType: release.releaseType,
        tracks: tracks,
        albumArt: albumArt,
        barcode: releaseData.barcode,
        country: releaseData.country,
        label: releaseData['label-info']?.[0]?.label?.name
      };
      
      console.log('Release data loaded:', tracks.length, 'tracks');
      setCurrentRelease(releaseInfo);
      setLoadingRelease(false);
      
      // Start resolving tracks in background
      resolveAllTracks(releaseInfo, artist.name);
      
    } catch (error) {
      console.error('Error fetching release data:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Load Failed',
        message: 'Failed to load release data. Please try again.'
      });
      setLoadingRelease(false);
    }
  };

  // Prefetch release tracks on hover (for context menu "Add All to Queue")
  const prefetchReleaseTracks = async (release, artist) => {
    // Skip if already prefetched or currently loaded
    if (prefetchedReleases[release.id] || currentRelease?.id === release.id) {
      return;
    }

    try {
      console.log('🔍 Prefetching tracks for:', release.title);

      // Try fetching as a direct release ID first
      let releaseId = release.id;
      let releaseDetailsResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );

      // If that fails (404), it might be a release-group ID
      if (!releaseDetailsResponse.ok && releaseDetailsResponse.status === 404) {
        const releaseGroupResponse = await fetch(
          `https://musicbrainz.org/ws/2/release?release-group=${release.id}&status=official&fmt=json&limit=1`,
          { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
        );

        if (!releaseGroupResponse.ok) return;

        const releaseGroupData = await releaseGroupResponse.json();
        if (!releaseGroupData.releases || releaseGroupData.releases.length === 0) return;

        releaseId = releaseGroupData.releases[0].id;
        releaseDetailsResponse = await fetch(
          `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`,
          { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
        );
      }

      if (!releaseDetailsResponse.ok) return;

      const releaseData = await releaseDetailsResponse.json();

      // Extract tracks
      const tracks = [];
      if (releaseData.media && releaseData.media.length > 0) {
        releaseData.media.forEach((medium) => {
          if (medium.tracks) {
            medium.tracks.forEach(track => {
              const trackId = `${artist?.name || 'unknown'}-${track.title || 'untitled'}-${release.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
              tracks.push({
                id: trackId,
                position: track.position,
                title: track.title || track.recording?.title || 'Unknown Track',
                length: track.length,
                recordingId: track.recording?.id,
                artist: artist?.name,
                album: release.title,
                albumArt: release.albumArt,
                sources: {}
              });
            });
          }
        });
      }

      // Cache the prefetched tracks
      setPrefetchedReleases(prev => ({
        ...prev,
        [release.id]: {
          tracks,
          title: release.title,
          albumArt: release.albumArt,
          artist: artist?.name
        }
      }));

      console.log(`✅ Prefetched ${tracks.length} tracks for ${release.title}`);
    } catch (error) {
      console.error('Error prefetching release tracks:', error);
    }
  };

  // Prefetch search album tracks on hover (for context menu "Add All to Queue")
  const prefetchSearchAlbumTracks = (album) => {
    // Skip if already prefetched or in progress (use module-level Set to avoid stale closure)
    if (prefetchedReleasesRef.current[album.id] || prefetchInProgress.has(album.id)) {
      return;
    }

    // Mark as in progress SYNCHRONOUSLY before any async work
    prefetchInProgress.add(album.id);

    // Run the actual fetch asynchronously
    (async () => {
    try {
      const artistName = album['artist-credit']?.[0]?.name || 'Unknown Artist';

      // Search albums use release-group IDs, so fetch the first release from the group
      const releaseGroupResponse = await fetch(
        `https://musicbrainz.org/ws/2/release?release-group=${album.id}&status=official&fmt=json&limit=1`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );

      if (!releaseGroupResponse.ok) return;

      const releaseGroupData = await releaseGroupResponse.json();
      if (!releaseGroupData.releases || releaseGroupData.releases.length === 0) return;

      const releaseId = releaseGroupData.releases[0].id;

      // Fetch the release details with tracks
      const releaseDetailsResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );

      if (!releaseDetailsResponse.ok) return;

      const releaseData = await releaseDetailsResponse.json();

      // Extract tracks
      const tracks = [];
      if (releaseData.media && releaseData.media.length > 0) {
        releaseData.media.forEach((medium) => {
          if (medium.tracks) {
            medium.tracks.forEach(track => {
              const trackId = `${artistName}-${track.title || 'untitled'}-${album.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
              // Get album art - could be on album.albumArt (quick search) or in searchAlbumArt state (detail view)
              const albumArt = album.albumArt || (typeof searchAlbumArt !== 'undefined' ? searchAlbumArt[album.id] : null) || null;
              tracks.push({
                id: trackId,
                position: track.position,
                title: track.title || track.recording?.title || 'Unknown Track',
                length: track.length,
                recordingId: track.recording?.id,
                artist: artistName,
                album: album.title,
                albumArt: albumArt,
                sources: {}
              });
            });
          }
        });
      }

      // Get album art - could be on album.albumArt (quick search) or in searchAlbumArt state (detail view)
      const cachedAlbumArt = album.albumArt || (typeof searchAlbumArt !== 'undefined' ? searchAlbumArt[album.id] : null) || null;

      // Cache the prefetched tracks using the release-group ID
      setPrefetchedReleases(prev => ({
        ...prev,
        [album.id]: {
          tracks,
          title: album.title,
          albumArt: cachedAlbumArt,
          artist: artistName
        }
      }));

    } catch (error) {
      // Silently fail - prefetch is optional optimization
    } finally {
      // Remove from in-progress set
      prefetchInProgress.delete(album.id);
    }
    })();
  };

  // Handle album click from search - fetch release data by release-group ID
  const handleAlbumClick = async (album) => {
    try {
      console.log('Fetching album from search:', album.title);

      // Get artist name from album
      const artistName = album['artist-credit']?.[0]?.name || 'Unknown Artist';

      // Create artist object
      const artist = {
        name: artistName,
        id: album['artist-credit']?.[0]?.artist?.id || null
      };

      // Mark that we're opening a release so header stays collapsed when artist changes
      openingReleaseRef.current = true;

      // Set artist context
      setCurrentArtist(artist);

      // Check for cached artist image first for instant display
      const normalizedName = artistName.trim().toLowerCase();
      const cachedImage = artistImageCache.current[normalizedName];
      const now = Date.now();
      const imageCacheValid = cachedImage && (now - cachedImage.timestamp) < CACHE_TTL.artistImage;

      if (imageCacheValid) {
        setArtistImage(cachedImage.url);
        setArtistImagePosition(cachedImage.facePosition || 'center 25%');
      } else {
        // Fetch artist image (don't clear current image to avoid gray flash)
        getArtistImage(artistName).then(result => {
          if (result) {
            setArtistImage(result.url);
            setArtistImagePosition(result.facePosition || 'center 25%');
          }
        });
      }

      // Start loading release FIRST (sets loadingRelease=true), then navigate
      // This prevents the header from flashing because loadingRelease=true hides it
      fetchReleaseData({
        id: album.id,
        title: album.title,
        releaseType: album['primary-type']?.toLowerCase() || 'album'
      }, artist);
      navigateTo('artist');
    } catch (error) {
      console.error('Error fetching album from search:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Load Failed',
        message: 'Failed to load album. Please try again.'
      });
    }
  };

  // Handle playlist click from search
  const handlePlaylistClick = (playlist) => {
    loadPlaylist(playlist);
  };

  // Handle collection album click - search and navigate to album page
  const handleCollectionAlbumClick = async (album) => {
    try {
      console.log('Loading collection album:', album.title, 'by', album.artist);

      // Show loading state immediately - set artist and navigate before search
      const artist = {
        name: album.artist,
        id: null
      };

      openingReleaseRef.current = true;
      setCurrentArtist(artist);
      setLoadingRelease(true);

      // Load artist image from cache if available
      const normalizedName = album.artist.trim().toLowerCase();
      const cachedImage = artistImageCache.current[normalizedName];
      const now = Date.now();
      const imageCacheValid = cachedImage && (now - cachedImage.timestamp) < CACHE_TTL.artistImage;

      if (imageCacheValid) {
        setArtistImage(cachedImage.url);
        setArtistImagePosition(cachedImage.facePosition || 'center 25%');
      } else {
        getArtistImage(album.artist).then(result => {
          if (result) {
            setArtistImage(result.url);
            setArtistImagePosition(result.facePosition || 'center 25%');
          }
        });
      }

      navigateTo('artist');

      // Search MusicBrainz for the album
      const searchQuery = encodeURIComponent(`${album.artist} ${album.title}`);
      const response = await fetch(
        `https://musicbrainz.org/ws/2/release-group?query=${searchQuery}&limit=5&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/0.1 (https://parachord.com)' } }
      );

      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      const results = data['release-groups'] || [];

      if (results.length === 0) {
        showToast('Album not found');
        setLoadingRelease(false);
        return;
      }

      // Find best match (prefer exact artist match)
      const match = results.find(r =>
        r['artist-credit']?.[0]?.name?.toLowerCase() === album.artist?.toLowerCase()
      ) || results[0];

      // Fetch release data (don't call handleAlbumClick to avoid duplicate state setting)
      fetchReleaseData({
        id: match.id,
        title: match.title,
        releaseType: match['primary-type']?.toLowerCase() || 'album'
      }, artist);
    } catch (error) {
      console.error('Error loading collection album:', error);
      showToast('Failed to load album');
      setLoadingRelease(false);
    }
  };

  // Validate cached sources in background and update if changed
  const validateCachedSources = async (track, artistName, cachedSources, cacheKey, trackKey) => {
    console.log(`🔍 Validating cached sources for: ${track.title}`);

    const freshSources = {};

    // Query enabled resolvers in priority order
    const enabledResolvers = resolverOrder
      .filter(id => activeResolvers.includes(id))
      .map(id => allResolvers.find(r => r.id === id))
      .filter(Boolean);

    const resolverPromises = enabledResolvers.map(async (resolver) => {
      // Skip resolvers that can't resolve or can't play (no point resolving if we can't play)
      if (!resolver.capabilities.resolve || !resolver.play) return;

      try {
        const config = await getResolverConfig(resolver.id);
        const result = await resolver.resolve(artistName, track.title, null, config);

        if (result) {
          freshSources[resolver.id] = {
            ...result,
            confidence: calculateConfidence(track, result)
          };
        }
      } catch (error) {
        console.error(`  ❌ ${resolver.name} validation error:`, error);
      }
    });

    await Promise.all(resolverPromises);

    // Compare with cached sources
    const cachedResolverIds = Object.keys(cachedSources).sort();
    const freshResolverIds = Object.keys(freshSources).sort();
    const sourcesChanged = JSON.stringify(cachedResolverIds) !== JSON.stringify(freshResolverIds);

    if (sourcesChanged) {
      console.log(`⚠️ Sources changed for: ${track.title}`);
      console.log(`  Old: ${cachedResolverIds.join(', ') || 'none'}`);
      console.log(`  New: ${freshResolverIds.join(', ') || 'none'}`);

      // Update cache with fresh data
      if (Object.keys(freshSources).length > 0) {
        trackSourcesCache.current[cacheKey] = {
          sources: freshSources,
          timestamp: Date.now(),
          resolverHash: getResolverSettingsHash()
        };

        // Update UI with fresh sources
        setTrackSources(prev => ({
          ...prev,
          [trackKey]: freshSources
        }));

        console.log(`✅ Cache updated with ${Object.keys(freshSources).length} fresh source(s)`);
      } else {
        // No sources found - invalidate cache
        delete trackSourcesCache.current[cacheKey];
        console.log(`❌ No sources found - cache invalidated`);
      }
    } else {
      console.log(`✅ Sources still valid, refreshing timestamp`);
      // Sources unchanged, just refresh timestamp and resolver hash
      trackSourcesCache.current[cacheKey].timestamp = Date.now();
      trackSourcesCache.current[cacheKey].resolverHash = getResolverSettingsHash();
    }
  };

  // Resolve a single track across all active resolvers
  // isQueueResolution: when true, this is a priority queue resolution that won't yield
  const resolveTrack = async (track, artistName, forceRefresh = false, isQueueResolution = false) => {
    const trackKey = `${track.position}-${track.title}`;
    const cacheKey = `${artistName.toLowerCase()}|${track.title.toLowerCase()}|${track.position}`;
    const currentResolverHash = getResolverSettingsHash();

    // If this is a page resolution and queue resolution is active, skip to let queue take priority
    if (!isQueueResolution && queueResolutionActiveRef.current) {
      console.log(`⏸️ Yielding page resolution for "${track.title}" - queue resolution has priority`);
      return;
    }

    // Check cache first (unless force refresh)
    const cachedData = trackSourcesCache.current[cacheKey];
    const now = Date.now();

    // Cache is valid if:
    // 1. Not forcing refresh
    // 2. Data exists and not expired
    // 3. Resolver settings haven't changed
    const cacheValid = !forceRefresh &&
                      cachedData &&
                      (now - cachedData.timestamp) < CACHE_TTL.trackSources &&
                      cachedData.resolverHash === currentResolverHash;

    // Check if there are active resolvers that weren't queried in the cached data
    const cachedResolverIds = cachedData ? Object.keys(cachedData.sources) : [];
    const missingResolvers = activeResolvers.filter(id =>
      !cachedResolverIds.includes(id) &&
      allResolvers.find(r => r.id === id)?.capabilities?.resolve
    );

    if (cachedData) {
      console.log(`  🔍 Cache check for "${track.title}": hash match=${cachedData.resolverHash === currentResolverHash}, missing resolvers: ${missingResolvers.join(', ') || 'none'}`);
    }

    if (cacheValid && missingResolvers.length === 0) {
      const cacheAge = Math.floor((now - cachedData.timestamp) / (1000 * 60 * 60)); // hours
      console.log(`📦 Using cached sources for: ${track.title} (age: ${cacheAge}h, sources: ${Object.keys(cachedData.sources).join(', ')})`);

      // Use cached sources immediately for fast UI
      setTrackSources(prev => ({
        ...prev,
        [trackKey]: cachedData.sources
      }));

      // Background validation: if cache is > 24 hours old, validate in background
      if (cacheAge >= 24) {
        console.log(`🔄 Cache > 24h old, validating in background...`);
        setTimeout(() => validateCachedSources(track, artistName, cachedData.sources, cacheKey, trackKey), 1000);
      }

      return;
    }

    // If cache is valid but missing resolvers, query only the missing ones
    if (cacheValid && missingResolvers.length > 0) {
      console.log(`🔍 Cache valid but missing ${missingResolvers.length} resolver(s), querying: ${missingResolvers.join(', ')}`);

      // Start with cached sources
      const sources = { ...cachedData.sources };

      // Query only missing resolvers
      const missingResolverInstances = missingResolvers
        .map(id => allResolvers.find(r => r.id === id))
        .filter(Boolean);

      const resolverPromises = missingResolverInstances.map(async (resolver) => {
        if (!resolver.capabilities.resolve || !resolver.play) return;

        try {
          const config = await getResolverConfig(resolver.id);
          console.log(`  🔎 Trying ${resolver.id}...`);
          const result = await resolver.resolve(artistName, track.title, null, config);

          if (result) {
            sources[resolver.id] = {
              ...result,
              confidence: calculateConfidence(track, result)
            };
            console.log(`  ✅ ${resolver.name}: Found match (confidence: ${(sources[resolver.id].confidence * 100).toFixed(0)}%)`);
            if (resolver.id === 'localfiles') {
              console.log(`  📁 LocalFiles source structure:`, JSON.stringify(sources[resolver.id], null, 2));
            }
          } else {
            console.log(`  ⚪ ${resolver.name}: No match found`);
          }
        } catch (error) {
          console.error(`  ❌ ${resolver.name} resolve error:`, error);
        }
      });

      await Promise.all(resolverPromises);

      // Update state with combined sources
      setTrackSources(prev => ({
        ...prev,
        [trackKey]: sources
      }));

      // Update cache with new sources
      trackSourcesCache.current[cacheKey] = {
        sources: sources,
        timestamp: Date.now(),
        resolverHash: getResolverSettingsHash()
      };

      return;
    }

    if (cachedData && cachedData.resolverHash !== currentResolverHash) {
      console.log(`🔄 Resolver settings changed, re-resolving: ${track.title}`);
    }

    console.log(`🔍 Resolving: ${artistName} - ${track.title}${forceRefresh ? ' (forced refresh)' : ''}`);

    const sources = {};

    // Query enabled resolvers in priority order
    const enabledResolvers = resolverOrder
      .filter(id => activeResolvers.includes(id))
      .map(id => allResolvers.find(r => r.id === id))
      .filter(Boolean);

    console.log(`  📋 Active resolvers: ${activeResolvers.join(', ')}`);
    console.log(`  📋 Resolver order: ${resolverOrder.join(', ')}`);
    console.log(`  📋 Enabled resolvers: ${enabledResolvers.map(r => r.id).join(', ')}`);

    const resolverPromises = enabledResolvers.map(async (resolver) => {
      // Skip resolvers that can't resolve or can't play (no point resolving if we can't play)
      if (!resolver.capabilities.resolve || !resolver.play) {
        console.log(`  ⏭️ Skipping ${resolver.id}: resolve=${resolver.capabilities.resolve}, play=${!!resolver.play}`);
        return;
      }

      try {
        const config = await getResolverConfig(resolver.id);
        console.log(`  🔎 Trying ${resolver.id}...`);
        const result = await resolver.resolve(artistName, track.title, null, config);

        if (result) {
          sources[resolver.id] = {
            ...result,
            confidence: calculateConfidence(track, result)
          };
          console.log(`  ✅ ${resolver.name}: Found match (confidence: ${(sources[resolver.id].confidence * 100).toFixed(0)}%)`);
        } else {
          console.log(`  ⚪ ${resolver.name}: No match found`);
        }
      } catch (error) {
        console.error(`  ❌ ${resolver.name} resolve error:`, error);
      }
    });

    // Wait for all resolvers to complete
    await Promise.all(resolverPromises);

    // Update state with found sources
    if (Object.keys(sources).length > 0) {
      setTrackSources(prev => ({
        ...prev,
        [trackKey]: sources
      }));

      // Cache the resolved sources with resolver settings hash
      trackSourcesCache.current[cacheKey] = {
        sources: sources,
        timestamp: Date.now(),
        resolverHash: getResolverSettingsHash()
      };

      console.log(`✅ Found ${Object.keys(sources).length} source(s) for: ${track.title} (cached)`);
    }
  };
  
  // Calculate confidence score for a match (0-1)
  const calculateConfidence = (originalTrack, foundTrack) => {
    // If the resolver already provided a confidence score, use it
    if (foundTrack.confidence && typeof foundTrack.confidence === 'number') {
      return foundTrack.confidence;
    }

    // Otherwise calculate based on title and duration match
    const originalTitle = originalTrack.title?.toLowerCase() || '';
    const foundTitle = foundTrack.title?.toLowerCase() || '';
    const titleMatch = originalTitle && foundTitle && originalTitle === foundTitle;
    const durationMatch = originalTrack.length && foundTrack.duration
      ? Math.abs(originalTrack.length / 1000 - foundTrack.duration) < 10 // Within 10 seconds
      : false;

    if (titleMatch && durationMatch) return 0.95;
    if (titleMatch) return 0.85;
    if (durationMatch) return 0.70;
    return 0.50;
  };

  // Resolve all tracks in a release
  const resolveAllTracks = async (release, artistName, forceRefresh = false) => {
    console.log(`🔍 Starting resolution for ${release.tracks.length} tracks...${forceRefresh ? ' (force refresh)' : ''}`);

    // Clear previous track sources only if force refresh
    if (forceRefresh) {
      setTrackSources({});
    }

    // Resolve tracks one at a time with small delay
    for (const track of release.tracks) {
      // Check if queue resolution has priority - if so, pause page resolution
      if (queueResolutionActiveRef.current) {
        console.log(`⏸️ Pausing page resolution - queue resolution has priority`);
        // Wait for queue resolution to complete before continuing
        while (queueResolutionActiveRef.current) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log(`▶️ Resuming page resolution`);
      }

      await resolveTrack(track, artistName, forceRefresh);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('✅ Track resolution complete');
  };

  // Resolve queue tracks with priority over page resolution
  // This ensures queue tracks get resolved first when user adds tracks to queue
  const resolveQueueTracks = async (queueTracks) => {
    if (!queueTracks || queueTracks.length === 0) return;

    // Filter to tracks that need resolution (no sources or empty sources)
    const tracksNeedingResolution = queueTracks.filter(track =>
      !track.sources || Object.keys(track.sources).length === 0
    );

    if (tracksNeedingResolution.length === 0) {
      console.log('✅ All queue tracks already have sources');
      return;
    }

    console.log(`🎯 Queue resolution: ${tracksNeedingResolution.length} tracks need sources (priority mode)`);

    // Set priority flag to pause page resolution
    queueResolutionActiveRef.current = true;

    try {
      // Get enabled resolvers
      const enabledResolvers = resolverOrder
        .filter(id => activeResolvers.includes(id))
        .map(id => allResolvers.find(r => r.id === id))
        .filter(Boolean);

      if (enabledResolvers.length === 0) {
        console.log('⚠️ No active resolvers for queue resolution');
        return;
      }

      // Resolve each queue track
      for (const track of tracksNeedingResolution) {
        const artistName = track.artist || 'Unknown Artist';
        const sources = {};

        console.log(`🎯 Queue resolving: ${artistName} - ${track.title}`);

        // Query all resolvers in parallel
        const resolverPromises = enabledResolvers.map(async (resolver) => {
          if (!resolver.capabilities?.resolve || !resolver.play) return;

          try {
            const config = await getResolverConfig(resolver.id);
            const result = await resolver.resolve(artistName, track.title, track.album || null, config);

            if (result) {
              sources[resolver.id] = {
                ...result,
                confidence: typeof result.confidence === 'number' ? result.confidence : 0.85
              };
              console.log(`  ✅ ${resolver.name}: Found match for queue track`);
            }
          } catch (error) {
            console.error(`  ❌ ${resolver.name} queue resolve error:`, error);
          }
        });

        await Promise.all(resolverPromises);

        // Update the queue track with resolved sources
        if (Object.keys(sources).length > 0) {
          setCurrentQueue(prevQueue =>
            prevQueue.map(queueTrack =>
              queueTrack.id === track.id
                ? { ...queueTrack, sources: { ...queueTrack.sources, ...sources } }
                : queueTrack
            )
          );
          console.log(`✅ Queue track resolved: ${track.title} (${Object.keys(sources).length} sources)`);
        }

        // Small delay between tracks to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      console.log('✅ Queue resolution complete');
    } finally {
      // Always clear priority flag
      queueResolutionActiveRef.current = false;
    }
  };

  // Resolve library tracks against active resolvers (for local files)
  const resolveLibraryTracks = async () => {
    if (!library || library.length === 0) return;
    if (!allResolvers || allResolvers.length === 0) return;
    if (!activeResolvers || activeResolvers.length === 0) return;

    console.log(`🔍 Resolving ${library.length} library tracks against active resolvers...`);

    // Get enabled resolvers (excluding localfiles since tracks already have that source)
    const enabledResolvers = resolverOrder
      .filter(id => activeResolvers.includes(id) && id !== 'localfiles')
      .map(id => allResolvers.find(r => r.id === id))
      .filter(Boolean);

    if (enabledResolvers.length === 0) {
      console.log('📚 No external resolvers active, skipping library resolution');
      return;
    }

    // Take a snapshot of current library to avoid stale closure issues
    const librarySnapshot = [...library];
    const updatedSources = {}; // Map of filePath -> sources

    // Mark all tracks that need resolving as "resolving"
    const tracksToResolve = librarySnapshot.filter(track => {
      const existingSources = track.sources || {};
      return !Object.keys(existingSources).some(id => id !== 'localfiles');
    });

    if (tracksToResolve.length > 0) {
      setResolvingLibraryTracks(new Set(tracksToResolve.map(t => t.filePath || t.id)));
    }

    // Resolve tracks one at a time with delay to avoid rate limiting
    for (let i = 0; i < librarySnapshot.length; i++) {
      const track = librarySnapshot[i];
      const trackKey = track.filePath || track.id;
      const artistName = track.artist || 'Unknown Artist';

      // Skip if track already has sources from external resolvers
      const existingSources = track.sources || {};
      const hasExternalSources = Object.keys(existingSources).some(id => id !== 'localfiles');
      if (hasExternalSources) continue;

      const sources = { ...existingSources };

      // Query enabled resolvers
      const resolverPromises = enabledResolvers.map(async (resolver) => {
        if (!resolver.capabilities?.resolve || !resolver.play) return;

        try {
          const config = await getResolverConfig(resolver.id);
          const result = await resolver.resolve(artistName, track.title, null, config);

          if (result) {
            const confidence = calculateLibraryConfidence(track, result);
            sources[resolver.id] = {
              ...result,
              confidence
            };
            console.log(`  ✅ ${resolver.name}: Found match for "${track.title}" (${(confidence * 100).toFixed(0)}%)`);
          }
        } catch (error) {
          // Silently ignore resolver errors for library tracks
        }
      });

      await Promise.all(resolverPromises);

      // Store updated sources if we found new ones
      const hasNewSources = Object.keys(sources).length > Object.keys(existingSources).length;
      if (hasNewSources) {
        updatedSources[trackKey] = sources;

        // Update library immediately for this track, THEN remove from resolving set
        // This ensures we go directly from "resolving" to "has sources" with no gap
        setLibrary(prev => prev.map(t => {
          const tKey = t.filePath || t.id;
          if (tKey === trackKey) {
            return { ...t, sources: sources };
          }
          return t;
        }));
      }

      // Mark this track as done resolving (after library update if there were new sources)
      setResolvingLibraryTracks(prev => {
        const next = new Set(prev);
        next.delete(trackKey);
        return next;
      });

      // Small delay between tracks to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Clear any remaining resolving state
    setResolvingLibraryTracks(new Set());

    console.log('✅ Library track resolution complete');
  };

  // Calculate confidence for library track matches
  const calculateLibraryConfidence = (originalTrack, foundTrack) => {
    const titleMatch = originalTrack.title?.toLowerCase() === foundTrack.title?.toLowerCase();
    const artistMatch = originalTrack.artist?.toLowerCase() === foundTrack.artist?.toLowerCase();
    const durationMatch = originalTrack.duration && foundTrack.duration
      ? Math.abs(originalTrack.duration - foundTrack.duration) < 10
      : false;

    if (titleMatch && artistMatch && durationMatch) return 0.98;
    if (titleMatch && artistMatch) return 0.90;
    if (titleMatch && durationMatch) return 0.85;
    if (titleMatch) return 0.75;
    return 0.50;
  };

  // Fetch album art suggestions from MusicBrainz/Cover Art Archive
  const fetchAlbumArtSuggestions = async (artist, album) => {
    if (!artist || !album) {
      setId3ArtSuggestions([]);
      return;
    }

    setId3ArtLoading(true);
    setId3ArtSuggestions([]);

    try {
      // Search MusicBrainz for releases matching artist and album
      const query = encodeURIComponent(`artist:"${artist}" AND release:"${album}"`);
      const searchUrl = `https://musicbrainz.org/ws/2/release?query=${query}&fmt=json&limit=5`;

      console.log('🎨 Searching MusicBrainz for album art:', artist, '-', album);

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Parachord/1.0.0 (https://github.com/parachord)'
        }
      });

      if (!response.ok) {
        throw new Error(`MusicBrainz search failed: ${response.status}`);
      }

      const data = await response.json();
      const releases = data.releases || [];

      console.log(`🎨 Found ${releases.length} releases`);

      // For each release, check if Cover Art Archive has artwork
      const artPromises = releases.slice(0, 5).map(async (release) => {
        try {
          const artUrl = `https://coverartarchive.org/release/${release.id}`;
          const artResponse = await fetch(artUrl, {
            headers: {
              'User-Agent': 'Parachord/1.0.0 (https://github.com/parachord)'
            }
          });

          if (artResponse.ok) {
            const artData = await artResponse.json();
            const frontArt = artData.images?.find(img => img.front) || artData.images?.[0];

            if (frontArt) {
              return {
                releaseId: release.id,
                releaseName: release.title,
                artistName: release['artist-credit']?.[0]?.name || artist,
                year: release.date?.split('-')[0] || '',
                thumbnailUrl: frontArt.thumbnails?.small || frontArt.thumbnails?.['250'] || frontArt.image,
                fullUrl: frontArt.image
              };
            }
          }
          return null;
        } catch (err) {
          // Silently fail for individual releases
          return null;
        }
      });

      const artResults = (await Promise.all(artPromises)).filter(Boolean);
      console.log(`🎨 Found ${artResults.length} releases with artwork`);

      setId3ArtSuggestions(artResults);
    } catch (error) {
      console.error('Error fetching album art suggestions:', error);
      setId3ArtSuggestions([]);
    } finally {
      setId3ArtLoading(false);
    }
  };

  // Auto-fetch album art suggestions when artist or album changes in ID3 editor
  useEffect(() => {
    // Only run when editor is open
    if (!id3EditorOpen) return;

    const artist = id3EditorValues.artist?.trim();
    const album = id3EditorValues.album?.trim();

    // Need both artist and album
    if (!artist || !album) {
      return;
    }

    // Create a key to track what we've already fetched
    const fetchKey = `${artist}|${album}`;
    if (fetchKey === id3ArtFetchKey) {
      return; // Already fetched for this combination
    }

    // Clear selection when search criteria change
    setId3SelectedArt(null);

    // Debounce the fetch
    const timer = setTimeout(() => {
      setId3ArtFetchKey(fetchKey);
      fetchAlbumArtSuggestions(artist, album);
    }, 500);

    return () => clearTimeout(timer);
  }, [id3EditorOpen, id3EditorValues.artist, id3EditorValues.album]);

  // Reset fetch key when editor closes
  useEffect(() => {
    if (!id3EditorOpen) {
      setId3ArtFetchKey('');
    }
  }, [id3EditorOpen]);

  // Effect to resolve library tracks when library or resolvers change
  useEffect(() => {
    if (library.length > 0 && allResolvers.length > 0 && activeResolvers.length > 0) {
      // Delay to let UI render first, then resolve in background
      const timer = setTimeout(() => {
        resolveLibraryTracks();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [library.length, allResolvers.length, activeResolvers.length]);

  // Lazy load album art after page is displayed
  const fetchAlbumArtLazy = async (releases) => {
    console.log('Starting lazy album art loading...');
    let loadedCount = 0;
    let skippedCount = 0;
    
    // Fetch album art one at a time to update UI progressively
    for (const release of releases) {
      // Skip if already in cache
      if (albumArtCache.current[release.id]) {
        skippedCount++;
        continue;
      }
      
      try {
        // Use release-group endpoint since we fetch release-groups, not individual releases
        const artResponse = await fetch(
          `https://coverartarchive.org/release-group/${release.id}`,
          {
            headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }
          }
        );
        
        if (artResponse.ok) {
          const artData = await artResponse.json();
          const frontCover = artData.images.find(img => img.front);
          
          if (frontCover && frontCover.thumbnails && frontCover.thumbnails['250']) {
            const albumArtUrl = frontCover.thumbnails['250'];

            // Store in cache with timestamp
            albumArtCache.current[release.id] = { url: albumArtUrl, timestamp: Date.now() };
            
            // Update just this release with album art
            setArtistReleases(prev => 
              prev.map(r => 
                r.id === release.id 
                  ? { ...r, albumArt: albumArtUrl }
                  : r
              )
            );
            loadedCount++;
          }
        }
      } catch (error) {
        // Silently continue to next release
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Album art: ${loadedCount} loaded, ${skippedCount} from cache, ${releases.length - loadedCount - skippedCount} not found`);

    // Save cache immediately after loading album art so it persists on navigation
    if (loadedCount > 0) {
      saveCacheToStore();
    }
  };

  // Remove a resolver's sources from all track data (trackSources, playlistTracks, queue, library)
  const removeResolverSources = (resolverId) => {
    console.log(`🧹 Removing sources for disabled/uninstalled resolver: ${resolverId}`);

    // Remove from trackSources (release/album view)
    setTrackSources(prev => {
      const updated = {};
      for (const [trackKey, sources] of Object.entries(prev)) {
        const { [resolverId]: removed, ...remainingSources } = sources;
        if (Object.keys(remainingSources).length > 0) {
          updated[trackKey] = remainingSources;
        }
      }
      return updated;
    });

    // Remove from playlistTracks
    setPlaylistTracks(prev =>
      prev.map(track => {
        if (track.sources && track.sources[resolverId]) {
          const { [resolverId]: removed, ...remainingSources } = track.sources;
          return { ...track, sources: remainingSources };
        }
        return track;
      })
    );

    // Remove from currentQueue
    setCurrentQueue(prev =>
      prev.map(track => {
        if (track.sources && track.sources[resolverId]) {
          const { [resolverId]: removed, ...remainingSources } = track.sources;
          return { ...track, sources: remainingSources };
        }
        return track;
      })
    );

    // Remove from library
    setLibrary(prev =>
      prev.map(track => {
        if (track.sources && track.sources[resolverId]) {
          const { [resolverId]: removed, ...remainingSources } = track.sources;
          return { ...track, sources: remainingSources };
        }
        return track;
      })
    );

    // Also clean up the cache
    if (trackSourcesCache.current) {
      for (const [cacheKey, cacheEntry] of Object.entries(trackSourcesCache.current)) {
        if (cacheEntry.sources && cacheEntry.sources[resolverId]) {
          const { [resolverId]: removed, ...remainingSources } = cacheEntry.sources;
          trackSourcesCache.current[cacheKey] = {
            ...cacheEntry,
            sources: remainingSources
          };
        }
      }
    }
  };

  const toggleResolver = (resolverId) => {
    const isCurrentlyActive = activeResolvers.includes(resolverId);

    // If disabling, remove the resolver's sources from all tracks
    if (isCurrentlyActive) {
      removeResolverSources(resolverId);
    }

    setActiveResolvers(prev =>
      prev.includes(resolverId)
        ? prev.filter(id => id !== resolverId)
        : [...prev, resolverId]
    );
  };

  // Drag and drop handlers for resolver reordering
  const handleResolverDragStart = (e, resolverId) => {
    setDraggedResolver(resolverId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target);
  };

  const handleResolverDragOver = (e) => {
    if (e.preventDefault) {
      e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
  };

  const handleResolverDragEnter = (e, resolverId) => {
    e.preventDefault();
    if (draggedResolver && draggedResolver !== resolverId) {
      setDragOverResolver(resolverId);
    }
  };

  const handleResolverDragLeave = (e) => {
    e.preventDefault();
    // Only clear if we're leaving the card entirely (not entering a child)
    const relatedTarget = e.relatedTarget;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverResolver(null);
    }
  };

  const handleResolverDrop = (e, targetResolverId) => {
    if (e.stopPropagation) {
      e.stopPropagation();
    }

    if (draggedResolver !== targetResolverId) {
      const newOrder = [...resolverOrder];
      const draggedIndex = newOrder.indexOf(draggedResolver);
      const targetIndex = newOrder.indexOf(targetResolverId);

      // Remove dragged item and insert at target position
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedResolver);

      setResolverOrder(newOrder);
      console.log('Resolver order updated:', newOrder);
    }

    setDraggedResolver(null);
    setDragOverResolver(null);
    return false;
  };

  const handleResolverDragEnd = () => {
    setDraggedResolver(null);
    setDragOverResolver(null);
  };

  // Install new resolver from .axe file (hot-reload, no restart)
  const handleInstallResolver = async () => {
    if (!window.electron?.resolvers?.pickFile) {
      showConfirmDialog({
        type: 'error',
        title: 'Not Available',
        message: 'File picker not available. Make sure you are running in Electron.'
      });
      return;
    }

    console.log('📦 Opening file picker for resolver...');

    try {
      const result = await window.electron.resolvers.pickFile();

      if (!result) {
        console.log('User cancelled file picker');
        return;
      }

      if (result.error) {
        showConfirmDialog({
          type: 'error',
          title: 'File Error',
          message: result.error
        });
        return;
      }
      
      const { content, filename } = result;
      
      // Parse to validate and get info
      const axe = JSON.parse(content);
      const resolverName = axe.manifest.name;
      const resolverId = axe.manifest.id;
      
      // Check if already installed
      const existing = allResolvers.find(r => r.id === resolverId);
      if (existing) {
        const shouldOverwrite = confirm(
          `Resolver "${resolverName}" (${resolverId}) is already installed.\n\n` +
          `Do you want to overwrite it with the new version?`
        );
        if (!shouldOverwrite) {
          return;
        }
      }
      
      console.log(`Installing resolver: ${resolverName}`);
      
      // Install via IPC
      const installResult = await window.electron.resolvers.install(content, filename);
      
      if (!installResult.success) {
        showConfirmDialog({
          type: 'error',
          title: 'Installation Failed',
          message: installResult.error
        });
        return;
      }
      
      console.log(`✅ Installed ${resolverName}`);
      
      // Hot-reload: Load the new resolver without restarting
      try {
                axe._filename = filename;
        const newResolverInstance = await resolverLoader.current.loadResolver(axe);
        
        if (existing) {
          // Replace existing resolver
          setLoadedResolvers(prev => prev.map(r => 
            r.id === resolverId ? newResolverInstance : r
          ));
          console.log(`🔄 Updated resolver: ${resolverName}`);
          showConfirmDialog({
            type: 'success',
            title: 'Resolver Updated',
            message: resolverName
          });
        } else {
          // Add new resolver
          setLoadedResolvers(prev => [...prev, newResolverInstance]);

          // Add to resolver order
          setResolverOrder(prev => [...prev, resolverId]);

          // Enable by default
          setActiveResolvers(prev => [...prev, resolverId]);

          console.log(`➕ Added resolver: ${resolverName}`);
          showConfirmDialog({
            type: 'success',
            title: 'Resolver Installed',
            message: resolverName
          });
        }
      } catch (error) {
        console.error('Failed to hot-load resolver:', error);
        showConfirmDialog({
          type: 'error',
          title: 'Load Failed',
          message: `Resolver installed but failed to load. Please restart the app.\n\n${error.message}`
        });
      }
    } catch (error) {
      console.error('Error installing resolver:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Installation Error',
        message: error.message
      });
    }
  };

  // Uninstall resolver (permanently delete from disk)
  const handleUninstallResolver = async (resolverId) => {
    console.log('=== handleUninstallResolver called ===');
    console.log('  Resolver ID:', resolverId);
    console.log('  Loaded resolvers count (ref):', loadedResolversRef.current.length);
    console.log('  Loaded resolver IDs (ref):', loadedResolversRef.current.map(r => r.id));

    const resolver = loadedResolversRef.current.find(r => r.id === resolverId);

    if (!resolver) {
      console.error('❌ Resolver not found:', resolverId);
      showConfirmDialog({
        type: 'error',
        title: 'Resolver Not Found',
        message: `Resolver "${resolverId}" not found. This might be a bug.`
      });
      return;
    }

    console.log('  Found resolver:', resolver.name);

    const confirmMessage = `Are you sure you want to uninstall "${resolver.name}"?\n\nThis will permanently remove the resolver from your system.`;

    const shouldUninstall = confirm(confirmMessage);

    if (!shouldUninstall) {
      return;
    }

    console.log(`🗑️ Uninstalling resolver: ${resolver.name}`);

    try {
      // Delete the resolver file from disk
      const result = await window.electron.resolvers.uninstall(resolverId);

      if (!result.success) {
        showConfirmDialog({
          type: 'error',
          title: 'Uninstall Failed',
          message: result.error
        });
        return;
      }

      console.log(`✅ Uninstalled ${resolver.name}`);

      // Remove the resolver's sources from all displayed tracks
      removeResolverSources(resolverId);

      // Hot-reload: Remove from state without restarting
      setLoadedResolvers(prev => prev.filter(r => r.id !== resolverId));
      setResolverOrder(prev => prev.filter(id => id !== resolverId));
      setActiveResolvers(prev => prev.filter(id => id !== resolverId));

      showConfirmDialog({
        type: 'success',
        title: 'Resolver Uninstalled',
        message: resolver.name
      });
    } catch (error) {
      console.error('Error uninstalling resolver:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Uninstall Error',
        message: error.message
      });
    }
  };

  // Marketplace functions
  const loadMarketplaceManifest = async () => {
    if (!window.electron?.resolvers?.getMarketplaceManifest) {
      console.error('Marketplace not available');
      return;
    }

    setMarketplaceLoading(true);

    try {
      const result = await window.electron.resolvers.getMarketplaceManifest();

      if (result.success) {
        setMarketplaceManifest(result.manifest);
        console.log(`✅ Loaded marketplace with ${result.manifest.resolvers.length} resolvers`);
      } else {
        console.error('Failed to load marketplace:', result.error);
        setMarketplaceManifest({ version: '1.0.0', resolvers: [] });
      }
    } catch (error) {
      console.error('Marketplace load error:', error);
      setMarketplaceManifest({ version: '1.0.0', resolvers: [] });
    } finally {
      setMarketplaceLoading(false);
    }
  };

  // Install resolver from marketplace
  const handleInstallFromMarketplace = async (marketplaceResolver) => {
    const { id, name, downloadUrl } = marketplaceResolver;

    // Check if already installing
    if (installingResolvers.has(id)) {
      return;
    }

    setInstallingResolvers(prev => new Set(prev).add(id));

    console.log(`📦 Installing ${name} from marketplace...`);

    try {
      // Download resolver from URL
      const downloadResult = await window.electron.resolvers.downloadResolver(downloadUrl);

      if (!downloadResult.success) {
        showConfirmDialog({
          type: 'error',
          title: 'Download Failed',
          message: `Failed to download ${name}: ${downloadResult.error}`
        });
        return;
      }

      const { content, filename, resolver: axe } = downloadResult;
      const resolverName = axe.manifest.name;
      const resolverId = axe.manifest.id;

      // Check if already installed
      const existing = allResolvers.find(r => r.id === resolverId);
      if (existing) {
        const shouldOverwrite = confirm(
          `Resolver "${resolverName}" is already installed.\n\n` +
          `Installed version: ${existing.version}\n` +
          `Marketplace version: ${axe.manifest.version}\n\n` +
          `Do you want to update it?`
        );
        if (!shouldOverwrite) {
          return;
        }
      }

      // Install via IPC (reuse existing install handler)
      const installResult = await window.electron.resolvers.install(content, filename);

      if (!installResult.success) {
        showConfirmDialog({
          type: 'error',
          title: 'Installation Failed',
          message: `Failed to install ${resolverName}: ${installResult.error}`
        });
        return;
      }

      // Hot-reload
            axe._filename = filename;
      const newResolverInstance = await resolverLoader.current.loadResolver(axe);

      if (existing) {
        setLoadedResolvers(prev => prev.map(r =>
          r.id === resolverId ? newResolverInstance : r
        ));
        showConfirmDialog({
          type: 'success',
          title: 'Resolver Updated',
          message: resolverName
        });
      } else {
        setLoadedResolvers(prev => [...prev, newResolverInstance]);
        setResolverOrder(prev => [...prev, resolverId]);
        setActiveResolvers(prev => [...prev, resolverId]);
        showConfirmDialog({
          type: 'success',
          title: 'Resolver Installed',
          message: resolverName
        });
      }
    } catch (error) {
      console.error('Marketplace install error:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Installation Failed',
        message: error.message
      });
    } finally {
      setInstallingResolvers(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Load marketplace when settings page opens to marketplace tab
  useEffect(() => {
    if (activeView === 'settings' && settingsTab === 'marketplace' && !marketplaceManifest) {
      loadMarketplaceManifest();
    }
  }, [activeView, settingsTab, marketplaceManifest]);

  // Playlist functions
  const parseXSPF = (xspfString) => {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xspfString, 'text/xml');

      // Parse date from XSPF (ISO 8601 format)
      const dateStr = xml.querySelector('playlist > date')?.textContent;
      const parsedDate = dateStr ? new Date(dateStr).getTime() : null;

      const playlist = {
        title: xml.querySelector('playlist > title')?.textContent || 'Untitled Playlist',
        creator: xml.querySelector('playlist > creator')?.textContent || 'Unknown',
        date: parsedDate, // Original creation date from XSPF
        tracks: []
      };
      
      const trackElements = xml.querySelectorAll('track');
      trackElements.forEach(trackEl => {
        const track = {
          title: trackEl.querySelector('title')?.textContent || 'Unknown Track',
          artist: trackEl.querySelector('creator')?.textContent || 'Unknown Artist',
          album: trackEl.querySelector('album')?.textContent || '',
          duration: parseInt(trackEl.querySelector('duration')?.textContent || '0') / 1000, // Convert ms to seconds
          location: trackEl.querySelector('location')?.textContent || ''
        };
        playlist.tracks.push(track);
      });
      
      return playlist;
    } catch (error) {
      console.error('Error parsing XSPF:', error);
      return null;
    }
  };

  // Generate XSPF content from playlist object
  const generateXSPF = (playlist) => {
    const escapeXml = (str) => {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    const tracks = (playlist.tracks || []).map(track => `    <track>
      <title>${escapeXml(track.title)}</title>
      <creator>${escapeXml(track.artist)}</creator>
      <album>${escapeXml(track.album || '')}</album>
      <duration>${Math.round((track.duration || 0) * 1000)}</duration>
    </track>`).join('\n');

    const date = playlist.createdAt ? new Date(playlist.createdAt).toISOString() : new Date().toISOString();

    return `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>${escapeXml(playlist.title)}</title>
  <creator>${escapeXml(playlist.creator || 'Parachord')}</creator>
  <date>${date}</date>
  <trackList>
${tracks}
  </trackList>
</playlist>`;
  };

  // Save playlist to disk
  const savePlaylistToDisk = async (playlist) => {
    if (!playlist || !playlist.id) return;

    // Don't save hosted playlists (they come from URLs)
    if (playlist.sourceUrl) {
      console.log(`⏭️ Skipping save for hosted playlist: ${playlist.title}`);
      return;
    }

    try {
      const xspfContent = generateXSPF(playlist);
      const filename = playlist.filename || `${playlist.id}.xspf`;
      const result = await window.electron.playlists.save(filename, xspfContent);

      if (result.success) {
        console.log(`💾 Saved playlist: ${playlist.title}`);
      } else {
        console.error(`❌ Failed to save playlist: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ Error saving playlist:`, error);
    }
  };

  // Parse Critic's Picks RSS feed
  const parseCriticsPicksRSS = (rssString) => {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(rssString, 'text/xml');

      const items = xml.querySelectorAll('item');
      const albums = [];

      items.forEach(item => {
        const titleText = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const description = item.querySelector('description')?.textContent || '';
        const score = item.querySelector('creator')?.textContent || ''; // dc:creator contains score
        const pubDate = item.querySelector('pubDate')?.textContent || '';

        // Parse "Album by Artist" format
        // Examples: "Valentine by Courtney Marie Andrews", "Tragic Magic by Julianna Barwick & Mary Lattimore"
        let artist = '';
        let album = '';

        const byMatch = titleText.match(/^(.+?)\s+by\s+(.+)$/i);
        if (byMatch) {
          album = byMatch[1].trim();
          artist = byMatch[2].trim();
        } else {
          // Fallback: use full title as album name
          artist = 'Unknown Artist';
          album = titleText;
        }

        if (album) {
          albums.push({
            id: `critics-${artist}-${album}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
            artist: artist,
            title: album,
            score: parseInt(score) || null,
            link: link,
            description: description,
            pubDate: pubDate ? new Date(pubDate) : null,
            albumArt: null // Will be fetched separately
          });
        }
      });

      return albums;
    } catch (error) {
      console.error('Error parsing Critic\'s Picks RSS:', error);
      return [];
    }
  };

  // Parse Apple Music Charts RSS feed
  const parseChartsRSS = (rssString) => {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(rssString, 'text/xml');

      const items = xml.querySelectorAll('item');
      const albums = [];

      items.forEach((item, index) => {
        const titleText = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const description = item.querySelector('description')?.textContent || '';
        const pubDate = item.querySelector('pubDate')?.textContent || '';

        // Get artist from category with domain attribute
        const categories = item.querySelectorAll('category');
        let artist = '';
        let genres = [];

        categories.forEach(cat => {
          if (cat.getAttribute('domain')) {
            // Category with domain is the artist link
            artist = cat.textContent || '';
          } else {
            // Categories without domain are genres
            genres.push(cat.textContent);
          }
        });

        // Title format is "Album Name - Artist Name"
        // But we already have artist from category, so extract album from title
        let album = titleText;
        if (titleText.includes(' - ') && artist) {
          album = titleText.replace(` - ${artist}`, '').trim();
        }

        // Fallback: if no artist from category, try parsing from title
        if (!artist && titleText.includes(' - ')) {
          const parts = titleText.split(' - ');
          album = parts[0].trim();
          artist = parts.slice(1).join(' - ').trim();
        }

        if (album && artist) {
          albums.push({
            id: `charts-${index}-${artist}-${album}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
            artist: artist,
            title: album,
            rank: index + 1,
            link: link,
            genres: genres.filter(g => g !== 'Music'),
            pubDate: pubDate ? new Date(pubDate) : null,
            albumArt: null
          });
        }
      });

      return albums;
    } catch (error) {
      console.error('Error parsing Charts RSS:', error);
      return [];
    }
  };

  // Load Critic's Picks from RSS feed
  const loadCriticsPicks = async () => {
    if (criticsPicksLoading || criticsPicksLoaded.current) return;

    setCriticsPicksLoading(true);
    console.log('📰 Loading Critic\'s Picks...');

    try {
      const response = await fetch('https://fetchrss.com/rss/6749eb6afa8030e1220ad6736749eb5b3c110a8c250ae1c2.xml');
      if (!response.ok) {
        throw new Error(`Failed to fetch RSS: ${response.status}`);
      }

      const rssText = await response.text();
      const albums = parseCriticsPicksRSS(rssText);

      console.log(`📰 Parsed ${albums.length} albums from Critic's Picks`);

      // Set albums immediately (without album art)
      setCriticsPicks(albums);
      criticsPicksLoaded.current = true;

      // Fetch album art in background
      fetchCriticsPicksAlbumArt(albums);

    } catch (error) {
      console.error('Failed to load Critic\'s Picks:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Load Failed',
        message: 'Failed to load Critic\'s Picks. Please try again.'
      });
    } finally {
      setCriticsPicksLoading(false);
    }
  };

  // Load Charts from Apple Music RSS feed
  const loadCharts = async () => {
    if (chartsLoading || chartsLoaded.current) return;

    setChartsLoading(true);
    console.log('📊 Loading Charts...');

    try {
      const response = await fetch('https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/albums.rss');
      if (!response.ok) {
        throw new Error(`Failed to fetch RSS: ${response.status}`);
      }

      const rssText = await response.text();
      const albums = parseChartsRSS(rssText);

      console.log(`📊 Parsed ${albums.length} albums from Charts`);

      setCharts(albums);
      chartsLoaded.current = true;

      // Wait for cache to be loaded before fetching album art
      if (cacheLoaded) {
        fetchChartsAlbumArt(albums);
      } else {
        // If cache not ready, wait a bit and try again
        const waitForCache = setInterval(() => {
          if (cacheLoaded) {
            clearInterval(waitForCache);
            fetchChartsAlbumArt(albums);
          }
        }, 100);
      }

    } catch (error) {
      console.error('Failed to load Charts:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Load Failed',
        message: 'Failed to load Charts. Please try again.'
      });
    } finally {
      setChartsLoading(false);
    }
  };

  // Fetch album art for Charts in background
  const fetchChartsAlbumArt = async (albums) => {
    const albumsNeedingFetch = [];
    const cachedUpdates = [];

    for (const album of albums) {
      const lookupKey = `${album.artist}-${album.title}`.toLowerCase();
      const cachedReleaseId = albumToReleaseIdCache.current[lookupKey];

      if (cachedReleaseId && albumArtCache.current[cachedReleaseId]?.url) {
        cachedUpdates.push({ id: album.id, albumArt: albumArtCache.current[cachedReleaseId].url });
      } else if (cachedReleaseId !== null) {
        albumsNeedingFetch.push(album);
      }
    }

    if (cachedUpdates.length > 0) {
      console.log(`📊 Using cached art for ${cachedUpdates.length} Charts albums`);
      setCharts(prev => prev.map(a => {
        const cached = cachedUpdates.find(u => u.id === a.id);
        return cached ? { ...a, albumArt: cached.albumArt } : a;
      }));
    }

    for (const album of albumsNeedingFetch) {
      try {
        const artUrl = await getAlbumArt(album.artist, album.title);
        if (artUrl) {
          setCharts(prev => prev.map(a =>
            a.id === album.id ? { ...a, albumArt: artUrl } : a
          ));
        }
      } catch (error) {
        console.log(`Could not fetch art for: ${album.artist} - ${album.title}`);
      }
      // MusicBrainz rate limit: 1 request per second
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  };

  // Navigate to a Charts album release page
  const openChartsAlbum = async (album) => {
    console.log(`🎵 Opening Chart Album: ${album.artist} - ${album.title}`);

    try {
      // Search MusicBrainz for the release
      const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
      const mbResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!mbResponse.ok) {
        throw new Error('MusicBrainz search failed');
      }

      const mbData = await mbResponse.json();

      if (!mbData.releases || mbData.releases.length === 0) {
        // Fallback: just navigate to artist page
        console.log('Release not found in MusicBrainz, navigating to artist page');
        fetchArtistData(album.artist);
        return;
      }

      const release = mbData.releases[0];
      const artistCredit = release['artist-credit']?.[0];

      // Create artist object for the release page
      const artist = {
        id: artistCredit?.artist?.id,
        name: artistCredit?.artist?.name || album.artist
      };

      // Create release object matching the expected format
      const releaseObj = {
        id: release.id,
        title: release.title,
        date: release.date,
        releaseType: release['release-group']?.['primary-type']?.toLowerCase() || 'album',
        albumArt: album.albumArt
      };

      // Set artist context and fetch release data
      // Mark that we're opening a release so header stays collapsed
      openingReleaseRef.current = true;
      setCurrentArtist(artist);
      navigateTo('artist');
      fetchReleaseData(releaseObj, artist);

    } catch (error) {
      console.error('Error opening chart album:', error);
      // Fallback: navigate to artist page
      fetchArtistData(album.artist);
    }
  };

  // Prefetch tracks for a Charts album on hover
  const prefetchChartsTracks = async (album) => {
    // Skip if already prefetched
    if (prefetchedReleases[album.id]) {
      return;
    }

    try {
      const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
      const mbResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!mbResponse.ok) return;

      const mbData = await mbResponse.json();
      if (!mbData.releases || mbData.releases.length === 0) return;

      const releaseId = mbData.releases[0].id;

      // Fetch release details with tracks
      const releaseDetailsResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!releaseDetailsResponse.ok) return;

      const releaseData = await releaseDetailsResponse.json();
      const tracks = [];

      releaseData.media?.forEach(medium => {
        medium.tracks?.forEach(track => {
          tracks.push({
            id: track.recording?.id || track.id,
            title: track.title,
            artist: album.artist,
            duration: track.length ? Math.round(track.length / 1000) : null,
            albumArt: album.albumArt
          });
        });
      });

      if (tracks.length > 0) {
        setPrefetchedReleases(prev => ({
          ...prev,
          [album.id]: {
            tracks,
            title: album.title,
            albumArt: album.albumArt
          }
        }));
      }
    } catch (error) {
      // Silent fail for prefetch
    }
  };

  // Add all tracks from a Charts album to the queue
  const addChartsToQueue = async (album) => {
    console.log(`➕ Adding chart album to queue: ${album.artist} - ${album.title}`);

    try {
      const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
      const mbResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!mbResponse.ok) throw new Error('MusicBrainz search failed');

      const mbData = await mbResponse.json();
      if (!mbData.releases?.[0]) {
        showConfirmDialog({
          type: 'error',
          title: 'Album Not Found',
          message: `Could not find tracks for "${album.title}"`
        });
        return;
      }

      const releaseId = mbData.releases[0].id;
      const tracksResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!tracksResponse.ok) throw new Error('Failed to fetch tracks');

      const releaseData = await tracksResponse.json();
      const tracks = [];

      releaseData.media?.forEach(medium => {
        medium.tracks?.forEach(track => {
          tracks.push({
            id: track.recording?.id || track.id,
            title: track.title,
            artist: album.artist,
            duration: track.length ? Math.round(track.length / 1000) : null,
            albumArt: album.albumArt
          });
        });
      });

      if (tracks.length > 0) {
        setQueue(prev => [...prev, ...tracks]);
        showConfirmDialog({
          type: 'success',
          title: 'Added to Queue',
          message: `Added ${tracks.length} tracks from "${album.title}"`
        });
      }
    } catch (error) {
      console.error('Error adding chart album to queue:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Error',
        message: 'Failed to add album to queue. Please try again.'
      });
    }
  };

  // Fetch album art for Critic's Picks in background
  const fetchCriticsPicksAlbumArt = async (albums) => {
    // First pass: check cache for all albums (instant, no network)
    const albumsNeedingFetch = [];
    const cachedUpdates = [];

    for (const album of albums) {
      const lookupKey = `${album.artist}-${album.title}`.toLowerCase();
      const cachedReleaseId = albumToReleaseIdCache.current[lookupKey];

      if (cachedReleaseId && albumArtCache.current[cachedReleaseId]?.url) {
        // We have cached art - collect for batch update
        cachedUpdates.push({ id: album.id, albumArt: albumArtCache.current[cachedReleaseId].url });
      } else if (cachedReleaseId !== null) {
        // No cached art or release ID not yet looked up - need to fetch
        albumsNeedingFetch.push(album);
      }
      // If cachedReleaseId === null, we previously failed to find this album, skip it
    }

    // Apply cached updates immediately
    if (cachedUpdates.length > 0) {
      console.log(`📰 Using cached art for ${cachedUpdates.length} Critic's Picks albums`);
      setCriticsPicks(prev => prev.map(a => {
        const cached = cachedUpdates.find(u => u.id === a.id);
        return cached ? { ...a, albumArt: cached.albumArt } : a;
      }));
    }

    // Second pass: fetch art for albums not in cache
    for (const album of albumsNeedingFetch) {
      try {
        const artUrl = await getAlbumArt(album.artist, album.title);
        if (artUrl) {
          setCriticsPicks(prev => prev.map(a =>
            a.id === album.id ? { ...a, albumArt: artUrl } : a
          ));
        }
      } catch (error) {
        console.log(`Could not fetch art for: ${album.artist} - ${album.title}`);
      }
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  };

  // Navigate to a Critic's Picks album release page
  const openCriticsPicksAlbum = async (album) => {
    console.log(`🎵 Opening Critic's Pick: ${album.artist} - ${album.title}`);

    try {
      // Search MusicBrainz for the release
      const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
      const mbResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!mbResponse.ok) {
        throw new Error('MusicBrainz search failed');
      }

      const mbData = await mbResponse.json();

      if (!mbData.releases || mbData.releases.length === 0) {
        // Fallback: just navigate to artist page
        console.log('Release not found in MusicBrainz, navigating to artist page');
        fetchArtistData(album.artist);
        return;
      }

      const release = mbData.releases[0];
      const artistCredit = release['artist-credit']?.[0];

      // Create artist object for the release page
      const artist = {
        id: artistCredit?.artist?.id,
        name: artistCredit?.artist?.name || album.artist
      };

      // Create release object matching the expected format
      const releaseObj = {
        id: release.id,
        title: release.title,
        date: release.date,
        releaseType: release['release-group']?.['primary-type']?.toLowerCase() || 'album',
        albumArt: album.albumArt
      };

      // Set artist context and fetch release data
      // Mark that we're opening a release so header stays collapsed
      openingReleaseRef.current = true;
      setCurrentArtist(artist);
      navigateTo('artist');
      fetchReleaseData(releaseObj, artist);

    } catch (error) {
      console.error('Error opening Critic\'s Pick album:', error);
      // Fallback: navigate to artist page
      fetchArtistData(album.artist);
    }
  };

  // Prefetch Critic's Picks album tracks on hover (for Add to Queue)
  const prefetchCriticsPicksTracks = async (album) => {
    // Skip if already prefetched
    if (prefetchedReleases[album.id]) {
      return;
    }

    try {
      console.log('🔍 Prefetching Critic\'s Pick tracks for:', album.title);

      // Search MusicBrainz for the release
      const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
      const mbResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!mbResponse.ok) return;

      const mbData = await mbResponse.json();
      if (!mbData.releases || mbData.releases.length === 0) return;

      const releaseId = mbData.releases[0].id;

      // Fetch release details with tracks
      const releaseDetailsResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!releaseDetailsResponse.ok) return;

      const releaseData = await releaseDetailsResponse.json();

      // Extract tracks
      const tracks = [];
      if (releaseData.media && releaseData.media.length > 0) {
        releaseData.media.forEach((medium) => {
          if (medium.tracks) {
            medium.tracks.forEach(track => {
              const trackId = `${album.artist}-${track.title || 'untitled'}-${album.title}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
              tracks.push({
                id: trackId,
                position: track.position,
                title: track.title || track.recording?.title || 'Unknown Track',
                length: track.length,
                recordingId: track.recording?.id,
                artist: album.artist,
                album: album.title,
                albumArt: album.albumArt,
                sources: {}
              });
            });
          }
        });
      }

      // Cache the prefetched tracks
      setPrefetchedReleases(prev => ({
        ...prev,
        [album.id]: {
          tracks,
          title: album.title,
          albumArt: album.albumArt,
          artist: album.artist
        }
      }));

      console.log(`✅ Prefetched ${tracks.length} tracks for ${album.title}`);
    } catch (error) {
      console.error('Error prefetching Critic\'s Pick tracks:', error);
    }
  };

  // Add Critic's Picks album to queue
  const addCriticsPicksToQueue = async (album) => {
    // Check if we have prefetched tracks
    const prefetched = prefetchedReleases[album.id];

    if (prefetched?.tracks?.length > 0) {
      addToQueue(prefetched.tracks);
      return;
    }

    // Otherwise, fetch and add
    await prefetchCriticsPicksTracks(album);
    const newPrefetched = prefetchedReleases[album.id];
    if (newPrefetched?.tracks?.length > 0) {
      addToQueue(newPrefetched.tracks);
    }
  };

  // Cache for mapping artist+album -> MusicBrainz release ID (to avoid repeated searches)
  const albumToReleaseIdCache = useRef({});

  // Fetch album art for a track by searching MusicBrainz first, then using the shared albumArtCache
  const getAlbumArt = async (artist, album) => {
    if (!artist || !album) return null;

    const lookupKey = `${artist}-${album}`.toLowerCase();

    // Check if we've already looked up this artist+album combo
    if (albumToReleaseIdCache.current[lookupKey] !== undefined) {
      const releaseId = albumToReleaseIdCache.current[lookupKey];
      if (releaseId === null) return null; // Previously failed lookup
      // Return from the shared albumArtCache
      return albumArtCache.current[releaseId]?.url || null;
    }

    try {
      // Search MusicBrainz for the release
      const searchQuery = encodeURIComponent(`release:"${album}" AND artist:"${artist}"`);
      const mbResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
      );

      if (!mbResponse.ok) {
        albumToReleaseIdCache.current[lookupKey] = null;
        return null;
      }

      const mbData = await mbResponse.json();
      if (!mbData.releases || mbData.releases.length === 0) {
        albumToReleaseIdCache.current[lookupKey] = null;
        return null;
      }

      const releaseId = mbData.releases[0].id;
      albumToReleaseIdCache.current[lookupKey] = releaseId;

      // Check if we already have art for this release in the shared cache
      if (albumArtCache.current[releaseId]?.url) {
        return albumArtCache.current[releaseId].url;
      }

      // Fetch cover art from Cover Art Archive
      const caaResponse = await fetch(
        `https://coverartarchive.org/release/${releaseId}/front-250`,
        { redirect: 'follow' }
      );

      if (caaResponse.ok) {
        const artUrl = caaResponse.url;
        // Store in the shared albumArtCache with timestamp
        albumArtCache.current[releaseId] = { url: artUrl, timestamp: Date.now() };
        return artUrl;
      }

      return null;
    } catch (error) {
      console.log(`Cover art not found for: ${artist} - ${album}`);
      albumToReleaseIdCache.current[lookupKey] = null;
      return null;
    }
  };

  // Detect face position in an image using browser's FaceDetector API
  const detectFacePosition = async (imageUrl) => {
    // Check if FaceDetector API is available (Chromium/Electron)
    if (!('FaceDetector' in window)) {
      console.log('FaceDetector API not available');
      return null;
    }

    try {
      // Load image into an HTMLImageElement
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });

      // Detect faces
      const detector = new FaceDetector();
      const faces = await detector.detect(img);

      if (faces.length === 0) {
        console.log('No faces detected in image');
        return null;
      }

      // Find largest face (by bounding box area) - likely the main artist
      const largest = faces.reduce((a, b) =>
        (a.boundingBox.width * a.boundingBox.height) >
        (b.boundingBox.width * b.boundingBox.height) ? a : b
      );

      // Calculate vertical center of face as percentage
      const faceCenter = largest.boundingBox.y + (largest.boundingBox.height / 2);
      const percentage = Math.round((faceCenter / img.height) * 100);

      console.log(`Face detected at ${percentage}% from top`);
      return `center ${percentage}%`;
    } catch (error) {
      console.error('Face detection failed:', error);
      return null;
    }
  };

  // Fetch artist image from Spotify API with caching and face detection
  // Track in-flight requests to prevent duplicate concurrent fetches
  const artistImageFetchPromises = useRef({});

  const getArtistImage = async (artistName) => {
    if (!artistName) return null;

    const normalizedName = artistName.trim().toLowerCase();
    const cached = artistImageCache.current[normalizedName];
    const now = Date.now();

    // Check cache validity - return both url and facePosition
    if (cached && (now - cached.timestamp) < CACHE_TTL.artistImage) {
      return { url: cached.url, facePosition: cached.facePosition };
    }

    // Check if there's already a fetch in progress for this artist
    if (artistImageFetchPromises.current[normalizedName]) {
      return artistImageFetchPromises.current[normalizedName];
    }

    // Spotify requires authentication
    if (!spotifyToken) {
      console.log('Spotify not connected, cannot fetch artist image');
      return null;
    }

    // Create the fetch promise and store it
    const fetchPromise = (async () => {
      try {
        // Search for the artist on Spotify with exact artist name matching
        const searchUrl = `https://api.spotify.com/v1/search?q=artist:"${encodeURIComponent(artistName)}"&type=artist&limit=5`;
        const response = await fetch(searchUrl, {
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        });

        if (!response.ok) {
          console.error('Spotify artist search failed:', response.status);
          return null;
        }

        const data = await response.json();

        // Find the artist with exact name match only (case-insensitive)
        // Don't fall back to first result - this causes wrong images for similar artist names
        const artists = data.artists?.items || [];
        const artist = artists.find(a => a.name.toLowerCase() === artistName.toLowerCase());

        if (artist?.images?.length > 0) {
          // Spotify returns images sorted by size (largest first)
          const imageUrl = artist.images[0].url;

          // Detect face position for smart cropping
          const facePosition = await detectFacePosition(imageUrl);

          artistImageCache.current[normalizedName] = {
            url: imageUrl,
            facePosition: facePosition, // may be null
            timestamp: now
          };

          return { url: imageUrl, facePosition };
        }

        return null; // No image available, don't cache failure
      } catch (error) {
        console.error('Failed to fetch artist image from Spotify:', error);
        return null; // Don't cache failures
      } finally {
        // Clean up the in-flight promise
        delete artistImageFetchPromises.current[normalizedName];
      }
    })();

    artistImageFetchPromises.current[normalizedName] = fetchPromise;
    return fetchPromise;
  };

  // Fetch artist image and bio for search preview pane
  useEffect(() => {
    // Only fetch for artist previews when we have a preview item
    if (searchDetailCategory !== 'artists' || !searchPreviewItem) {
      setSearchPreviewArtistImage(null);
      setSearchPreviewArtistBio(null);
      return;
    }

    const artistName = searchPreviewItem.name;
    if (!artistName) return;

    // Fetch artist image from Spotify (uses existing cache)
    const fetchArtistImage = async () => {
      const result = await getArtistImage(artistName);
      if (result?.url) {
        setSearchPreviewArtistImage(result);
      } else {
        setSearchPreviewArtistImage(null);
      }
    };

    // Fetch artist bio snippet from Last.fm (lightweight version, no loading state)
    const fetchArtistBioSnippet = async () => {
      const apiKey = lastfmApiKey.current;
      if (!apiKey) {
        setSearchPreviewArtistBio(null);
        return;
      }

      try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`;
        const response = await fetch(url);
        if (!response.ok) {
          setSearchPreviewArtistBio(null);
          return;
        }

        const data = await response.json();
        if (data.artist?.bio) {
          // Use summary for preview (shorter than content)
          const bioSummary = data.artist.bio.summary || data.artist.bio.content || '';
          // Strip HTML tags and limit to ~200 chars for preview
          const cleanBio = bioSummary.replace(/<[^>]*>/g, '').trim();
          const truncatedBio = cleanBio.length > 200 ? cleanBio.substring(0, 200) + '...' : cleanBio;
          setSearchPreviewArtistBio(truncatedBio);
        } else {
          setSearchPreviewArtistBio(null);
        }
      } catch (error) {
        console.error('Failed to fetch artist bio snippet:', error);
        setSearchPreviewArtistBio(null);
      }
    };

    fetchArtistImage();
    fetchArtistBioSnippet();
  }, [searchDetailCategory, searchPreviewItem?.id]);

  // Fetch artist biography from Last.fm (lazy loaded on Biography tab click)
  const getArtistBio = async (artistName) => {
    if (!artistName) return null;

    const apiKey = lastfmApiKey.current;
    if (!apiKey) {
      console.warn('⚠️ Last.fm API key not available, cannot fetch artist bio');
      return null;
    }

    setLoadingBio(true);
    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error('Last.fm artist info request failed:', response.status);
        return null;
      }

      const data = await response.json();
      if (data.artist?.bio) {
        // Strip HTML tags from bio content
        const bioContent = data.artist.bio.content || data.artist.bio.summary || '';
        const cleanBio = bioContent.replace(/<[^>]*>/g, '').trim();

        // Also get the Last.fm URL for "Read more" link
        const lastfmUrl = data.artist.url || null;

        return { bio: cleanBio, url: lastfmUrl };
      }

      return null;
    } catch (error) {
      console.error('Failed to fetch artist bio from Last.fm:', error);
      return null;
    } finally {
      setLoadingBio(false);
    }
  };

  // Fetch related artists from Last.fm (lazy loaded on Related Artists tab click)
  const getRelatedArtists = async (artistName) => {
    if (!artistName) return [];

    const apiKey = lastfmApiKey.current;
    if (!apiKey) {
      console.warn('⚠️ Last.fm API key not available, cannot fetch related artists');
      return [];
    }

    setLoadingRelated(true);
    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json&limit=12`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error('Last.fm similar artists request failed:', response.status);
        return [];
      }

      const data = await response.json();
      if (data.similarartists?.artist) {
        // Map to our format with match percentage
        return data.similarartists.artist.map(a => ({
          name: a.name,
          match: Math.round(parseFloat(a.match) * 100), // Convert 0-1 to percentage
          url: a.url
        }));
      }

      return [];
    } catch (error) {
      console.error('Failed to fetch related artists from Last.fm:', error);
      return [];
    } finally {
      setLoadingRelated(false);
    }
  };

  // Get 4 unique album covers for a playlist's 2x2 grid display
  // Returns array of up to 4 album art URLs, using cache when available
  const getPlaylistCovers = async (playlistId, tracks) => {
    // Check cache first
    const cached = playlistCoverCache.current[playlistId];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL.playlistCover) {
      return cached.covers;
    }

    // Collect unique album art URLs from tracks
    const seenAlbums = new Set();
    const covers = [];

    for (const track of tracks) {
      if (covers.length >= 4) break;

      // Create a unique key for the album to avoid duplicates
      const albumKey = `${track.artist}-${track.album}`.toLowerCase();
      if (seenAlbums.has(albumKey)) continue;
      seenAlbums.add(albumKey);

      // If track already has albumArt, use it
      if (track.albumArt) {
        covers.push(track.albumArt);
        continue;
      }

      // Otherwise try to fetch it
      if (track.artist && track.album) {
        const artUrl = await getAlbumArt(track.artist, track.album);
        if (artUrl) {
          covers.push(artUrl);
        }
      }
    }

    // Cache the result
    if (covers.length > 0) {
      playlistCoverCache.current[playlistId] = {
        covers,
        timestamp: Date.now()
      };
    }

    return covers;
  };

  // Fetch and update covers for a single playlist (used after import)
  const fetchPlaylistCovers = async (playlistId, tracks) => {
    if (!tracks || tracks.length === 0) return;

    const covers = await getPlaylistCovers(playlistId, tracks);
    if (covers.length > 0) {
      setAllPlaylistCovers(prev => ({
        ...prev,
        [playlistId]: covers
      }));
    }
  };

  // State for current playlist's cover art grid
  const [playlistCoverArt, setPlaylistCoverArt] = useState([]);

  const loadPlaylist = async (playlistOrId) => {
    // Accept either a playlist object or an ID for backwards compatibility
    let playlist;
    if (typeof playlistOrId === 'string') {
      console.log('🖱️ Playlist clicked, ID:', playlistOrId);
      playlist = playlists.find(p => p.id === playlistOrId);
      if (!playlist) {
        console.error('❌ Playlist not found:', playlistOrId);
        return;
      }
    } else {
      playlist = playlistOrId;
      console.log('🖱️ Playlist clicked, ID:', playlist.id);
    }

    console.log('📋 Found playlist:', playlist.title);

    setSelectedPlaylist(playlist);
    setPlaylistCoverArt([]); // Reset cover art
    navigateTo('playlist-view');
    console.log(`📋 Loading playlist: ${playlist.title}`);

    // Parse XSPF if we have the content
    if (playlist.xspf) {
      const parsed = parseXSPF(playlist.xspf);
      if (parsed) {
        console.log(`🎵 Parsed ${parsed.tracks.length} tracks from XSPF`);

        // Step 1: Immediately display all tracks with metadata (no sources yet)
        const tracksWithIds = parsed.tracks.map(track => {
          const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
          return { ...track, id: trackId, sources: {} };
        });
        setPlaylistTracks(tracksWithIds);

        // Step 1.5: Fetch playlist cover art (4 unique album covers for 2x2 grid)
        getPlaylistCovers(playlist.id, tracksWithIds).then(covers => {
          setPlaylistCoverArt(covers);
        });

        // Step 1.6: Fetch album art for tracks that don't have it (background, non-blocking)
        tracksWithIds.forEach(async (track) => {
          if (!track.albumArt && track.album) {
            const artUrl = await getAlbumArt(track.artist, track.album);
            if (artUrl) {
              setPlaylistTracks(prevTracks =>
                prevTracks.map(t =>
                  t.id === track.id && !t.albumArt
                    ? { ...t, albumArt: artUrl }
                    : t
                )
              );
            }
          }
        });

        // Step 2: Resolve sources in the background for each track
        for (const track of tracksWithIds) {
          // Check if queue resolution has priority - if so, pause page resolution
          if (queueResolutionActiveRef.current) {
            console.log(`⏸️ Pausing playlist resolution - queue resolution has priority`);
            while (queueResolutionActiveRef.current) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            console.log(`▶️ Resuming playlist resolution`);
          }

          console.log(`🔍 Resolving: ${track.artist} - ${track.title}`);

          // Resolve all sources for this track
          for (const resolverId of activeResolvers) {
            const resolver = allResolvers.find(r => r.id === resolverId);
            if (!resolver || !resolver.capabilities.resolve) continue;

            try {
              const config = await getResolverConfig(resolverId);
              const resolved = await resolver.resolve(track.artist, track.title, track.album, config);

              if (resolved) {
                console.log(`  ✅ ${resolver.name}: Found match`);
                // Update the track's sources and duration (if available) and trigger re-render
                setPlaylistTracks(prevTracks =>
                  prevTracks.map(t =>
                    t.id === track.id
                      ? {
                          ...t,
                          sources: { ...t.sources, [resolverId]: resolved },
                          // Update duration if resolved source has it and track doesn't
                          duration: t.duration || resolved.duration || 0
                        }
                      : t
                  )
                );
              }
            } catch (error) {
              console.error(`  ❌ ${resolver.name} resolve error:`, error);
            }
          }
        }

        console.log(`✅ Finished resolving ${tracksWithIds.length} tracks`);
      }
    } else if (playlist.tracks && playlist.tracks.length > 0) {
      // Handle playlists with tracks array directly (e.g., newly created playlists)
      console.log(`🎵 Loading ${playlist.tracks.length} tracks from playlist object`);

      // Add IDs and sources to tracks if not present
      const tracksWithIds = playlist.tracks.map(track => {
        const trackId = track.id || `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
        return { ...track, id: trackId, sources: track.sources || {} };
      });
      setPlaylistTracks(tracksWithIds);

      // Fetch playlist cover art
      getPlaylistCovers(playlist.id, tracksWithIds).then(covers => {
        setPlaylistCoverArt(covers);
      });

      // Fetch album art for tracks that don't have it
      tracksWithIds.forEach(async (track) => {
        if (!track.albumArt && track.album) {
          const artUrl = await getAlbumArt(track.artist, track.album);
          if (artUrl) {
            setPlaylistTracks(prevTracks =>
              prevTracks.map(t =>
                t.id === track.id && !t.albumArt
                  ? { ...t, albumArt: artUrl }
                  : t
              )
            );
          }
        }
      });

      // Resolve sources in background
      for (const track of tracksWithIds) {
        // Check if queue resolution has priority - if so, pause page resolution
        if (queueResolutionActiveRef.current) {
          console.log(`⏸️ Pausing playlist resolution - queue resolution has priority`);
          while (queueResolutionActiveRef.current) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          console.log(`▶️ Resuming playlist resolution`);
        }

        console.log(`🔍 Resolving: ${track.artist} - ${track.title}`);

        for (const resolverId of activeResolvers) {
          const resolver = allResolvers.find(r => r.id === resolverId);
          if (!resolver || !resolver.capabilities.resolve) continue;

          try {
            const config = await getResolverConfig(resolverId);
            const resolved = await resolver.resolve(track.artist, track.title, track.album, config);

            if (resolved) {
              console.log(`  ✅ ${resolver.name}: Found match`);
              setPlaylistTracks(prevTracks =>
                prevTracks.map(t =>
                  t.id === track.id
                    ? {
                        ...t,
                        sources: { ...t.sources, [resolverId]: resolved },
                        duration: t.duration || resolved.duration || 0
                      }
                    : t
                )
              );
            }
          } catch (error) {
            console.error(`  ❌ ${resolver.name} resolve error:`, error);
          }
        }
      }

      console.log(`✅ Finished resolving ${tracksWithIds.length} tracks`);
    } else {
      // No tracks to display
      console.log('⚠️ Playlist has no tracks');
      setPlaylistTracks([]);
    }
  };

  // Keep queue in sync with playlistTracks as they get resolved
  // This ensures queue items get their sources updated without re-setting the entire queue
  useEffect(() => {
    if (currentQueue.length === 0 || playlistTracks.length === 0) return;

    // Check if queue tracks match playlist tracks (by id)
    const queueIds = new Set(currentQueue.map(t => t.id));
    const playlistIds = new Set(playlistTracks.map(t => t.id));

    // Only sync if the queue was created from this playlist
    const isQueueFromPlaylist = currentQueue.every(t => playlistIds.has(t.id));
    if (!isQueueFromPlaylist) return;

    // Update queue items with resolved sources and duration from playlistTracks
    setCurrentQueue(prevQueue =>
      prevQueue.map(queueTrack => {
        const playlistTrack = playlistTracks.find(t => t.id === queueTrack.id);
        if (playlistTrack) {
          const hasMoreSources = Object.keys(playlistTrack.sources || {}).length > Object.keys(queueTrack.sources || {}).length;
          const hasDuration = playlistTrack.duration && !queueTrack.duration;

          if (hasMoreSources || hasDuration) {
            // Update queue track with new sources and/or duration
            return {
              ...queueTrack,
              sources: { ...queueTrack.sources, ...playlistTrack.sources },
              duration: queueTrack.duration || playlistTrack.duration || 0
            };
          }
        }
        return queueTrack;
      })
    );
  }, [playlistTracks]);

  // Sync queue tracks with trackSources updates (for release/album tracks)
  // This ensures queue items get their sources updated when resolution completes
  useEffect(() => {
    if (currentQueue.length === 0 || Object.keys(trackSources).length === 0) return;

    // Check if any queue tracks need source updates from trackSources
    // trackSources uses keys like "1-Track Title" (position-title)
    let hasUpdates = false;
    const updatedQueue = currentQueue.map(queueTrack => {
      // Try to find matching sources in trackSources
      // Queue tracks from releases have position property
      if (queueTrack.position && queueTrack.title) {
        const trackKey = `${queueTrack.position}-${queueTrack.title}`;
        const resolvedSources = trackSources[trackKey];

        if (resolvedSources && Object.keys(resolvedSources).length > Object.keys(queueTrack.sources || {}).length) {
          hasUpdates = true;
          return { ...queueTrack, sources: { ...queueTrack.sources, ...resolvedSources } };
        }
      }
      return queueTrack;
    });

    if (hasUpdates) {
      setCurrentQueue(updatedQueue);
    }
  }, [trackSources]);

  // Watch for queue changes and resolve any unresolved tracks with priority
  // This handles cases where setCurrentQueue is called directly (e.g., clicking a track to play)
  useEffect(() => {
    if (currentQueue.length === 0) return;
    if (queueResolutionActiveRef.current) return; // Already resolving

    // Find tracks that need resolution
    const unresolvedTracks = currentQueue.filter(track =>
      !track.sources || Object.keys(track.sources).length === 0
    );

    if (unresolvedTracks.length > 0) {
      console.log(`🎯 Queue has ${unresolvedTracks.length} unresolved tracks, starting priority resolution`);
      resolveQueueTracks(unresolvedTracks);
    }
  }, [currentQueue]);

  // Navigation helpers
  const navigateTo = (view) => {
    if (view !== activeView) {
      // Clear search state when leaving search view
      if (activeView === 'search') {
        setSearchQuery('');
        setSearchResults({ artists: [], albums: [], tracks: [], playlists: [] });
        setIsSearching(false);
        setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });
        setSearchDetailCategory(null);
        setSearchPreviewItem(null);
      }
      setViewHistory(prev => [...prev, view]);
      setActiveView(view);
      if (view === 'settings') {
        setSettingsTab('installed');
      }
    }
  };

  const navigateBack = () => {
    // If we're on artist page and have artist history, go to previous artist
    if (activeView === 'artist' && artistHistory.length > 0) {
      const newArtistHistory = [...artistHistory];
      const previousArtist = newArtistHistory.pop();
      setArtistHistory(newArtistHistory);

      // Fetch the previous artist's data
      const loadPreviousArtist = async () => {
        const cacheKey = previousArtist.toLowerCase();
        const cachedData = artistDataCache.current[cacheKey];
        const now = Date.now();

        // Check if artist image is in cache
        const normalizedName = previousArtist.trim().toLowerCase();
        const cachedImage = artistImageCache.current[normalizedName];
        const imageCacheValid = cachedImage && (now - cachedImage.timestamp) < CACHE_TTL.artistImage;

        // Cache is valid if data exists and not expired
        const cacheValid = cachedData &&
                          (now - cachedData.timestamp) < CACHE_TTL.artistData;

        if (cacheValid) {
          // Set artist image immediately from cache if available
          if (imageCacheValid) {
            setArtistImage(cachedImage.url);
            setArtistImagePosition(cachedImage.facePosition || 'center 25%');
          } else {
            setArtistImage(null);
            setArtistImagePosition('center 25%');
            getArtistImage(previousArtist).then(result => {
              if (result) {
                setArtistImage(result.url);
                setArtistImagePosition(result.facePosition || 'center 25%');
              }
            });
          }

          setCurrentArtist(cachedData.artist);
          const releasesWithCache = cachedData.releases.map(release => ({
            ...release,
            albumArt: albumArtCache.current[release.id]?.url || null
          }));
          setArtistReleases(releasesWithCache);
          setSmartReleaseTypeFilter(releasesWithCache);
          setLoadingArtist(false);
          fetchAlbumArtLazy(cachedData.releases);
        } else {
          // No valid cache - show loading state
          setLoadingArtist(true);
          setArtistImage(null);
          setArtistImagePosition('center 25%');

          // Refetch if not in cache (rare case)
          const searchResponse = await fetch(
            `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(previousArtist)}&fmt=json&limit=1`,
            { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
          );
          const searchData = await searchResponse.json();
          if (searchData.artists?.[0]) {
            const artist = searchData.artists[0];
            setCurrentArtist(artist);
            getArtistImage(previousArtist).then(result => {
              if (result) {
                setArtistImage(result.url);
                setArtistImagePosition(result.facePosition || 'center 25%');
              }
            });
          }
          setLoadingArtist(false);
        }
      };
      loadPreviousArtist();
      return;
    }

    if (viewHistory.length > 1) {
      const newHistory = [...viewHistory];
      const currentView = newHistory.pop(); // Remove current view
      const previousView = newHistory[newHistory.length - 1];
      setViewHistory(newHistory);
      setActiveView(previousView);

      // Clear associated state when leaving certain views
      if (currentView === 'artist') {
        setCurrentArtist(null);
        setArtistImage(null);
        setArtistImagePosition('center 25%');
        setArtistReleases([]);
        setReleaseTypeFilter('all');
        setArtistHistory([]); // Clear artist history when leaving artist view
      }
      if (currentView === 'release') {
        setCurrentRelease(null);
      }
      if (currentView === 'playlist-view') {
        setSelectedPlaylist(null);
        setPlaylistTracks([]);
      }
    }
  };

  // Playlist import/export functions
  const handleImportPlaylist = async () => {
    try {
      console.log('📥 Importing playlist...');
      const result = await window.electron.playlists.import();
      
      if (!result) {
        console.log('Import cancelled');
        return;
      }
      
      if (result.error) {
        showConfirmDialog({
          type: 'error',
          title: 'Import Failed',
          message: result.error
        });
        return;
      }

      const { content, filename } = result;

      // Parse to get playlist info
      const parsed = parseXSPF(content);
      if (!parsed) {
        showConfirmDialog({
          type: 'error',
          title: 'Import Failed',
          message: 'Failed to parse XSPF file'
        });
        return;
      }
      
      // Generate ID from filename
      const id = filename.replace('.xspf', '');
      
      // Save to playlists folder
      const saveResult = await window.electron.playlists.save(filename, content);
      
      if (!saveResult.success) {
        showConfirmDialog({
          type: 'error',
          title: 'Save Failed',
          message: saveResult.error
        });
        return;
      }
      
      // Add to state
      const newPlaylist = {
        id: id,
        filename: filename,
        title: parsed.title,
        creator: parsed.creator,
        tracks: parsed.tracks || [],
        xspf: content,
        createdAt: parsed.date || Date.now(), // Use XSPF date or import time
        lastModified: Date.now()
      };

      setPlaylists(prev => [...prev, newPlaylist]);

      // Fetch covers for the 2x2 grid display immediately
      fetchPlaylistCovers(id, parsed.tracks || []);

      console.log(`✅ Imported playlist: ${parsed.title} (${newPlaylist.tracks.length} tracks)`);
      showConfirmDialog({
        type: 'success',
        title: 'Playlist Imported',
        message: parsed.title
      });
    } catch (error) {
      console.error('Import error:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Import Failed',
        message: error.message
      });
    }
  };

  // Import playlist from URL (hosted XSPF)
  // skipStorageUpdate: true when loading from storage on app start (to avoid duplicates)
  const handleImportPlaylistFromUrl = async (url, skipStorageUpdate = false) => {
    try {
      console.log('🌐 Importing playlist from URL:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }

      const content = await response.text();

      // Parse to get playlist info
      const parsed = parseXSPF(content);
      if (!parsed) {
        showConfirmDialog({
          type: 'error',
          title: 'Import Failed',
          message: 'Failed to parse XSPF file from URL'
        });
        return;
      }

      // Generate ID from URL using a simple hash for uniqueness
      // Using full URL hash instead of truncated base64 to avoid collisions
      const hashCode = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
      };
      const id = 'hosted-' + hashCode(url);

      // Check if playlist already exists
      const existingIndex = playlists.findIndex(p => p.sourceUrl === url);
      if (existingIndex >= 0) {
        // Update existing playlist
        setPlaylists(prev => prev.map((p, i) =>
          i === existingIndex
            ? { ...p, xspf: content, title: parsed.title, creator: parsed.creator, tracks: parsed.tracks || [], lastUpdated: Date.now() }
            : p
        ));
        console.log(`🔄 Updated hosted playlist: ${parsed.title} (${parsed.tracks?.length || 0} tracks)`);
        return { updated: true, playlist: parsed };
      }

      // Add new hosted playlist
      const newPlaylist = {
        id: id,
        filename: null,  // No local file for hosted playlists
        title: parsed.title,
        creator: parsed.creator,
        tracks: parsed.tracks || [],
        xspf: content,
        sourceUrl: url,  // Track the source URL for updates
        createdAt: parsed.date || Date.now(), // Use XSPF date or import time
        lastModified: Date.now()
      };

      setPlaylists(prev => [...prev, newPlaylist]);

      // Fetch covers for the 2x2 grid display immediately
      fetchPlaylistCovers(id, parsed.tracks || []);

      // Save URL to persistent storage for reload on app start
      // Skip this when loading from storage to avoid duplicates
      if (!skipStorageUpdate) {
        const hostedPlaylists = await window.electron?.store?.get('hosted_playlists') || [];
        hostedPlaylists.push({ url, id, addedAt: Date.now() });
        await window.electron?.store?.set('hosted_playlists', hostedPlaylists);
      }

      console.log(`✅ Imported hosted playlist: ${parsed.title}`);
      return { updated: false, playlist: parsed };
    } catch (error) {
      console.error('URL import error:', error);
      throw error;
    }
  };

  // Refresh a hosted playlist
  const refreshHostedPlaylist = async (playlistId) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist?.sourceUrl) {
      console.log('Not a hosted playlist, cannot refresh');
      return false;
    }

    try {
      console.log(`🔄 Refreshing hosted playlist: ${playlist.title}`);
      const result = await handleImportPlaylistFromUrl(playlist.sourceUrl);

      // If currently viewing this playlist, reload the tracks
      if (selectedPlaylist?.id === playlistId) {
        const parsed = parseXSPF(result?.playlist ? playlists.find(p => p.id === playlistId)?.xspf : playlist.xspf);
        if (parsed) {
          const tracksWithIds = parsed.tracks.map(track => {
            const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            return { ...track, id: trackId, sources: {} };
          });
          setPlaylistTracks(tracksWithIds);

          // Re-resolve sources in background
          for (const track of tracksWithIds) {
            for (const resolverId of activeResolvers) {
              const resolver = allResolvers.find(r => r.id === resolverId);
              if (!resolver || !resolver.capabilities.resolve) continue;

              try {
                const config = await getResolverConfig(resolverId);
                const resolved = await resolver.resolve(track.artist, track.title, track.album, config);

                if (resolved) {
                  setPlaylistTracks(prevTracks =>
                    prevTracks.map(t =>
                      t.id === track.id
                        ? { ...t, sources: { ...t.sources, [resolverId]: resolved } }
                        : t
                    )
                  );
                }
              } catch (error) {
                console.error(`  ❌ ${resolver.name} resolve error:`, error);
              }
            }
          }
        }
      }

      return true;
    } catch (error) {
      console.error('Refresh error:', error);
      return false;
    }
  };

  // Poll hosted playlists for updates
  const hostedPlaylistPollInterval = useRef(null);

  useEffect(() => {
    // Start polling for hosted playlist updates (every 5 minutes)
    const pollHostedPlaylists = async () => {
      const hostedPlaylists = playlists.filter(p => p.sourceUrl);
      if (hostedPlaylists.length === 0) return;

      console.log(`🔄 Checking ${hostedPlaylists.length} hosted playlist(s) for updates...`);

      for (const playlist of hostedPlaylists) {
        try {
          const response = await fetch(playlist.sourceUrl);
          if (!response.ok) continue;

          const content = await response.text();

          // Check if content changed
          if (content !== playlist.xspf) {
            console.log(`📝 Hosted playlist changed: ${playlist.title}`);
            await handleImportPlaylistFromUrl(playlist.sourceUrl);
          }
        } catch (error) {
          console.error(`Failed to check playlist ${playlist.title}:`, error);
        }
      }
    };

    // Poll every 5 minutes
    hostedPlaylistPollInterval.current = setInterval(pollHostedPlaylists, 5 * 60 * 1000);

    // Also poll on mount (after a short delay to let playlists load)
    const initialPoll = setTimeout(pollHostedPlaylists, 10000);

    return () => {
      clearInterval(hostedPlaylistPollInterval.current);
      clearTimeout(initialPoll);
    };
  }, [playlists.filter(p => p.sourceUrl).length]); // Re-run when hosted playlist count changes

  // Load hosted playlists on app start
  useEffect(() => {
    const loadHostedPlaylists = async () => {
      let hostedPlaylistUrls = await window.electron?.store?.get('hosted_playlists') || [];
      if (hostedPlaylistUrls.length === 0) return;

      // Deduplicate by URL (in case duplicates accumulated from previous bug)
      const seenUrls = new Set();
      const deduped = hostedPlaylistUrls.filter(item => {
        if (seenUrls.has(item.url)) return false;
        seenUrls.add(item.url);
        return true;
      });

      // Save deduped list back to storage if we removed duplicates
      if (deduped.length < hostedPlaylistUrls.length) {
        console.log(`🧹 Cleaned up ${hostedPlaylistUrls.length - deduped.length} duplicate hosted playlist entries`);
        await window.electron?.store?.set('hosted_playlists', deduped);
        hostedPlaylistUrls = deduped;
      }

      console.log(`📦 Loading ${hostedPlaylistUrls.length} hosted playlist(s)...`);

      for (const { url } of hostedPlaylistUrls) {
        try {
          // Pass true to skip storage update (already in storage)
          await handleImportPlaylistFromUrl(url, true);
        } catch (error) {
          console.error(`Failed to load hosted playlist from ${url}:`, error);
        }
      }
    };

    // Delay to allow local playlists to load first
    const timer = setTimeout(loadHostedPlaylists, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleExportPlaylist = async (playlist) => {
    try {
      console.log(`📤 Exporting playlist: ${playlist.id}`);
      
      const defaultFilename = playlist.filename || `${playlist.id}.xspf`;
      const result = await window.electron.playlists.export(defaultFilename, playlist.xspf);
      
      if (!result) {
        console.log('Export cancelled');
        return;
      }
      
      if (!result.success) {
        showConfirmDialog({
          type: 'error',
          title: 'Export Failed',
          message: result.error
        });
        return;
      }

      console.log(`✅ Exported to: ${result.filepath}`);
      showConfirmDialog({
        type: 'success',
        title: 'Playlist Exported',
        message: 'Successfully saved to disk'
      });
    } catch (error) {
      console.error('Export error:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Export Error',
        message: error.message
      });
    }
  };

  // Add Spotify authentication functions

  // Refresh the Spotify token and return the new token (or null if refresh failed)
  // This is called when a 401 is detected to get a fresh token
  const refreshSpotifyToken = async () => {
    console.log('🔄 Refreshing Spotify token...');
    if (!window.electron?.spotify) {
      console.log('window.electron.spotify not available');
      return null;
    }

    const tokenData = await window.electron.spotify.checkToken();
    if (tokenData && tokenData.token) {
      console.log('✅ Token refreshed successfully');
      setSpotifyToken(tokenData.token);
      setSpotifyConnected(true);
      return tokenData.token;
    } else {
      console.log('❌ Token refresh failed - no valid token returned');
      setSpotifyToken(null);
      setSpotifyConnected(false);
      return null;
    }
  };

  const checkSpotifyToken = async () => {
    console.log('Checking Spotify token...');
    if (window.electron?.spotify) {
      const tokenData = await window.electron.spotify.checkToken();
      console.log('Token data received:', {
        hasData: !!tokenData,
        hasToken: !!tokenData?.token,
        tokenLength: tokenData?.token?.length,
        tokenPreview: tokenData?.token ? tokenData.token.substring(0, 20) + '...' : 'null',
        expiry: tokenData?.expiry,
        hasRefresh: !!tokenData?.refreshToken
      });
      if (tokenData && tokenData.token) {
        console.log('Valid token found, setting connected state');
        setSpotifyToken(tokenData.token);
        setSpotifyConnected(true);
        // Enable Spotify resolver if authenticated
        setActiveResolvers(prev => {
          if (!prev.includes('spotify')) {
            console.log('Adding Spotify to active resolvers');
            return [...prev, 'spotify'];
          }
          return prev;
        });
      } else {
        console.log('No valid token found');
      }
    } else {
      console.log('window.electron.spotify not available');
    }
  };

  const connectSpotify = async () => {
    console.log('=== Connect Spotify Clicked ===');
    console.log('window.electron:', !!window.electron);
    console.log('window.electron.spotify:', !!window.electron?.spotify);
    
    if (window.electron?.spotify) {
      try {
        console.log('Calling authenticate...');
        const result = await window.electron.spotify.authenticate();
        console.log('Authenticate result:', result);
      } catch (error) {
        console.error('Spotify auth error:', error);
        showConfirmDialog({
          type: 'error',
          title: 'Authentication Failed',
          message: 'Spotify authentication failed. Check console for details.'
        });
      }
    } else {
      console.error('window.electron.spotify not available!');
      showConfirmDialog({
        type: 'error',
        title: 'API Not Available',
        message: 'Electron API not available. Make sure preload.js is loaded correctly.'
      });
    }
  };

  const disconnectSpotify = async () => {
    if (window.electron?.spotify) {
      await window.electron.store.delete('spotify_token');
      await window.electron.store.delete('spotify_refresh_token');
      await window.electron.store.delete('spotify_token_expiry');
      setSpotifyToken(null);
      setSpotifyConnected(false);
      // Remove Spotify sources from all tracks and remove from active resolvers
      removeResolverSources('spotify');
      setActiveResolvers(prev => prev.filter(id => id !== 'spotify'));
    }
  };

// Listen for Spotify auth events
useEffect(() => {
  checkSpotifyToken();

  if (window.electron?.spotify) {
    window.electron.spotify.onAuthSuccess((data) => {
      console.log('Spotify auth success!', {
        hasToken: !!data.token,
        tokenLength: data.token?.length,
        tokenPreview: data.token ? data.token.substring(0, 20) + '...' : 'null'
      });
      setSpotifyToken(data.token);
      setSpotifyConnected(true);
      // Automatically enable Spotify resolver after successful auth
      setActiveResolvers(prev => {
        if (!prev.includes('spotify')) {
          return [...prev, 'spotify'];
        }
        return prev;
      });
      console.log('Spotify connected and enabled!');
    });
    window.electron.spotify.onAuthError((error) => {
      console.error('Spotify auth failed:', error);
      showConfirmDialog({
        type: 'error',
        title: 'Spotify Authentication Failed',
        message: error
      });
    });
  }

  // Periodically check and refresh token every 5 minutes
  const tokenRefreshInterval = setInterval(() => {
    console.log('⏰ Periodic token refresh check...');
    checkSpotifyToken();
  }, 5 * 60 * 1000); // 5 minutes

  return () => clearInterval(tokenRefreshInterval);
}, []);

// Spotify Connect - Get available devices
const getSpotifyDevices = async () => {
  if (!spotifyToken) return [];
  
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: {
        'Authorization': `Bearer ${spotifyToken}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.devices || [];
    }
  } catch (error) {
    console.error('Failed to get devices:', error);
  }
  return [];
};

// Play on Spotify Connect (controls external Spotify clients)
const playOnSpotifyConnect = async (track) => {
  if (!spotifyToken) {
    showConfirmDialog({
      type: 'error',
      title: 'Spotify Not Connected',
      message: 'Please connect to Spotify in Settings to use this feature.'
    });
    return false;
  }

  try {
    // Get available devices
    const devices = await getSpotifyDevices();
    console.log('Available Spotify devices:', devices);

    if (devices.length === 0) {
      showConfirmDialog({
        type: 'info',
        title: 'No Devices Found',
        message: 'No Spotify devices found. Please open Spotify on your phone, computer, or web player (spotify.com), then try again.'
      });
      return false;
    }
    
    // Log all devices for debugging
    console.log(`Found ${devices.length} Spotify device(s):`);
    devices.forEach((d, i) => {
      console.log(`Device ${i + 1}:`, {
        name: d.name,
        type: d.type,
        is_active: d.is_active,
        is_restricted: d.is_restricted,
        volume_percent: d.volume_percent
      });
    });
    
    // Find active device or use first available
    const activeDevice = devices.find(d => d.is_active) || devices[0];
    console.log('Selected device:', activeDevice.name, 'Active:', activeDevice.is_active);
    
    // If device is not active, try to transfer playback to it first
    if (!activeDevice.is_active) {
      console.log('Device not active, transferring playback first...');
      const transferResponse = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${spotifyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [activeDevice.id],
          play: false // Don't start playing yet
        })
      });
      
      if (!transferResponse.ok && transferResponse.status !== 204) {
        console.error('Failed to transfer playback:', transferResponse.status);
        const error = await transferResponse.text();
        console.error('Transfer error details:', error);
      } else {
        console.log('Playback transferred to device');
        // Small delay to let the transfer complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Now play track on device
    console.log('Starting playback on device:', activeDevice.name);
    const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${activeDevice.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${spotifyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uris: [track.spotifyUri]
      })
    });
    
    if (response.ok || response.status === 204) {
      console.log('✅ Playing on Spotify:', activeDevice.name);
      setCurrentTrack(track);
      setIsPlaying(true);
      // Reset browser playback state since we're now using Spotify Connect
      setBrowserPlaybackActive(false);
      setIsExternalPlayback(false);

      // Don't call getCurrentPlaybackState() here - let polling handle it
      // This prevents flickering when starting playback
      return true;
    } else {
      const error = await response.text();
      console.error('Spotify play failed:', response.status, error);
      
      // Provide specific error messages
      if (response.status === 404) {
        showConfirmDialog({
          type: 'error',
          title: 'Device Not Responding',
          message: `Spotify device "${activeDevice.name}" is not responding.\n\nTry playing any song on Spotify first, then use Parachord.`
        });
      } else if (response.status === 403) {
        showConfirmDialog({
          type: 'error',
          title: 'Premium Required',
          message: 'Spotify Premium is required for remote playback.'
        });
      } else {
        showConfirmDialog({
          type: 'error',
          title: 'Playback Failed',
          message: `Failed to play on Spotify. Error: ${response.status}`
        });
      }
      return false;
    }
  } catch (error) {
    console.error('Spotify Connect error:', error);
    showConfirmDialog({
      type: 'error',
      title: 'Spotify Error',
      message: error.message
    });
    return false;
  }
};

// Get current playback state from Spotify
const getCurrentPlaybackState = async () => {
  if (!spotifyToken) return;

  // Don't update track info from Spotify when browser playback is active
  // This prevents overwriting the current track with whatever Spotify last played
  if (browserPlaybackActive || isExternalPlayback) {
    return;
  }

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      headers: {
        'Authorization': `Bearer ${spotifyToken}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.item) {
        const newIsPlaying = data.is_playing;
        const newProgress = data.progress_ms / 1000;
        const newTrackId = `spotify-${data.item.id}`;

        // Only update if something changed
        if (isPlaying !== newIsPlaying) {
          setIsPlaying(newIsPlaying);
        }

        // Update progress (always, for smooth progress bar)
        setProgress(newProgress);

        // Only update track if it's different
        if (currentTrack?.id !== newTrackId) {
          setCurrentTrack({
            id: newTrackId,
            title: data.item.name,
            artist: data.item.artists.map(a => a.name).join(', '),
            album: data.item.album.name,
            duration: data.item.duration_ms / 1000,
            albumArt: data.item.album.images[0]?.url,
            spotifyUri: data.item.uri,
            spotifyId: data.item.id,
            sources: ['spotify']
          });
        }
      }
    }
  } catch (error) {
    console.error('Failed to get playback state:', error);
  }
};

// Poll Spotify playback state when playing
useEffect(() => {
  if (!spotifyToken || !isPlaying) return;
  
  const currentIsSpotify = currentTrack?.sources?.spotify || currentTrack?.spotifyUri;
  if (!currentIsSpotify) return;
  
  // Poll every 5 seconds (reduced from 2 to minimize flickering)
  const interval = setInterval(() => {
    getCurrentPlaybackState();
  }, 5000);
  
  return () => clearInterval(interval);
}, [spotifyToken, isPlaying, currentTrack]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return React.createElement('div', {
    className: 'h-screen bg-gray-100 text-gray-900 flex flex-col'
  },

    // Main content with sidebar (no separate header - search is in sidebar)
    React.createElement('div', {
      className: 'flex-1 flex overflow-hidden'
    },
      // Sidebar
      React.createElement('div', {
        className: 'w-64 bg-gray-50 border-r border-gray-200 flex flex-col no-drag',
        onDragOver: (e) => {
          // Show Add to Playlist panel when dragging a track over sidebar
          if (draggingTrackForPlaylist && !addToPlaylistPanel.open) {
            e.preventDefault();
            setAddToPlaylistPanel({
              open: true,
              tracks: [draggingTrackForPlaylist],
              sourceName: draggingTrackForPlaylist.title,
              sourceType: 'track'
            });
            setSelectedPlaylistsForAdd([]);
          }
        }
      },
        // Draggable title bar area (space for macOS traffic lights)
        React.createElement('div', {
          className: 'h-8 drag flex-shrink-0'
        }),
        // Navigation arrows
        React.createElement('div', {
          className: 'flex items-center gap-2 px-4 pb-2'
        },
          React.createElement('button', {
            onClick: navigateBack,
            disabled: viewHistory.length <= 1,
            className: `p-1.5 rounded hover:bg-gray-200 transition-colors no-drag ${viewHistory.length <= 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600'}`
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 19l-7-7 7-7' })
            )
          ),
          React.createElement('button', {
            disabled: true, // Forward not implemented yet
            className: 'p-1.5 rounded text-gray-300 cursor-not-allowed no-drag'
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 5l7 7-7 7' })
            )
          )
        ),

        // Search - navigates to search page
        React.createElement('div', { className: 'px-4 py-2' },
          React.createElement('button', {
            className: `w-full flex items-center gap-2 text-gray-500 hover:text-gray-700 cursor-pointer transition-colors ${
              activeView === 'search' ? 'text-gray-900 font-medium' : ''
            }`,
            onClick: () => navigateTo('search')
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
            ),
            React.createElement('span', { className: 'text-sm' }, 'SEARCH')
          )
        ),

        // Scrollable navigation area
        React.createElement('div', { className: 'flex-1 overflow-y-auto scrollable-content px-2 py-2' },
          // DISCOVER section
          React.createElement('div', { className: 'mb-4' },
            React.createElement('div', { className: 'px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Discover'),
            React.createElement('button', {
              onClick: () => {
                navigateTo('discover');
                loadCharts();
              },
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeView === 'discover' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`
            },
              // Bar chart icon for Charts
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' })
              ),
              'Pop of the Tops'
            ),
            // TODO: New Releases - commented out for now, may come back to it later
            // React.createElement('button', {
            //   onClick: () => navigateTo('new-releases'),
            //   className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
            //     activeView === 'new-releases' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
            //   }`
            // },
            //   // Sparkles icon for New Releases
            //   React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            //     React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' })
            //   ),
            //   'New Releases'
            // ),
            React.createElement('button', {
              onClick: () => {
                navigateTo('critics-picks');
                loadCriticsPicks();
              },
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeView === 'critics-picks' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`
            },
              // Award/trophy icon for Critical Darlings
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 3h14a1 1 0 011 1v3a7 7 0 01-7 7 7 7 0 01-7-7V4a1 1 0 011-1zM8.5 21h7M12 17v4M8 14l-3-3m11 3l3-3' })
              ),
              "Critical Darlings"
            )
          ),

          // YOUR MUSIC section
          React.createElement('div', { className: 'mb-4' },
            React.createElement('div', { className: 'px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Your Music'),
            React.createElement('button', {
              onClick: () => navigateTo('library'),
              onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
              onDragEnter: (e) => { e.preventDefault(); setCollectionDropHighlight(true); },
              onDragLeave: (e) => { e.preventDefault(); setCollectionDropHighlight(false); },
              onDrop: handleCollectionDrop,
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                collectionDropHighlight ? 'bg-purple-100 border-2 border-purple-400 text-purple-700' :
                activeView === 'library' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`
            },
              React.createElement('svg', { className: 'w-4 h-4 flex-shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' })
              ),
              'Collection',
              sidebarBadges.collection && React.createElement('span', {
                key: `collection-badge-${Date.now()}`,
                className: 'ml-auto text-xs bg-purple-500 text-white px-1.5 py-0.5 rounded-full sidebar-badge'
              }, `+${sidebarBadges.collection}`)
            ),
            React.createElement('button', {
              onClick: () => navigateTo('playlists'),
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeView === 'playlists' || activeView === 'playlist-view' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`
            },
              React.createElement('svg', { className: 'w-4 h-4 flex-shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 6h16M4 10h16M4 14h16M4 18h16' })
              ),
              'Playlists',
              sidebarBadges.playlists && React.createElement('span', {
                key: `playlists-badge-${Date.now()}`,
                className: 'ml-auto text-xs bg-purple-500 text-white px-1.5 py-0.5 rounded-full sidebar-badge'
              }, `+${sidebarBadges.playlists}`)
            ),
            React.createElement('button', {
              onClick: () => {}, // Placeholder
              className: 'w-full flex items-center gap-3 px-3 py-2 rounded text-sm text-gray-400 cursor-not-allowed'
            },
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z' })
              ),
              'Stations'
            ),
            React.createElement('button', {
              onClick: () => {}, // Placeholder
              className: 'w-full flex items-center gap-3 px-3 py-2 rounded text-sm text-gray-400 cursor-not-allowed'
            },
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' })
              ),
              'History'
            )
          )
        ),

        // Settings button at bottom of sidebar
        React.createElement('div', { className: 'p-4 border-t border-gray-200' },
          React.createElement('button', {
            onClick: () => navigateTo('settings'),
            className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
              activeView === 'settings' ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'
            }`
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' }),
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' })
            ),
            'Settings'
          )
        )
      ),

      // Toast notification
      toast && React.createElement('div', {
        className: `fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg transition-all ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`
      }, toast.message),

      // Main content area
      React.createElement('div', {
        className: 'flex-1 flex flex-col overflow-hidden bg-white'
      },

    // External Track Prompt Modal
    showExternalPrompt && pendingExternalTrack && React.createElement('div', {
      className: 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'
    },
      React.createElement('div', {
        className: 'bg-white rounded-lg p-8 max-w-md w-full mx-4 border border-gray-200 shadow-xl relative'
      },
        // Close button
        React.createElement('button', {
          onClick: () => {
            // Clear the auto-skip timeout
            if (externalTrackTimeoutRef.current) {
              clearTimeout(externalTrackTimeoutRef.current);
              externalTrackTimeoutRef.current = null;
            }
            // Pause playback and dismiss the prompt
            setIsPlaying(false);
            setShowExternalPrompt(false);
            setPendingExternalTrack(null);
            console.log('⏸️ User dismissed external track prompt, pausing playback');
          },
          className: 'absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors',
          title: 'Dismiss and pause'
        }, React.createElement(X, { size: 20 })),
        React.createElement('div', { className: 'text-center mb-6' },
          React.createElement('div', { className: 'text-6xl mb-4' }, '🌐'),
          React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-2' },
            'Next track requires browser'
          ),
          React.createElement('div', { className: 'text-gray-600 mb-4' },
            React.createElement('div', { className: 'font-medium text-gray-900' }, pendingExternalTrack.title),
            React.createElement('div', { className: 'text-sm text-gray-500' }, pendingExternalTrack.artist),
            React.createElement('div', { className: 'text-xs text-purple-600 mt-2' },
              'via ',
              (allResolvers.find(r =>
                r.id === (pendingExternalTrack.bandcampUrl ? 'bandcamp' :
                         pendingExternalTrack.youtubeUrl || pendingExternalTrack.youtubeId ? 'youtube' : 'unknown')
              )?.name || 'External')
            )
          ),
          React.createElement('div', { className: 'text-xs text-gray-400 mb-6' },
            'Auto-skipping in 15 seconds...'
          )
        ),
        React.createElement('div', { className: 'flex gap-3' },
          React.createElement('button', {
            onClick: () => handleOpenExternalTrack(pendingExternalTrack),
            className: 'flex-1 bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-lg font-medium transition-colors'
          }, 'Open in Browser'),
          React.createElement('button', {
            onClick: handleSkipExternalTrack,
            className: 'flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-3 px-4 rounded-lg font-medium transition-colors'
          }, 'Skip Track')
        )
      )
    ),

    // Search Page - Full page search view
    activeView === 'search' ? (
      searchDetailCategory ?
        // DETAIL VIEW - Similar structure to artist page with collapsible header
        React.createElement('div', {
          className: 'flex-1 flex flex-col bg-white',
          style: { overflow: 'hidden' }
        },
          // Header section (outside scrollable area) - uses preview artist image as background
          React.createElement('div', {
            className: 'relative',
            style: {
              height: searchHeaderCollapsed ? '70px' : '120px',
              flexShrink: 0,
              transition: 'height 300ms ease',
              overflow: 'hidden'
            }
          },
            // Background image (blurred preview artist image or gray fallback)
            searchPreviewArtistImage?.url ?
              React.createElement('div', {
                className: 'absolute inset-0',
                style: {
                  backgroundImage: `url(${searchPreviewArtistImage.url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center 30%',
                  filter: 'blur(20px)',
                  transform: 'scale(1.1)'
                }
              })
            :
              React.createElement('div', {
                className: 'absolute inset-0 bg-gray-400'
              }),
            // Dark overlay for readability
            React.createElement('div', {
              className: 'absolute inset-0',
              style: {
                background: 'rgba(0,0,0,0.4)'
              }
            }),
            // Header content - single row layout
            React.createElement('div', {
              className: 'absolute inset-0 flex items-center px-8 z-10'
            },
              // Left: Search icon + query
              React.createElement('div', { className: 'flex items-center gap-3' },
                React.createElement('svg', { className: 'w-5 h-5 text-white/70', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                ),
                React.createElement('input', {
                  type: 'text',
                  value: searchQuery,
                  onChange: (e) => handleSearchInput(e.target.value),
                  className: 'text-2xl font-light text-white bg-transparent border-none outline-none placeholder-white/50 uppercase tracking-widest',
                  placeholder: 'Search...',
                  style: { textShadow: '0 1px 10px rgba(0,0,0,0.3)', width: '200px' }
                })
              ),
              // Spacer
              React.createElement('div', { className: 'flex-1' }),
              // Center-right: Category tabs
              React.createElement('div', {
                className: 'flex items-center gap-6',
                style: { textShadow: '0 1px 10px rgba(0,0,0,0.3)' }
              },
                React.createElement('button', {
                  onClick: () => { setSearchDetailCategory('artists'); setSearchPreviewItem(searchResults.artists[0] || null); },
                  className: `text-sm font-medium transition-colors ${searchDetailCategory === 'artists' ? 'text-white' : 'text-white/60 hover:text-white'}`
                }, `${searchResults.artists.length} Artists`),
                React.createElement('button', {
                  onClick: () => { setSearchDetailCategory('albums'); setSearchPreviewItem(searchResults.albums[0] || null); },
                  className: `text-sm font-medium transition-colors ${searchDetailCategory === 'albums' ? 'text-white' : 'text-white/60 hover:text-white'}`
                }, `${searchResults.albums.length} Albums`),
                React.createElement('button', {
                  onClick: () => { setSearchDetailCategory('tracks'); setSearchPreviewItem(searchResults.tracks[0] || null); },
                  className: `text-sm font-medium transition-colors ${searchDetailCategory === 'tracks' ? 'text-white' : 'text-white/60 hover:text-white'}`
                }, `${searchResults.tracks.length} Songs`)
              )
            )
          ),
          // Scrollable content area with two-pane layout
          React.createElement('div', {
            className: 'flex-1 overflow-y-auto bg-white scrollable-content',
            onScroll: handleSearchDetailScroll
          },
            // Two-pane layout
            React.createElement('div', { className: 'flex h-full' },
              // Left: Preview pane - no border, clean design
              React.createElement('div', { className: 'w-80 flex-shrink-0 p-6 border-r border-gray-100' },
                searchPreviewItem ? (
                  searchDetailCategory === 'artists' ?
                    // Artist preview
                    React.createElement('div', null,
                      // Artist image (from Spotify via getArtistImage) - no rounded corners
                      React.createElement('div', { className: 'w-full aspect-square bg-gray-100 mb-4 overflow-hidden' },
                        searchPreviewArtistImage?.url ?
                          React.createElement('img', {
                            src: searchPreviewArtistImage.url,
                            alt: searchPreviewItem.name,
                            className: 'w-full h-full object-cover',
                            style: searchPreviewArtistImage.facePosition ? {
                              objectPosition: `${searchPreviewArtistImage.facePosition.x}% ${searchPreviewArtistImage.facePosition.y}%`
                            } : {}
                          })
                        :
                          React.createElement('div', { className: 'w-full h-full flex items-center justify-center text-gray-300' },
                            React.createElement('svg', { className: 'w-20 h-20', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
                              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
                            )
                          )
                      ),
                      React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 mb-3' }, searchPreviewItem.name),
                      // Artist bio snippet (from Last.fm) - more lines visible
                      React.createElement('p', { className: 'text-sm text-gray-600 leading-relaxed mb-3' },
                        searchPreviewArtistBio || 'Loading biography...'
                      ),
                      React.createElement('button', {
                        onClick: () => fetchArtistData(searchPreviewItem.name),
                        className: 'text-sm text-gray-500 hover:text-gray-700 underline'
                      }, 'Read more')
                    )
                  : searchDetailCategory === 'tracks' ?
                    // Track preview - show album info
                    React.createElement('div', null,
                      React.createElement('div', { className: 'w-full aspect-square bg-gray-200 rounded-lg mb-4 flex items-center justify-center text-gray-300' },
                        React.createElement('svg', { className: 'w-20 h-20', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
                          React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
                          React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
                          React.createElement('circle', { cx: 12, cy: 12, r: 6, strokeDasharray: '2 2' })
                        )
                      ),
                      React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-1' }, searchPreviewItem.album || 'Unknown Album'),
                      React.createElement('p', { className: 'text-sm text-gray-600' }, searchPreviewItem.artist)
                    )
                  : searchDetailCategory === 'albums' ?
                    // Album preview
                    React.createElement('div', null,
                      React.createElement('div', { className: 'w-full aspect-square bg-gray-200 rounded-lg mb-4 overflow-hidden relative' },
                        // Placeholder always rendered behind
                        React.createElement('div', { className: 'absolute inset-0 flex items-center justify-center text-gray-300' },
                          React.createElement('svg', { className: 'w-20 h-20', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
                            React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
                            React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
                            React.createElement('circle', { cx: 12, cy: 12, r: 6, strokeDasharray: '2 2' })
                          )
                        ),
                        searchPreviewItem.albumArt && React.createElement('img', {
                          src: searchPreviewItem.albumArt,
                          alt: searchPreviewItem.title,
                          className: 'absolute inset-0 w-full h-full object-cover',
                          onError: (e) => { e.target.style.display = 'none'; }
                        })
                      ),
                      React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-1' }, searchPreviewItem.title),
                      React.createElement('p', { className: 'text-sm text-gray-600' }, searchPreviewItem['artist-credit']?.[0]?.name || 'Unknown Artist'),
                      React.createElement('p', { className: 'text-sm text-gray-500' },
                        `${searchPreviewItem['first-release-date']?.split('-')[0] || ''} • ${searchPreviewItem['primary-type'] || 'Album'}`
                      )
                    )
                  :
                    // Playlists preview
                    React.createElement('div', null,
                      // 2x2 grid placeholder
                      React.createElement('div', { className: 'w-full aspect-square bg-gray-200 rounded-lg mb-4 grid grid-cols-2 gap-0.5 overflow-hidden' },
                        React.createElement('div', { className: 'bg-gray-300' }),
                        React.createElement('div', { className: 'bg-gray-300' }),
                        React.createElement('div', { className: 'bg-gray-300' }),
                        React.createElement('div', { className: 'bg-gray-300' })
                      ),
                      React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-1' }, searchPreviewItem.title),
                      searchPreviewItem.creator && React.createElement('p', { className: 'text-sm text-gray-600' }, searchPreviewItem.creator),
                      React.createElement('p', { className: 'text-sm text-gray-500' }, `${searchPreviewItem.tracks?.length || 0} tracks`)
                    )
                ) :
                  // No item selected
                  React.createElement('div', { className: 'text-gray-400 text-center py-12' }, 'No item selected')
              ),
              // Right: Results list
              React.createElement('div', { className: 'flex-1 flex flex-col' },
                // Header with SEARCH RESULTS and CLOSE button
                React.createElement('div', { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-100' },
                  React.createElement('span', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'SEARCH RESULTS'),
                  React.createElement('button', {
                    onClick: () => { setSearchDetailCategory(null); setSearchPreviewItem(null); },
                    className: 'flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors border border-gray-200 rounded px-3 py-1'
                  },
                    'CLOSE',
                    React.createElement('svg', { className: 'w-3 h-3', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                    )
                  )
                ),

                // Scrollable list
                React.createElement('div', {
                  className: 'flex-1 overflow-y-auto'
                },
                  searchDetailCategory === 'artists' && searchResults.artists.map((artist, index) =>
                    React.createElement('div', {
                      key: artist.id,
                      className: `group flex items-center px-6 py-3 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors ${searchPreviewItem?.id === artist.id ? 'bg-gray-100' : ''}`,
                      onMouseEnter: () => setSearchPreviewItem(artist),
                      onMouseLeave: () => setSearchPreviewItem(searchResults.artists[0] || null),
                      onClick: () => fetchArtistData(artist.name),
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'artist',
                          artist: {
                            id: (artist.name || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, ''),
                            name: artist.name,
                            image: null
                          }
                        }));
                      },
                      onContextMenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.electronAPI.showContextMenu({
                          type: 'artist',
                          artist: {
                            id: (artist.name || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, ''),
                            name: artist.name,
                            image: null
                          }
                        });
                      }
                    },
                      // Row number
                      React.createElement('span', { className: 'w-10 text-sm text-gray-400' }, String(index + 1).padStart(2, '0')),
                      // Artist name
                      React.createElement('span', { className: 'flex-1 font-medium text-gray-900' }, artist.name),
                      // Album count
                      React.createElement('span', { className: 'w-28 text-sm text-gray-500' },
                        `${artist['release-count'] || '-'} Albums`
                      ),
                      // Song count - hidden on hover, replaced by action icons
                      React.createElement('span', { className: 'w-28 text-sm text-gray-500 text-right group-hover:hidden' },
                        `${artist['recording-count'] || '-'} songs`
                      ),
                      // Action icons - shown on hover
                      React.createElement('div', { className: 'w-28 hidden group-hover:flex items-center justify-end gap-3' },
                        // Signal/wifi icon
                        React.createElement('button', {
                          onClick: (e) => { e.stopPropagation(); },
                          className: 'text-gray-400 hover:text-gray-600'
                        },
                          React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0' })
                          )
                        ),
                        // Menu/list icon
                        React.createElement('button', {
                          onClick: (e) => { e.stopPropagation(); },
                          className: 'text-gray-400 hover:text-gray-600'
                        },
                          React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 6h16M4 12h16M4 18h16' })
                          )
                        ),
                        // Play icon
                        React.createElement('button', {
                          onClick: (e) => { e.stopPropagation(); },
                          className: 'text-gray-400 hover:text-gray-600'
                        },
                          React.createElement('svg', { className: 'w-4 h-4', fill: 'currentColor', viewBox: '0 0 24 24' },
                            React.createElement('path', { d: 'M8 5v14l11-7z' })
                          )
                        )
                      )
                    )
                  ),
                  // Tracks list
                  searchDetailCategory === 'tracks' && searchResults.tracks.map((track, index) =>
                    React.createElement('div', {
                      key: track.id,
                      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors ${searchPreviewItem?.id === track.id ? 'bg-gray-100' : ''}`,
                      onMouseEnter: () => setSearchPreviewItem(track),
                      onMouseLeave: () => setSearchPreviewItem(searchResults.tracks[0] || null),
                      onClick: () => handlePlay(track),
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'track',
                          track: {
                            id: track.id,
                            title: track.title,
                            artist: track.artist,
                            album: track.album,
                            duration: track.duration,
                            albumArt: track.albumArt,
                            sources: track.sources || {}
                          }
                        }));
                      },
                      onContextMenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.electronAPI.showContextMenu({
                          type: 'track',
                          track: {
                            id: track.id,
                            title: track.title,
                            artist: track.artist,
                            album: track.album,
                            duration: track.duration,
                            albumArt: track.albumArt,
                            sources: track.sources || {}
                          }
                        });
                      }
                    },
                      // Row number
                      React.createElement('span', { className: 'w-10 text-sm text-gray-400' }, String(index + 1).padStart(2, '0')),
                      // Track title
                      React.createElement('span', { className: 'flex-1 font-medium text-gray-900 truncate' }, track.title),
                      // Artist
                      React.createElement('span', { className: 'w-40 text-sm text-gray-600 truncate' }, track.artist),
                      // Album
                      React.createElement('span', { className: 'w-40 text-sm text-gray-500 truncate' }, track.album || '-'),
                      // Resolver badges
                      React.createElement('div', { className: 'w-32 flex gap-1 justify-end' },
                        track.sources && Object.keys(track.sources).length > 0 ?
                          Object.keys(track.sources).map(source => {
                            const colors = {
                              spotify: 'bg-green-100 text-green-700',
                              youtube: 'bg-red-100 text-red-700',
                              bandcamp: 'bg-cyan-100 text-cyan-700',
                              qobuz: 'bg-blue-100 text-blue-700'
                            };
                            return React.createElement('span', {
                              key: source,
                              className: `text-xs px-1.5 py-0.5 rounded ${colors[source] || 'bg-gray-100 text-gray-600'}`
                            }, source);
                          })
                        : null
                      )
                    )
                  ),
                  // Albums list
                  searchDetailCategory === 'albums' && searchResults.albums.map((album, index) =>
                    React.createElement('div', {
                      key: album.id,
                      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors ${searchPreviewItem?.id === album.id ? 'bg-gray-100' : ''}`,
                      onMouseEnter: () => {
                        setSearchPreviewItem(album);
                        // Prefetch album tracks on hover for context menu
                        prefetchSearchAlbumTracks(album);
                      },
                      onMouseLeave: () => setSearchPreviewItem(searchResults.albums[0] || null),
                      onClick: () => handleAlbumClick(album),
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'album',
                          album: {
                            id: `${album['artist-credit']?.[0]?.name || 'unknown'}-${album.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                            title: album.title,
                            artist: album['artist-credit']?.[0]?.name || 'Unknown',
                            year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                            art: searchAlbumArt[album.id] || null
                          }
                        }));
                      },
                      onContextMenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const artistName = album['artist-credit']?.[0]?.name || 'Unknown';
                        const albumData = {
                          title: album.title,
                          artist: artistName,
                          year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                          art: searchAlbumArt[album.id] || null
                        };
                        // Check prefetched cache (use ref) and loading state (use module-level Set)
                        const prefetched = prefetchedReleasesRef.current[album.id];
                        const isLoading = prefetchInProgress.has(album.id);
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: album.title,
                          album: albumData,
                          tracks: prefetched?.tracks || [],
                          loading: isLoading
                        });
                      }
                    },
                      // Row number
                      React.createElement('span', { className: 'w-10 text-sm text-gray-400' }, String(index + 1).padStart(2, '0')),
                      // Album title
                      React.createElement('span', { className: 'flex-1 font-medium text-gray-900 truncate' }, album.title),
                      // Artist
                      React.createElement('span', { className: 'w-40 text-sm text-gray-600 truncate' }, album['artist-credit']?.[0]?.name || 'Unknown'),
                      // Year
                      React.createElement('span', { className: 'w-20 text-sm text-gray-500 text-center' }, album['first-release-date']?.split('-')[0] || '-'),
                      // Release type
                      React.createElement('span', { className: 'w-24 text-sm text-gray-500 text-right capitalize' }, album['primary-type'] || 'Album')
                    )
                  ),
                  // Playlists list
                  searchDetailCategory === 'playlists' && searchResults.playlists.map((playlist, index) =>
                    React.createElement('div', {
                      key: playlist.title,
                      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${searchPreviewItem?.title === playlist.title ? 'bg-gray-100' : ''}`,
                      onMouseEnter: () => setSearchPreviewItem(playlist),
                      onMouseLeave: () => setSearchPreviewItem(searchResults.playlists[0] || null),
                      onClick: () => handlePlaylistClick(playlist)
                    },
                      // Row number
                      React.createElement('span', { className: 'w-10 text-sm text-gray-400' }, String(index + 1).padStart(2, '0')),
                      // Playlist title
                      React.createElement('span', { className: 'flex-1 font-medium text-gray-900 truncate' }, playlist.title),
                      // Creator/Author
                      React.createElement('span', { className: 'w-40 text-sm text-gray-600 truncate' }, playlist.creator || '-'),
                      // Track count
                      React.createElement('span', { className: 'w-24 text-sm text-gray-500 text-right' }, `${playlist.tracks?.length || 0} tracks`)
                    )
                  )
                )
              )
            ) // end two-pane layout
          ) // end scrollable content
        ) // end detail view container
      :
        // MAIN VIEW - clean white layout matching reference
        React.createElement('div', {
          className: 'h-full overflow-y-auto bg-white'
        },
          // Header bar with SEARCH title and CLOSE button
          React.createElement('div', { className: 'flex items-center gap-4 px-8 py-4 border-b border-gray-100' },
            React.createElement('span', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'SEARCH'),
            React.createElement('button', {
              onClick: () => navigateBack(),
              className: 'flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors border border-gray-200 rounded px-3 py-1'
            },
              'CLOSE',
              React.createElement('svg', { className: 'w-3 h-3', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
              )
            )
          ),

          // Content area
          React.createElement('div', { className: 'px-8 py-6' },
        // Main view content
        React.createElement('div', null,
          // Large search input with cursor styling
          React.createElement('div', { className: 'mb-8' },
            React.createElement('input', {
              ref: (el) => el && activeView === 'search' && !searchQuery && el.focus(),
              type: 'text',
              value: searchQuery,
              onChange: (e) => handleSearchInput(e.target.value),
              placeholder: '',
              className: 'w-full text-6xl font-extralight text-gray-900 bg-transparent border-none outline-none tracking-tight',
              style: {
                caretColor: '#9ca3af',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }
            })
          ),

        // Results area
        // Show skeletons when no query or when searching
        (!searchQuery || isSearching) ?
          // Loading skeletons
          React.createElement('div', { className: 'space-y-10' },
            // Artists skeleton
            React.createElement('div', null,
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'ARTISTS'),
              React.createElement('div', { className: 'flex gap-4 overflow-hidden' },
                ...Array(7).fill(null).map((_, i) =>
                  React.createElement('div', { key: `artist-skeleton-${i}`, className: 'flex-shrink-0 w-28' },
                    React.createElement('div', {
                      className: 'w-28 h-28 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 mb-2 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-3 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 w-3/4 mb-1 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 50}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-2 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 w-1/2 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 100}ms` }
                    })
                  )
                )
              )
            ),
            // Songs skeleton
            React.createElement('div', null,
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'SONGS'),
              React.createElement('div', { className: 'flex gap-4 overflow-hidden' },
                ...Array(7).fill(null).map((_, i) =>
                  React.createElement('div', { key: `track-skeleton-${i}`, className: 'flex-shrink-0 w-28' },
                    React.createElement('div', {
                      className: 'w-28 h-28 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 mb-2 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-3 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 w-3/4 mb-1 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 50}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-2 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 w-1/2 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 100}ms` }
                    })
                  )
                )
              )
            )
          )
        :
        // No results state
        searchResults.artists.length === 0 &&
        searchResults.albums.length === 0 &&
        searchResults.tracks.length === 0 &&
        searchResults.playlists.length === 0 ?
          React.createElement('div', { className: 'text-center py-12 text-gray-400' },
            `No results found for "${searchQuery}"`
          )
        :
        // Results
        React.createElement('div', { className: 'space-y-10' },
          // Artists section with image cards
          searchResults.artists.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'ARTISTS'),
              searchResults.artists.length > 7 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('artists');
                    setSearchPreviewItem(searchResults.artists[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', { className: 'flex gap-4 overflow-hidden' },
              ...searchResults.artists.slice(0, 7).map(artist =>
                React.createElement(SearchArtistCard, {
                  key: artist.id,
                  artist: artist,
                  onClick: () => fetchArtistData(artist.name),
                  getArtistImage: getArtistImage,
                  onContextMenu: (artist) => {
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      window.electron.contextMenu.showTrackMenu({
                        type: 'artist',
                        artist: {
                          id: (artist.name || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, ''),
                          name: artist.name,
                          image: null
                        }
                      });
                    }
                  }
                })
              )
            )
          ),

          // Songs/Tracks section with album art cards
          searchResults.tracks.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'SONGS'),
              searchResults.tracks.length > 7 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('tracks');
                    setSearchPreviewItem(searchResults.tracks[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', { className: 'flex gap-4 overflow-hidden' },
              ...searchResults.tracks.slice(0, 7).map(track =>
                React.createElement('button', {
                  key: track.id,
                  onClick: () => handlePlay(track),
                  className: 'flex-shrink-0 w-28 text-left group cursor-grab active:cursor-grabbing',
                  draggable: true,
                  onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                      type: 'track',
                      track: {
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        album: track.album,
                        duration: track.duration,
                        albumArt: track.albumArt,
                        sources: track.sources || {}
                      }
                    }));
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      window.electron.contextMenu.showTrackMenu({
                        type: 'track',
                        track: {
                          id: track.id,
                          title: track.title,
                          artist: track.artist,
                          album: track.album,
                          duration: track.duration,
                          albumArt: track.albumArt,
                          sources: track.sources || {}
                        }
                      });
                    }
                  }
                },
                  // Album art square
                  React.createElement('div', { className: 'w-28 h-28 bg-gray-100 mb-2 relative overflow-hidden flex items-center justify-center' },
                    track.albumArt && React.createElement('img', {
                      src: track.albumArt,
                      alt: track.album,
                      className: 'absolute inset-0 w-full h-full object-cover',
                      onError: (e) => { e.target.style.display = 'none'; }
                    }),
                    React.createElement('svg', { className: 'w-10 h-10 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                    )
                  ),
                  // Track info
                  React.createElement('div', { className: 'text-sm font-medium text-gray-900 truncate' }, track.title),
                  React.createElement('div', { className: 'text-xs text-gray-500 truncate' }, track.artist),
                  // Resolver icons (small squares like track lists) - always render container for consistent height
                  React.createElement('div', { className: 'flex gap-1 mt-1', style: { minHeight: '18px' } },
                    ...(track.sources && Object.keys(track.sources).length > 0 ?
                      Object.keys(track.sources).slice(0, 3).map(source => {
                        const colors = {
                          spotify: '#1DB954',
                          youtube: '#FF0000',
                          bandcamp: '#1DA0C3',
                          qobuz: '#0070CC',
                          applemusic: '#FA243C'
                        };
                        const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM', localfiles: 'LO' };
                        return React.createElement('div', {
                          key: source,
                          style: {
                            width: '18px',
                            height: '18px',
                            borderRadius: '3px',
                            backgroundColor: colors[source] || '#9CA3AF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '8px',
                            fontWeight: 'bold',
                            color: 'white'
                          }
                        }, abbrevMap[source] || source.slice(0, 2).toUpperCase());
                      })
                    : [])
                  )
                )
              )
            )
          ),

          // Albums section with album art cards
          searchResults.albums.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'ALBUMS'),
              searchResults.albums.length > 5 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('albums');
                    setSearchPreviewItem(searchResults.albums[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', { className: 'flex gap-4 overflow-hidden' },
              ...searchResults.albums.slice(0, 5).map(album =>
                React.createElement('button', {
                  key: album.id,
                  onClick: () => handleAlbumClick(album),
                  onMouseEnter: () => {
                    // Prefetch album tracks on hover for context menu
                    prefetchSearchAlbumTracks(album);
                  },
                  className: 'flex-shrink-0 w-44 text-left group cursor-grab active:cursor-grabbing',
                  draggable: true,
                  onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                      type: 'album',
                      album: {
                        id: `${album['artist-credit']?.[0]?.name || 'unknown'}-${album.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                        title: album.title,
                        artist: album['artist-credit']?.[0]?.name || 'Unknown',
                        year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                        art: null
                      }
                    }));
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      const artistName = album['artist-credit']?.[0]?.name || 'Unknown';
                      const albumData = {
                        title: album.title,
                        artist: artistName,
                        year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                        art: album.albumArt || null
                      };
                      // Check prefetched cache (use ref) and loading state (use module-level Set)
                      const prefetched = prefetchedReleasesRef.current[album.id];
                      const isLoading = prefetchInProgress.has(album.id);
                      window.electron.contextMenu.showTrackMenu({
                        type: 'release',
                        name: album.title,
                        album: albumData,
                        tracks: prefetched?.tracks || [],
                        loading: isLoading
                      });
                    }
                  }
                },
                  // Album art square
                  React.createElement('div', { className: 'w-44 h-44 bg-gray-100 mb-2 relative overflow-hidden' },
                    // Placeholder always rendered behind
                    React.createElement('div', { className: 'absolute inset-0 flex items-center justify-center text-gray-300' },
                      React.createElement('svg', { className: 'w-16 h-16', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
                        React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
                        React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
                        React.createElement('circle', { cx: 12, cy: 12, r: 6, strokeDasharray: '2 2' })
                      )
                    ),
                    album.albumArt && React.createElement('img', {
                      src: album.albumArt,
                      alt: album.title,
                      className: 'absolute inset-0 w-full h-full object-cover',
                      onError: (e) => { e.target.style.display = 'none'; }
                    })
                  ),
                  // Album info
                  React.createElement('div', { className: 'text-sm font-medium text-gray-900 truncate' }, album.title),
                  React.createElement('div', { className: 'text-xs text-gray-500 truncate' },
                    `${album['artist-credit']?.[0]?.name || 'Unknown'} • ${album['first-release-date']?.split('-')[0] || ''}`
                  )
                )
              )
            )
          ),

          // Playlists section (kept simple)
          searchResults.playlists.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'PLAYLISTS'),
              searchResults.playlists.length > 5 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('playlists');
                    setSearchPreviewItem(searchResults.playlists[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', { className: 'flex gap-4 overflow-hidden' },
              ...searchResults.playlists.slice(0, 5).map(playlist =>
                React.createElement('button', {
                  key: playlist.title,
                  onClick: () => handlePlaylistClick(playlist),
                  className: 'flex-shrink-0 w-44 text-left'
                },
                  React.createElement('div', { className: 'text-sm font-medium text-gray-900 truncate' }, playlist.title),
                  React.createElement('div', { className: 'text-xs text-gray-500 truncate mt-1' },
                    `${playlist.tracks?.length || 0} tracks`
                  )
                )
              )
            )
          )
        )
        )
      )
    ) // end main view
    ) : // end activeView === 'search' ternary

      // Main content area - Artist Page (completely separate layout)
      activeView === 'artist' ? React.createElement('div', { 
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Artist page hero header (not inside scrollable area) - only show when NOT viewing or loading a release
        !currentRelease && !loadingRelease && React.createElement('div', {
          className: 'relative',
          style: {
            height: isHeaderCollapsed ? '80px' : '320px',
            flexShrink: 0,
            transition: 'height 300ms ease',
            overflow: 'hidden'
          }
        },
          // Background image with gradient overlay
          artistImage && React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              backgroundImage: `url(${artistImage})`,
              backgroundSize: 'cover',
              backgroundPosition: artistImagePosition,
              filter: 'blur(0px)'
            }
          }),
          // Gradient overlay for readability
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              background: artistImage
                ? isHeaderCollapsed
                  ? 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(17,17,17,0.95) 100%)'
                  : 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.6) 50%, rgba(17,17,17,1) 100%)'
                : 'linear-gradient(to bottom, rgba(60,60,80,0.4) 0%, rgba(17,17,17,1) 100%)'
            }
          }),
          // EXPANDED STATE - Artist info overlay (centered)
          !loadingRelease && currentArtist && !isHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10',
            style: {
              opacity: isHeaderCollapsed ? 0 : 1,
              transition: 'opacity 300ms ease'
            }
          },
            React.createElement('h1', {
              className: 'text-5xl font-light text-white',
              style: {
                textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                letterSpacing: '0.3em',
                textTransform: 'uppercase'
              }
            }, currentArtist.name),
            // Navigation tabs (centered)
            React.createElement('div', {
              className: 'flex items-center gap-1 mt-6',
              style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
            },
              ['music', 'biography', 'related'].map((tab, index) => [
                index > 0 && React.createElement('span', {
                  key: `sep-${tab}`,
                  className: 'text-gray-400 mx-2'
                }, '|'),
                React.createElement('button', {
                  key: tab,
                  onClick: async () => {
                    setArtistPageTab(tab);
                    // Lazy load data when tab is first clicked
                    if (tab === 'biography' && !artistBio && currentArtist) {
                      const bioData = await getArtistBio(currentArtist.name);
                      if (bioData) setArtistBio(bioData);
                    }
                    if (tab === 'related' && relatedArtists.length === 0 && currentArtist) {
                      const related = await getRelatedArtists(currentArtist.name);
                      if (related.length > 0) setRelatedArtists(related);
                    }
                  },
                  className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                    artistPageTab === tab
                      ? 'text-white'
                      : 'text-gray-400 hover:text-white'
                  }`
                }, tab === 'related' ? 'Related Artists' : tab.charAt(0).toUpperCase() + tab.slice(1))
              ]).flat().filter(Boolean)
            ),
            // Start Artist Station button
            React.createElement('button', {
              onClick: () => console.log('Start Artist Station - placeholder'),
              className: 'mt-6 px-6 py-2 rounded-full font-medium text-white no-drag transition-all hover:scale-105',
              style: {
                backgroundColor: '#E91E63',
                boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
              }
            }, 'Start Artist Station')
          ),
          // COLLAPSED STATE - Inline layout
          !loadingRelease && currentArtist && isHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-16 z-10',
            style: {
              opacity: isHeaderCollapsed ? 1 : 0,
              transition: 'opacity 300ms ease'
            }
          },
            // Left side: Artist name
            React.createElement('h1', {
              className: 'text-2xl font-light mr-6 text-white flex-shrink-0',
              style: {
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                maxWidth: '40%',
                lineHeight: '1.2'
              }
            }, currentArtist.name),
            // Center: Navigation tabs
            React.createElement('div', {
              className: 'flex items-center gap-1',
              style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
            },
              ['music', 'biography', 'related'].map((tab, index) => [
                index > 0 && React.createElement('span', {
                  key: `sep-collapsed-${tab}`,
                  className: 'text-gray-400 mx-2'
                }, '|'),
                React.createElement('button', {
                  key: `collapsed-${tab}`,
                  onClick: async () => {
                    setArtistPageTab(tab);
                    if (tab === 'biography' && !artistBio && currentArtist) {
                      const bioData = await getArtistBio(currentArtist.name);
                      if (bioData) setArtistBio(bioData);
                    }
                    if (tab === 'related' && relatedArtists.length === 0 && currentArtist) {
                      const related = await getRelatedArtists(currentArtist.name);
                      if (related.length > 0) setRelatedArtists(related);
                    }
                  },
                  className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                    artistPageTab === tab
                      ? 'text-white'
                      : 'text-gray-400 hover:text-white'
                  }`
                }, tab === 'related' ? 'Related Artists' : tab.charAt(0).toUpperCase() + tab.slice(1))
              ]).flat().filter(Boolean)
            ),
            // Right side: Start Artist Station button
            React.createElement('button', {
              onClick: () => console.log('Start Artist Station - placeholder'),
              className: 'ml-auto px-5 py-2 rounded-full font-medium text-white text-sm no-drag transition-all hover:scale-105',
              style: {
                backgroundColor: '#E91E63',
                boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
              }
            }, 'Start Artist Station')
          )
        ),
        
        // Loading state for release - show real header (already loaded), skeleton for content only
        loadingRelease && React.createElement('div', {
          className: 'flex-1 flex flex-col',
          style: { backgroundColor: 'white' }
        },
          // Real header with artist image (already loaded)
          React.createElement('div', {
            className: 'relative',
            style: { height: '80px', flexShrink: 0, overflow: 'hidden' }
          },
            // Background image
            artistImage && React.createElement('div', {
              className: 'absolute inset-0',
              style: {
                backgroundImage: `url(${artistImage})`,
                backgroundSize: 'cover',
                backgroundPosition: artistImagePosition
              }
            }),
            // Gradient overlay
            React.createElement('div', {
              className: 'absolute inset-0',
              style: {
                background: artistImage
                  ? 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(17,17,17,0.95) 100%)'
                  : 'linear-gradient(to bottom, rgba(60,60,80,0.4) 0%, rgba(17,17,17,1) 100%)'
              }
            }),
            // Artist info overlay (matching collapsed artist header)
            React.createElement('div', {
              className: 'absolute inset-0 flex items-center px-16 z-10'
            },
              // Left side: Artist name
              React.createElement('h1', {
                className: 'text-2xl font-light mr-6 text-white flex-shrink-0',
                style: {
                  textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  maxWidth: '40%',
                  lineHeight: '1.2'
                }
              }, currentArtist?.name || ''),
              // Center: Navigation tabs
              React.createElement('div', {
                className: 'flex items-center gap-1',
                style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
              },
                ['music', 'biography', 'related'].map((tab, index) => [
                  index > 0 && React.createElement('span', {
                    key: `sep-loading-${tab}`,
                    className: 'text-gray-400 mx-2'
                  }, '|'),
                  React.createElement('span', {
                    key: `loading-${tab}`,
                    className: `px-2 py-1 text-sm font-medium uppercase tracking-wider ${
                      tab === 'music' ? 'text-white' : 'text-gray-400'
                    }`
                  }, tab === 'related' ? 'Related Artists' : tab.charAt(0).toUpperCase() + tab.slice(1))
                ]).flat().filter(Boolean)
              ),
              // Right side: Start Album Station button
              React.createElement('button', {
                className: 'ml-auto px-5 py-2 rounded-full font-medium text-white text-sm no-drag transition-all hover:scale-105',
                style: {
                  backgroundColor: '#E91E63',
                  boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
                }
              }, 'Start Album Station')
            )
          ),
          // Skeleton content with white background (matching release page)
          React.createElement('div', { className: 'bg-white flex-1 p-6' },
            React.createElement('div', { className: 'flex gap-8' },
              // Left column - album art skeleton
              React.createElement('div', { className: 'w-64 flex-shrink-0' },
                React.createElement('div', {
                  className: 'aspect-square rounded-lg mb-4 animate-pulse bg-gray-100'
                }),
                React.createElement('div', {
                  className: 'h-6 rounded w-3/4 mb-2 animate-pulse bg-gray-200'
                }),
                React.createElement('div', {
                  className: 'h-4 rounded w-1/2 mb-4 animate-pulse bg-gray-100'
                })
              ),
              // Right column - track list skeleton
              React.createElement('div', { className: 'flex-1 space-y-1' },
                Array.from({ length: 8 }).map((_, i) =>
                  React.createElement('div', {
                    key: `track-skeleton-${i}`,
                    className: 'flex items-center gap-4 p-3 rounded',
                    style: { backgroundColor: i % 2 === 0 ? '#fafafa' : 'transparent' }
                  },
                    React.createElement('div', {
                      className: 'w-6 h-4 rounded animate-pulse bg-gray-100'
                    }),
                    React.createElement('div', { className: 'flex-1' },
                      React.createElement('div', {
                        className: 'h-4 rounded w-2/3 animate-pulse bg-gray-200'
                      })
                    ),
                    React.createElement('div', {
                      className: 'w-10 h-4 rounded animate-pulse bg-gray-100'
                    })
                  )
                )
              )
            )
          )
        ),
        
        // Release page - artist header (shows artist image/name/tabs at top)
        !loadingRelease && currentRelease && React.createElement('div', {
          className: 'relative',
          style: {
            height: '80px',
            flexShrink: 0,
            overflow: 'hidden'
          }
        },
          // Background image with gradient overlay
          artistImage && React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              backgroundImage: `url(${artistImage})`,
              backgroundSize: 'cover',
              backgroundPosition: artistImagePosition,
              filter: 'blur(0px)'
            }
          }),
          // Gradient overlay for readability
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              background: artistImage
                ? 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(17,17,17,0.95) 100%)'
                : 'linear-gradient(to bottom, rgba(60,60,80,0.4) 0%, rgba(17,17,17,1) 100%)'
            }
          }),
          // Artist info overlay (inline layout for release page - matches collapsed artist header)
          React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-16 z-10'
          },
            // Left side: Artist name
            React.createElement('h1', {
              className: 'text-2xl font-light mr-6 text-white cursor-pointer hover:text-purple-300 transition-colors no-drag flex-shrink-0',
              style: {
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                maxWidth: '40%',
                lineHeight: '1.2'
              },
              onClick: () => {
                const artistName = currentRelease?.artist?.name || currentArtist?.name;
                setCurrentRelease(null);
                // Ensure full artist data is loaded
                if (artistName && artistReleases.length === 0) {
                  fetchArtistData(artistName);
                }
              },
              title: 'Back to artist'
            }, currentRelease.artist?.name || currentArtist?.name),
            // Center: Navigation tabs
            React.createElement('div', {
              className: 'flex items-center gap-1',
              style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
            },
              ['music', 'biography', 'related'].map((tab, index) => [
                index > 0 && React.createElement('span', {
                  key: `sep-release-${tab}`,
                  className: 'text-gray-400 mx-2'
                }, '|'),
                React.createElement('button', {
                  key: `release-${tab}`,
                  onClick: async () => {
                    // Go back to artist page and switch to the selected tab
                    const artistName = currentRelease?.artist?.name || currentArtist?.name;
                    setCurrentRelease(null);
                    setArtistPageTab(tab);
                    // Ensure full artist data is loaded if navigating to music tab
                    if (tab === 'music' && artistName && artistReleases.length === 0) {
                      fetchArtistData(artistName);
                    }
                    if (tab === 'biography' && !artistBio && artistName) {
                      // Ensure artist data is loaded first
                      if (artistReleases.length === 0) {
                        fetchArtistData(artistName);
                      }
                      const bioData = await getArtistBio(artistName);
                      if (bioData) setArtistBio(bioData);
                    }
                    if (tab === 'related' && relatedArtists.length === 0 && artistName) {
                      // Ensure artist data is loaded first
                      if (artistReleases.length === 0) {
                        fetchArtistData(artistName);
                      }
                      const related = await getRelatedArtists(artistName);
                      if (related.length > 0) setRelatedArtists(related);
                    }
                  },
                  className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                    tab === 'music'
                      ? 'text-white'
                      : 'text-gray-400 hover:text-white'
                  }`
                }, tab === 'related' ? 'Related Artists' : tab.charAt(0).toUpperCase() + tab.slice(1))
              ]).flat().filter(Boolean)
            ),
            // Right side: Start Album Station button
            React.createElement('button', {
              onClick: () => console.log('Start Album Station - placeholder'),
              className: 'ml-auto px-5 py-2 rounded-full font-medium text-white text-sm no-drag transition-all hover:scale-105',
              style: {
                backgroundColor: '#E91E63',
                boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
              }
            }, 'Start Album Station')
          )
        ),

        // Release page content (scrollable) - new layout with album details header
        !loadingRelease && currentRelease && React.createElement('div', {
          className: 'scrollable-content bg-white',
          style: {
            flex: 1,
            overflowY: 'scroll',
            pointerEvents: 'auto'
          }
        },
          // ALBUM DETAILS section header with Close button
          React.createElement('div', {
            className: 'flex items-center justify-between px-6 py-4 border-b border-gray-200'
          },
            React.createElement('span', {
              className: 'text-xs font-medium tracking-widest text-gray-400 uppercase'
            }, 'Album Details'),
            React.createElement('button', {
              onClick: () => {
                // Clear the release view
                setCurrentRelease(null);
                // If artist releases aren't loaded, fetch full artist data
                const artistName = currentRelease?.artist?.name || currentArtist?.name;
                if (artistName && artistReleases.length === 0) {
                  fetchArtistData(artistName);
                }
              },
              className: 'flex items-center gap-1 px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors no-drag'
            },
              'CLOSE',
              React.createElement('span', { className: 'text-gray-400' }, '×')
            )
          ),
          // Two-column layout: album art + metadata on left, tracklist on right
          React.createElement(ReleasePage, {
            release: currentRelease,
            handleSearch: handleSearchInput,
            handlePlay: handlePlay,
            onTrackPlay: (track, tracksAfter) => {
              // Set queue with remaining tracks from the album, then play
              setCurrentQueue(tracksAfter);
              handlePlay(track);
            },
            onTrackContextMenu: (track) => {
              if (window.electron?.contextMenu?.showTrackMenu) {
                window.electron.contextMenu.showTrackMenu({
                  type: 'track',
                  track: track
                });
              }
            },
            trackSources: trackSources,
            resolvers: resolvers,
            // Drag and drop handlers for adding tracks to playlists
            onDragStart: (track) => {
              setDraggingTrackForPlaylist(track);
            },
            onDragEnd: () => {
              setDraggingTrackForPlaylist(null);
              setDropTargetPlaylistId(null);
              setDropTargetNewPlaylist(false);
              // Close panel if it was opened by drag and nothing was dropped
              if (addToPlaylistPanel.open && selectedPlaylistsForAdd.length === 0) {
                setAddToPlaylistPanel(prev => ({ ...prev, open: false }));
              }
            }
          })
        ),
        
        // Skeleton loading state for artist - hide when loading a release
        !currentRelease && !loadingRelease && loadingArtist && React.createElement('div', {
          className: 'flex-1'
        },
          // Skeleton header area with shimmer
          React.createElement('div', {
            className: 'relative h-48 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer',
            style: { backgroundSize: '200% 100%' }
          }),
          // Skeleton content
          React.createElement('div', { className: 'p-6' },
            // Skeleton filter buttons
            React.createElement('div', { className: 'flex gap-2 mb-4' },
              Array.from({ length: 4 }).map((_, i) =>
                React.createElement('div', {
                  key: `filter-skeleton-${i}`,
                  className: 'h-10 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded-full animate-shimmer',
                  style: { width: `${80 + i * 15}px`, backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                })
              )
            ),
            // Skeleton release count
            React.createElement('div', {
              className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded w-24 mb-6 animate-shimmer',
              style: { backgroundSize: '200% 100%' }
            }),
            // Skeleton album grid
            React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
            },
              Array.from({ length: 10 }).map((_, i) =>
                React.createElement('div', { key: `album-skeleton-${i}` },
                  React.createElement('div', {
                    className: 'aspect-square bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded-lg mb-3 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                  }),
                  React.createElement('div', {
                    className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded w-3/4 mb-2 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 25}ms` }
                  }),
                  React.createElement('div', {
                    className: 'h-3 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded w-1/2 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 50}ms` }
                  })
                )
              )
            )
          )
        ),
        
        // Artist content (scrollable) - only show if no release is being viewed or loaded
        !currentRelease && !loadingRelease && !loadingArtist && currentArtist && React.createElement('div', {
          ref: artistPageScrollRef,
          className: 'scrollable-content',
          style: {
            flex: 1,
            overflowY: 'scroll',
            pointerEvents: 'auto'
          },
          onScroll: handleArtistPageScroll
        },
          // Sticky filter bar (Music tab only)
          artistPageTab === 'music' && React.createElement('div', {
            className: 'sticky top-0 z-10 flex items-center px-6 py-3 bg-white border-b border-gray-200'
          },
            // Release type filter pills
            React.createElement('div', { className: 'flex gap-2 flex-wrap' },
              [
                { value: 'album', label: 'Studio Albums' },
                { value: 'ep', label: 'EPs' },
                { value: 'single', label: 'Singles' },
                { value: 'live', label: 'Live' },
                { value: 'compilation', label: 'Compilations' },
                { value: 'all', label: 'All' }
              ].map(({ value, label }) => {
                const searchFiltered = filterArtistReleases(artistReleases);
                const count = value === 'all'
                  ? searchFiltered.length
                  : searchFiltered.filter(r => r.releaseType === value).length;

                // Don't show filter pills with 0 count (except 'all')
                if (count === 0 && value !== 'all') return null;

                return React.createElement('button', {
                  key: value,
                  onClick: () => setReleaseTypeFilter(value),
                  className: `px-3 py-1.5 rounded-full text-sm transition-all no-drag ${
                    releaseTypeFilter === value
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`,
                }, `${label} (${count})`);
              })
            ),
            // Spacer
            React.createElement('div', { className: 'flex-1' }),
            // Sort dropdown
            React.createElement('div', { className: 'relative mr-3' },
              React.createElement('button', {
                onClick: (e) => { e.stopPropagation(); setArtistSortDropdownOpen(!artistSortDropdownOpen); },
                className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
              },
                React.createElement('span', null, artistSortOptions.find(o => o.value === artistSort)?.label || 'Sort'),
                React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                )
              ),
              // Dropdown menu
              artistSortDropdownOpen && React.createElement('div', {
                className: 'absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
              },
                artistSortOptions.map(option =>
                  React.createElement('button', {
                    key: option.value,
                    onClick: (e) => {
                      e.stopPropagation();
                      setArtistSort(option.value);
                      setArtistSortDropdownOpen(false);
                    },
                    className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                      artistSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                    }`
                  },
                    option.label,
                    artistSort === option.value && React.createElement('svg', {
                      className: 'w-4 h-4',
                      fill: 'none',
                      viewBox: '0 0 24 24',
                      stroke: 'currentColor'
                    },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                    )
                  )
                )
              )
            ),
            // Search toggle/field
            React.createElement('div', { className: 'flex items-center' },
              artistSearchOpen ?
                React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-1.5' },
                  React.createElement('input', {
                    type: 'text',
                    value: artistSearch,
                    onChange: (e) => setArtistSearch(e.target.value),
                    onBlur: () => {
                      if (!artistSearch.trim()) {
                        setArtistSearchOpen(false);
                      }
                    },
                    autoFocus: true,
                    placeholder: 'Filter...',
                    className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none',
                    style: { width: '150px' }
                  }),
                  artistSearch && React.createElement('button', {
                    onClick: () => {
                      setArtistSearch('');
                      setArtistSearchOpen(false);
                    },
                    className: 'ml-2 text-gray-400 hover:text-gray-600'
                  },
                    React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                    )
                  )
                )
              :
                React.createElement('button', {
                  onClick: () => setArtistSearchOpen(true),
                  className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors'
                },
                  React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  )
                )
            )
          ),
          // MUSIC TAB - Discography
          artistPageTab === 'music' && React.createElement('div', {
            className: 'space-y-6 p-6'
          },
            // Discography grid
            React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
            },
              sortArtistReleases(filterArtistReleases(artistReleases)).map(release =>
                React.createElement(ReleaseCard, {
                  key: release.id,
                  release: release,
                  currentArtist: currentArtist,
                  fetchReleaseData: fetchReleaseData,
                  onHoverFetch: (rel) => {
                    // Prefetch release tracks on hover for context menu
                    prefetchReleaseTracks(rel, currentArtist);
                  },
                  onContextMenu: async (rel) => {
                    // For releases, show context menu with tracks
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      const albumData = {
                        title: rel.title,
                        artist: currentArtist?.name,
                        year: rel.date?.split('-')[0] ? parseInt(rel.date.split('-')[0]) : null,
                        art: rel.albumArt
                      };
                      // Check prefetched cache first (use ref to avoid stale closure)
                      const prefetched = prefetchedReleasesRef.current[rel.id];
                      if (prefetched?.tracks?.length > 0) {
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: rel.title,
                          album: albumData,
                          tracks: prefetched.tracks
                        });
                      } else if (currentRelease?.id === rel.id && currentRelease?.tracks?.length > 0) {
                        // Use already loaded tracks from current release
                        const tracks = currentRelease.tracks.map(t => {
                          const trackId = `${currentArtist?.name || 'unknown'}-${t.title || 'untitled'}-${rel.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                          return {
                            ...t,
                            id: trackId,
                            artist: currentArtist?.name,
                            album: rel.title,
                            albumArt: rel.albumArt,
                            sources: trackSources[`${t.position}-${t.title}`] || {}
                          };
                        });
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: rel.title,
                          album: albumData,
                          tracks: tracks
                        });
                      } else {
                        // No tracks available yet - show with 0 tracks
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: rel.title,
                          album: albumData,
                          releaseId: rel.id,
                          artist: currentArtist?.name,
                          albumArt: rel.albumArt,
                          tracks: []
                        });
                      }
                    }
                  },
                  isVisible: (releaseTypeFilter === 'all' || release.releaseType === releaseTypeFilter) &&
                    (!artistSearch.trim() || release.title.toLowerCase().includes(artistSearch.toLowerCase()))
                })
              )
            ),

            // Empty state
            (() => {
              const filtered = sortArtistReleases(filterArtistReleases(artistReleases));
              const typeFiltered = filtered.filter(r => releaseTypeFilter === 'all' || r.releaseType === releaseTypeFilter);
              if (typeFiltered.length === 0) {
                const typeLabels = {
                  all: '',
                  album: 'studio albums',
                  live: 'live albums',
                  compilation: 'compilations',
                  ep: 'EPs',
                  single: 'singles'
                };
                return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                  artistSearch.trim()
                    ? `No releases matching "${artistSearch}"`
                    : `No ${typeLabels[releaseTypeFilter] || releaseTypeFilter} found`
                );
              }
              return null;
            })()
          ),

          // BIOGRAPHY TAB
          artistPageTab === 'biography' && React.createElement('div', {
            className: 'max-w-3xl mx-auto p-6'
          },
            // Loading state - skeleton paragraphs
            loadingBio && React.createElement('div', { className: 'space-y-4' },
              // First paragraph skeleton (longer)
              React.createElement('div', { className: 'space-y-2' },
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%' } }),
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '50ms' } }),
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-11/12', style: { backgroundSize: '200% 100%', animationDelay: '100ms' } }),
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-4/5', style: { backgroundSize: '200% 100%', animationDelay: '150ms' } })
              ),
              // Second paragraph skeleton
              React.createElement('div', { className: 'space-y-2' },
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '200ms' } }),
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '250ms' } }),
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-3/4', style: { backgroundSize: '200% 100%', animationDelay: '300ms' } })
              ),
              // Third paragraph skeleton (shorter)
              React.createElement('div', { className: 'space-y-2' },
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '350ms' } }),
                React.createElement('div', { className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer w-2/3', style: { backgroundSize: '200% 100%', animationDelay: '400ms' } })
              )
            ),
            // Bio content
            !loadingBio && artistBio && React.createElement('div', { className: 'space-y-4' },
              React.createElement('div', {
                className: 'text-sm text-gray-700 leading-relaxed whitespace-pre-wrap'
              }, artistBio.bio),
              artistBio.url && React.createElement('a', {
                href: artistBio.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'inline-block mt-4 text-purple-600 hover:text-purple-700 text-sm'
              }, 'Read more on Last.fm →')
            ),
            // No bio found
            !loadingBio && !artistBio && React.createElement('div', {
              className: 'text-center py-12 text-gray-400'
            }, 'No biography available for this artist.')
          ),

          // RELATED ARTISTS TAB
          artistPageTab === 'related' && React.createElement('div', { className: 'p-6' },
            // Loading state - skeleton grid
            loadingRelated && React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
            },
              Array.from({ length: 10 }).map((_, i) =>
                React.createElement('div', {
                  key: `skeleton-${i}`,
                  className: 'flex flex-col'
                },
                  // Square image skeleton
                  React.createElement('div', {
                    className: 'w-full aspect-square bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer mb-2',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                  }),
                  // Name skeleton
                  React.createElement('div', {
                    className: 'h-4 w-3/4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 50}ms` }
                  })
                )
              )
            ),
            // Related artists grid (sorted by match, highest first)
            !loadingRelated && relatedArtists.length > 0 && React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
            },
              [...relatedArtists].sort((a, b) => b.match - a.match).map((artist, index) =>
                React.createElement(RelatedArtistCard, {
                  key: `related-${index}`,
                  artist: artist,
                  getArtistImage: getArtistImage,
                  onNavigate: () => fetchArtistData(artist.name)
                })
              )
            ),
            // No related artists found
            !loadingRelated && relatedArtists.length === 0 && React.createElement('div', {
              className: 'text-center py-12 text-gray-400'
            }, 'No related artists found.')
          )
        )
      )
      
      // Main content area - Playlist Page (new design matching album page layout)
      : activeView === 'playlist-view' && selectedPlaylist ? React.createElement('div', {
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Playlist hero header (similar to Playlists main page)
        React.createElement('div', {
          className: 'relative',
          style: {
            height: '140px',
            flexShrink: 0,
            overflow: 'hidden'
          }
        },
          // Background with first album art or gradient
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              backgroundImage: playlistCoverArt[0]
                ? `url(${playlistCoverArt[0]})`
                : 'linear-gradient(to bottom right, #f43f5e, #ec4899, #c026d3)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(20px) brightness(0.7)',
              transform: 'scale(1.2)'
            }
          }),
          // Gradient overlay
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(17,17,17,0.95) 100%)'
            }
          }),
          // Header content
          React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-8 z-10'
          },
            // Playlist icon
            React.createElement('div', {
              className: 'w-6 h-6 rounded-full bg-white/20 flex items-center justify-center mr-3'
            },
              React.createElement('svg', { className: 'w-3 h-3 text-white', fill: 'currentColor', viewBox: '0 0 24 24' },
                React.createElement('circle', { cx: '12', cy: '12', r: '10' })
              )
            ),
            // Playlist name
            React.createElement('h1', {
              className: 'text-2xl font-bold text-white mr-8',
              style: {
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
              }
            }, selectedPlaylist.title),
            // Stats
            React.createElement('div', {
              className: 'flex items-center gap-6 text-white/80 text-sm'
            },
              // Count unique artists
              React.createElement('span', null, `${new Set(playlistTracks.map(t => t.artist)).size} Artists`),
              // Count unique albums
              React.createElement('span', null, `${new Set(playlistTracks.filter(t => t.album).map(t => t.album)).size} Albums`),
              React.createElement('span', null, `${playlistTracks.length} Songs`)
            ),
            // Start Playlist Station button
            React.createElement('button', {
              onClick: () => console.log('Start Playlist Station - placeholder'),
              className: 'ml-auto px-5 py-2 rounded-full font-medium text-white text-sm no-drag transition-all hover:scale-105',
              style: {
                backgroundColor: '#E91E63',
                boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
              }
            }, 'Start Playlist Station')
          )
        ),

        // Playlist content (scrollable) - white background with new layout
        React.createElement('div', {
          className: 'scrollable-content bg-white',
          style: {
            flex: 1,
            overflowY: 'scroll',
            pointerEvents: 'auto'
          }
        },
          // PLAYLIST DETAILS section header with Close button
          React.createElement('div', {
            className: 'flex items-center justify-between px-6 py-4 border-b border-gray-200'
          },
            React.createElement('span', {
              className: 'text-xs font-medium tracking-widest text-gray-400 uppercase'
            }, 'Playlist Details'),
            React.createElement('button', {
              onClick: () => {
                setSelectedPlaylist(null);
                setPlaylistTracks([]);
                setPlaylistCoverArt([]);
                navigateTo('playlists');
              },
              className: 'flex items-center gap-1 px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors no-drag'
            },
              'CLOSE',
              React.createElement('span', { className: 'text-gray-400' }, '×')
            )
          ),

          // Two-column layout: playlist cover + metadata on left, tracklist on right
          React.createElement('div', { className: 'flex gap-0 p-6' },
            // LEFT COLUMN: 2x2 album art grid and metadata
            React.createElement('div', {
              className: 'flex-shrink-0 pr-8',
              style: { width: '240px' }
            },
              // 2x2 Album art grid
              React.createElement('div', {
                className: 'w-48 h-48 rounded shadow-lg overflow-hidden',
                style: {
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gridTemplateRows: '1fr 1fr',
                  gap: '2px',
                  backgroundColor: '#e5e7eb'
                }
              },
                playlistCoverArt.length >= 4 ?
                  // Show 4 album covers in 2x2 grid
                  playlistCoverArt.slice(0, 4).map((url, i) =>
                    React.createElement('div', {
                      key: i,
                      style: {
                        backgroundImage: `url(${url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }
                    })
                  )
                : playlistCoverArt.length > 0 ?
                  // Show available covers, fill rest with gradient
                  [...Array(4)].map((_, i) =>
                    React.createElement('div', {
                      key: i,
                      style: {
                        backgroundImage: playlistCoverArt[i]
                          ? `url(${playlistCoverArt[i]})`
                          : 'linear-gradient(135deg, #c026d3, #ec4899)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }
                    })
                  )
                :
                  // Default gradient placeholder
                  [...Array(4)].map((_, i) =>
                    React.createElement('div', {
                      key: i,
                      className: 'flex items-center justify-center',
                      style: {
                        background: `linear-gradient(135deg, ${
                          ['#c026d3', '#ec4899', '#f43f5e', '#fb7185'][i]
                        }, ${
                          ['#ec4899', '#f43f5e', '#fb7185', '#c026d3'][i]
                        })`
                      }
                    },
                      i === 0 && React.createElement('span', { className: 'text-3xl text-white/50' }, '🎵')
                    )
                  )
              ),

              // Playlist title and metadata
              React.createElement('div', { className: 'mt-4 space-y-1' },
                React.createElement('h2', {
                  className: 'font-bold text-gray-900 text-lg leading-tight'
                }, selectedPlaylist.title),
                React.createElement('p', {
                  className: 'text-sm text-gray-500'
                }, `Created by ${selectedPlaylist.creator || 'Unknown'}`),
                React.createElement('p', {
                  className: 'text-sm text-gray-500'
                }, `${playlistTracks.length.toString().padStart(2, '0')} Songs`),
                // Created date
                selectedPlaylist.createdAt && React.createElement('p', {
                  className: 'text-xs text-gray-400'
                }, `Created: ${new Date(selectedPlaylist.createdAt).toLocaleDateString()}`),
                // Last modified date
                selectedPlaylist.lastModified && React.createElement('p', {
                  className: 'text-xs text-gray-400'
                }, `Modified: ${new Date(selectedPlaylist.lastModified).toLocaleDateString()}`)
              )
            ),

            // RIGHT COLUMN: Tracklist
            React.createElement('div', { className: 'flex-1 min-w-0' },
              playlistTracks.length > 0 ?
                React.createElement('div', { className: 'space-y-0' },
                  playlistTracks.map((track, index) => {
                    const hasResolved = Object.keys(track.sources || {}).length > 0;
                    const isResolving = Object.keys(track.sources || {}).length === 0;
                    const isDraggedOver = playlistDropTarget === index;
                    const isDragging = draggedPlaylistTrack === index;

                    return React.createElement('div', {
                      key: track.id || index,
                      draggable: true,
                      onDragStart: (e) => {
                        setDraggedPlaylistTrack(index);
                        setDraggingTrackForPlaylist(track); // Track for potential playlist drop
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track }));
                      },
                      onDragEnd: () => {
                        setDraggedPlaylistTrack(null);
                        setPlaylistDropTarget(null);
                        setDraggingTrackForPlaylist(null);
                        setDropTargetPlaylistId(null);
                        setDropTargetNewPlaylist(false);
                        // Close panel if it was opened by drag and nothing was dropped
                        if (addToPlaylistPanel.open && selectedPlaylistsForAdd.length === 0) {
                          setAddToPlaylistPanel(prev => ({ ...prev, open: false }));
                        }
                      },
                      onDragOver: (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (draggedPlaylistTrack !== null && draggedPlaylistTrack !== index) {
                          setPlaylistDropTarget(index);
                        }
                      },
                      onDragLeave: () => {
                        setPlaylistDropTarget(null);
                      },
                      onDrop: (e) => {
                        e.preventDefault();
                        if (draggedPlaylistTrack !== null && draggedPlaylistTrack !== index) {
                          moveInPlaylist(draggedPlaylistTrack, index);
                        }
                        setDraggedPlaylistTrack(null);
                        setPlaylistDropTarget(null);
                      },
                      className: `flex items-center gap-4 py-2 px-3 border-b border-gray-100 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors no-drag group ${
                        isResolving ? 'opacity-60' : ''
                      } ${isDragging ? 'opacity-50 bg-gray-100' : ''} ${isDraggedOver ? 'border-t-2 border-t-purple-500' : ''}`,
                      onClick: () => {
                        if (draggedPlaylistTrack !== null) return; // Don't play if dragging
                        const tracksAfter = playlistTracks.slice(index + 1);
                        setCurrentQueue(tracksAfter);
                        handlePlay(track);
                      },
                      onContextMenu: (e) => {
                        e.preventDefault();
                        if (window.electron?.contextMenu?.showTrackMenu) {
                          window.electron.contextMenu.showTrackMenu({
                            type: 'track',
                            track: track,
                            // Pass playlist context for "Remove from Playlist" option
                            inPlaylist: true,
                            playlistId: selectedPlaylist.id,
                            trackIndex: index
                          });
                        }
                      }
                    },
                      // Track number
                      React.createElement('span', {
                        className: 'text-sm text-gray-400 flex-shrink-0 text-right',
                        style: { pointerEvents: 'none', width: '32px' }
                      }, String(index + 1).padStart(2, '0')),

                      // Track title - fixed width column
                      React.createElement('span', {
                        className: `text-sm truncate transition-colors ${hasResolved ? 'text-gray-700 group-hover:text-gray-900' : 'text-gray-500'}`,
                        style: { pointerEvents: 'none', width: '280px', flexShrink: 0 }
                      }, track.title),

                      // Artist name - fixed width column, clickable
                      React.createElement('span', {
                        className: 'text-sm text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                        style: { width: '180px', flexShrink: 0 },
                        onClick: (e) => {
                          e.stopPropagation();
                          fetchArtistData(track.artist);
                        }
                      }, track.artist),

                      // Duration - fixed width column (before resolver icons)
                      React.createElement('span', {
                        className: 'text-sm text-gray-400 text-right tabular-nums',
                        style: { pointerEvents: 'none', width: '50px', flexShrink: 0 }
                      }, formatTime(track.duration)),

                      // Resolver icons - fixed width column (last column)
                      React.createElement('div', {
                        className: 'flex items-center gap-1 justify-end ml-auto',
                        style: { width: '100px', flexShrink: 0, minHeight: '24px' }
                      },
                        isResolving ?
                          React.createElement('div', {
                            className: 'flex items-center gap-1'
                          },
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                              title: 'Resolving track...'
                            }),
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                              style: { animationDelay: '0.1s' }
                            })
                          )
                        : hasResolved ?
                          Object.entries(track.sources)
                            .sort(([aId], [bId]) => {
                              const aIndex = resolverOrder.indexOf(aId);
                              const bIndex = resolverOrder.indexOf(bId);
                              return aIndex - bIndex;
                            })
                            .map(([resolverId, source]) => {
                              const resolver = allResolvers.find(r => r.id === resolverId);
                              if (!resolver || !resolver.play) return null;
                              return React.createElement('button', {
                                key: resolverId,
                                className: 'no-drag',
                                onClick: (e) => {
                                  e.stopPropagation();
                                  const tracksAfter = playlistTracks.slice(index + 1);
                                  setCurrentQueue(tracksAfter);
                                  handlePlay({ ...track, preferredResolver: resolverId });
                                },
                                style: {
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '4px',
                                  backgroundColor: resolver.color,
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '10px',
                                  fontWeight: 'bold',
                                  color: 'white',
                                  pointerEvents: 'auto',
                                  opacity: (source.confidence || 0) > 0.8 ? 1 : 0.6,
                                  transition: 'transform 0.1s'
                                },
                                onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                                onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                                title: `Play from ${resolver.name}${source.confidence ? ` (${Math.round(source.confidence * 100)}% match)` : ''}`
                              }, (() => {
                                const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM', localfiles: 'LO' };
                                return abbrevMap[resolverId] || resolver.name.slice(0, 2).toUpperCase();
                              })());
                            })
                        :
                          // Show shimmer skeletons while resolving (match resolver icon size)
                          React.createElement('div', {
                            className: 'flex items-center gap-1'
                          },
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                              title: 'Resolving track...'
                            }),
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                              style: { animationDelay: '0.1s' }
                            })
                          )
                      )
                    );
                  })
                )
              :
                React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                  'Loading tracks...'
                )
            )
          )
        )
      )

      // Main content area - Playlists Page (separate layout like Artist page)
      : activeView === 'playlists' ? React.createElement('div', {
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Header section (outside scrollable area)
        React.createElement('div', {
          className: 'relative',
          style: {
            height: playlistsHeaderCollapsed ? '80px' : '320px',
            flexShrink: 0,
            transition: 'height 300ms ease',
            overflow: 'hidden'
          }
        },
          // Gradient background
          React.createElement('div', {
            className: 'absolute inset-0 bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-600'
          }),
          // Background pattern
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              opacity: 0.15,
              backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' stroke=\'%23ffffff\' stroke-width=\'2\'%3E%3Cpath d=\'M5 15h50M5 30h35M5 45h45\'/%3E%3Ccircle cx=\'50\' cy=\'30\' r=\'5\' fill=\'%23ffffff\'/%3E%3C/g%3E%3C/svg%3E")'
            }
          }),
          // EXPANDED STATE - Centered content
          !playlistsHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10',
            style: {
              opacity: playlistsHeaderCollapsed ? 0 : 1,
              transition: 'opacity 300ms ease'
            }
          },
            React.createElement('h1', {
              className: 'text-5xl font-light text-white',
              style: {
                textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                letterSpacing: '0.3em',
                textTransform: 'uppercase'
              }
            }, 'PLAYLISTS'),
            React.createElement('div', {
              className: 'flex items-center gap-1 mt-6',
              style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
            },
              React.createElement('span', {
                className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white'
              }, `${playlists.length} Playlist${playlists.length !== 1 ? 's' : ''}`)
            ),
            React.createElement('button', {
              onClick: () => setShowUrlImportDialog(true),
              className: 'mt-6 px-6 py-2 rounded-full font-medium text-white no-drag transition-all hover:scale-105',
              style: {
                backgroundColor: '#E91E63',
                boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
              }
            }, 'Import Playlist')
          ),
          // COLLAPSED STATE - Inline layout
          playlistsHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-6 z-10',
            style: {
              opacity: playlistsHeaderCollapsed ? 1 : 0,
              transition: 'opacity 300ms ease'
            }
          },
            React.createElement('h1', {
              className: 'text-2xl font-light text-white',
              style: {
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase'
              }
            }, 'PLAYLISTS'),
            React.createElement('div', { className: 'flex-1' }),
            React.createElement('span', {
              className: 'text-sm font-medium uppercase tracking-wider text-white/80 mr-4'
            }, `${playlists.length} Playlist${playlists.length !== 1 ? 's' : ''}`),
            React.createElement('button', {
              onClick: () => setShowUrlImportDialog(true),
              className: 'px-4 py-1.5 rounded-full text-sm font-medium text-white transition-colors hover:opacity-90',
              style: { backgroundColor: '#E91E63' }
            }, 'Import')
          )
        ),
        // Filter bar (outside scrollable area)
        React.createElement('div', {
          className: 'flex items-center px-6 py-3 bg-white border-b border-gray-200',
          style: { flexShrink: 0 }
        },
          // Sort dropdown
          React.createElement('div', { className: 'relative' },
            React.createElement('button', {
              onClick: (e) => { e.stopPropagation(); setPlaylistsSortDropdownOpen(!playlistsSortDropdownOpen); },
              className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
            },
              React.createElement('span', null, playlistsSortOptions.find(o => o.value === playlistsSort)?.label || 'Sort'),
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
              )
            ),
            playlistsSortDropdownOpen && React.createElement('div', {
              className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
            },
              playlistsSortOptions.map(option =>
                React.createElement('button', {
                  key: option.value,
                  onClick: (e) => {
                    e.stopPropagation();
                    setPlaylistsSort(option.value);
                    setPlaylistsSortDropdownOpen(false);
                  },
                  className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                    playlistsSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                  }`
                },
                  option.label,
                  playlistsSort === option.value && React.createElement('svg', {
                    className: 'w-4 h-4',
                    fill: 'none',
                    viewBox: '0 0 24 24',
                    stroke: 'currentColor'
                  },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                  )
                )
              )
            )
          ),
          React.createElement('div', { className: 'flex-1' }),
          // Search
          React.createElement('div', { className: 'flex items-center' },
            playlistsSearchOpen ?
              React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-1.5' },
                React.createElement('input', {
                  type: 'text',
                  value: playlistsSearch,
                  onChange: (e) => setPlaylistsSearch(e.target.value),
                  onBlur: () => { if (!playlistsSearch.trim()) setPlaylistsSearchOpen(false); },
                  autoFocus: true,
                  placeholder: 'Filter...',
                  className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none',
                  style: { width: '150px' }
                }),
                playlistsSearch && React.createElement('button', {
                  onClick: () => { setPlaylistsSearch(''); setPlaylistsSearchOpen(false); },
                  className: 'ml-2 text-gray-400 hover:text-gray-600'
                },
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                  )
                )
              )
            :
              React.createElement('button', {
                onClick: () => setPlaylistsSearchOpen(true),
                className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors'
              },
                React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                )
              )
          )
        ),
        // Content area (scrollable)
        React.createElement('div', {
          className: 'scrollable-content',
          style: {
            flex: 1,
            overflowY: 'auto',
            padding: '24px'
          },
          onScroll: handlePlaylistsScroll
        },
          (() => {
            const filtered = filterPlaylists(playlists);
            const sorted = sortPlaylists(filtered);

            if (sorted.length === 0 && playlistsSearch) {
              return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                ),
                React.createElement('div', { className: 'text-sm' }, 'No playlists match your search')
              );
            }

            if (sorted.length === 0) {
              return React.createElement('div', {
                className: 'text-center py-12 text-gray-400'
              }, 'No playlists yet. Import a playlist to get started!');
            }

            return React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6' },
              sorted.map(playlist => {
                const covers = allPlaylistCovers[playlist.id] || [];
                const hasCachedCovers = covers.length > 0;

                return React.createElement('div', {
                  key: playlist.id,
                  onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    loadPlaylist(playlist);
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      const tracksWithIds = (playlist.tracks || []).map((track, idx) => {
                        const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        return { ...track, id: trackId, sources: {} };
                      });
                      window.electron.contextMenu.showTrackMenu({
                        type: 'playlist',
                        playlistId: playlist.id,
                        name: playlist.title,
                        tracks: tracksWithIds
                      });
                    }
                  },
                  className: 'group cursor-pointer'
                },
                  // Album art mosaic or placeholder
                  React.createElement('div', {
                    className: 'relative aspect-square rounded-lg overflow-hidden mb-3 shadow-md group-hover:shadow-lg transition-shadow'
                  },
                    hasCachedCovers ?
                      React.createElement('div', { className: 'grid grid-cols-2 grid-rows-2 w-full h-full' },
                        [0, 1, 2, 3].map(idx => {
                          const gradients = [
                            'bg-gradient-to-br from-violet-400 to-purple-500',
                            'bg-gradient-to-br from-rose-400 to-pink-500',
                            'bg-gradient-to-br from-amber-400 to-orange-500',
                            'bg-gradient-to-br from-emerald-400 to-teal-500'
                          ];
                          return covers[idx] ?
                            React.createElement('img', {
                              key: idx,
                              src: covers[idx],
                              alt: '',
                              className: 'w-full h-full object-cover'
                            })
                          :
                            React.createElement('div', {
                              key: idx,
                              className: `w-full h-full ${gradients[idx]} flex items-center justify-center`
                            }, React.createElement(Music, { size: 20, className: 'text-white/70' }));
                        })
                      )
                    :
                      React.createElement('div', {
                        className: `w-full h-full flex items-center justify-center ${
                          playlist.sourceUrl
                            ? 'bg-gradient-to-br from-blue-400 to-cyan-400'
                            : 'bg-gradient-to-br from-purple-400 to-pink-400'
                        }`
                      }, React.createElement(Music, { size: 48, className: 'text-white/80' })),

                    // Hosted indicator
                    playlist.sourceUrl && React.createElement('div', {
                      className: 'absolute top-2 right-2 flex items-center gap-1'
                    },
                      React.createElement('span', {
                        className: 'bg-white/90 backdrop-blur-sm text-blue-500 text-xs px-2 py-0.5 rounded-full font-medium',
                        title: 'Hosted playlist'
                      }, '🌐 Hosted'),
                      React.createElement('button', {
                        onClick: async (e) => {
                          e.stopPropagation();
                          setRefreshingPlaylist(playlist.id);
                          await refreshHostedPlaylist(playlist.id);
                          setRefreshingPlaylist(null);
                        },
                        className: `p-1 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-colors ${refreshingPlaylist === playlist.id ? 'animate-spin' : ''}`,
                        title: 'Refresh playlist'
                      },
                        React.createElement('svg', { className: 'w-3 h-3 text-gray-600', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
                        )
                      )
                    ),

                    // Hover play overlay
                    React.createElement('div', {
                      className: 'absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'
                    },
                      React.createElement('div', {
                        className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg'
                      }, React.createElement(Play, { size: 24, className: 'text-gray-800 ml-1' }))
                    )
                  ),
                  // Playlist info
                  React.createElement('div', { className: 'font-medium text-gray-900 truncate group-hover:text-green-600 transition-colors' }, playlist.title),
                  React.createElement('div', { className: 'text-sm text-gray-500 truncate' },
                    playlist.creator || `${playlist.tracks?.length || 0} Songs`
                  )
                );
              })
            );
          })()
        )
      )

      // Main content area - Normal views (Library, Search, etc.)
      : React.createElement('div', {
        className: `flex-1 ${
          // Views with custom scroll handling should not have overflow on parent
          ['library', 'discover', 'critics-picks'].includes(activeView)
            ? 'overflow-hidden'
            : 'overflow-y-auto scrollable-content'
        } ${
          // No padding for views with full-bleed heroes
          ['library', 'discover', 'new-releases', 'critics-picks'].includes(activeView) ? '' : 'p-6'
        }`,
        style: {
          minHeight: 0,
          flexBasis: 0,
          pointerEvents: activeView === 'artist' || activeView === 'playlist-view' ? 'none' : 'auto'
        }
      },
        // Shared header - only show for views without custom heroes
        !['library', 'discover', 'new-releases', 'critics-picks', 'settings'].includes(activeView) &&
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('h2', { className: 'text-2xl font-bold' },
            activeView === 'playlist-view' && selectedPlaylist ? selectedPlaylist.title :
            activeView === 'friends' ? 'Friends' :
            'Discover'
          )
        ),

        // Library view with hero
        activeView === 'library' && React.createElement('div', {
          className: 'h-full overflow-y-auto scrollable-content',
          onScroll: handleCollectionScroll
        },
          // Sticky header container
          React.createElement('div', {
            className: 'sticky top-0 z-20'
          },
            // Hero section (collapsible)
            React.createElement('div', {
              className: 'relative overflow-hidden',
              style: {
                height: collectionHeaderCollapsed ? '50px' : '280px',
                transition: 'height 300ms ease'
              }
            },
              // Gradient background
              React.createElement('div', {
                className: 'absolute inset-0 bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700'
              }),
              // Vinyl pattern overlay
              React.createElement('div', {
                className: 'absolute inset-0',
                style: {
                  opacity: 0.08,
                  backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'20\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'12\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'4\'/%3E%3C/g%3E%3C/svg%3E")'
                }
              }),
              // Expanded content - centered title, stats, button
              React.createElement('div', {
                className: 'absolute inset-0 flex flex-col items-center justify-center',
                style: {
                  opacity: collectionHeaderCollapsed ? 0 : 1,
                  transform: collectionHeaderCollapsed ? 'translateY(-20px)' : 'translateY(0)',
                  transition: 'opacity 200ms ease, transform 200ms ease',
                  pointerEvents: collectionHeaderCollapsed ? 'none' : 'auto'
                }
              },
                // Title
                React.createElement('h1', {
                  className: 'text-5xl font-light text-white',
                  style: {
                    textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                    letterSpacing: '0.3em',
                    textTransform: 'uppercase'
                  }
                }, 'COLLECTION'),
                // Stats row as tabs (matching Artist page styling)
                React.createElement('div', {
                  className: 'flex items-center gap-1 mt-6',
                  style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
                },
                  [
                    { key: 'artists', label: `${collectionData.artists.length} Artists` },
                    { key: 'albums', label: `${collectionData.albums.length} Albums` },
                    { key: 'tracks', label: `${library.length + collectionData.tracks.length} Songs` }
                  ].map((tab, index) => [
                    index > 0 && React.createElement('span', {
                      key: `sep-${tab.key}`,
                      className: 'text-gray-400 mx-2'
                    }, '|'),
                    React.createElement('button', {
                      key: tab.key,
                      onClick: () => setCollectionTab(tab.key),
                      className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors ${
                        collectionTab === tab.key
                          ? 'text-white'
                          : 'text-gray-400 hover:text-white'
                      }`
                    }, tab.label)
                  ]).flat().filter(Boolean)
                ),
                // Start Collection Station button (pink, matching Artist page)
                React.createElement('button', {
                  onClick: () => console.log('Start Collection Station - placeholder'),
                  className: 'mt-6 px-6 py-2 rounded-full font-medium text-white no-drag transition-all hover:scale-105',
                  style: {
                    backgroundColor: '#E91E63',
                    boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
                  }
                }, 'Start Collection Station')
              ),
              // Collapsed content - inline row
              React.createElement('div', {
                className: 'absolute inset-0 flex items-center justify-between px-6',
                style: {
                  opacity: collectionHeaderCollapsed ? 1 : 0,
                  transition: 'opacity 200ms ease',
                  pointerEvents: collectionHeaderCollapsed ? 'auto' : 'none'
                }
              },
                // Left: Title
                React.createElement('h1', {
                  className: 'text-lg font-light text-white',
                  style: {
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase'
                  }
                }, 'COLLECTION'),
                // Center: Stats as tabs (matching Artist page styling)
                React.createElement('div', {
                  className: 'flex items-center gap-1',
                  style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
                },
                  [
                    { key: 'artists', label: `${collectionData.artists.length} Artists` },
                    { key: 'albums', label: `${collectionData.albums.length} Albums` },
                    { key: 'tracks', label: `${library.length + collectionData.tracks.length} Songs` }
                  ].map((tab, index) => [
                    index > 0 && React.createElement('span', {
                      key: `sep-${tab.key}`,
                      className: 'text-gray-400 mx-2'
                    }, '|'),
                    React.createElement('button', {
                      key: tab.key,
                      onClick: () => setCollectionTab(tab.key),
                      className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors ${
                        collectionTab === tab.key
                          ? 'text-white'
                          : 'text-gray-400 hover:text-white'
                      }`
                    }, tab.label)
                  ]).flat().filter(Boolean)
                ),
                // Right: Start Collection Station button
                React.createElement('button', {
                  onClick: () => console.log('Start Collection Station - placeholder'),
                  className: 'px-4 py-1.5 rounded-full text-sm font-medium text-white transition-colors hover:opacity-90',
                  style: {
                    backgroundColor: '#E91E63'
                  }
                }, 'Start Station')
              )
            ),
            // Filter bar (always visible, below hero)
            React.createElement('div', {
              className: 'flex items-center px-6 py-3 bg-white border-b border-gray-200'
            },
              // Sort dropdown (moved to left)
              React.createElement('div', { className: 'relative' },
                React.createElement('button', {
                  onClick: (e) => { e.stopPropagation(); setCollectionSortDropdownOpen(!collectionSortDropdownOpen); },
                  className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
                },
                  React.createElement('span', null, getCollectionSortOptions(collectionTab).find(o => o.value === collectionSort[collectionTab])?.label || 'Sort'),
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                  )
                ),
                // Dropdown menu
                collectionSortDropdownOpen && React.createElement('div', {
                  className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
                },
                  getCollectionSortOptions(collectionTab).map(option =>
                    React.createElement('button', {
                      key: option.value,
                      onClick: (e) => {
                        e.stopPropagation();
                        setCollectionSort(prev => ({ ...prev, [collectionTab]: option.value }));
                        setCollectionSortDropdownOpen(false);
                      },
                      className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                        collectionSort[collectionTab] === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                      }`
                    },
                      option.label,
                      collectionSort[collectionTab] === option.value && React.createElement('svg', {
                        className: 'w-4 h-4',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                      )
                    )
                  )
                )
              ),
              // Spacer
              React.createElement('div', { className: 'flex-1' }),
              // Search toggle/field
              React.createElement('div', { className: 'flex items-center' },
                collectionSearchOpen ?
                  React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-1.5' },
                    React.createElement('input', {
                      type: 'text',
                      value: collectionSearch,
                      onChange: (e) => setCollectionSearch(e.target.value),
                      onBlur: () => {
                        if (!collectionSearch.trim()) {
                          setCollectionSearchOpen(false);
                        }
                      },
                      autoFocus: true,
                      placeholder: 'Filter...',
                      className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none',
                      style: { width: '150px' }
                    }),
                    collectionSearch && React.createElement('button', {
                      onClick: () => {
                        setCollectionSearch('');
                        setCollectionSearchOpen(false);
                      },
                      className: 'ml-2 text-gray-400 hover:text-gray-600'
                    },
                      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                      )
                    )
                  )
                :
                  React.createElement('button', {
                    onClick: () => setCollectionSearchOpen(true),
                    className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors'
                  },
                    React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                    )
                  )
              )
            )
          ),
          // Content area
          React.createElement('div', { className: 'p-6' },
            // Artists tab
            collectionTab === 'artists' && (() => {
              const filtered = filterCollectionItems(collectionData.artists, 'artists');
              const sorted = sortCollectionItems(filtered, 'artists');

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500' }, 'No artists match your search')
                );
              }

              if (sorted.length === 0) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No artists yet'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag artists here to add them to your collection')
                );
              }

              return React.createElement('div', {
                className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
              },
                sorted.map(artist =>
                  React.createElement(CollectionArtistCard, {
                    key: artist.name,
                    artist: { ...artist, trackCount: 0 },
                    getArtistImage: getArtistImage,
                    onNavigate: () => fetchArtistData(artist.name)
                  })
                )
              );
            })(),

            // Albums tab
            collectionTab === 'albums' && (() => {
              const filtered = filterCollectionItems(collectionData.albums, 'albums');
              const sorted = sortCollectionItems(filtered, 'albums');

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500' }, 'No albums match your search')
                );
              }

              if (sorted.length === 0) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No albums yet'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag albums here to add them to your collection')
                );
              }

              return React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' },
                sorted.map((album, index) =>
                  React.createElement(CollectionAlbumCard, {
                    key: `${album.title}-${album.artist}-${index}`,
                    album: { ...album, trackCount: 0 },
                    getAlbumArt: getAlbumArt,
                    onNavigate: () => handleCollectionAlbumClick(album)
                  })
                )
              );
            })(),

            // Tracks tab (existing implementation with filter/sort applied)
            collectionTab === 'tracks' && (() => {
              if (libraryLoading) {
                // Skeleton loaders while loading
                return React.createElement('div', { className: 'space-y-0' },
                  Array.from({ length: 8 }).map((_, index) =>
                    React.createElement('div', {
                      key: `skeleton-${index}`,
                      className: 'flex items-center gap-4 py-2 px-3 border-b border-gray-100'
                    },
                      // Track number skeleton
                      React.createElement('div', {
                        className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer',
                        style: { width: '32px', flexShrink: 0 }
                      }),
                      // Title skeleton
                      React.createElement('div', {
                        className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer',
                        style: { width: '280px', flexShrink: 0, animationDelay: '0.1s' }
                      }),
                      // Artist skeleton (wider)
                      React.createElement('div', {
                        className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer',
                        style: { width: '220px', flexShrink: 0, animationDelay: '0.2s' }
                      }),
                      // Album skeleton (narrower)
                      React.createElement('div', {
                        className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer',
                        style: { width: '150px', flexShrink: 0, animationDelay: '0.3s' }
                      }),
                      // Spacer
                      React.createElement('div', { className: 'flex-1' }),
                      // Duration skeleton
                      React.createElement('div', {
                        className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer mr-4',
                        style: { width: '50px', flexShrink: 0, animationDelay: '0.4s' }
                      }),
                      // Resolver icons skeleton
                      React.createElement('div', {
                        className: 'flex items-center gap-1',
                        style: { width: '120px', flexShrink: 0 }
                      },
                        React.createElement('div', {
                          className: 'w-6 h-6 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer',
                          style: { animationDelay: '0.5s' }
                        }),
                        React.createElement('div', {
                          className: 'w-6 h-6 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-shimmer',
                          style: { animationDelay: '0.6s' }
                        })
                      )
                    )
                  )
                );
              }

              // Merge local files with collection tracks
              const allTracks = [...library, ...collectionData.tracks];

              // Deduplicate by id
              const trackMap = new Map();
              allTracks.forEach(track => {
                const trackId = track.id || `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                if (!trackMap.has(trackId)) {
                  trackMap.set(trackId, { ...track, id: trackId });
                }
              });

              const mergedTracks = Array.from(trackMap.values());

              const filtered = filterCollectionItems(mergedTracks, 'tracks');
              const sorted = sortCollectionItems(filtered, 'tracks');

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                  React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  ),
                  React.createElement('div', { className: 'text-sm' }, 'No tracks match your search')
                );
              }

              if (sorted.length === 0) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No tracks yet'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag tracks here or add local music folders in Settings')
                );
              }

              return React.createElement('div', { className: 'space-y-0' },
                sorted.map((track, index) => {
                  const hasResolved = Object.keys(track.sources || {}).length > 0;
                  const isCurrentTrack = currentTrack?.id === track.id || currentTrack?.filePath === track.filePath;
                  const trackKey = track.filePath || track.id;
                  const isResolving = resolvingLibraryTracks.has(trackKey);

                  return React.createElement('div', {
                    key: track.id || track.filePath || index,
                    className: `flex items-center gap-4 py-2 px-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors no-drag group ${
                      isCurrentTrack && isPlaying ? 'bg-purple-50' : ''
                    }`,
                    onClick: () => {
                      const tracksAfter = sorted.slice(index + 1);
                      setCurrentQueue(tracksAfter);
                      handlePlay(track);
                    },
                    onContextMenu: (e) => {
                      e.preventDefault();
                      if (window.electron?.contextMenu?.showTrackMenu) {
                        window.electron.contextMenu.showTrackMenu({
                          type: 'track',
                          track: track
                        });
                      }
                    }
                  },
                    // Track number
                    React.createElement('span', {
                      className: 'text-sm text-gray-400 flex-shrink-0 text-right',
                      style: { pointerEvents: 'none', width: '32px' }
                    }, String(index + 1).padStart(2, '0')),

                    // Track title - fixed width column
                    React.createElement('span', {
                      className: `text-sm truncate transition-colors ${isCurrentTrack && isPlaying ? 'text-purple-600 font-medium' : 'text-gray-700 group-hover:text-gray-900'}`,
                      style: { pointerEvents: 'none', width: '280px', flexShrink: 0 }
                    }, track.title),

                    // Artist name - fixed width column, clickable (wider)
                    React.createElement('span', {
                      className: 'text-sm text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                      style: { width: '220px', flexShrink: 0 },
                      onClick: (e) => {
                        e.stopPropagation();
                        fetchArtistData(track.artist);
                      }
                    }, track.artist || 'Unknown Artist'),

                    // Album name - fixed width column (narrower), clickable
                    track.album ? React.createElement('span', {
                      className: 'text-sm text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                      style: { width: '150px', flexShrink: 0 },
                      onClick: (e) => {
                        e.stopPropagation();
                        openChartsAlbum({ artist: track.artist, title: track.album, albumArt: track.albumArt });
                      }
                    }, track.album) : React.createElement('span', {
                      className: 'text-sm text-gray-500 truncate',
                      style: { pointerEvents: 'none', width: '150px', flexShrink: 0 }
                    }, ''),

                    // Spacer to push duration and resolvers to the right
                    React.createElement('div', { className: 'flex-1' }),

                    // Duration - right-justified before resolver icons
                    React.createElement('span', {
                      className: 'text-sm text-gray-400 text-right tabular-nums mr-4',
                      style: { pointerEvents: 'none', width: '50px', flexShrink: 0 }
                    }, formatTime(track.duration)),

                    // Resolver icons - fixed width column (last column)
                    React.createElement('div', {
                      className: 'flex items-center gap-1 justify-end',
                      style: { width: '120px', flexShrink: 0, minHeight: '24px' }
                    },
                      (() => {
                        const sources = track.sources || {};
                        const sourceIds = Object.keys(sources);
                        const hasExternalSources = sourceIds.some(id => id !== 'localfiles');

                        if (hasExternalSources) {
                          // Show all resolver icons (including LO)
                          return Object.entries(sources)
                            .sort(([aId], [bId]) => {
                              const aIndex = resolverOrder.indexOf(aId);
                              const bIndex = resolverOrder.indexOf(bId);
                              return aIndex - bIndex;
                            })
                            .map(([resolverId, source]) => {
                              const resolver = allResolvers.find(r => r.id === resolverId);
                              if (!resolver) return null;
                              return React.createElement('button', {
                                key: resolverId,
                                className: 'no-drag',
                                onClick: (e) => {
                                  e.stopPropagation();
                                  const tracksAfter = sorted.slice(index + 1);
                                  setCurrentQueue(tracksAfter);
                                  handlePlay({ ...track, preferredResolver: resolverId });
                                },
                                style: {
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '4px',
                                  backgroundColor: resolver.color,
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '10px',
                                  fontWeight: 'bold',
                                  color: 'white',
                                  pointerEvents: 'auto',
                                  opacity: (source.confidence || 1) > 0.8 ? 1 : 0.6,
                                  transition: 'transform 0.1s'
                                },
                                onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                                onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                                title: `Play from ${resolver.name}${source.confidence ? ` (${Math.round(source.confidence * 100)}% match)` : ''}`
                              }, (() => {
                                const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM', localfiles: 'LO' };
                                return abbrevMap[resolverId] || resolver.name.slice(0, 2).toUpperCase();
                              })());
                            });
                        } else if (isResolving && track.filePath) {
                          // Show LO icon + shimmer skeletons while resolving
                          const localFilesResolver = allResolvers.find(r => r.id === 'localfiles');
                          return React.createElement('div', { className: 'flex items-center gap-1' },
                            // LO icon
                            localFilesResolver && React.createElement('button', {
                              key: 'localfiles',
                              className: 'no-drag',
                              onClick: (e) => {
                                e.stopPropagation();
                                const tracksAfter = sorted.slice(index + 1);
                                setCurrentQueue(tracksAfter);
                                handlePlay({ ...track, preferredResolver: 'localfiles' });
                              },
                              style: {
                                width: '24px',
                                height: '24px',
                                borderRadius: '4px',
                                backgroundColor: localFilesResolver.color,
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                color: 'white',
                                pointerEvents: 'auto',
                                transition: 'transform 0.1s'
                              },
                              onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                              onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                              title: 'Play from Local Files'
                            }, 'LO'),
                            // Shimmer skeletons
                            React.createElement('div', {
                              className: 'w-6 h-6 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                              title: 'Resolving...'
                            }),
                            React.createElement('div', {
                              className: 'w-6 h-6 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
                              style: { animationDelay: '0.1s' }
                            })
                          );
                        } else if (track.filePath) {
                          // Show just the LO icon for local tracks that finished resolving without finding external sources
                          const localFilesResolver = allResolvers.find(r => r.id === 'localfiles');
                          if (!localFilesResolver) return null;
                          return React.createElement('button', {
                            key: 'localfiles',
                            className: 'no-drag',
                            onClick: (e) => {
                              e.stopPropagation();
                              const tracksAfter = sorted.slice(index + 1);
                              setCurrentQueue(tracksAfter);
                              handlePlay({ ...track, preferredResolver: 'localfiles' });
                            },
                            style: {
                              width: '24px',
                              height: '24px',
                              borderRadius: '4px',
                              backgroundColor: localFilesResolver.color,
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              fontWeight: 'bold',
                              color: 'white',
                              pointerEvents: 'auto',
                              transition: 'transform 0.1s'
                            },
                            onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                            onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                            title: 'Play from Local Files'
                          }, 'LO');
                        }
                        return null;
                      })()
                    )
                  );
                })
              );
            })()
          )
        ),

        activeView === 'friends' && React.createElement('div', {
          className: 'text-center py-12 text-gray-400'
        }, '👥 Connect with friends to see what they\'re listening to'),

        // Charts view with collapsible hero header (matching Artist page pattern)
        activeView === 'discover' && React.createElement('div', {
          className: 'flex-1 flex flex-col',
          style: { overflow: 'hidden' }
        },
          // Header section (outside scrollable area)
          React.createElement('div', {
            className: 'relative',
            style: {
              height: chartsHeaderCollapsed ? '80px' : '320px',
              flexShrink: 0,
              transition: 'height 300ms ease',
              overflow: 'hidden'
            }
          },
              // Gradient background
              React.createElement('div', {
                className: 'absolute inset-0 bg-gradient-to-br from-orange-500 via-pink-500 to-purple-600'
              }),
              // Background pattern
              React.createElement('div', {
                className: 'absolute inset-0',
                style: {
                  opacity: 0.15,
                  backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
                }
              }),
              // EXPANDED STATE - Centered content
              !chartsHeaderCollapsed && React.createElement('div', {
                className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10',
                style: {
                  opacity: chartsHeaderCollapsed ? 0 : 1,
                  transition: 'opacity 300ms ease'
                }
              },
                React.createElement('h1', {
                  className: 'text-5xl font-light text-white',
                  style: {
                    textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                    letterSpacing: '0.3em',
                    textTransform: 'uppercase'
                  }
                }, 'POP OF THE TOPS'),
                React.createElement('div', {
                  className: 'flex items-center gap-1 mt-6',
                  style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
                },
                  React.createElement('span', {
                    className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white'
                  }, `${charts.length} Albums`)
                ),
                React.createElement('p', {
                  className: 'mt-2 text-white/80 text-sm'
                }, 'Top 50 most played albums on Apple Music')
              ),
              // COLLAPSED STATE - Inline layout
              chartsHeaderCollapsed && React.createElement('div', {
                className: 'absolute inset-0 flex items-center px-6 z-10',
                style: {
                  opacity: chartsHeaderCollapsed ? 1 : 0,
                  transition: 'opacity 300ms ease'
                }
              },
                React.createElement('h1', {
                  className: 'text-2xl font-light text-white',
                  style: {
                    textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase'
                  }
                }, 'POP OF THE TOPS'),
                React.createElement('div', { className: 'flex-1' }),
                React.createElement('span', {
                  className: 'text-sm font-medium uppercase tracking-wider text-white/80'
                }, `${charts.length} Albums`)
              )
          ),
          // Filter bar (outside scrollable area)
          React.createElement('div', {
            className: 'flex items-center px-6 py-3 bg-white border-b border-gray-200',
            style: { flexShrink: 0 }
          },
            // Sort dropdown
              React.createElement('div', { className: 'relative' },
                React.createElement('button', {
                  onClick: (e) => { e.stopPropagation(); setChartsSortDropdownOpen(!chartsSortDropdownOpen); },
                  className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
                },
                  React.createElement('span', null, chartsSortOptions.find(o => o.value === chartsSort)?.label || 'Sort'),
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                  )
                ),
                chartsSortDropdownOpen && React.createElement('div', {
                  className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
                },
                  chartsSortOptions.map(option =>
                    React.createElement('button', {
                      key: option.value,
                      onClick: (e) => {
                        e.stopPropagation();
                        setChartsSort(option.value);
                        setChartsSortDropdownOpen(false);
                      },
                      className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                        chartsSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                      }`
                    },
                      option.label,
                      chartsSort === option.value && React.createElement('svg', {
                        className: 'w-4 h-4',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                      )
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'flex-1' }),
              // Search
              React.createElement('div', { className: 'flex items-center' },
                chartsSearchOpen ?
                  React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-1.5' },
                    React.createElement('input', {
                      type: 'text',
                      value: chartsSearch,
                      onChange: (e) => setChartsSearch(e.target.value),
                      onBlur: () => { if (!chartsSearch.trim()) setChartsSearchOpen(false); },
                      autoFocus: true,
                      placeholder: 'Filter...',
                      className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none',
                      style: { width: '150px' }
                    }),
                    chartsSearch && React.createElement('button', {
                      onClick: () => { setChartsSearch(''); setChartsSearchOpen(false); },
                      className: 'ml-2 text-gray-400 hover:text-gray-600'
                    },
                      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                      )
                    )
                  )
                :
                  React.createElement('button', {
                    onClick: () => setChartsSearchOpen(true),
                    className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors'
                  },
                    React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                    )
                  )
              )
          ),
          // Content area (scrollable)
          React.createElement('div', {
            className: 'scrollable-content',
            style: {
              flex: 1,
              overflowY: 'auto',
              padding: '24px'
            },
            onScroll: handleChartsScroll
          },
            // Skeleton loading state
            chartsLoading && React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
            },
              Array.from({ length: 15 }).map((_, i) =>
                React.createElement('div', { key: `skeleton-${i}` },
                  // Skeleton album art
                  React.createElement('div', {
                    className: 'aspect-square rounded-lg mb-3 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                  }),
                  // Skeleton title
                  React.createElement('div', { className: 'space-y-2' },
                    React.createElement('div', {
                      className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded w-3/4 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 25}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-3 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded w-1/2 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 50}ms` }
                    })
                  )
                )
              )
            ),

            // Albums grid with filter/sort
            !chartsLoading && (() => {
              const filtered = filterCharts(charts);
              const sorted = sortCharts(filtered);

              if (sorted.length === 0 && chartsSearch) {
                return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                  React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  ),
                  React.createElement('div', { className: 'text-sm' }, 'No albums match your search')
                );
              }

              if (sorted.length === 0) {
                return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                  React.createElement('div', { className: 'text-sm' }, 'No chart data available')
                );
              }

              return React.createElement('div', {
                className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
              },
                sorted.map(album =>
                React.createElement('div', {
                  key: album.id,
                  className: 'group cursor-pointer',
                  onMouseEnter: () => prefetchChartsTracks(album),
                  onClick: () => openChartsAlbum(album)
                },
                  // Album art with hover overlay
                  React.createElement('div', {
                    className: 'aspect-square rounded-lg overflow-hidden mb-3 bg-gradient-to-br from-purple-500 to-pink-500 relative'
                  },
                    // Placeholder always rendered behind
                    React.createElement('div', {
                      className: 'absolute inset-0 flex items-center justify-center text-white/60'
                    },
                      React.createElement('svg', { className: 'w-16 h-16', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
                        React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
                        React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
                        React.createElement('circle', { cx: 12, cy: 12, r: 6, strokeDasharray: '2 2' })
                      )
                    ),
                    album.albumArt && React.createElement('img', {
                      src: album.albumArt,
                      alt: album.title,
                      className: 'absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300',
                      onError: (e) => { e.target.style.display = 'none'; }
                    }),
                    // Rank badge
                    React.createElement('div', {
                      className: 'absolute top-2 right-2 px-2 py-1 rounded bg-black/70 text-white text-xs font-bold'
                    }, `#${album.rank}`),
                    // Hover overlay with Add to Queue button
                    React.createElement('div', {
                      className: 'absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center'
                    },
                      React.createElement('button', {
                        onClick: (e) => {
                          e.stopPropagation();
                          addChartsToQueue(album);
                        },
                        className: 'bg-white text-gray-900 px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-100 transition-colors flex items-center gap-2 shadow-lg'
                      },
                        React.createElement('svg', {
                          className: 'w-4 h-4',
                          fill: 'none',
                          viewBox: '0 0 24 24',
                          stroke: 'currentColor'
                        },
                          React.createElement('path', {
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            strokeWidth: 2,
                            d: 'M12 4v16m8-8H4'
                          })
                        ),
                        'Add to Queue'
                      )
                    )
                  ),
                  // Album info
                  React.createElement('div', { className: 'space-y-1' },
                    React.createElement('div', {
                      className: 'font-medium text-gray-900 truncate group-hover:text-purple-600 transition-colors'
                    }, album.title),
                    React.createElement('div', {
                      className: 'text-sm text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                      onClick: (e) => {
                        e.stopPropagation();
                        fetchArtistData(album.artist);
                      }
                    }, album.artist)
                  )
                )
              )
              );
            })()
          )
        ),

        // New Releases view with hero
        activeView === 'new-releases' && React.createElement('div', {
          className: 'h-full overflow-y-auto scrollable-content'
        },
          // Hero section
          React.createElement('div', {
            className: 'relative h-64 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 overflow-hidden'
          },
            // Background pattern - sparkles
            React.createElement('div', {
              className: 'absolute inset-0 opacity-30',
              style: {
                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'2\'/%3E%3Ccircle cx=\'75\' cy=\'25\' r=\'1.5\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'2.5\'/%3E%3Ccircle cx=\'25\' cy=\'75\' r=\'1.5\'/%3E%3Ccircle cx=\'75\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'10\' cy=\'50\' r=\'1\'/%3E%3Ccircle cx=\'90\' cy=\'50\' r=\'1\'/%3E%3C/g%3E%3C/svg%3E")'
              }
            }),
            // Hero content
            React.createElement('div', {
              className: 'absolute inset-0 flex items-end p-8'
            },
              React.createElement('div', null,
                React.createElement('div', {
                  className: 'inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-white/90 text-sm mb-3'
                },
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' })
                  ),
                  'Fresh Music'
                ),
                React.createElement('h1', { className: 'text-4xl font-light text-white mb-2', style: { letterSpacing: '0.2em', textTransform: 'uppercase' } }, 'NEW RELEASES'),
                React.createElement('p', { className: 'text-white/80 text-lg' }, 'The latest albums and singles, just dropped')
              )
            )
          ),
          // Placeholder content
          React.createElement('div', { className: 'p-6' },
            React.createElement('div', { className: 'text-center py-12 text-gray-400' },
              React.createElement('div', { className: 'text-5xl mb-4' }, '✨'),
              React.createElement('div', { className: 'text-lg font-medium text-gray-600 mb-2' }, 'New Releases Coming Soon'),
              React.createElement('div', { className: 'text-sm' }, 'Stay tuned for the freshest music')
            )
          )
        ),

        // Critic's Picks view with collapsible hero header (matching Artist page pattern)
        activeView === 'critics-picks' && React.createElement('div', {
          className: 'flex-1 flex flex-col',
          style: { overflow: 'hidden' }
        },
          // Header section (outside scrollable area)
          React.createElement('div', {
            className: 'relative',
            style: {
              height: criticsHeaderCollapsed ? '80px' : '320px',
              flexShrink: 0,
              transition: 'height 300ms ease',
              overflow: 'hidden'
            }
          },
              // Gradient background
              React.createElement('div', {
                className: 'absolute inset-0 bg-gradient-to-br from-amber-500 via-orange-500 to-red-500'
              }),
              // Background pattern
              React.createElement('div', {
                className: 'absolute inset-0',
                style: {
                  opacity: 0.15,
                  backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'80\' height=\'80\' viewBox=\'0 0 80 80\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Cpath d=\'M40 5l4.5 13.8h14.5l-11.7 8.5 4.5 13.8L40 32.6l-11.8 8.5 4.5-13.8-11.7-8.5h14.5z\'/%3E%3C/g%3E%3C/svg%3E")'
                }
              }),
              // EXPANDED STATE - Centered content
              !criticsHeaderCollapsed && React.createElement('div', {
                className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10',
                style: {
                  opacity: criticsHeaderCollapsed ? 0 : 1,
                  transition: 'opacity 300ms ease'
                }
              },
                React.createElement('h1', {
                  className: 'text-5xl font-light text-white',
                  style: {
                    textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                    letterSpacing: '0.3em',
                    textTransform: 'uppercase'
                  }
                }, 'CRITICAL DARLINGS'),
                React.createElement('div', {
                  className: 'flex items-center gap-1 mt-6',
                  style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
                },
                  React.createElement('span', {
                    className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white'
                  }, `${criticsPicks.length} Albums`)
                ),
                React.createElement('p', {
                  className: 'mt-2 text-white/80 text-sm'
                }, 'Top-rated albums from leading music publications')
              ),
              // COLLAPSED STATE - Inline layout
              criticsHeaderCollapsed && React.createElement('div', {
                className: 'absolute inset-0 flex items-center px-6 z-10',
                style: {
                  opacity: criticsHeaderCollapsed ? 1 : 0,
                  transition: 'opacity 300ms ease'
                }
              },
                React.createElement('h1', {
                  className: 'text-2xl font-light text-white',
                  style: {
                    textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase'
                  }
                }, 'CRITICAL DARLINGS'),
                React.createElement('div', { className: 'flex-1' }),
                React.createElement('span', {
                  className: 'text-sm font-medium uppercase tracking-wider text-white/80'
                }, `${criticsPicks.length} Albums`)
              )
          ),
          // Filter bar (outside scrollable area)
          React.createElement('div', {
            className: 'flex items-center px-6 py-3 bg-white border-b border-gray-200',
            style: { flexShrink: 0 }
          },
            // Sort dropdown
              React.createElement('div', { className: 'relative' },
                React.createElement('button', {
                  onClick: (e) => { e.stopPropagation(); setCriticsSortDropdownOpen(!criticsSortDropdownOpen); },
                  className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
                },
                  React.createElement('span', null, criticsSortOptions.find(o => o.value === criticsSort)?.label || 'Sort'),
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                  )
                ),
                criticsSortDropdownOpen && React.createElement('div', {
                  className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
                },
                  criticsSortOptions.map(option =>
                    React.createElement('button', {
                      key: option.value,
                      onClick: (e) => {
                        e.stopPropagation();
                        setCriticsSort(option.value);
                        setCriticsSortDropdownOpen(false);
                      },
                      className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                        criticsSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                      }`
                    },
                      option.label,
                      criticsSort === option.value && React.createElement('svg', {
                        className: 'w-4 h-4',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                      )
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'flex-1' }),
              // Search
              React.createElement('div', { className: 'flex items-center' },
                criticsSearchOpen ?
                  React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-1.5' },
                    React.createElement('input', {
                      type: 'text',
                      value: criticsSearch,
                      onChange: (e) => setCriticsSearch(e.target.value),
                      onBlur: () => { if (!criticsSearch.trim()) setCriticsSearchOpen(false); },
                      autoFocus: true,
                      placeholder: 'Filter...',
                      className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none',
                      style: { width: '150px' }
                    }),
                    criticsSearch && React.createElement('button', {
                      onClick: () => { setCriticsSearch(''); setCriticsSearchOpen(false); },
                      className: 'ml-2 text-gray-400 hover:text-gray-600'
                    },
                      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                      )
                    )
                  )
                :
                  React.createElement('button', {
                    onClick: () => setCriticsSearchOpen(true),
                    className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors'
                  },
                    React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                    )
                  )
              )
          ),
          // Content area (scrollable)
          React.createElement('div', {
            className: 'scrollable-content',
            style: {
              flex: 1,
              overflowY: 'auto',
              padding: '24px'
            },
            onScroll: handleCriticsScroll
          },
            // Skeleton loading state
            criticsPicksLoading && React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
            },
            Array.from({ length: 15 }).map((_, i) =>
              React.createElement('div', { key: `skeleton-${i}` },
                // Skeleton album art
                React.createElement('div', {
                  className: 'aspect-square rounded-lg mb-3 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer',
                  style: { backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                }),
                // Skeleton title
                React.createElement('div', { className: 'space-y-2' },
                  React.createElement('div', {
                    className: 'h-4 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded w-3/4 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 25}ms` }
                  }),
                  React.createElement('div', {
                    className: 'h-3 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded w-1/2 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 50}ms` }
                  })
                )
              )
            )
          ),

          // Albums grid with filter/sort
          !criticsPicksLoading && (() => {
            const filtered = filterCriticsPicks(criticsPicks);
            const sorted = sortCriticsPicks(filtered);

            if (sorted.length === 0 && criticsSearch) {
              return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                ),
                React.createElement('div', { className: 'text-sm' }, 'No albums match your search')
              );
            }

            if (sorted.length === 0) {
              return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                React.createElement('div', { className: 'text-sm' }, 'No critic picks available')
              );
            }

            return React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
            },
              sorted.map(album =>
              React.createElement('div', {
                key: album.id,
                className: 'group cursor-pointer',
                onMouseEnter: () => prefetchCriticsPicksTracks(album),
                onClick: () => openCriticsPicksAlbum(album)
              },
                // Album art with hover overlay
                React.createElement('div', {
                  className: 'aspect-square rounded-lg overflow-hidden mb-3 bg-gradient-to-br from-purple-500 to-pink-500 relative'
                },
                  // Placeholder always rendered behind
                  React.createElement('div', {
                    className: 'absolute inset-0 flex items-center justify-center text-white/60'
                  },
                    React.createElement('svg', { className: 'w-16 h-16', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1 },
                      React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
                      React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
                      React.createElement('circle', { cx: 12, cy: 12, r: 6, strokeDasharray: '2 2' })
                    )
                  ),
                  album.albumArt && React.createElement('img', {
                    src: album.albumArt,
                    alt: album.title,
                    className: 'absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300',
                    onError: (e) => { e.target.style.display = 'none'; }
                  }),
                  // Metacritic score badge
                  album.score && React.createElement('div', {
                    className: `absolute top-2 right-2 px-2 py-1 rounded text-xs font-bold ${
                      album.score >= 80 ? 'bg-green-500 text-white' :
                      album.score >= 60 ? 'bg-yellow-500 text-black' :
                      'bg-red-500 text-white'
                    }`
                  }, album.score),
                  // Hover overlay with Add to Queue button
                  React.createElement('div', {
                    className: 'absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center'
                  },
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        addCriticsPicksToQueue(album);
                      },
                      className: 'bg-white text-gray-900 px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-100 transition-colors flex items-center gap-2 shadow-lg'
                    },
                      React.createElement('svg', {
                        className: 'w-4 h-4',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                      },
                        React.createElement('path', {
                          strokeLinecap: 'round',
                          strokeLinejoin: 'round',
                          strokeWidth: 2,
                          d: 'M12 4v16m8-8H4'
                        })
                      ),
                      'Add to Queue'
                    )
                  )
                ),
                // Album info
                React.createElement('div', { className: 'space-y-1' },
                  React.createElement('div', {
                    className: 'font-medium text-gray-900 truncate group-hover:text-purple-600 transition-colors'
                  }, album.title),
                  React.createElement('div', {
                    className: 'text-sm text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                    onClick: (e) => {
                      e.stopPropagation();
                      fetchArtistData(album.artist);
                    }
                  }, album.artist)
                )
              )
            )
            );
          })()
          )
        ),

        activeView === 'settings' && React.createElement('div', {
          className: 'flex h-full'
        },
          // Settings vertical tabs (left side)
          React.createElement('div', {
            className: 'w-48 border-r border-gray-200 py-6 flex-shrink-0'
          },
            React.createElement('nav', { className: 'space-y-1 px-3' },
              // Installed Resolvers tab
              React.createElement('button', {
                onClick: () => setSettingsTab('installed'),
                className: `w-full text-left px-4 py-3 text-sm transition-colors ${
                  settingsTab === 'installed'
                    ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
                    : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
                }`
              }, 'Installed Resolvers'),
              // Marketplace tab
              React.createElement('button', {
                onClick: () => setSettingsTab('marketplace'),
                className: `w-full text-left px-4 py-3 text-sm transition-colors ${
                  settingsTab === 'marketplace'
                    ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
                    : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
                }`
              }, 'Marketplace'),
              // General tab (placeholder)
              React.createElement('button', {
                onClick: () => setSettingsTab('general'),
                className: `w-full text-left px-4 py-3 text-sm transition-colors ${
                  settingsTab === 'general'
                    ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
                    : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
                }`
              }, 'General'),
              // About tab (placeholder)
              React.createElement('button', {
                onClick: () => setSettingsTab('about'),
                className: `w-full text-left px-4 py-3 text-sm transition-colors ${
                  settingsTab === 'about'
                    ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
                    : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
                }`
              }, 'About')
            )
          ),
          // Settings content area (right side)
          React.createElement('div', {
            className: 'flex-1 overflow-y-auto p-8'
          },
            // Installed Resolvers Tab
            settingsTab === 'installed' && React.createElement('div', null,
              // Header
              React.createElement('div', { className: 'flex items-center justify-between mb-8' },
                React.createElement('div', null,
                  React.createElement('h2', { className: 'text-xl font-semibold text-gray-900' }, 'Installed Resolvers'),
                  React.createElement('p', { className: 'text-sm text-gray-500 mt-1' },
                    'Select the platforms you want to stream music from. Drag and drop to reorder priority.'
                  )
                ),
                // Add from file button
                React.createElement('button', {
                  onClick: handleInstallResolver,
                  className: 'px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2'
                },
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' })
                  ),
                  'Add from file'
                )
              ),
              // Resolver grid
              React.createElement('div', {
                className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6'
              },
                resolverOrder.map((resolverId, index) => {
                  const resolver = allResolvers.find(r => r.id === resolverId);
                  if (!resolver) return null;

                  const isActive = activeResolvers.includes(resolver.id);

                  // Check if marketplace has a newer version
                  const marketplaceResolver = marketplaceManifest?.resolvers?.find(r => r.id === resolver.id);
                  const hasUpdate = marketplaceResolver &&
                    marketplaceResolver.version !== resolver.version &&
                    marketplaceResolver.version > resolver.version;

                  return React.createElement(ResolverCard, {
                    key: resolver.id,
                    resolver: resolver,
                    isActive: isActive,
                    hasUpdate: hasUpdate,
                    priorityNumber: index + 1,
                    draggable: true,
                    isDragging: draggedResolver === resolver.id,
                    isDragOver: dragOverResolver === resolver.id,
                    onClick: () => setSelectedResolver(resolver),
                    onDragStart: (e) => handleResolverDragStart(e, resolver.id),
                    onDragOver: handleResolverDragOver,
                    onDragEnter: (e) => handleResolverDragEnter(e, resolver.id),
                    onDragLeave: handleResolverDragLeave,
                    onDrop: (e) => handleResolverDrop(e, resolver.id),
                    onDragEnd: handleResolverDragEnd,
                    onContextMenu: (e) => {
                      e.preventDefault();
                      if (window.electron?.resolvers?.showContextMenu) {
                        window.electron.resolvers.showContextMenu(resolver.id);
                      }
                    }
                  });
                })
              )
            ),

            // Marketplace Tab
            settingsTab === 'marketplace' && React.createElement('div', null,
              // Header with search
              React.createElement('div', { className: 'flex items-center justify-between mb-8' },
                React.createElement('div', null,
                  React.createElement('h2', { className: 'text-xl font-semibold text-gray-900' }, 'Marketplace'),
                  React.createElement('p', { className: 'text-sm text-gray-500 mt-1' },
                    'Discover and install new resolver plugins.'
                  )
                )
              ),
              // Search and filter bar
              React.createElement('div', { className: 'flex gap-4 mb-8' },
                React.createElement('input', {
                  type: 'text',
                  placeholder: 'Search resolvers...',
                  value: marketplaceSearchQuery,
                  onChange: (e) => setMarketplaceSearchQuery(e.target.value),
                  className: 'flex-1 max-w-md px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                }),
                React.createElement('select', {
                  value: marketplaceCategory,
                  onChange: (e) => setMarketplaceCategory(e.target.value),
                  className: 'px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                },
                  React.createElement('option', { value: 'all' }, 'All Categories'),
                  React.createElement('option', { value: 'streaming' }, 'Streaming'),
                  React.createElement('option', { value: 'purchase' }, 'Purchase'),
                  React.createElement('option', { value: 'metadata' }, 'Metadata'),
                  React.createElement('option', { value: 'radio' }, 'Radio')
                )
              ),
              // Loading state
              marketplaceLoading && React.createElement('div', {
                className: 'text-center py-12 text-gray-500'
              }, 'Loading marketplace...'),
              // Empty state
              !marketplaceLoading && marketplaceManifest && marketplaceManifest.resolvers && marketplaceManifest.resolvers.length === 0 &&
                React.createElement('div', {
                  className: 'text-center py-12 text-gray-400'
                }, 'No resolvers available in marketplace yet.'),
              // Resolver grid
              !marketplaceLoading && marketplaceManifest && marketplaceManifest.resolvers && marketplaceManifest.resolvers.length > 0 &&
                React.createElement('div', {
                  className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6'
                },
                  marketplaceManifest.resolvers
                    .filter(resolver => {
                      if (marketplaceSearchQuery) {
                        const query = marketplaceSearchQuery.toLowerCase();
                        const matchesName = resolver.name.toLowerCase().includes(query);
                        const matchesDesc = resolver.description.toLowerCase().includes(query);
                        const matchesAuthor = resolver.author.toLowerCase().includes(query);
                        if (!matchesName && !matchesDesc && !matchesAuthor) return false;
                      }
                      if (marketplaceCategory !== 'all' && resolver.category !== marketplaceCategory) {
                        return false;
                      }
                      return true;
                    })
                    .map(resolver => {
                      const installedResolver = allResolvers.find(r => r.id === resolver.id);
                      const isInstalled = !!installedResolver;
                      const isInstalling = installingResolvers.has(resolver.id);

                      return React.createElement(ResolverCard, {
                        key: resolver.id,
                        resolver: resolver,
                        isInstalled: isInstalled,
                        isInstalling: isInstalling,
                        onClick: isInstalled
                          ? () => setSelectedResolver(installedResolver)
                          : () => handleInstallFromMarketplace(resolver)
                      });
                    })
                )
            ),

            // General Tab
            settingsTab === 'general' && React.createElement('div', {
              className: 'space-y-6'
            },
              // Cache Management Section
              React.createElement('div', {
                className: 'bg-white border border-gray-200 rounded-lg p-6'
              },
                React.createElement('h3', {
                  className: 'text-lg font-semibold text-gray-900 mb-2'
                }, 'Cache Management'),
                React.createElement('p', {
                  className: 'text-sm text-gray-500 mb-4'
                }, 'Clear cached data including artist images, album art, and API responses. This may temporarily slow down loading while data is re-fetched.'),
                React.createElement('button', {
                  onClick: async () => {
                    // Clear all caches
                    artistImageCache.current = {};
                    albumArtCache.current = {};
                    artistDataCache.current = {};
                    albumToReleaseIdCache.current = {};

                    // Clear persisted caches
                    if (window.electron?.store) {
                      await window.electron.store.set('cache_artist_images', {});
                      await window.electron.store.set('cache_album_art', {});
                      await window.electron.store.set('cache_artist_data', {});
                      await window.electron.store.set('cache_album_release_ids', {});
                    }

                    // Show confirmation (using a simple alert for now)
                    alert('Cache cleared successfully!');
                  },
                  className: 'px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors'
                }, 'Clear Cache')
              )
            ),

            // About Tab
            settingsTab === 'about' && React.createElement('div', {
              className: 'flex flex-col items-center justify-center py-12'
            },
              // Parachord Logo
              React.createElement('svg', {
                width: '280',
                height: '70',
                viewBox: '0 0 974 245',
                fill: 'none',
                xmlns: 'http://www.w3.org/2000/svg',
                className: 'mb-6'
              },
                React.createElement('path', { d: 'M705.5 96C729.725 96 750.5 116.846 750.5 144C750.5 171.154 729.725 192 705.5 192C681.275 192 660.5 171.154 660.5 144C660.5 116.846 681.275 96 705.5 96Z', stroke: 'currentColor', strokeWidth: '27' }),
                React.createElement('path', { d: 'M178.5 89C202.725 89 223.5 109.846 223.5 137C223.5 164.154 202.725 185 178.5 185C154.275 185 133.5 164.154 133.5 137C133.5 109.846 154.275 89 178.5 89Z', stroke: 'currentColor', strokeWidth: '27' }),
                React.createElement('rect', { x: '212', y: '75.5', width: '25', height: '123', fill: 'currentColor' }),
                React.createElement('path', { d: 'M365.5 93C389.725 93 410.5 113.846 410.5 141C410.5 168.154 389.725 189 365.5 189C341.275 189 320.5 168.154 320.5 141C320.5 113.846 341.275 93 365.5 93Z', stroke: 'currentColor', strokeWidth: '27' }),
                React.createElement('rect', { x: '399', y: '79.5', width: '25', height: '123', fill: 'currentColor' }),
                React.createElement('path', { d: 'M58.5 89C82.7246 89 103.5 109.846 103.5 137C103.5 164.154 82.7246 185 58.5 185C34.2754 185 13.5 164.154 13.5 137C13.5 109.846 34.2754 89 58.5 89Z', stroke: 'currentColor', strokeWidth: '27' }),
                React.createElement('rect', { y: '141.5', width: '25', height: '90', fill: 'currentColor' }),
                React.createElement('rect', { x: '248', y: '138.5', width: '27', height: '60', fill: 'currentColor' }),
                React.createElement('path', { d: 'M248 138.5C248 103.706 274.191 75.5 306.5 75.5C306.667 75.5 306.833 75.5024 307 75.5039L307 102.508C306.833 102.505 306.667 102.5 306.5 102.5C291.195 102.5 275.499 116.258 275.012 137.483L275 138.5L248 138.5Z', fill: 'currentColor' }),
                React.createElement('rect', { x: '769', y: '142.5', width: '27', height: '60', fill: 'currentColor' }),
                React.createElement('path', { d: 'M769 142.5C769 107.706 795.191 79.5 827.5 79.5C827.667 79.5 827.833 79.5024 828 79.5039L828 106.508C827.833 106.505 827.667 106.5 827.5 106.5C812.195 106.5 796.499 120.258 796.012 141.483L796 142.5L769 142.5Z', fill: 'currentColor' }),
                React.createElement('rect', { x: '617', y: '142.5', width: '25', height: '60', fill: 'currentColor' }),
                React.createElement('rect', { x: '538', y: '36.3779', width: '25', height: '165', fill: 'currentColor' }),
                React.createElement('path', { d: 'M563 28.5V41L538 36.3779L563 28.5Z', fill: 'currentColor' }),
                React.createElement('path', { d: 'M589.702 82.5C616.533 82.5 639.054 108.771 641.898 142.5H616.816C614.171 118.264 598.459 107.5 589.702 107.5C581.176 107.5 565.661 118.003 563.075 142.5H538C540.787 108.771 562.871 82.5 589.702 82.5Z', fill: 'currentColor' }),
                React.createElement('path', { d: 'M488.5 79.5C506.518 79.5 522.632 88.0639 533.363 101.53L509.492 115.312C503.729 109.727 496.204 106.5 488.5 106.5C472.36 106.5 457 120.658 457 141C457 161.342 472.36 175.5 488.5 175.5C496.205 175.5 503.729 172.272 509.492 166.688L533.363 180.469C522.632 193.935 506.518 202.5 488.5 202.5C456.191 202.5 430 174.966 430 141C430 107.034 456.191 79.5 488.5 79.5Z', fill: 'currentColor' }),
                React.createElement('path', { d: 'M25 231.5L6.8343e-07 245L-6.11959e-07 231L0 217L25 231.5Z', fill: 'currentColor' }),
                React.createElement('path', { d: 'M893.011 191.341C868.787 191.577 847.81 170.935 847.545 143.782C847.28 116.63 867.851 95.5818 892.075 95.3456C916.298 95.1094 937.276 115.752 937.541 142.905C937.805 170.057 917.234 191.105 893.011 191.341Z', stroke: 'currentColor', strokeWidth: '27' }),
                React.createElement('rect', { x: '950.995', y: '138.273', width: '25', height: '100.266', transform: 'rotate(179.441 950.995 138.273)', fill: 'currentColor' }),
                React.createElement('path', { d: 'M974.001 27L925.251 55.1458L924.5 0L974.001 27Z', fill: '#FF0000' }),
                React.createElement('line', { x1: '924.822', y1: '55.1746', x2: '950.699', y2: '40.9495', stroke: 'white' })
              ),

              // Version
              React.createElement('p', { className: 'text-lg text-gray-600 mb-2' }, 'Version 1.0.0'),

              // Tagline
              React.createElement('p', { className: 'text-gray-500 mb-8 text-center max-w-md' },
                'A modern multi-source music player inspired by Tomahawk.'
              ),

              // Divider
              React.createElement('div', { className: 'w-48 h-px bg-gray-200 mb-8' }),

              // Open Source info
              React.createElement('div', { className: 'text-center mb-8' },
                React.createElement('p', { className: 'text-sm text-gray-500 mb-2' }, 'Open Source Software'),
                React.createElement('p', { className: 'text-xs text-gray-400' },
                  'Built with Electron, React, and Tailwind CSS'
                ),
                React.createElement('a', {
                  href: '#',
                  onClick: (e) => {
                    e.preventDefault();
                    if (window.electron?.shell?.openExternal) {
                      window.electron.shell.openExternal('https://github.com/jherskowitz/parachord');
                    }
                  },
                  className: 'text-xs text-purple-600 hover:text-purple-700 mt-2 inline-block'
                }, 'View on GitHub')
              ),

              // Copyright
              React.createElement('p', { className: 'text-xs text-gray-400' },
                '© ', new Date().getFullYear(), ' Parachord. All rights reserved.'
              ),

              // License
              React.createElement('p', { className: 'text-xs text-gray-400 mt-1' },
                'Licensed under the MIT License'
              )
            )
          )
        )
      )
    )
    ), // Close the sidebar + main wrapper

    // Player bar (always visible) - New Tomahawk-inspired layout
    // Layout: [Left: transport + queue] [Center: track info] [Right: progress + shuffle + repeat + volume]
    // z-50 to stay above queue drawer
    React.createElement('div', {
      className: 'bg-gray-800/95 backdrop-blur-xl border-t border-gray-700 px-4 py-3 no-drag flex-shrink-0 relative z-50',
      style: { minHeight: '72px' }
    },
      React.createElement('div', { className: 'flex items-center justify-between gap-4' },
        // LEFT: Transport controls + Queue button
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('button', {
            onClick: handlePrevious,
            disabled: !currentTrack,
            className: `p-2 rounded hover:bg-white/10 transition-colors ${!currentTrack ? 'text-gray-600 cursor-not-allowed' : 'text-white'}`
          }, React.createElement(SkipBack, { size: 18 })),
          React.createElement('button', {
            onClick: handlePlayPause,
            disabled: !currentTrack,
            className: `p-2 rounded hover:bg-white/10 transition-colors ${!currentTrack ? 'text-gray-600 cursor-not-allowed' : 'text-white'}`
          }, isPlaying ? React.createElement(Pause, { size: 22 }) : React.createElement(Play, { size: 22 })),
          React.createElement('button', {
            onClick: handleNext,
            disabled: !currentTrack,
            className: `p-2 rounded hover:bg-white/10 transition-colors ${!currentTrack ? 'text-gray-600 cursor-not-allowed' : 'text-white'}`
          }, React.createElement(SkipForward, { size: 18 })),
          // Queue button (hamburger style)
          React.createElement('button', {
            onClick: () => setQueueDrawerOpen(!queueDrawerOpen),
            className: `relative p-2 ml-1 rounded hover:bg-white/10 transition-colors ${queueDrawerOpen ? 'bg-white/20 text-white' : 'text-gray-400'} ${queueAnimating ? 'queue-pulse' : ''}`,
            title: `Queue (${currentQueue.length} tracks)`
          },
            React.createElement(List, { size: 18 }),
            currentQueue.length > 0 && React.createElement('span', {
              className: `absolute -top-1 -right-1 bg-green-500 text-white text-xs rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 text-[10px] font-medium ${queueAnimating ? 'badge-flash' : ''}`
            }, currentQueue.length > 99 ? '99+' : currentQueue.length)
          )
        ),

        // CENTER: Track info (album art + metadata)
        React.createElement('div', {
          className: 'flex-1 flex items-center justify-center gap-3 max-w-md relative',
          onDragEnter: (e) => handleDragEnter(e, 'now-playing'),
          onDragOver: (e) => handleDragOver(e, 'now-playing'),
          onDragLeave: handleDragLeave,
          onDrop: (e) => handleDrop(e, 'now-playing')
        },
          React.createElement(DropZoneOverlay, {
            zone: 'now-playing',
            isActive: isDraggingUrl && dropZoneTarget === 'now-playing'
          }),
          currentTrack ? [
            React.createElement('button', {
              key: 'album-art-button',
              onClick: async () => {
                // Search for the album and open its page
                if (currentTrack.album && currentTrack.artist) {
                  try {
                    // Search MusicBrainz for the release
                    const query = encodeURIComponent(`"${currentTrack.album}" AND artist:"${currentTrack.artist}"`);
                    const response = await fetch(
                      `https://musicbrainz.org/ws/2/release-group?query=${query}&fmt=json&limit=1`,
                      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
                    );
                    if (response.ok) {
                      const data = await response.json();
                      if (data['release-groups']?.length > 0) {
                        const album = data['release-groups'][0];
                        handleAlbumClick(album);
                      }
                    }
                  } catch (error) {
                    console.error('Error searching for album:', error);
                  }
                }
              },
              className: 'flex-shrink-0 hover:opacity-80 transition-opacity cursor-pointer no-drag',
              title: currentTrack.album ? `Open "${currentTrack.album}"` : 'Album'
            },
              React.createElement('div', {
                className: 'w-12 h-12 bg-gray-700 rounded flex items-center justify-center overflow-hidden relative'
              },
                currentTrack.albumArt && React.createElement('img', {
                  src: currentTrack.albumArt,
                  alt: currentTrack.album,
                  className: 'absolute inset-0 w-full h-full object-cover',
                  onError: (e) => { e.target.style.display = 'none'; }
                }),
                React.createElement(Music, { size: 20, className: 'text-gray-500' })
              )
            ),
            React.createElement('div', { key: 'track-info', className: 'min-w-0 text-center' },
              React.createElement('div', { className: 'text-sm font-medium text-white truncate' }, currentTrack.title),
              React.createElement('div', { className: 'text-xs text-gray-400 truncate flex items-center justify-center gap-1' },
                React.createElement('button', {
                  onClick: () => fetchArtistData(currentTrack.artist),
                  className: 'hover:text-white hover:underline transition-colors cursor-pointer no-drag'
                }, currentTrack.artist),
                (() => {
                  const resolverId = determineResolverIdFromTrack(currentTrack);
                  const resolver = allResolvers.find(r => r.id === resolverId);
                  if (resolver) {
                    const meta = {
                      spotify: { color: 'text-green-400' },
                      bandcamp: { color: 'text-cyan-400' },
                      qobuz: { color: 'text-blue-400' },
                      youtube: { color: 'text-red-400' }
                    }[resolverId] || { color: 'text-purple-400' };
                    return React.createElement('span', { className: meta.color }, ` · ${resolver.name}`);
                  }
                  return null;
                })()
              )
            )
          ] : React.createElement('div', { className: 'text-sm text-gray-500' }, 'No track playing')
        ),

        // RIGHT: Heart + Progress bar + Shuffle + Repeat + Volume
        React.createElement('div', { className: 'flex items-center gap-3' },
          // Heart/favorite button
          (() => {
            if (!currentTrack) return null;
            const trackId = `${currentTrack.artist || 'unknown'}-${currentTrack.title || 'untitled'}-${currentTrack.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            const isInCollection = collectionData.tracks.some(t => t.id === trackId);
            return React.createElement('button', {
              onClick: () => {
                if (!isInCollection) {
                  addTrackToCollection(currentTrack);
                } else {
                  showToast(`${currentTrack.title} is already in your collection`);
                }
              },
              className: `p-1.5 rounded-full transition-colors ${isInCollection ? 'text-red-500 hover:text-red-400' : 'text-gray-400 hover:text-white'}`,
              title: isInCollection ? 'In your collection' : 'Add to collection'
            },
              React.createElement('svg', {
                className: 'w-5 h-5',
                viewBox: '0 0 24 24',
                fill: isInCollection ? 'currentColor' : 'none',
                stroke: 'currentColor',
                strokeWidth: isInCollection ? 0 : 2
              },
                React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  d: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z'
                })
              )
            );
          })(),
          // Progress section
          React.createElement('div', { className: 'flex items-center gap-2 min-w-[200px]' },
            React.createElement('span', { className: 'text-xs text-gray-400 w-10 text-right tabular-nums' },
              currentTrack && !browserPlaybackActive ? formatTime(progress) : '0:00'
            ),
            React.createElement('div', { className: 'flex-1 w-24' },
              React.createElement('input', {
                type: 'range',
                min: '0',
                max: currentTrack?.duration || 100,
                value: currentTrack && !browserPlaybackActive ? progress : 0,
                disabled: !currentTrack || browserPlaybackActive,
                onChange: async (e) => {
                  if (browserPlaybackActive || !currentTrack) return;
                  const newPosition = Number(e.target.value);
                  setProgress(newPosition);
                  if ((currentTrack.sources?.spotify || currentTrack.spotifyUri) && spotifyPlayer) {
                    try {
                      await spotifyPlayer.seek(newPosition * 1000);
                    } catch (err) {
                      console.error('Seek error:', err);
                    }
                  } else if (currentTrack?.sources?.localfiles && audioRef.current) {
                    audioRef.current.currentTime = newPosition;
                  }
                },
                className: `w-full h-1 rounded-full appearance-none ${!currentTrack || browserPlaybackActive ? 'bg-gray-700 cursor-not-allowed' : 'bg-gray-600 cursor-pointer'}`
              })
            ),
            React.createElement('span', { className: 'text-xs text-gray-400 w-10 text-left tabular-nums' },
              currentTrack ? formatTime(currentTrack.duration) : '0:00'
            )
          ),
          // Shuffle button (placeholder)
          React.createElement('button', {
            disabled: true,
            className: 'p-2 rounded text-gray-600 cursor-not-allowed',
            title: 'Shuffle (coming soon)'
          },
            React.createElement('svg', { className: 'w-4 h-4', viewBox: '0 0 18 18', fill: 'currentColor' },
              React.createElement('path', { d: 'M17.5,1.5l-8.6,7l-8.4-7v14.9l8.3-6.9l8.8,7.1V1.5z M1.5,14.2V3.6l6.4,5.3L1.5,14.2z M16.5,14.4L9.8,9l6.7-5.4V14.4z' })
            )
          ),
          // Repeat button (placeholder)
          React.createElement('button', {
            disabled: true,
            className: 'p-2 rounded text-gray-600 cursor-not-allowed',
            title: 'Repeat (coming soon)'
          },
            React.createElement('svg', { className: 'w-4 h-4', viewBox: '0 0 16 16', fill: 'currentColor' },
              React.createElement('path', { d: 'M8,16c-1.3,0-2.7-0.3-3.8-1c-0.8-0.4-1.4-0.9-2-1.6c-0.5-0.5-0.9-1.1-1.3-1.8C0.3,10.5,0,9.3,0,8c0-4.4,3.6-8,8-8c1.1,0,2.1,0.2,3,0.6l-0.4,0.9C9.8,1.2,8.9,1,8,1C4.1,1,1,4.1,1,8c0,1.1,0.3,2.2,0.8,3.2c0.3,0.6,0.7,1.1,1.1,1.6c0.5,0.5,1.1,1,1.8,1.4C5.7,14.7,6.8,15,8,15c3.9,0,7-3.1,7-7c0-1-0.2-2-0.6-2.9l0.9-0.4C15.8,5.7,16,6.8,16,8C16,12.4,12.4,16,8,16z' })
            )
          ),
          // Volume
          React.createElement('div', { className: 'flex items-center gap-1' },
            React.createElement('span', { className: 'text-gray-400' },
              React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 18 18', fill: 'currentColor' },
                React.createElement('path', { d: 'M16,17.4l-6.1-3.8H2V5.1h6.9L16,0.6V17.4z M3,12.6h7.2l4.8,3V2.4L9.1,6.1H3V12.6z' })
              )
            ),
            React.createElement('input', {
              type: 'range',
              min: '0',
              max: '100',
              value: volume,
              onChange: (e) => {
                  const newVolume = Number(e.target.value);
                  setVolume(newVolume);
                  if (audioRef.current) {
                    audioRef.current.volume = newVolume / 100;
                  }
                },
              className: 'w-20 h-1 bg-gray-600 rounded-full appearance-none cursor-pointer'
            })
          )
        )
      ),

      // External playback notice (if applicable)
      isExternalPlayback && !browserPlaybackActive && currentTrack && React.createElement('div', {
        className: 'mt-2 flex items-center justify-center gap-4'
      },
        React.createElement('span', { className: 'text-xs text-gray-400' }, '🌐 Playing in browser'),
        React.createElement('button', {
          onClick: handleDoneWithExternalTrack,
          className: 'bg-green-600 hover:bg-green-700 text-white py-1 px-4 rounded text-sm font-medium transition-colors'
        }, 'Done - Play Next')
      )
    ),

    // Import Playlist Dialog Modal
    showUrlImportDialog && React.createElement('div', {
      className: 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50',
      onClick: (e) => {
        // Close when clicking backdrop
        if (e.target === e.currentTarget) {
          setShowUrlImportDialog(false);
          setUrlImportValue('');
        }
      }
    },
      React.createElement('div', {
        className: 'bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl'
      },
        // Header
        React.createElement('div', {
          className: 'flex items-center justify-between mb-6'
        },
          React.createElement('h2', { className: 'text-xl font-bold text-gray-900' }, '📥 Import Playlist'),
          React.createElement('button', {
            onClick: () => {
              setShowUrlImportDialog(false);
              setUrlImportValue('');
            },
            className: 'p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500'
          }, React.createElement(X))
        ),

        // Option 1: Import from file
        React.createElement('div', { className: 'mb-6' },
          React.createElement('h3', { className: 'text-sm font-semibold text-gray-700 mb-2' }, '📁 From File'),
          React.createElement('p', { className: 'text-xs text-gray-500 mb-3' }, 'Import an XSPF playlist file from your computer.'),
          React.createElement('button', {
            onClick: async () => {
              setShowUrlImportDialog(false);
              await handleImportPlaylist();
            },
            className: 'w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2',
            disabled: urlImportLoading
          },
            React.createElement('span', null, '📁'),
            'Choose File...'
          )
        ),

        // Divider
        React.createElement('div', { className: 'flex items-center gap-4 mb-6' },
          React.createElement('div', { className: 'flex-1 h-px bg-gray-200' }),
          React.createElement('span', { className: 'text-gray-400 text-sm' }, 'or'),
          React.createElement('div', { className: 'flex-1 h-px bg-gray-200' })
        ),

        // Option 2: Import from URL
        React.createElement('div', null,
          React.createElement('h3', { className: 'text-sm font-semibold text-gray-700 mb-2' }, '🌐 From URL'),
          React.createElement('p', { className: 'text-xs text-gray-500 mb-3' }, 'Import a hosted XSPF playlist. It will auto-update when the source changes.'),
          React.createElement('input', {
            type: 'url',
            value: urlImportValue,
            onChange: (e) => setUrlImportValue(e.target.value),
            placeholder: 'https://example.com/playlist.xspf',
            className: 'w-full px-4 py-3 bg-gray-50 rounded-lg border border-gray-200 focus:border-green-500 focus:outline-none text-gray-900 mb-3',
            disabled: urlImportLoading
          }),
          React.createElement('button', {
            onClick: async () => {
              if (!urlImportValue.trim()) return;
              setUrlImportLoading(true);
              try {
                const result = await handleImportPlaylistFromUrl(urlImportValue.trim());
                setShowUrlImportDialog(false);
                setUrlImportValue('');
                showConfirmDialog({
                  type: 'success',
                  title: result.updated ? 'Playlist Updated' : 'Playlist Imported',
                  message: result.playlist.title
                });
              } catch (error) {
                showConfirmDialog({
                  type: 'error',
                  title: 'Import Failed',
                  message: error.message
                });
              } finally {
                setUrlImportLoading(false);
              }
            },
            disabled: urlImportLoading || !urlImportValue.trim(),
            className: `w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center gap-2 ${
              (urlImportLoading || !urlImportValue.trim()) ? 'opacity-50 cursor-not-allowed' : ''
            }`
          },
            urlImportLoading ? '⏳ Importing...' : '🌐 Import from URL'
          )
        )
      )
    ),

    // Resolver Detail Modal
    selectedResolver && React.createElement('div', {
      className: 'fixed inset-0 bg-black/50 flex items-center justify-center z-50',
      onClick: (e) => { if (e.target === e.currentTarget) setSelectedResolver(null); }
    },
      React.createElement('div', {
        className: 'bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden'
      },
        // Modal header with colored background
        React.createElement('div', {
          className: 'p-6 flex items-center gap-4',
          style: { backgroundColor: selectedResolver.color || '#6B7280' }
        },
          // Logo
          React.createElement('div', {
            className: 'w-16 h-16 flex items-center justify-center'
          }, SERVICE_LOGOS[selectedResolver.id] || React.createElement('span', { className: 'text-4xl' }, selectedResolver.icon)),
          // Name and version
          React.createElement('div', { className: 'flex-1 text-white' },
            React.createElement('div', { className: 'flex items-center gap-2' },
              React.createElement('h2', { className: 'text-xl font-bold' }, selectedResolver.name),
              selectedResolver.version && React.createElement('span', {
                className: 'px-2 py-0.5 bg-white/20 rounded text-xs'
              }, 'v', selectedResolver.version)
            ),
            React.createElement('p', { className: 'text-white/80 text-sm' }, selectedResolver.author || 'Parachord Team')
          ),
          // Close button
          React.createElement('button', {
            onClick: () => setSelectedResolver(null),
            className: 'w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors'
          }, '✕')
        ),
        // Modal body
        React.createElement('div', { className: 'p-6 space-y-6 max-h-[60vh] overflow-y-auto' },
          // Description
          React.createElement('p', { className: 'text-gray-600 text-sm' }, selectedResolver.description),

          // Capabilities
          React.createElement('div', null,
            React.createElement('h3', { className: 'text-sm font-semibold text-gray-900 mb-2' }, 'Capabilities'),
            React.createElement('div', { className: 'flex flex-wrap gap-2' },
              Object.entries(selectedResolver.capabilities || {}).map(([cap, enabled]) => {
                if (!enabled) return null;
                const capLabels = {
                  resolve: { icon: '🎯', label: 'Resolve' },
                  search: { icon: '🔍', label: 'Search' },
                  stream: { icon: '▶️', label: 'Stream' },
                  browse: { icon: '📁', label: 'Browse' },
                  urlLookup: { icon: '🔗', label: 'URL Lookup' }
                };
                const capInfo = capLabels[cap] || { icon: '✓', label: cap };
                return React.createElement('span', {
                  key: cap,
                  className: 'px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-700 flex items-center gap-1'
                }, capInfo.icon, ' ', capInfo.label);
              })
            )
          ),

          // Enable/Disable toggle
          React.createElement('div', {
            className: 'flex items-center justify-between py-3 border-t border-gray-100'
          },
            React.createElement('div', null,
              React.createElement('span', { className: 'font-medium text-gray-900' }, 'Enable Resolver'),
              React.createElement('p', { className: 'text-xs text-gray-500' }, 'Include in search and playback')
            ),
            React.createElement('label', { className: 'relative inline-block w-12 h-6' },
              React.createElement('input', {
                type: 'checkbox',
                checked: activeResolvers.includes(selectedResolver.id),
                onChange: () => toggleResolver(selectedResolver.id),
                className: 'sr-only peer'
              }),
              React.createElement('div', {
                className: 'w-full h-full bg-gray-300 rounded-full peer-checked:bg-purple-600 transition-colors'
              }),
              React.createElement('div', {
                className: 'absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-6'
              })
            )
          ),

          // Authentication section (for services that require it)
          selectedResolver.id === 'spotify' && React.createElement('div', {
            className: 'py-3 border-t border-gray-100'
          },
            React.createElement('div', { className: 'flex items-center justify-between' },
              React.createElement('div', null,
                React.createElement('span', { className: 'font-medium text-gray-900' }, 'Spotify Account'),
                React.createElement('p', { className: 'text-xs text-gray-500' },
                  spotifyConnected ? 'Connected and ready' : 'Sign in to enable streaming'
                )
              ),
              spotifyConnected
                ? React.createElement('button', {
                    onClick: disconnectSpotify,
                    className: 'px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors'
                  }, 'Disconnect')
                : React.createElement('button', {
                    onClick: connectSpotify,
                    className: 'px-4 py-2 text-sm text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors'
                  }, 'Connect')
            ),
            spotifyConnected && React.createElement('div', {
              className: 'mt-3 flex items-center gap-2 text-green-600 text-sm'
            },
              React.createElement('span', null, '✓'),
              React.createElement('span', null, 'Spotify Premium connected')
            )
          ),

          // Qobuz authentication section
          selectedResolver.id === 'qobuz' && React.createElement('div', {
            className: 'py-3 border-t border-gray-100'
          },
            React.createElement('div', null,
              React.createElement('span', { className: 'font-medium text-gray-900' }, 'Qobuz Streaming'),
              React.createElement('p', { className: 'text-xs text-gray-500 mt-1' },
                'Currently using 30-second previews. Full streaming requires Qobuz subscription.'
              )
            )
          ),

          // Local Files settings section
          selectedResolver.id === 'localfiles' && React.createElement('div', {
            className: 'py-3 border-t border-gray-100'
          },
            React.createElement('h3', { className: 'font-medium text-gray-900 mb-3' }, 'Watch Folders'),
            React.createElement('p', { className: 'text-xs text-gray-500 mb-4' },
              'Add folders containing your music files. Parachord will automatically index and watch them for changes.'
            ),

            // Watch folders list
            React.createElement('div', { className: 'space-y-2 mb-4' },
              watchFolders.length === 0
                ? React.createElement('p', { className: 'text-sm text-gray-400 italic' }, 'No watch folders configured')
                : watchFolders.map(folder =>
                    React.createElement('div', {
                      key: folder.path,
                      className: 'flex items-center justify-between p-3 bg-gray-50 rounded-lg'
                    },
                      React.createElement('div', { className: 'flex-1 min-w-0' },
                        React.createElement('p', { className: 'text-sm font-medium text-gray-900 truncate' }, folder.path),
                        React.createElement('p', { className: 'text-xs text-gray-500' },
                          `${folder.track_count || 0} tracks`
                        )
                      ),
                      React.createElement('div', { className: 'flex items-center gap-2 ml-4' },
                        React.createElement('button', {
                          onClick: () => handleRescanFolder(folder.path),
                          disabled: isScanning,
                          className: 'p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors disabled:opacity-50',
                          title: 'Rescan folder'
                        }, '\u21BB'),
                        React.createElement('button', {
                          onClick: () => handleRemoveWatchFolder(folder.path),
                          className: 'p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors',
                          title: 'Remove folder'
                        }, '\u2715')
                      )
                    )
                  )
            ),

            // Add folder button
            React.createElement('button', {
              onClick: handleAddWatchFolder,
              disabled: isScanning,
              className: 'w-full px-4 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2'
            },
              React.createElement('span', null, '+'),
              'Add Watch Folder'
            ),

            // Scan progress
            isScanning && React.createElement('div', { className: 'mt-4' },
              React.createElement('div', { className: 'flex items-center gap-2 mb-2' },
                React.createElement('div', { className: 'animate-spin w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full' }),
                React.createElement('span', { className: 'text-sm text-gray-600' }, 'Scanning...')
              ),
              React.createElement('div', { className: 'w-full bg-gray-200 rounded-full h-2' },
                React.createElement('div', {
                  className: 'bg-purple-600 h-2 rounded-full transition-all',
                  style: { width: `${scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0}%` }
                })
              ),
              React.createElement('p', { className: 'text-xs text-gray-500 mt-1 truncate' },
                scanProgress.file || 'Preparing...'
              )
            ),

            // Stats
            React.createElement('div', { className: 'mt-6 pt-4 border-t border-gray-200' },
              React.createElement('h4', { className: 'text-sm font-medium text-gray-900 mb-2' }, 'Library Stats'),
              React.createElement('div', { className: 'grid grid-cols-2 gap-4 text-sm' },
                React.createElement('div', null,
                  React.createElement('p', { className: 'text-gray-500' }, 'Total Tracks'),
                  React.createElement('p', { className: 'font-medium text-gray-900' }, localFilesStats.totalTracks.toLocaleString())
                ),
                React.createElement('div', null,
                  React.createElement('p', { className: 'text-gray-500' }, 'Last Scan'),
                  React.createElement('p', { className: 'font-medium text-gray-900' },
                    localFilesStats.lastScan
                      ? new Date(localFilesStats.lastScan).toLocaleDateString()
                      : 'Never'
                  )
                )
              ),
              React.createElement('button', {
                onClick: handleRescanAll,
                disabled: isScanning || watchFolders.length === 0,
                className: 'mt-4 px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              }, 'Rescan All Folders')
            )
          )
        ),

        // Modal footer with action buttons
        React.createElement('div', {
          className: 'px-6 py-4 bg-gray-50 flex items-center justify-between'
        },
          // Left side: Remove button (only for user-installed resolvers)
          React.createElement('div', null,
            // Check if this is a user-installed resolver (not built-in)
            !['spotify', 'bandcamp', 'qobuz', 'musicbrainz'].includes(selectedResolver.id) &&
              React.createElement('button', {
                onClick: async () => {
                  await handleUninstallResolver(selectedResolver.id);
                  setSelectedResolver(null);
                },
                className: 'px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors'
              }, 'Remove')
          ),
          // Right side: Update button (if available) and Done
          React.createElement('div', { className: 'flex items-center gap-2' },
            // Update button - show if marketplace has newer version
            (() => {
              const marketplaceResolver = marketplaceManifest?.resolvers?.find(r => r.id === selectedResolver.id);
              const hasUpdate = marketplaceResolver &&
                marketplaceResolver.version !== selectedResolver.version &&
                marketplaceResolver.version > selectedResolver.version;
              if (hasUpdate) {
                return React.createElement('button', {
                  onClick: async () => {
                    await handleInstallFromMarketplace(marketplaceResolver);
                    setSelectedResolver(null);
                  },
                  disabled: installingResolvers.has(selectedResolver.id),
                  className: `px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors ${
                    installingResolvers.has(selectedResolver.id) ? 'opacity-50 cursor-not-allowed' : ''
                  }`
                }, installingResolvers.has(selectedResolver.id) ? 'Updating...' : `Update to v${marketplaceResolver.version}`);
              }
              return null;
            })(),
            React.createElement('button', {
              onClick: () => setSelectedResolver(null),
              className: 'px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors'
            }, 'Done')
          )
        )
      )
    ),

    // Add to Playlist Slide-out Panel
    addToPlaylistPanel.open && React.createElement('div', {
      className: 'fixed inset-0 z-50',
      style: { pointerEvents: 'none' }
    },
      // Backdrop (only covers area outside sidebar)
      React.createElement('div', {
        className: 'absolute inset-0 bg-black/30 transition-opacity',
        style: { left: '256px', pointerEvents: 'auto' },
        onClick: () => {
          setAddToPlaylistPanel(prev => ({ ...prev, open: false }));
          setSelectedPlaylistsForAdd([]);
          setNewPlaylistFormOpen(false);
          setNewPlaylistName('');
        },
        onDragOver: (e) => {
          e.preventDefault();
        },
        onDrop: (e) => {
          e.preventDefault();
        }
      }),

      // Panel - positioned at right edge of sidebar
      React.createElement('div', {
        className: 'absolute w-96 bg-white shadow-2xl flex flex-col',
        style: { left: '256px', top: '28px', bottom: '72px', pointerEvents: 'auto' }, // Account for title bar and player
        onDragOver: (e) => {
          // Allow drag events to pass through to children
          e.preventDefault();
        },
        onDrop: (e) => {
          e.preventDefault();
        }
      },
        // Dark header with title
        React.createElement('div', {
          className: 'bg-gray-700 px-5 py-4'
        },
          React.createElement('div', {
            className: 'flex items-center gap-2 text-white'
          },
            React.createElement('span', { className: 'text-lg' }, '+'),
            React.createElement('span', { className: 'w-4 h-4 rounded-full bg-gray-500' }),
            React.createElement('span', {
              className: 'text-sm font-medium tracking-wide'
            }, 'ADD TO PLAYLIST')
          )
        ),

        // Track info section with DONE button
        React.createElement('div', {
          className: 'px-5 py-4 bg-gray-100 border-b border-gray-200'
        },
          React.createElement('div', {
            className: 'flex items-center gap-3'
          },
            // Album art thumbnail (gray placeholder or actual art)
            React.createElement('div', {
              className: 'w-12 h-12 rounded bg-gray-300 flex-shrink-0 flex items-center justify-center overflow-hidden relative'
            },
              // Placeholder always rendered behind
              React.createElement(Music, { size: 20, className: 'text-gray-400' }),
              addToPlaylistPanel.tracks[0]?.albumArt && React.createElement('img', {
                src: addToPlaylistPanel.tracks[0].albumArt,
                className: 'absolute inset-0 w-full h-full object-cover',
                onError: (e) => { e.target.style.display = 'none'; }
              })
            ),
            // Track/source info
            React.createElement('div', {
              className: 'flex-1 min-w-0'
            },
              React.createElement('p', {
                className: 'text-sm font-medium text-gray-900 truncate'
              }, addToPlaylistPanel.sourceName),
              React.createElement('p', {
                className: 'text-xs text-gray-500'
              }, addToPlaylistPanel.tracks[0]?.artist || `${addToPlaylistPanel.tracks.length} tracks`)
            ),
            // DONE button - just closes the panel (tracks are added on click)
            React.createElement('button', {
              onClick: () => {
                setAddToPlaylistPanel(prev => ({ ...prev, open: false }));
                setSelectedPlaylistsForAdd([]);
                setNewPlaylistFormOpen(false);
                setNewPlaylistName('');
              },
              className: 'px-5 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-full transition-colors'
            }, 'DONE')
          )
        ),

        // PLAYLISTS section header
        React.createElement('div', {
          className: 'px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider'
        }, 'PLAYLISTS'),

        // Playlist list (scrollable) - includes New Playlist row at top
        React.createElement('div', {
          className: 'flex-1 overflow-y-auto min-h-0'
        },
          // New Playlist row (always shown at top)
          // TODO: Fix drag-and-drop to create new playlist - onDrop events not firing in Electron
          // The visual highlight works (onDragEnter/onDragLeave) but onDrop never fires.
          // Attempted: dataTransfer fallback, mouseUp fallback, pointerEvents:none on children.
          // For now, users must click "New Playlist" row to open form, then drag to existing playlists works.
          React.createElement('div', {
            key: 'new-playlist-row',
            onClick: () => {
              if (!newPlaylistFormOpen) {
                setNewPlaylistFormOpen(true);
                setNewPlaylistName('');
                setDroppedTrackForNewPlaylist(null);
              }
            },
            onMouseUp: () => {
              // Fallback for drop - if we're hovering while a track is being dragged
              if (dropTargetNewPlaylist && draggingTrackForPlaylist) {
                console.log('🖱️ MouseUp on New Playlist row while dragging:', draggingTrackForPlaylist.title);
                setDroppedTrackForNewPlaylist(draggingTrackForPlaylist);
                setNewPlaylistFormOpen(true);
                setNewPlaylistName('');
                setDropTargetNewPlaylist(false);
              }
            },
            onDragEnter: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (draggingTrackForPlaylist) {
                setDropTargetNewPlaylist(true);
              }
            },
            onDragOver: (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            },
            onDragLeave: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setDropTargetNewPlaylist(false);
              }
            },
            onDrop: (e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('🎯 Drop on New Playlist row');

              // Try to get track from state or dataTransfer
              let trackToUse = draggingTrackForPlaylist;
              if (!trackToUse) {
                try {
                  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                  if (data.type === 'track' && data.track) {
                    trackToUse = data.track;
                  }
                } catch (err) {
                  // ignore
                }
              }

              if (trackToUse) {
                setDroppedTrackForNewPlaylist(trackToUse);
                setNewPlaylistFormOpen(true);
                setNewPlaylistName('');
                setDropTargetNewPlaylist(false);
              }
            },
            className: `flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-all border-b border-gray-100 ${
              dropTargetNewPlaylist
                ? 'bg-purple-100 border-l-4 border-l-purple-500 pl-4'
                : newPlaylistFormOpen
                  ? 'bg-gray-100'
                  : 'hover:bg-gray-50'
            }`
          },
            // Plus icon in square (like playlist thumbnail)
            React.createElement('div', {
              className: 'w-10 h-10 rounded bg-gray-200 flex-shrink-0 flex items-center justify-center',
              style: { pointerEvents: 'none' } // Let parent handle all events
            },
              React.createElement('span', { className: 'text-gray-500 text-xl font-light' }, '+')
            ),
            // "New Playlist" text or input form
            newPlaylistFormOpen ?
              React.createElement('div', {
                className: 'flex-1 flex gap-2',
                onClick: (e) => e.stopPropagation(), // Prevent row click when interacting with form
                style: { pointerEvents: 'auto' } // Allow form interaction
              },
                React.createElement('input', {
                  type: 'text',
                  value: newPlaylistName,
                  onChange: (e) => setNewPlaylistName(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' && newPlaylistName.trim()) {
                      // Create new playlist with the tracks
                      const playlistId = newPlaylistName.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
                      // Use dropped track if available, otherwise use panel tracks
                      const sourceTracks = droppedTrackForNewPlaylist ? [droppedTrackForNewPlaylist] : addToPlaylistPanel.tracks;
                      const tracksToAdd = sourceTracks.map(t => ({
                        title: t.title,
                        artist: t.artist,
                        album: t.album,
                        duration: t.duration,
                        id: t.id || `${t.artist}-${t.title}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
                      }));
                      const newPlaylist = {
                        id: playlistId,
                        filename: `${playlistId}.xspf`,
                        title: newPlaylistName.trim(),
                        creator: 'Me',
                        tracks: tracksToAdd,
                        createdAt: Date.now(),
                        lastModified: Date.now()
                      };
                      setPlaylists(prev => [newPlaylist, ...prev]);
                      fetchPlaylistCovers(playlistId, newPlaylist.tracks);
                      setSelectedPlaylistsForAdd(prev => [...prev, playlistId]);
                      savePlaylistToDisk(newPlaylist); // Save to disk
                      showSidebarBadge('playlists', tracksToAdd.length);
                      setNewPlaylistFormOpen(false);
                      setNewPlaylistName('');
                      setDroppedTrackForNewPlaylist(null); // Clear dropped track
                    } else if (e.key === 'Escape') {
                      setNewPlaylistFormOpen(false);
                      setNewPlaylistName('');
                      setDroppedTrackForNewPlaylist(null); // Clear dropped track
                    }
                  },
                  placeholder: 'Playlist name...',
                  autoFocus: true,
                  className: 'flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500'
                }),
                React.createElement('button', {
                  onClick: () => {
                    if (!newPlaylistName.trim()) return;
                    // Create new playlist with the tracks
                    const playlistId = newPlaylistName.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
                    // Use dropped track if available, otherwise use panel tracks
                    const sourceTracks = droppedTrackForNewPlaylist ? [droppedTrackForNewPlaylist] : addToPlaylistPanel.tracks;
                    const tracksToAdd = sourceTracks.map(t => ({
                      title: t.title,
                      artist: t.artist,
                      album: t.album,
                      duration: t.duration,
                      id: t.id || `${t.artist}-${t.title}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
                    }));
                    const newPlaylist = {
                      id: playlistId,
                      filename: `${playlistId}.xspf`,
                      title: newPlaylistName.trim(),
                      creator: 'Me',
                      tracks: tracksToAdd,
                      createdAt: Date.now(),
                      lastModified: Date.now()
                    };
                    setPlaylists(prev => [newPlaylist, ...prev]);
                    fetchPlaylistCovers(playlistId, newPlaylist.tracks);
                    setSelectedPlaylistsForAdd(prev => [...prev, playlistId]);
                    savePlaylistToDisk(newPlaylist); // Save to disk
                    showSidebarBadge('playlists', tracksToAdd.length);
                    setNewPlaylistFormOpen(false);
                    setNewPlaylistName('');
                    setDroppedTrackForNewPlaylist(null); // Clear dropped track
                  },
                  disabled: !newPlaylistName.trim(),
                  className: `px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                    newPlaylistName.trim()
                      ? 'bg-green-500 hover:bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`
                }, 'Create')
              )
            :
              React.createElement('span', {
                className: 'flex-1 text-sm text-gray-600',
                style: { pointerEvents: 'none' } // Let parent handle all events
              }, 'New Playlist')
          ),

          // Existing playlists
          playlists.length === 0 ?
            React.createElement('div', {
              className: 'px-5 py-8 text-center text-gray-400 text-sm'
            }, 'No playlists yet')
          :
            playlists.map(playlist => {
              const isAdded = selectedPlaylistsForAdd.includes(playlist.id);
              const isDropTarget = dropTargetPlaylistId === playlist.id;

              // Helper to add tracks to this playlist
              const addTracksToPlaylistHelper = (tracks) => {
                if (isAdded || !tracks || tracks.length === 0) return;

                // Add tracks to this playlist immediately
                const tracksToAdd = tracks.map(t => ({
                  title: t.title,
                  artist: t.artist,
                  album: t.album,
                  duration: t.duration,
                  id: t.id || `${t.artist}-${t.title}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
                }));

                // Build updated playlist for saving
                const updatedPlaylist = {
                  ...playlist,
                  tracks: [...(playlist.tracks || []), ...tracksToAdd],
                  lastModified: Date.now()
                };

                setPlaylists(prev => prev.map(p => {
                  if (p.id === playlist.id) {
                    return updatedPlaylist;
                  }
                  return p;
                }));

                // Save to disk
                savePlaylistToDisk(updatedPlaylist);

                // Mark as added
                setSelectedPlaylistsForAdd(prev => [...prev, playlist.id]);

                // Show sidebar badge
                showSidebarBadge('playlists', tracks.length);
              };

              return React.createElement('div', {
                key: playlist.id,
                onClick: () => addTracksToPlaylistHelper(addToPlaylistPanel.tracks),
                onDragEnter: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isAdded) {
                    setDropTargetPlaylistId(playlist.id);
                  }
                },
                onDragOver: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                  if (!isAdded && dropTargetPlaylistId !== playlist.id) {
                    setDropTargetPlaylistId(playlist.id);
                  }
                },
                onDragLeave: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Only clear if we're actually leaving this element
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDropTargetPlaylistId(null);
                  }
                },
                onDrop: (e) => {
                  e.preventDefault();
                  e.stopPropagation();

                  // Try to get track from state first, then dataTransfer as fallback
                  let trackFromDrag = draggingTrackForPlaylist;
                  if (!trackFromDrag) {
                    try {
                      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                      if (data.type === 'track' && data.track) {
                        trackFromDrag = data.track;
                      }
                    } catch (err) {
                      // ignore parse errors
                    }
                  }

                  const tracksToUse = trackFromDrag
                    ? [trackFromDrag]
                    : addToPlaylistPanel.tracks;
                  addTracksToPlaylistHelper(tracksToUse);
                  // Clear the dragging state
                  setDraggingTrackForPlaylist(null);
                  setDropTargetPlaylistId(null);
                },
                className: `flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-all border-b border-gray-100 ${
                  isAdded
                    ? 'bg-green-50'
                    : isDropTarget
                      ? 'bg-purple-100 border-l-4 border-l-purple-500 pl-4'
                      : 'hover:bg-gray-50'
                }`
              },
                // Playlist thumbnail (gray square)
                React.createElement('div', {
                  className: 'w-10 h-10 rounded bg-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden'
                },
                  // Could show playlist cover here if available
                  allPlaylistCovers[playlist.id]?.[0] ?
                    React.createElement('img', {
                      src: allPlaylistCovers[playlist.id][0],
                      className: 'w-full h-full object-cover'
                    })
                  :
                    React.createElement(Music, { size: 16, className: 'text-gray-400' })
                ),
                // Playlist name
                React.createElement('span', {
                  className: 'flex-1 text-sm text-gray-900 truncate'
                }, playlist.title),
                // Song count - shows updated count from playlists state
                React.createElement('span', {
                  className: `text-sm flex-shrink-0 ${isAdded ? 'text-green-600 font-medium' : 'text-gray-400'}`
                }, `${playlist.tracks?.length || 0} songs`),
                // Checkmark if added
                isAdded && React.createElement('svg', {
                  className: 'w-5 h-5 text-green-500 flex-shrink-0',
                  fill: 'none',
                  viewBox: '0 0 24 24',
                  stroke: 'currentColor'
                },
                  React.createElement('path', {
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    strokeWidth: 2,
                    d: 'M5 13l4 4L19 7'
                  })
                )
              );
            })
        )
      )
    ),

    // ID3 Tag Editor Modal
    id3EditorOpen && React.createElement('div', {
      className: 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]',
      onClick: (e) => {
        if (e.target === e.currentTarget && !id3EditorSaving) {
          setId3EditorOpen(false);
          setId3EditorTrack(null);
        }
      }
    },
      React.createElement('div', {
        className: 'bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden',
        onClick: (e) => e.stopPropagation()
      },
        // Header
        React.createElement('div', {
          className: 'px-6 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white'
        },
          React.createElement('h2', { className: 'text-lg font-semibold' }, 'Edit ID3 Tags'),
          React.createElement('p', { className: 'text-sm text-white/80 mt-1 truncate' },
            id3EditorTrack?.filePath?.split('/').pop() || 'Unknown file'
          )
        ),
        // Body
        React.createElement('div', {
          className: 'p-6 space-y-4 max-h-[60vh] overflow-y-auto'
        },
          // Title field
          React.createElement('div', null,
            React.createElement('label', {
              className: 'block text-sm font-medium text-gray-700 mb-1'
            }, 'Title'),
            React.createElement('input', {
              type: 'text',
              value: id3EditorValues.title,
              onChange: (e) => setId3EditorValues(v => ({ ...v, title: e.target.value })),
              className: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent',
              placeholder: 'Track title'
            })
          ),
          // Artist field
          React.createElement('div', null,
            React.createElement('label', {
              className: 'block text-sm font-medium text-gray-700 mb-1'
            }, 'Artist'),
            React.createElement('input', {
              type: 'text',
              value: id3EditorValues.artist,
              onChange: (e) => setId3EditorValues(v => ({ ...v, artist: e.target.value })),
              className: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent',
              placeholder: 'Artist name'
            })
          ),
          // Album field
          React.createElement('div', null,
            React.createElement('label', {
              className: 'block text-sm font-medium text-gray-700 mb-1'
            }, 'Album'),
            React.createElement('input', {
              type: 'text',
              value: id3EditorValues.album,
              onChange: (e) => setId3EditorValues(v => ({ ...v, album: e.target.value })),
              className: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent',
              placeholder: 'Album name'
            })
          ),
          // Track Number and Year row
          React.createElement('div', { className: 'flex gap-4' },
            // Track Number field
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', {
                className: 'block text-sm font-medium text-gray-700 mb-1'
              }, 'Track #'),
              React.createElement('input', {
                type: 'text',
                value: id3EditorValues.trackNumber,
                onChange: (e) => setId3EditorValues(v => ({ ...v, trackNumber: e.target.value })),
                className: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent',
                placeholder: '1'
              })
            ),
            // Year field
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', {
                className: 'block text-sm font-medium text-gray-700 mb-1'
              }, 'Year'),
              React.createElement('input', {
                type: 'text',
                value: id3EditorValues.year,
                onChange: (e) => setId3EditorValues(v => ({ ...v, year: e.target.value })),
                className: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent',
                placeholder: '2024'
              })
            )
          ),

          // Album Art section
          React.createElement('div', { className: 'pt-4 border-t border-gray-200' },
            React.createElement('div', { className: 'flex items-center justify-between mb-3' },
              React.createElement('label', {
                className: 'block text-sm font-medium text-gray-700'
              }, 'Album Art'),
              id3ArtLoading && React.createElement('span', {
                className: 'text-sm text-purple-600 flex items-center gap-1'
              },
                React.createElement('span', { className: 'animate-spin' }, '⟳'),
                'Searching...'
              )
            ),

            // Current selection
            id3SelectedArt && React.createElement('div', {
              className: 'mb-3 p-2 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3'
            },
              React.createElement('img', {
                src: id3SelectedArt.thumbnailUrl,
                alt: 'Selected album art',
                className: 'w-16 h-16 rounded object-cover'
              }),
              React.createElement('div', { className: 'flex-1 min-w-0' },
                React.createElement('div', { className: 'text-sm font-medium text-green-800 truncate' }, id3SelectedArt.releaseName),
                React.createElement('div', { className: 'text-xs text-green-600 truncate' }, id3SelectedArt.artistName),
                id3SelectedArt.year && React.createElement('div', { className: 'text-xs text-green-600' }, id3SelectedArt.year)
              ),
              React.createElement('button', {
                onClick: () => setId3SelectedArt(null),
                className: 'text-green-600 hover:text-green-800 p-1'
              }, '✕')
            ),

            // Art suggestions grid
            id3ArtSuggestions.length > 0 && !id3SelectedArt && React.createElement('div', {
              className: 'grid grid-cols-4 gap-2'
            },
              id3ArtSuggestions.map((art, idx) =>
                React.createElement('button', {
                  key: art.releaseId || idx,
                  onClick: () => setId3SelectedArt(art),
                  className: 'relative group rounded-lg overflow-hidden border-2 border-transparent hover:border-purple-500 transition-colors',
                  title: `${art.releaseName} by ${art.artistName}${art.year ? ` (${art.year})` : ''}`
                },
                  React.createElement('img', {
                    src: art.thumbnailUrl,
                    alt: art.releaseName,
                    className: 'w-full aspect-square object-cover'
                  }),
                  React.createElement('div', {
                    className: 'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'
                  },
                    React.createElement('span', { className: 'text-white text-xs font-medium' }, 'Select')
                  )
                )
              )
            ),

            // Empty state messages
            !id3ArtLoading && id3ArtSuggestions.length === 0 && !id3SelectedArt && React.createElement('div', {
              className: 'text-center py-4 text-gray-400 text-sm'
            },
              (!id3EditorValues.artist || !id3EditorValues.album)
                ? 'Enter artist and album to see artwork suggestions'
                : 'No artwork found for this album'
            )
          )
        ),
        // Footer with buttons
        React.createElement('div', {
          className: 'px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3'
        },
          React.createElement('button', {
            onClick: () => {
              setId3EditorOpen(false);
              setId3EditorTrack(null);
            },
            disabled: id3EditorSaving,
            className: 'px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50'
          }, 'Cancel'),
          React.createElement('button', {
            onClick: async () => {
              if (!id3EditorTrack?.filePath) return;

              setId3EditorSaving(true);
              try {
                const tagsToSave = {
                  title: id3EditorValues.title,
                  artist: id3EditorValues.artist,
                  album: id3EditorValues.album,
                  trackNumber: id3EditorValues.trackNumber ? parseInt(id3EditorValues.trackNumber, 10) : null,
                  year: id3EditorValues.year ? parseInt(id3EditorValues.year, 10) : null
                };

                // If album art was selected, include it
                if (id3SelectedArt?.fullUrl) {
                  tagsToSave.albumArtUrl = id3SelectedArt.fullUrl;
                }

                const result = await window.electron.localFiles.saveId3Tags(
                  id3EditorTrack.filePath,
                  tagsToSave
                );

                if (result.success) {
                  console.log('🏷️ ID3 tags saved successfully');
                  // Update track in library
                  setLibrary(prev => prev.map(t =>
                    t.filePath === id3EditorTrack.filePath
                      ? {
                          ...t,
                          ...id3EditorValues,
                          trackNumber: id3EditorValues.trackNumber ? parseInt(id3EditorValues.trackNumber, 10) : t.trackNumber,
                          year: id3EditorValues.year ? parseInt(id3EditorValues.year, 10) : t.year,
                          albumArt: id3SelectedArt?.fullUrl || t.albumArt
                        }
                      : t
                  ));
                  setId3EditorOpen(false);
                  setId3EditorTrack(null);
                  setId3SelectedArt(null);
                  setId3ArtSuggestions([]);
                } else {
                  alert('Failed to save ID3 tags: ' + result.error);
                }
              } catch (error) {
                console.error('Error saving ID3 tags:', error);
                alert('Failed to save ID3 tags: ' + error.message);
              } finally {
                setId3EditorSaving(false);
              }
            },
            disabled: id3EditorSaving,
            className: 'px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center gap-2'
          },
            id3EditorSaving && React.createElement('span', { className: 'animate-spin' }, '⟳'),
            id3EditorSaving ? 'Saving...' : 'Save'
          )
        )
      )
    ),

    // Confirmation Dialog Modal
    confirmDialog.show && React.createElement('div', {
      className: 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]',
      onClick: (e) => {
        if (e.target === e.currentTarget) closeConfirmDialog();
      }
    },
      React.createElement('div', {
        className: 'bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden transform transition-all',
        onClick: (e) => e.stopPropagation()
      },
        // Header with colored indicator
        React.createElement('div', {
          className: `px-6 pt-6 pb-4 flex flex-col items-center text-center`
        },
          // Icon based on type
          React.createElement('div', {
            className: `w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
              confirmDialog.type === 'success' ? 'bg-green-100' :
              confirmDialog.type === 'error' ? 'bg-red-100' :
              'bg-purple-100'
            }`
          },
            React.createElement('span', {
              className: 'text-3xl'
            }, confirmDialog.type === 'success' ? '✓' :
               confirmDialog.type === 'error' ? '✕' : 'ℹ')
          ),
          // Title
          confirmDialog.title && React.createElement('h3', {
            className: `text-lg font-semibold mb-2 ${
              confirmDialog.type === 'success' ? 'text-green-800' :
              confirmDialog.type === 'error' ? 'text-red-800' :
              'text-gray-900'
            }`
          }, confirmDialog.title),
          // Message
          confirmDialog.message && React.createElement('p', {
            className: 'text-gray-600 text-sm leading-relaxed'
          }, confirmDialog.message)
        ),
        // Footer with button
        React.createElement('div', { className: 'px-6 pb-6 pt-2' },
          React.createElement('button', {
            onClick: () => {
              if (confirmDialog.onConfirm) confirmDialog.onConfirm();
              closeConfirmDialog();
            },
            className: `w-full py-3 px-4 rounded-xl font-medium transition-colors ${
              confirmDialog.type === 'success' ? 'bg-green-600 hover:bg-green-700 text-white' :
              confirmDialog.type === 'error' ? 'bg-red-600 hover:bg-red-700 text-white' :
              'bg-purple-600 hover:bg-purple-700 text-white'
            }`
          }, 'OK')
        )
      )
    ),

    // Queue Drawer - slides up above the playbar with matching dark theme
    // Gradient transparency: more opaque near playbar, more transparent at top
    React.createElement('div', {
      className: 'fixed left-0 right-0 backdrop-blur-md border-t border-gray-700/50 shadow-2xl transition-all duration-300 ease-in-out z-40',
      style: {
        bottom: queueDrawerOpen ? '72px' : -queueDrawerHeight, // Position above the playbar (72px height)
        height: queueDrawerHeight + 'px',
        background: 'linear-gradient(to top, rgba(17, 24, 39, 0.9), rgba(17, 24, 39, 0.5))'
      }
    },
      // Drawer header with drag handle - dark translucent theme
      React.createElement('div', {
        className: 'flex items-center justify-between px-4 py-2 bg-gray-900/60 border-b border-gray-700/50 cursor-ns-resize',
        onMouseDown: (e) => {
          const startY = e.clientY;
          const startHeight = queueDrawerHeight;

          const handleMouseMove = (moveEvent) => {
            const deltaY = startY - moveEvent.clientY;
            const newHeight = Math.max(200, Math.min(600, startHeight + deltaY));
            setQueueDrawerHeight(newHeight);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }
      },
        React.createElement('div', {
          className: 'flex items-center gap-3'
        },
          React.createElement('div', {
            className: 'w-8 h-1 bg-gray-600 rounded-full'
          }),
          React.createElement('span', {
            className: 'text-sm font-medium text-gray-200'
          }, 'Queue'),
          React.createElement('span', {
            className: 'text-xs text-gray-400'
          }, `${currentQueue.length} track${currentQueue.length !== 1 ? 's' : ''}`)
        ),
        React.createElement('div', {
          className: 'flex items-center gap-2'
        },
          currentQueue.length > 0 && React.createElement('button', {
            onClick: clearQueue,
            className: 'text-xs text-gray-400 hover:text-white px-2 py-1 hover:bg-white/10 rounded transition-colors'
          }, 'Clear'),
          React.createElement('button', {
            onClick: () => setQueueDrawerOpen(false),
            className: 'p-1 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-white'
          }, React.createElement(X))
        )
      ),

      // Queue content - dark theme
      React.createElement('div', {
        ref: queueContentRef,
        className: 'overflow-y-auto relative',
        style: { height: (queueDrawerHeight - 44) + 'px' },
        onDragEnter: (e) => handleDragEnter(e, 'queue'),
        onDragOver: (e) => handleDragOver(e, 'queue'),
        onDragLeave: handleDragLeave,
        onDrop: (e) => handleDrop(e, 'queue')
      },
        // Drop zone overlay
        React.createElement(DropZoneOverlay, {
          zone: 'queue',
          isActive: isDraggingUrl && dropZoneTarget === 'queue'
        }),
        currentQueue.length === 0 ?
          React.createElement('div', {
            className: 'flex flex-col items-center justify-center h-full text-gray-500'
          },
            React.createElement('span', { className: 'text-4xl mb-2' }, '🎵'),
            React.createElement('span', { className: 'text-gray-400' }, 'Queue is empty'),
            React.createElement('span', { className: 'text-sm text-gray-500 mt-1' }, 'Play a playlist to add tracks')
          )
        :
          // flex-col-reverse so first track (next up) appears at bottom, closest to playbar
          React.createElement('div', { className: 'flex flex-col-reverse justify-end h-full' },
            currentQueue.map((track, index) => {
              const isCurrentTrack = currentTrack?.id === track.id;
              const isLoading = track.status === 'loading';
              const isError = track.status === 'error';
              // Sort by priority order (left to right = highest to lowest priority)
              const availableSources = Object.keys(track.sources || {}).sort((a, b) => {
                const aIndex = resolverOrder.indexOf(a);
                const bIndex = resolverOrder.indexOf(b);
                return aIndex - bIndex;
              });

              const isDraggedOver = queueDropTarget === index;
              const isDragging = draggedQueueTrack === index;
              const isDropping = droppingTrackId === track.id;

              return React.createElement('div', {
                key: track.id,
                draggable: !isLoading && !isError,
                onDragStart: (e) => {
                  if (!isLoading && !isError) {
                    setDraggedQueueTrack(index);
                    setDraggingTrackForPlaylist(track); // Track for potential playlist drop
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track }));
                  }
                },
                onDragEnd: () => {
                  setDraggedQueueTrack(null);
                  setQueueDropTarget(null);
                  setDraggingTrackForPlaylist(null);
                  setDropTargetPlaylistId(null);
                  setDropTargetNewPlaylist(false);
                  // Close panel if it was opened by drag and nothing was dropped
                  if (addToPlaylistPanel.open && selectedPlaylistsForAdd.length === 0) {
                    setAddToPlaylistPanel(prev => ({ ...prev, open: false }));
                  }
                },
                onDragOver: (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (draggedQueueTrack !== null && draggedQueueTrack !== index) {
                    setQueueDropTarget(index);
                  }
                },
                onDragLeave: () => {
                  setQueueDropTarget(null);
                },
                onDrop: (e) => {
                  e.preventDefault();
                  if (draggedQueueTrack !== null && draggedQueueTrack !== index) {
                    moveInQueue(draggedQueueTrack, index);
                  }
                  setDraggedQueueTrack(null);
                  setQueueDropTarget(null);
                },
                onContextMenu: (e) => {
                  e.preventDefault();
                  if (!isLoading && !isError && window.electron?.contextMenu?.showTrackMenu) {
                    window.electron.contextMenu.showTrackMenu({
                      type: 'track',
                      track: track
                    });
                  }
                },
                className: `group flex items-center gap-3 py-2 px-3 border-b border-gray-600/30 hover:bg-white/10 transition-all duration-300 ${
                  isCurrentTrack ? 'bg-purple-900/40' : ''
                } ${isDragging ? 'opacity-50 bg-gray-700/50' : ''} ${
                  isError ? 'opacity-50' : ''
                } ${isDraggedOver ? 'border-t-2 border-t-purple-400' : ''} ${
                  isLoading || isError ? '' : 'cursor-grab active:cursor-grabbing'} ${
                  isDropping ? 'queue-track-drop' : ''}`
              },
                // Track number / status indicator - fixed width
                React.createElement('span', {
                  className: 'text-sm text-gray-500 text-right',
                  style: { width: '28px', flexShrink: 0 }
                },
                  isLoading ? React.createElement('span', { className: 'animate-spin inline-block' }, '◌') :
                  isError ? '⚠' :
                  isCurrentTrack ? '▶' : String(index + 1).padStart(2, '0')
                ),

                // Track title - flexible column that grows
                React.createElement('span', {
                  className: `text-sm truncate cursor-pointer ${
                    isLoading ? 'text-gray-500' :
                    isError ? 'text-red-400' :
                    isCurrentTrack ? 'text-purple-400' : 'text-gray-200 group-hover:text-white'
                  }`,
                  style: { flex: '1 1 0', minWidth: 0 },
                  onClick: () => {
                    if (isLoading || isError) return;
                    // Trigger drop animation for this track
                    setDroppingTrackId(track.id);
                    // After animation, play the track
                    setTimeout(() => {
                      setCurrentQueue(prev => prev.slice(index + 1));
                      handlePlay(track);
                      setDroppingTrackId(null);
                    }, 300);
                  }
                },
                  isLoading ? 'Loading...' :
                  isError ? 'Could not load track' :
                  track.title
                ),

                // Artist name - flexible column, clickable
                React.createElement('span', {
                  className: 'text-sm text-gray-400 truncate hover:text-purple-400 hover:underline cursor-pointer transition-colors',
                  style: { flex: '0.7 1 0', minWidth: 0 },
                  onClick: (e) => {
                    e.stopPropagation();
                    if (!isLoading && !isError && track.artist) {
                      fetchArtistData(track.artist);
                    }
                  }
                },
                  isLoading ? `from ${track.sourceDomain || 'unknown'}` :
                  isError ? (track.errorMessage || 'Unknown error') :
                  track.artist
                ),

                // Duration - fixed width column (before resolver icons)
                React.createElement('span', {
                  className: 'text-sm text-gray-500 text-right tabular-nums',
                  style: { width: '50px', flexShrink: 0 }
                }, !isLoading && !isError ? formatTime(track.duration || 0) : ''),

                // Resolver icons - fixed width column (last before remove button)
                React.createElement('div', {
                  className: 'flex items-center gap-1 justify-end',
                  style: { width: '100px', flexShrink: 0, minHeight: '24px' }
                },
                  isError ?
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        if (track.sourceUrl) {
                          removeFromQueue(track.id);
                          handleUrlDrop(track.sourceUrl, 'queue');
                        }
                      },
                      className: 'px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors',
                      title: 'Retry'
                    }, '↻')
                  : isLoading ?
                    React.createElement('div', {
                      className: 'flex items-center gap-1'
                    },
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 bg-[length:200%_100%] animate-shimmer'
                      }),
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 bg-[length:200%_100%] animate-shimmer',
                        style: { animationDelay: '0.1s' }
                      })
                    )
                  : availableSources.length > 0 ?
                    availableSources.map(resolverId => {
                      const resolver = allResolvers.find(r => r.id === resolverId);
                      if (!resolver) return null;
                      const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM', localfiles: 'LO' };
                      const abbrev = abbrevMap[resolverId] || resolver.name.slice(0, 2).toUpperCase();
                      const source = track.sources?.[resolverId];
                      const confidence = source?.confidence || 0;
                      return React.createElement('button', {
                        key: resolverId,
                        onClick: (e) => {
                          e.stopPropagation();
                          handlePlay({ ...track, preferredResolver: resolverId });
                        },
                        className: 'no-drag',
                        style: {
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          backgroundColor: resolver.color,
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          color: 'white',
                          opacity: confidence > 0.8 ? 1 : 0.6,
                          transition: 'transform 0.1s'
                        },
                        onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                        onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                        title: `Play via ${resolver.name}${confidence ? ` (${Math.round(confidence * 100)}% match)` : ''}`
                      }, abbrev);
                    })
                  :
                    // Show shimmer skeletons while resolving (match resolver icon size)
                    React.createElement('div', {
                      className: 'flex items-center gap-1'
                    },
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 bg-[length:200%_100%] animate-shimmer',
                        title: 'Resolving track...'
                      }),
                      React.createElement('div', {
                        className: 'w-5 h-5 rounded bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 bg-[length:200%_100%] animate-shimmer',
                        style: { animationDelay: '0.1s' }
                      })
                    )
                ),

                // Remove button
                React.createElement('button', {
                  onClick: (e) => {
                    e.stopPropagation();
                    removeFromQueue(track.id);
                  },
                  className: 'flex-shrink-0 p-1 text-gray-500 hover:text-red-400 hover:bg-white/10 rounded transition-colors opacity-0 group-hover:opacity-100',
                  title: isLoading ? 'Cancel' : 'Remove from queue'
                }, React.createElement(X, { size: 14 }))
              );
            })
          )
      )
    )
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(Parachord));