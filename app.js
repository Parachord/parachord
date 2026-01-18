// Parachord Desktop App - Electron Version
const { useState, useEffect, useRef } = React;

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
const TrackRow = React.memo(({ track, isPlaying, handlePlay, onArtistClick, allResolvers, resolverOrder, activeResolvers }) => {
  // Get available sources (track.sources is an object with resolver IDs as keys)
  const availableSources = track.sources && typeof track.sources === 'object' && !Array.isArray(track.sources)
    ? Object.keys(track.sources)
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
    className: 'group flex items-center gap-4 p-3 rounded-lg hover:bg-white/10 transition-colors no-drag'
  },
    // Album art or play button
    React.createElement('div', { className: 'relative w-12 h-12 flex-shrink-0' },
      track.albumArt ?
        React.createElement('img', {
          src: track.albumArt,
          alt: track.album,
          className: 'w-12 h-12 rounded object-cover'
        })
      :
        React.createElement('div', {
          className: 'w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded flex items-center justify-center'
        }, React.createElement(Music)),
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
      React.createElement('div', { className: `font-medium truncate ${isPlaying ? 'text-purple-400' : ''}` }, track.title),
      React.createElement('div', { className: 'flex items-center gap-2' },
        React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            if (onArtistClick) {
              onArtistClick(track.artist);
            }
          },
          className: 'text-sm text-gray-400 truncate hover:text-purple-400 hover:underline cursor-pointer transition-colors',
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
      primaryResolver && React.createElement('div', { className: 'text-xs text-slate-400 mt-0.5' }, `via ${primaryResolver.name}`)
    ),
    React.createElement('div', { className: 'text-sm text-gray-400 truncate max-w-[200px]' }, track.album),
    React.createElement('div', { className: 'text-sm text-gray-400 w-12 text-right' },
      `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}`
    )
  );
});

// ReleaseCard component - FRESH START - Ultra simple, no complications
const ReleaseCard = ({ release, currentArtist, fetchReleaseData, isVisible = true }) => {
  const year = release.date ? release.date.split('-')[0] : 'Unknown';
  
  const cardStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    cursor: 'pointer',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    transition: 'transform 0.2s, background-color 0.2s'
  };
  
  const handleClick = () => {
    console.log('🎵 Card clicked:', release.title);
    fetchReleaseData(release, currentArtist);
  };
  
  return React.createElement('button', {
    className: 'no-drag',
    style: {
      ...cardStyle,
      width: '100%',
      textAlign: 'left',
      display: isVisible ? 'block' : 'none'  // Hide with CSS instead of destroying DOM
    },
    onClick: handleClick,
    onMouseEnter: (e) => {
      e.currentTarget.style.transform = 'scale(1.05)';
      e.currentTarget.style.backgroundColor = 'rgba(124, 58, 237, 0.2)';
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
        background: release.albumArt ? 'none' : 'linear-gradient(135deg, #9333ea 0%, #ec4899 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '12px',
        pointerEvents: 'none',
        overflow: 'hidden',
        position: 'relative'
      }
    },
      // Album art image (if loaded)
      release.albumArt && React.createElement('img', {
        src: release.albumArt,
        alt: release.title,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none'
        }
      }),
      
      // Music icon placeholder (only when no album art)
      !release.albumArt && React.createElement('svg', {
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
        color: 'white',
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
const ReleasePage = ({ release, handleSearch, handlePlay, trackSources = {}, resolvers = [] }) => {
  const formatDuration = (ms) => {
    if (!ms) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return React.createElement('div', { className: 'space-y-6' },
    // Release info and album art
    React.createElement('div', { className: 'flex gap-6' },
      // Album art
      release.albumArt ?
        React.createElement('img', {
          src: release.albumArt,
          alt: release.title,
          className: 'w-64 h-64 rounded-lg object-cover'
        })
      :
        React.createElement('div', {
          className: 'w-64 h-64 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center'
        },
          React.createElement('svg', {
            className: 'w-24 h-24 text-white/50',
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
      
      // Metadata
      React.createElement('div', { className: 'flex-1' },
        React.createElement('div', { className: 'space-y-2 text-sm' },
          release.releaseType && React.createElement('div', {},
            React.createElement('span', { className: 'text-gray-400' }, 'Type: '),
            React.createElement('span', {
              className: `inline-block px-2 py-0.5 rounded-full text-xs ${
                release.releaseType === 'album' ? 'bg-blue-600/20 text-blue-400' :
                release.releaseType === 'ep' ? 'bg-green-600/20 text-green-400' :
                'bg-purple-600/20 text-purple-400'
              }`
            }, release.releaseType.toUpperCase())
          ),
          release.date && React.createElement('div', {},
            React.createElement('span', { className: 'text-gray-400' }, 'Released: '),
            React.createElement('span', {}, release.date)
          ),
          release.label && React.createElement('div', {},
            React.createElement('span', { className: 'text-gray-400' }, 'Label: '),
            React.createElement('span', {}, release.label)
          ),
          release.country && React.createElement('div', {},
            React.createElement('span', { className: 'text-gray-400' }, 'Country: '),
            React.createElement('span', {}, release.country)
          ),
          release.tracks.length > 0 && React.createElement('div', {},
            React.createElement('span', { className: 'text-gray-400' }, 'Tracks: '),
            React.createElement('span', {}, release.tracks.length)
          )
        )
      )
    ),
    
    // Tracklist
    React.createElement('div', { className: 'mt-8' },
      React.createElement('h2', { className: 'text-2xl font-bold mb-4' }, 'Tracklist'),
      release.tracks.length > 0 ?
        React.createElement('div', { className: 'space-y-1' },
          release.tracks.map((track, index) => {
            const trackKey = `${track.position}-${track.title}`;
            const sources = trackSources[trackKey] || {};
            const availableResolvers = Object.keys(sources);
            
            return React.createElement('div', {
              key: index,
              className: 'flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors no-drag group',
              onClick: () => {
                console.log('Track row clicked:', track.title);

                // Create a track object with sources for handlePlay to select the best one
                if (availableResolvers.length > 0) {
                  const trackWithSources = {
                    ...track,
                    artist: release.artist.name,
                    album: release.title,
                    sources: sources
                  };
                  handlePlay(trackWithSources);
                } else {
                  // No resolved sources yet, fall back to search
                  console.log('No resolved sources, searching...');
                  handleSearch(`${release.artist.name} ${track.title}`);
                }
              }
            },
              // Track number
              React.createElement('span', {
                className: 'text-gray-400 text-sm w-8 flex-shrink-0',
                style: { pointerEvents: 'none' }
              }, track.position),
              
              // Track title
              React.createElement('span', {
                className: 'flex-1 group-hover:text-purple-400 transition-colors',
                style: { pointerEvents: 'none' }
              }, track.title),
              
              // Duration
              track.length && React.createElement('span', {
                className: 'text-gray-400 text-sm flex-shrink-0',
                style: { pointerEvents: 'none' }
              }, formatDuration(track.length)),
              
              // Resolver icons (sources available for this track)
              React.createElement('div', {
                className: 'flex items-center gap-1 flex-shrink-0',
                style: { pointerEvents: 'none' }
              },
                (() => {
                  const trackKey = `${track.position}-${track.title}`;
                  const sources = trackSources[trackKey] || {};
                  const availableResolvers = Object.keys(sources);
                  
                  if (availableResolvers.length === 0) {
                    // Show loading indicator while resolving
                    return React.createElement('span', {
                      className: 'text-xs text-gray-500',
                      title: 'Searching for sources...'
                    }, '🔍');
                  }
                  
                  // Show resolver icons for available sources
                  return availableResolvers.map(resolverId => {
                    const resolver = resolvers.find(r => r.id === resolverId);
                    if (!resolver) return null;
                    
                    const source = sources[resolverId];
                    const confidence = source.confidence || 0;
                    
                    return React.createElement('button', {
                      key: resolverId,
                      className: 'no-drag',
                      onClick: (e) => {
                        e.stopPropagation(); // Don't trigger row click
                        console.log(`Playing from ${resolver.name}:`, source);
                        
                        // Call handlePlay with the resolved source
                        // The source already has the right structure from the resolver
                        handlePlay(source);
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
                    }, resolver.name.slice(0, 2).toUpperCase());
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
  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
  const searchTimeoutRef = useRef(null);
  // Pagination state - how many items to show per column
  const [displayLimits, setDisplayLimits] = useState({
    artists: 5,
    albums: 5,
    tracks: 8,
    playlists: 5
  });
  const [activeView, setActiveView] = useState('library');
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [currentArtist, setCurrentArtist] = useState(null); // Artist page data
  const [artistReleases, setArtistReleases] = useState([]); // Discography
  const [releaseTypeFilter, setReleaseTypeFilter] = useState('all'); // all, album, ep, single
  const [loadingArtist, setLoadingArtist] = useState(false);
  const [currentRelease, setCurrentRelease] = useState(null); // Release/Album page data
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [trackSources, setTrackSources] = useState({}); // Resolved sources for each track: { trackId: { youtube: {...}, soundcloud: {...} } }
  const [activeResolvers, setActiveResolvers] = useState(['spotify', 'bandcamp', 'qobuz']);
  const [resolverOrder, setResolverOrder] = useState(['spotify', 'bandcamp', 'qobuz', 'youtube', 'soundcloud']);
  const [draggedResolver, setDraggedResolver] = useState(null);
  const [library, setLibrary] = useState([]);
  const [audioContext, setAudioContext] = useState(null);
  const [currentSource, setCurrentSource] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isExternalPlayback, setIsExternalPlayback] = useState(false);
  const [showExternalPrompt, setShowExternalPrompt] = useState(false);
  const [pendingExternalTrack, setPendingExternalTrack] = useState(null);
  const externalTrackTimeoutRef = useRef(null);
  const playbackPollerRef = useRef(null);
  const [settingsTab, setSettingsTab] = useState('installed'); // 'installed' | 'marketplace'
  const [marketplaceManifest, setMarketplaceManifest] = useState(null);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceSearchQuery, setMarketplaceSearchQuery] = useState('');
  const [marketplaceCategory, setMarketplaceCategory] = useState('all');
  const [installingResolvers, setInstallingResolvers] = useState(new Set());
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerUrl, setDrawerUrl] = useState(null);
  const [drawerHeight, setDrawerHeight] = useState(400); // Default height in pixels
  const [qobuzToken, setQobuzToken] = useState(null);
  const [qobuzConnected, setQobuzConnected] = useState(false);

  // Resolver plugin system
  const resolverLoader = useRef(null);
  const [loadedResolvers, setLoadedResolvers] = useState([]);
  const loadedResolversRef = useRef([]);

  // Cleanup polling interval and external track timeout on unmount
  useEffect(() => {
    return () => {
      if (playbackPollerRef.current) {
        clearInterval(playbackPollerRef.current);
        playbackPollerRef.current = null;
      }
      if (externalTrackTimeoutRef.current) {
        clearTimeout(externalTrackTimeoutRef.current);
        externalTrackTimeoutRef.current = null;
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

  // Cache for album art URLs (releaseId -> imageUrl)
  const albumArtCache = useRef({});

  // Cache for artist data (artistName -> { data, timestamp })
  const artistDataCache = useRef({});

  // Cache for track sources (trackKey -> { sources, timestamp })
  // trackKey format: "artist|title|album"
  const trackSourcesCache = useRef({});

  // Cache TTLs (in milliseconds)
  const CACHE_TTL = {
    albumArt: 90 * 24 * 60 * 60 * 1000,    // 90 days
    artistData: 30 * 24 * 60 * 60 * 1000,  // 30 days
    trackSources: 7 * 24 * 60 * 60 * 1000  // 7 days (track availability changes)
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

  // Initialize resolver plugin system
  useEffect(() => {
    const initResolvers = async () => {
      console.log('🔌 Initializing resolver plugin system...');
      
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
        console.log(`✅ Loaded ${resolvers.length} resolver plugins:`, resolvers.map(r => r.name).join(', '));
      } catch (error) {
        console.error('❌ Failed to load resolvers:', error);
        console.log('💾 Attempting to use fallback resolvers...');
        
        try {
          const resolvers = await resolverLoader.current.loadResolvers(FALLBACK_RESOLVERS);
          setLoadedResolvers(resolvers);
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

  // Get resolvers in priority order
  const resolvers = resolverOrder
    .map(id => allResolvers.find(r => r.id === id))
    .filter(Boolean);

  // Helper function to get resolver config
  const getResolverConfig = (resolverId) => {
    const configs = {
      spotify: { token: spotifyToken },
      qobuz: { appId: '285473059', volume: volume / 100 },
      bandcamp: {}
    };
    const config = configs[resolverId] || {};
    
    // Debug: Log Spotify token status
    if (resolverId === 'spotify') {
      console.log('🔑 Spotify token status:', {
        hasToken: !!spotifyToken,
        tokenLength: spotifyToken?.length,
        tokenPreview: spotifyToken ? spotifyToken.substring(0, 20) + '...' : 'null'
      });
    }
    
    return config;
  };

  const SPOTIFY_CLIENT_ID = 'c040c0ee133344b282e6342198bcbeea';

  useEffect(() => {
    setLibrary(sampleTracks);
    const context = new (window.AudioContext || window.webkitAudioContext)();
    setAudioContext(context);
    
    // Load playlists from files
    const loadPlaylistsFromFiles = async () => {
      try {
        const loadedPlaylists = await window.electron.playlists.load();
        console.log(`📋 Loaded ${loadedPlaylists.length} playlist(s) from files`);
        
        if (loadedPlaylists.length > 0) {
          // Parse each playlist to get title and creator
          const parsedPlaylists = loadedPlaylists.map(playlist => {
            const parsed = parseXSPF(playlist.xspf);
            return {
              ...playlist,
              title: parsed?.title || playlist.id,
              creator: parsed?.creator || 'Unknown'
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
    
    return () => context.close();
  }, []);

  useEffect(() => {
    if (isPlaying && audioContext && currentTrack) {
      const interval = setInterval(() => {
        const elapsed = (audioContext.currentTime - startTime);
        if (elapsed >= currentTrack.duration) {
          handleNext();
        } else {
          setProgress(elapsed);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isPlaying, audioContext, currentTrack, startTime]);

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
              const config = getResolverConfig(resolverId);
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
    // Skip on initial mount
    if (activeResolvers.length === 0 && resolverOrder.length === 0) return;

    // Debounce the save to avoid saving too frequently
    const timeoutId = setTimeout(() => {
      saveCacheToStore();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [activeResolvers, resolverOrder]);

  // Keyboard shortcuts - Escape closes search drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && searchDrawerOpen) {
        setSearchDrawerOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchDrawerOpen]);

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
            const config = getResolverConfig(resolver.id);
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
          alert('Could not find a playable source for this track. Try enabling more resolvers in settings.');
          return;
        }
      }

      // Sort sources by: 1) resolver priority (lower index = higher priority), 2) confidence
      const sortedSources = availableResolvers.map(resId => ({
        resolverId: resId,
        source: trackOrSource.sources[resId],
        priority: resolverOrder.indexOf(resId),
        confidence: trackOrSource.sources[resId].confidence || 0
      }))
      .filter(s => activeResolvers.includes(s.resolverId)) // Only enabled resolvers
      .sort((a, b) => {
        // First sort by priority (lower index = higher priority)
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

    // Check if resolver can stream
    if (!resolver.capabilities.stream) {
      // For non-streaming resolvers (Bandcamp, YouTube), show prompt first
      console.log('🌐 External browser track detected, showing prompt...');
      // CRITICAL: Update currentTrack BEFORE showing prompt so handleNext() can find it in queue
      // Merge source with original track to preserve queue ID
      const trackToSet = trackOrSource.sources ? { ...trackOrSource, ...sourceToPlay } : sourceToPlay;
      setCurrentTrack(trackToSet);
      showExternalTrackPromptUI(trackToSet);
      return; // Don't play yet, wait for user confirmation
    }

    // Use resolver's play method
    try {
      const config = getResolverConfig(resolverId);
      console.log(`▶️ Using ${resolver.name} to play track...`);

      const success = await resolver.play(sourceToPlay, config);

      if (success) {
        console.log(`✅ Playing on ${resolver.name}`);
        // Merge source with original track to preserve queue ID
        const trackToSet = trackOrSource.sources ? { ...trackOrSource, ...sourceToPlay } : sourceToPlay;
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

        // Playback failed - cached source may be invalid
        // Try to re-resolve and find alternative sources
        if (sourceToPlay.artist && sourceToPlay.title) {
          console.log('🔄 Attempting to re-resolve track with fresh sources...');
          const artistName = sourceToPlay.artist;
          const trackData = { position: sourceToPlay.position || 1, title: sourceToPlay.title, length: sourceToPlay.duration };

          // Force refresh to bypass cache
          await resolveTrack(trackData, artistName, true);

          alert(`Playback failed. Track has been re-resolved. Please try playing again.`);
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

    if (resolverId === 'spotify' && config.token) {
      console.log('🔄 Starting Spotify playback polling for auto-advance (5s interval)...');

      let errorCount = 0; // Track consecutive polling errors

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

          // Check if we're still playing the same track
          if (data.item && data.item.uri === track.spotifyUri) {
            const progressMs = data.progress_ms;
            const durationMs = data.item.duration_ms;

            // If within 1 second of end, trigger next
            if (progressMs >= durationMs - 1000) {
              console.log('🎵 Track ending, auto-advancing to next...');
              clearInterval(pollInterval);
              playbackPollerRef.current = null;
              handleNext();
            }
          } else if (!data.item || !data.is_playing) {
            // Playback stopped or track changed externally
            clearInterval(pollInterval);
            playbackPollerRef.current = null;
          }
        } catch (error) {
          console.error('Spotify polling error:', error);

          // Track consecutive errors
          errorCount = (errorCount || 0) + 1;

          if (errorCount >= 3) {
            // After 3 consecutive errors, stop polling
            console.error('❌ Too many Spotify polling errors, stopping auto-advance');
            clearInterval(pollInterval);
            playbackPollerRef.current = null;
          }
        }
      }, 5000); // Poll every 5 seconds (consistent with existing playback polling)

      playbackPollerRef.current = pollInterval;
    }
    // For future HTML5 audio resolvers, add event listener logic here
  };

  // Show prompt for external browser track
  const showExternalTrackPromptUI = (track) => {
    console.log('🌐 Showing external track prompt for:', track.title);
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

    // Open in external browser FIRST
    try {
      const config = getResolverConfig(resolverId);
      await resolver.play(track, config);
      console.log(`🌐 Opened ${track.title} in browser via ${resolver.name}`);

      // Only update state AFTER successful browser open
      setShowExternalPrompt(false);
      setPendingExternalTrack(null);
      setIsExternalPlayback(true);
      setCurrentTrack(track);
    } catch (error) {
      console.error('❌ Failed to open external track:', error);
      alert(`Failed to open browser: ${error.message}`);
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

    // Find next track BEFORE removing current from queue
    if (currentQueue.length === 0) {
      console.log('Queue is empty, cannot skip');
      return;
    }

    const currentIndex = currentQueue.findIndex(t => t.id === currentTrack?.id);
    console.log(`🔍 Skip: currentIndex=${currentIndex}, queueLength=${currentQueue.length}`);
    console.log(`🔍 currentTrack.id="${currentTrack?.id}", title="${currentTrack?.title}"`);
    console.log(`🔍 Queue track IDs:`, currentQueue.map(t => `"${t.id}"`));
    console.log(`🔍 Queue track titles:`, currentQueue.map(t => t.title));

    let nextTrack;
    if (currentIndex === -1) {
      // Track not found, play first
      nextTrack = currentQueue[0];
    } else if (currentIndex === currentQueue.length - 1) {
      // Last track, loop to first
      nextTrack = currentQueue[0];
    } else {
      // Play next track
      nextTrack = currentQueue[currentIndex + 1];
    }

    // Remove current track from queue
    const newQueue = currentQueue.filter(t => t.id !== currentTrack?.id);
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

    // Find next track BEFORE removing current from queue
    if (currentQueue.length === 0) {
      console.log('Queue is empty, nothing to play');
      return;
    }

    const currentIndex = currentQueue.findIndex(t => t.id === currentTrack?.id);
    console.log(`🔍 Done: currentIndex=${currentIndex}, queueLength=${currentQueue.length}`);
    console.log(`🔍 currentTrack.id="${currentTrack?.id}", title="${currentTrack?.title}"`);
    console.log(`🔍 Queue track IDs:`, currentQueue.map(t => `"${t.id}"`));
    console.log(`🔍 Queue track titles:`, currentQueue.map(t => t.title));

    let nextTrack;
    if (currentIndex === -1) {
      // Track not found, play first
      nextTrack = currentQueue[0];
    } else if (currentIndex === currentQueue.length - 1) {
      // Last track, loop to first
      nextTrack = currentQueue[0];
    } else {
      // Play next track
      nextTrack = currentQueue[currentIndex + 1];
    }

    // Remove current track from queue
    const newQueue = currentQueue.filter(t => t.id !== currentTrack?.id);
    setCurrentQueue(newQueue);
    console.log(`📋 Removed track. New queue length: ${newQueue.length}`);

    // Play the next track directly
    if (nextTrack) {
      handlePlay(nextTrack);
    }
  };

  const handlePlayPause = async () => {
    if (!currentTrack) return;
    
    const isSpotifyTrack = currentTrack.sources?.includes('spotify') || currentTrack.spotifyUri;
    
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
    // Clean up any active polling or timeouts
    if (playbackPollerRef.current) {
      clearInterval(playbackPollerRef.current);
      playbackPollerRef.current = null;
    }
    if (externalTrackTimeoutRef.current) {
      clearTimeout(externalTrackTimeoutRef.current);
      externalTrackTimeoutRef.current = null;
    }
    setIsExternalPlayback(false);
    setShowExternalPrompt(false);
    setPendingExternalTrack(null);

    const isSpotifyTrack = currentTrack?.sources?.includes('spotify') || currentTrack?.spotifyUri;
    
    if (isSpotifyTrack && spotifyToken) {
      // Use Spotify's next track
      try {
        const response = await fetch('https://api.spotify.com/v1/me/player/next', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${spotifyToken}`
          }
        });
        
        if (response.ok || response.status === 204) {
          console.log('Skipped to next Spotify track');
          // Poll after 1 second to get updated track info
          // (longer delay to ensure Spotify has switched tracks)
          setTimeout(() => getCurrentPlaybackState(), 1000);
        }
      } catch (error) {
        console.error('Spotify next error:', error);
      }
    } else {
      // Local track - find next in current queue
      if (currentQueue.length === 0) {
        console.log('No queue set, cannot go to next track');
        return;
      }
      
      const currentIndex = currentQueue.findIndex(t => t.id === currentTrack?.id);
      console.log(`🔍 Queue navigation: currentTrack.id="${currentTrack?.id}", currentIndex=${currentIndex}, queueLength=${currentQueue.length}`);

      if (currentIndex === -1) {
        // Current track not in queue, play first track
        console.log('⚠️ Current track not found in queue, playing first track');
        handlePlay(currentQueue[0]);
      } else {
        // Play next track, loop to beginning if at end
        const nextIndex = (currentIndex + 1) % currentQueue.length;
        console.log(`➡️ Moving from index ${currentIndex} to ${nextIndex}`);
        const nextTrack = currentQueue[nextIndex];
        handlePlay(nextTrack);
      }
    }
  };

  const handlePrevious = async () => {
    // Clean up any active polling or timeouts
    if (playbackPollerRef.current) {
      clearInterval(playbackPollerRef.current);
      playbackPollerRef.current = null;
    }
    if (externalTrackTimeoutRef.current) {
      clearTimeout(externalTrackTimeoutRef.current);
      externalTrackTimeoutRef.current = null;
    }
    setIsExternalPlayback(false);
    setShowExternalPrompt(false);
    setPendingExternalTrack(null);

    if (!currentTrack) return;

    const isSpotifyTrack = currentTrack.sources?.includes('spotify') || currentTrack.spotifyUri;
    
    if (isSpotifyTrack && spotifyToken) {
      // Use Spotify's previous track
      try {
        const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${spotifyToken}`
          }
        });
        
        if (response.ok || response.status === 204) {
          console.log('Skipped to previous Spotify track');
          // Poll after 1 second to get updated track info
          // (longer delay to ensure Spotify has switched tracks)
          setTimeout(() => getCurrentPlaybackState(), 1000);
        }
      } catch (error) {
        console.error('Spotify previous error:', error);
      }
    } else {
      // Local track - find previous in current queue
      if (currentQueue.length === 0) {
        console.log('No queue set, cannot go to previous track');
        return;
      }
      
      const currentIndex = currentQueue.findIndex(t => t.id === currentTrack?.id);
      if (currentIndex === -1) {
        // Current track not in queue, play last track
        handlePlay(currentQueue[currentQueue.length - 1]);
      } else {
        // Play previous track, loop to end if at beginning
        const prevTrack = currentQueue[(currentIndex - 1 + currentQueue.length) % currentQueue.length];
        handlePlay(prevTrack);
      }
    }
  };

  const handleSearchInput = (value) => {
    setSearchQuery(value);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Close drawer if search cleared
    if (!value) {
      setSearchDrawerOpen(false);
      setSearchResults({ artists: [], albums: [], tracks: [], playlists: [] });
      setIsSearching(false);
      // Reset pagination
      setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });
      return;
    }

    // Open drawer immediately and show loading state for responsive feel
    if (value.length >= 2) {
      setSearchDrawerOpen(true);
      setIsSearching(true);
    }

    // Reset pagination on new search
    setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });

    // Debounce search by 400ms to allow completion of multi-word queries
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
      if (!resolver.capabilities.resolve) return;

      try {
        const config = getResolverConfig(resolver.id);
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
      // Load album art cache
      const albumArtData = await window.electron.store.get('cache_album_art');
      if (albumArtData) {
        // Filter out expired entries
        const now = Date.now();
        const validEntries = Object.entries(albumArtData).filter(
          ([_, entry]) => now - entry.timestamp < CACHE_TTL.albumArt
        );
        albumArtCache.current = Object.fromEntries(
          validEntries.map(([key, entry]) => [key, entry.url])
        );
        console.log(`📦 Loaded ${validEntries.length} album art entries from cache`);
      }

      // Load artist data cache
      const artistData = await window.electron.store.get('cache_artist_data');
      if (artistData) {
        // Filter out expired entries
        const now = Date.now();
        const validEntries = Object.entries(artistData).filter(
          ([_, entry]) => now - entry.timestamp < CACHE_TTL.artistData
        );
        artistDataCache.current = Object.fromEntries(validEntries);
        console.log(`📦 Loaded ${validEntries.length} artist data entries from cache`);
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

      // Load resolver settings
      const savedActiveResolvers = await window.electron.store.get('active_resolvers');
      const savedResolverOrder = await window.electron.store.get('resolver_order');

      if (savedActiveResolvers) {
        setActiveResolvers(savedActiveResolvers);
        console.log(`📦 Loaded ${savedActiveResolvers.length} active resolvers from storage`);
      }

      if (savedResolverOrder) {
        setResolverOrder(savedResolverOrder);
        console.log(`📦 Loaded resolver order from storage (${savedResolverOrder.length} resolvers)`);
      }
    } catch (error) {
      console.error('Failed to load cache from store:', error);
    }
  };

  const saveCacheToStore = async () => {
    if (!window.electron?.store) return;

    try {
      // Save album art cache with timestamps
      const albumArtData = Object.fromEntries(
        Object.entries(albumArtCache.current).map(([key, url]) => [
          key,
          { url, timestamp: Date.now() }
        ])
      );
      await window.electron.store.set('cache_album_art', albumArtData);

      // Save artist data cache (already has timestamps)
      await window.electron.store.set('cache_artist_data', artistDataCache.current);

      // Save track sources cache (already has timestamps)
      await window.electron.store.set('cache_track_sources', trackSourcesCache.current);

      // Save resolver settings
      await window.electron.store.set('active_resolvers', activeResolvers);
      await window.electron.store.set('resolver_order', resolverOrder);

      console.log('💾 Cache and resolver settings saved to persistent storage');
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
    setLoadingArtist(true);
    setActiveView('artist'); // Show artist page immediately with loading animation

    // Check cache first
    const cacheKey = artistName.toLowerCase();
    const cachedData = artistDataCache.current[cacheKey];
    const now = Date.now();
    const currentResolverHash = getResolverSettingsHash();

    // Cache is valid if:
    // 1. Data exists
    // 2. Not expired
    // 3. Resolver settings haven't changed
    const cacheValid = cachedData &&
                      (now - cachedData.timestamp) < CACHE_TTL.artistData &&
                      cachedData.resolverHash === currentResolverHash;

    if (cacheValid) {
      console.log('📦 Using cached artist data for:', artistName);
      setCurrentArtist(cachedData.artist);

      // Pre-populate releases with cached album art
      const releasesWithCache = cachedData.releases.map(release => ({
        ...release,
        albumArt: albumArtCache.current[release.id] || null
      }));

      setArtistReleases(releasesWithCache);
      setLoadingArtist(false);

      // Still fetch album art in background for any missing covers
      fetchAlbumArtLazy(cachedData.releases);
      return;
    }

    if (cachedData && cachedData.resolverHash !== currentResolverHash) {
      console.log('🔄 Resolver settings changed, invalidating cache for:', artistName);
    }

    console.log('🌐 Fetching fresh artist data from MusicBrainz...');

    try {
      // Step 1: Search for artist by name to get MBID
      const searchResponse = await fetch(
        `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(artistName)}&fmt=json&limit=1`,
        {
          headers: {
            'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)'
          }
        }
      );
      
      if (!searchResponse.ok) {
        console.error('Artist search failed:', searchResponse.status);
        setLoadingArtist(false);
        return;
      }
      
      const searchData = await searchResponse.json();
      
      if (!searchData.artists || searchData.artists.length === 0) {
        console.log('Artist not found');
        alert(`Artist "${artistName}" not found in MusicBrainz`);
        setLoadingArtist(false);
        return;
      }
      
      const artist = searchData.artists[0];
      console.log('Found artist:', artist.name, 'MBID:', artist.id);
      
      // Step 2: Fetch artist's releases (albums, EPs, singles)
      const releaseTypes = ['album', 'ep', 'single'];
      const allReleases = [];
      
      for (const type of releaseTypes) {
        const releasesResponse = await fetch(
          `https://musicbrainz.org/ws/2/release?artist=${artist.id}&type=${type}&status=official&fmt=json&limit=100`,
          {
            headers: {
              'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)'
            }
          }
        );
        
        if (releasesResponse.ok) {
          const releasesData = await releasesResponse.json();
          if (releasesData.releases) {
            const typedReleases = releasesData.releases.map(release => ({
              ...release,
              releaseType: type
            }));
            allReleases.push(...typedReleases);
          }
        }
        
        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`Found ${allReleases.length} releases for ${artist.name}`);

      // De-duplicate releases (same title + date can appear multiple times)
      const seenReleases = new Map();
      const uniqueReleases = [];

      for (const release of allReleases) {
        const key = `${release.title.toLowerCase()}|${release.date || 'unknown'}`;
        if (!seenReleases.has(key)) {
          seenReleases.set(key, true);
          uniqueReleases.push(release);
        }
      }

      console.log(`After de-duplication: ${uniqueReleases.length} unique releases`);

      // Sort by date (newest first)
      uniqueReleases.sort((a, b) => {
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

      setCurrentArtist(artistData);

      // Cache the artist data with resolver settings hash
      artistDataCache.current[cacheKey] = {
        artist: artistData,
        releases: uniqueReleases,
        timestamp: Date.now(),
        resolverHash: getResolverSettingsHash()
      };
      console.log('💾 Cached artist data for:', artistName);

      // Pre-populate releases with cached album art
      const releasesWithCache = uniqueReleases.map(release => ({
        ...release,
        albumArt: albumArtCache.current[release.id] || null
      }));

      // Show page immediately (with cached album art if available)
      setArtistReleases(releasesWithCache);
      setLoadingArtist(false);

      // Fetch album art in background (lazy loading) - only for releases without cache
      fetchAlbumArtLazy(uniqueReleases);
      
    } catch (error) {
      console.error('Error fetching artist data:', error);
      alert('Failed to load artist data. Please try again.');
      setLoadingArtist(false);
    }
  };

  // Fetch release data (album/EP/single) with full track listing
  const fetchReleaseData = async (release, artist) => {
    setLoadingRelease(true);
    setCurrentRelease(null);

    try {
      console.log('Fetching release data for:', release.title);

      // Try fetching as a direct release ID first (for artist discography)
      let releaseId = release.id;
      let releaseDetailsResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`,
        { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
      );

      // If that fails (404), it might be a release-group ID (from search)
      // Try converting release-group to release ID
      if (!releaseDetailsResponse.ok && releaseDetailsResponse.status === 404) {
        console.log('Not a release ID, trying as release-group...');

        const releaseGroupResponse = await fetch(
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
        releaseDetailsResponse = await fetch(
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
      alert('Failed to load release data. Please try again.');
      setLoadingRelease(false);
    }
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
        mbid: album['artist-credit']?.[0]?.artist?.id || null
      };

      // Fetch release data using the release-group ID
      // This reuses existing fetchReleaseData which handles the release-group -> release conversion
      // Include primary-type if available (Album, EP, Single, etc.)
      await fetchReleaseData({
        id: album.id,
        title: album.title,
        releaseType: album['primary-type']?.toLowerCase() || 'album'
      }, artist);

      // Switch to artist view to show the release
      setActiveView('artist');
    } catch (error) {
      console.error('Error fetching album from search:', error);
      alert('Failed to load album. Please try again.');
    }
  };

  // Handle playlist click from search
  const handlePlaylistClick = (playlist) => {
    setSearchDrawerOpen(false);
    loadPlaylist(playlist.id);
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
      if (!resolver.capabilities.resolve) return;

      try {
        const config = getResolverConfig(resolver.id);
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
  const resolveTrack = async (track, artistName, forceRefresh = false) => {
    const trackKey = `${track.position}-${track.title}`;
    const cacheKey = `${artistName.toLowerCase()}|${track.title.toLowerCase()}|${track.position}`;
    const currentResolverHash = getResolverSettingsHash();

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

    if (cacheValid) {
      const cacheAge = Math.floor((now - cachedData.timestamp) / (1000 * 60 * 60)); // hours
      console.log(`📦 Using cached sources for: ${track.title} (age: ${cacheAge}h)`);

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

    const resolverPromises = enabledResolvers.map(async (resolver) => {
      if (!resolver.capabilities.resolve) return;

      try {
        const config = getResolverConfig(resolver.id);
        const result = await resolver.resolve(artistName, track.title, null, config);

        if (result) {
          sources[resolver.id] = {
            ...result,
            confidence: calculateConfidence(track, result)
          };
          console.log(`  ✅ ${resolver.name}: Found match (confidence: ${(sources[resolver.id].confidence * 100).toFixed(0)}%)`);
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
    const titleMatch = originalTrack.title.toLowerCase() === foundTrack.title.toLowerCase();
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
      await resolveTrack(track, artistName, forceRefresh);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('✅ Track resolution complete');
  };

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
        const artResponse = await fetch(
          `https://coverartarchive.org/release/${release.id}`,
          { 
            headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }
          }
        );
        
        if (artResponse.ok) {
          const artData = await artResponse.json();
          const frontCover = artData.images.find(img => img.front);
          
          if (frontCover && frontCover.thumbnails && frontCover.thumbnails['250']) {
            const albumArtUrl = frontCover.thumbnails['250'];
            
            // Store in cache
            albumArtCache.current[release.id] = albumArtUrl;
            
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
  };

  const toggleResolver = (resolverId) => {
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
    return false;
  };

  const handleResolverDragEnd = () => {
    setDraggedResolver(null);
  };

  // Install new resolver from .axe file (hot-reload, no restart)
  const handleInstallResolver = async () => {
    if (!window.electron?.resolvers?.pickFile) {
      alert('File picker not available. Make sure you are running in Electron.');
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
        alert(`Error reading file: ${result.error}`);
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
        alert(`Failed to install resolver: ${installResult.error}`);
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
          alert(`✅ Successfully updated "${resolverName}"!`);
        } else {
          // Add new resolver
          setLoadedResolvers(prev => [...prev, newResolverInstance]);
          
          // Add to resolver order
          setResolverOrder(prev => [...prev, resolverId]);
          
          // Enable by default
          setActiveResolvers(prev => [...prev, resolverId]);
          
          console.log(`➕ Added resolver: ${resolverName}`);
          alert(`✅ Successfully installed "${resolverName}"!`);
        }
      } catch (error) {
        console.error('Failed to hot-load resolver:', error);
        alert(`Resolver installed but failed to load. Please restart the app.\n\nError: ${error.message}`);
      }
    } catch (error) {
      console.error('Error installing resolver:', error);
      alert(`Error installing resolver: ${error.message}`);
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
      alert(`Resolver "${resolverId}" not found. This might be a bug.`);
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
        alert(`Failed to uninstall: ${result.error}`);
        return;
      }

      console.log(`✅ Uninstalled ${resolver.name}`);

      // Hot-reload: Remove from state without restarting
      setLoadedResolvers(prev => prev.filter(r => r.id !== resolverId));
      setResolverOrder(prev => prev.filter(id => id !== resolverId));
      setActiveResolvers(prev => prev.filter(id => id !== resolverId));

      alert(`✅ Successfully uninstalled "${resolver.name}"!`);
    } catch (error) {
      console.error('Error uninstalling resolver:', error);
      alert(`Error uninstalling resolver: ${error.message}`);
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
        alert(`Failed to download ${name}: ${downloadResult.error}`);
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
        alert(`Failed to install ${resolverName}: ${installResult.error}`);
        return;
      }

      // Hot-reload
            axe._filename = filename;
      const newResolverInstance = await resolverLoader.current.loadResolver(axe);

      if (existing) {
        setLoadedResolvers(prev => prev.map(r =>
          r.id === resolverId ? newResolverInstance : r
        ));
        alert(`✅ Successfully updated "${resolverName}"!`);
      } else {
        setLoadedResolvers(prev => [...prev, newResolverInstance]);
        setResolverOrder(prev => [...prev, resolverId]);
        setActiveResolvers(prev => [...prev, resolverId]);
        alert(`✅ Successfully installed "${resolverName}"!`);
      }
    } catch (error) {
      console.error('Marketplace install error:', error);
      alert(`Installation failed: ${error.message}`);
    } finally {
      setInstallingResolvers(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Load marketplace when settings modal opens to marketplace tab
  useEffect(() => {
    if (showSettings && settingsTab === 'marketplace' && !marketplaceManifest) {
      loadMarketplaceManifest();
    }
  }, [showSettings, settingsTab, marketplaceManifest]);

  // Playlist functions
  const parseXSPF = (xspfString) => {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xspfString, 'text/xml');
      
      const playlist = {
        title: xml.querySelector('playlist > title')?.textContent || 'Untitled Playlist',
        creator: xml.querySelector('playlist > creator')?.textContent || 'Unknown',
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

  const loadPlaylist = async (playlistId) => {
    console.log('🖱️ Playlist clicked, ID:', playlistId);
    
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) {
      console.error('❌ Playlist not found:', playlistId);
      return;
    }
    
    console.log('📋 Found playlist:', playlist.title);
    
    setSelectedPlaylist(playlist);
    setActiveView('playlist-view');
    console.log(`📋 Loading playlist: ${playlist.title}`);
    
    // Parse XSPF if we have the content
    if (playlist.xspf) {
      const parsed = parseXSPF(playlist.xspf);
      if (parsed) {
        console.log(`🎵 Parsed ${parsed.tracks.length} tracks from XSPF`);
        
        // Resolve each track
        setPlaylistTracks([]); // Clear previous tracks
        const resolvedTracks = [];
        
        for (const track of parsed.tracks) {
          console.log(`🔍 Resolving: ${track.artist} - ${track.title}`);

          // Try to resolve the track using active resolvers
          // Generate unique ID from artist + title + album for queue tracking
          const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
          const trackWithSources = { ...track, id: trackId, sources: {} };
          
          for (const resolverId of activeResolvers) {
            const resolver = allResolvers.find(r => r.id === resolverId);
            if (!resolver || !resolver.capabilities.resolve) continue;
            
            try {
              const config = getResolverConfig(resolverId);
              const resolved = await resolver.resolve(track.artist, track.title, track.album, config);
              
              if (resolved) {
                console.log(`  ✅ ${resolver.name}: Found match`);
                trackWithSources.sources[resolverId] = resolved;
              }
            } catch (error) {
              console.error(`  ❌ ${resolver.name} resolve error:`, error);
            }
          }
          
          resolvedTracks.push(trackWithSources);
          setPlaylistTracks([...resolvedTracks]); // Update UI progressively
        }
        
        console.log(`✅ Resolved ${resolvedTracks.length} tracks`);
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
        alert(`Failed to import playlist: ${result.error}`);
        return;
      }
      
      const { content, filename } = result;
      
      // Parse to get playlist info
      const parsed = parseXSPF(content);
      if (!parsed) {
        alert('Failed to parse XSPF file');
        return;
      }
      
      // Generate ID from filename
      const id = filename.replace('.xspf', '');
      
      // Save to playlists folder
      const saveResult = await window.electron.playlists.save(filename, content);
      
      if (!saveResult.success) {
        alert(`Failed to save playlist: ${saveResult.error}`);
        return;
      }
      
      // Add to state
      const newPlaylist = {
        id: id,
        filename: filename,
        title: parsed.title,
        creator: parsed.creator,
        xspf: content
      };
      
      setPlaylists(prev => [...prev, newPlaylist]);
      
      console.log(`✅ Imported playlist: ${parsed.title}`);
      alert(`✅ Imported playlist: ${parsed.title}`);
    } catch (error) {
      console.error('Import error:', error);
      alert(`Error importing playlist: ${error.message}`);
    }
  };

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
        alert(`Failed to export playlist: ${result.error}`);
        return;
      }
      
      console.log(`✅ Exported to: ${result.filepath}`);
      alert(`✅ Playlist exported successfully!`);
    } catch (error) {
      console.error('Export error:', error);
      alert(`Error exporting playlist: ${error.message}`);
    }
  };

  // Add Spotify authentication functions
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
        alert('Spotify authentication failed. Check console for details.');
      }
    } else {
      console.error('window.electron.spotify not available!');
      alert('Electron API not available. Make sure preload.js is loaded correctly.');
    }
  };

  const disconnectSpotify = async () => {
    if (window.electron?.spotify) {
      await window.electron.store.delete('spotify_token');
      await window.electron.store.delete('spotify_refresh_token');
      await window.electron.store.delete('spotify_token_expiry');
      setSpotifyToken(null);
      setSpotifyConnected(false);
      // Remove Spotify from active resolvers
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
      alert('Spotify authentication failed: ' + error);
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
    alert('Spotify not connected');
    return false;
  }
  
  try {
    // Get available devices
    const devices = await getSpotifyDevices();
    console.log('Available Spotify devices:', devices);
    
    if (devices.length === 0) {
      alert('No Spotify devices found. Please open Spotify on your phone, computer, or web player (spotify.com), then try again.');
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
      
      // Don't call getCurrentPlaybackState() here - let polling handle it
      // This prevents flickering when starting playback
      return true;
    } else {
      const error = await response.text();
      console.error('Spotify play failed:', response.status, error);
      
      // Provide specific error messages
      if (response.status === 404) {
        alert(`Spotify device not responding.\n\nTry:\n1. Play any song on Spotify first\n2. Then use Parachord\n\nDevice: ${activeDevice.name}`);
      } else if (response.status === 403) {
        alert('Spotify Premium required for remote playback.');
      } else {
        alert(`Failed to play on Spotify. Error: ${response.status}\n\n${error}`);
      }
      return false;
    }
  } catch (error) {
    console.error('Spotify Connect error:', error);
    alert('Error playing on Spotify: ' + error.message);
    return false;
  }
};

// Get current playback state from Spotify
const getCurrentPlaybackState = async () => {
  if (!spotifyToken) return;
  
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
  
  const currentIsSpotify = currentTrack?.sources?.includes('spotify') || currentTrack?.spotifyUri;
  if (!currentIsSpotify) return;
  
  // Poll every 5 seconds (reduced from 2 to minimize flickering)
  const interval = setInterval(() => {
    getCurrentPlaybackState();
  }, 5000);
  
  return () => clearInterval(interval);
}, [spotifyToken, isPlaying, currentTrack]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return React.createElement('div', {
    className: 'h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white flex flex-col'
  },
    // Header (no drag - causes rendering issues)
    React.createElement('div', {
      className: 'flex items-center justify-between p-4 border-b border-white/10'
    },
      React.createElement('div', { className: 'flex items-center gap-3' },
        React.createElement('div', {
          className: 'w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center text-2xl'
        }, React.createElement(Music))
      ),
      React.createElement('div', { className: 'flex-1 max-w-2xl mx-8' },
        React.createElement('input', {
          type: 'text',
          placeholder: 'Search music...',
          value: searchQuery,
          onChange: (e) => handleSearchInput(e.target.value),
          className: 'w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500'
        })
      ),
      React.createElement('button', {
        onClick: () => setShowSettings(!showSettings),
        className: 'p-2 hover:bg-white/10 rounded-lg transition-colors text-xl'
      }, React.createElement(Settings))
    ),

    // External Track Prompt Modal
    showExternalPrompt && pendingExternalTrack && React.createElement('div', {
      className: 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'
    },
      React.createElement('div', {
        className: 'bg-slate-800 rounded-lg p-8 max-w-md w-full mx-4 border border-slate-700'
      },
        React.createElement('div', { className: 'text-center mb-6' },
          React.createElement('div', { className: 'text-6xl mb-4' }, '🌐'),
          React.createElement('h3', { className: 'text-xl font-semibold text-white mb-2' },
            'Next track requires browser'
          ),
          React.createElement('div', { className: 'text-slate-300 mb-4' },
            React.createElement('div', { className: 'font-medium' }, pendingExternalTrack.title),
            React.createElement('div', { className: 'text-sm text-slate-400' }, pendingExternalTrack.artist),
            React.createElement('div', { className: 'text-xs text-purple-400 mt-2' },
              'via ',
              (allResolvers.find(r =>
                r.id === (pendingExternalTrack.bandcampUrl ? 'bandcamp' :
                         pendingExternalTrack.youtubeUrl || pendingExternalTrack.youtubeId ? 'youtube' : 'unknown')
              )?.name || 'External')
            )
          ),
          React.createElement('div', { className: 'text-xs text-slate-500 mb-6' },
            'Auto-skipping in 15 seconds...'
          )
        ),
        React.createElement('div', { className: 'flex gap-3' },
          React.createElement('button', {
            onClick: () => handleOpenExternalTrack(pendingExternalTrack),
            className: 'flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 px-4 rounded-lg font-medium transition-colors'
          }, 'Open in Browser'),
          React.createElement('button', {
            onClick: handleSkipExternalTrack,
            className: 'flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 px-4 rounded-lg font-medium transition-colors'
          }, 'Skip Track')
        )
      )
    ),

    // Search Drawer - slides down from header (fixed positioning to avoid covering header)
    searchDrawerOpen && React.createElement('div', {
      className: `fixed left-0 right-0 bg-slate-900/95 backdrop-blur-md border-b border-white/20 shadow-2xl transition-all duration-300 ease-in-out overflow-hidden`,
      style: {
        top: '64px', // Below header
        height: '45vh',
        zIndex: 30
      }
    },
      // Scrollable results container
      React.createElement('div', {
        className: 'h-full overflow-y-auto p-6 scrollable-content'
      },
        isSearching ?
          React.createElement('div', { className: 'text-center py-12 text-gray-400' },
            '🔍 Searching...'
          )
        :
        !searchQuery || (
          searchResults.artists.length === 0 &&
          searchResults.albums.length === 0 &&
          searchResults.tracks.length === 0 &&
          searchResults.playlists.length === 0
        ) ?
          React.createElement('div', { className: 'text-center py-12 text-gray-400' },
            searchQuery ? `No results found for "${searchQuery}"` : 'Type to search...'
          )
        :
        // 4-column grid layout with wider tracks column
        React.createElement('div', { className: 'grid gap-4 h-full', style: { gridTemplateColumns: '1fr 1fr 2fr 1fr' } },
          // Artists column
          React.createElement('div', { className: 'flex flex-col overflow-hidden' },
            React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3 flex-shrink-0' },
              `🎤 Artists (${searchResults.artists.length})`
            ),
            React.createElement('div', { className: 'overflow-y-auto space-y-2 flex-1' },
              searchResults.artists.length > 0 ? [
                ...searchResults.artists.slice(0, displayLimits.artists).map(artist =>
                  React.createElement('button', {
                    key: artist.id,
                    onClick: () => {
                      setSearchDrawerOpen(false);
                      fetchArtistData(artist.name);
                    },
                    className: 'w-full text-left p-3 rounded-lg hover:bg-white/10 transition-colors'
                  },
                    React.createElement('div', { className: 'font-medium truncate' }, artist.name),
                    artist.disambiguation && React.createElement('div', { className: 'text-xs text-gray-500 truncate' }, artist.disambiguation)
                  )
                ),
                displayLimits.artists < searchResults.artists.length &&
                  React.createElement('button', {
                    key: 'load-more-artists',
                    onClick: () => handleLoadMore('artists'),
                    className: 'w-full text-center p-3 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 transition-colors text-purple-400 text-sm font-medium'
                  }, `Load more (${searchResults.artists.length - displayLimits.artists} remaining)`)
              ]
              :
                React.createElement('div', { className: 'text-gray-500 text-sm' }, 'No artists found')
            )
          ),

          // Albums column
          React.createElement('div', { className: 'flex flex-col overflow-hidden' },
            React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3 flex-shrink-0' },
              `💿 Albums (${searchResults.albums.length})`
            ),
            React.createElement('div', { className: 'overflow-y-auto space-y-2 flex-1' },
              searchResults.albums.length > 0 ? [
                ...searchResults.albums.slice(0, displayLimits.albums).map(album =>
                  React.createElement('button', {
                    key: album.id,
                    onClick: () => {
                      setSearchDrawerOpen(false);
                      handleAlbumClick(album);
                    },
                    className: 'w-full text-left p-2 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-3'
                  },
                    // Album art thumbnail
                    React.createElement('div', {
                      className: 'w-12 h-12 flex-shrink-0 rounded overflow-hidden bg-white/5'
                    },
                      album.albumArt ?
                        React.createElement('img', {
                          src: album.albumArt,
                          alt: album.title,
                          className: 'w-full h-full object-cover'
                        })
                      :
                        React.createElement('div', {
                          className: 'w-full h-full flex items-center justify-center text-gray-600 text-xl'
                        }, '💿')
                    ),
                    // Album info
                    React.createElement('div', { className: 'flex-1 min-w-0' },
                      React.createElement('div', { className: 'font-medium truncate' }, album.title),
                      React.createElement('div', { className: 'text-xs text-gray-500 truncate' },
                        `${album['artist-credit']?.[0]?.name || 'Unknown'} • ${album['first-release-date']?.split('-')[0] || 'Unknown year'}`
                      )
                    )
                  )
                ),
                displayLimits.albums < searchResults.albums.length &&
                  React.createElement('button', {
                    key: 'load-more-albums',
                    onClick: () => handleLoadMore('albums'),
                    className: 'w-full text-center p-3 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 transition-colors text-purple-400 text-sm font-medium'
                  }, `Load more (${searchResults.albums.length - displayLimits.albums} remaining)`)
              ]
              :
                React.createElement('div', { className: 'text-gray-500 text-sm' }, 'No albums found')
            )
          ),

          // Tracks column
          React.createElement('div', { className: 'flex flex-col overflow-hidden' },
            React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3 flex-shrink-0' },
              `🎵 Tracks (${searchResults.tracks.length})`
            ),
            React.createElement('div', { className: 'overflow-y-auto space-y-1 flex-1' },
              searchResults.tracks.length > 0 ? [
                ...searchResults.tracks.slice(0, displayLimits.tracks).map(track =>
                  React.createElement(TrackRow, {
                    key: track.id,
                    track: track,
                    isPlaying: isPlaying && currentTrack?.id === track.id,
                    handlePlay: handlePlay,
                    onArtistClick: (artistName) => {
                      setSearchDrawerOpen(false);
                      fetchArtistData(artistName);
                    },
                    allResolvers: allResolvers,
                    resolverOrder: resolverOrder,
                    activeResolvers: activeResolvers
                  })
                ),
                displayLimits.tracks < searchResults.tracks.length &&
                  React.createElement('button', {
                    key: 'load-more-tracks',
                    onClick: () => handleLoadMore('tracks'),
                    className: 'w-full text-center p-3 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 transition-colors text-purple-400 text-sm font-medium mt-2'
                  }, `Load more (${searchResults.tracks.length - displayLimits.tracks} remaining)`)
              ]
              :
                React.createElement('div', { className: 'text-gray-500 text-sm' }, 'No tracks found')
            )
          ),

          // Playlists column
          React.createElement('div', { className: 'flex flex-col overflow-hidden' },
            React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3 flex-shrink-0' },
              `📋 Playlists (${searchResults.playlists.length})`
            ),
            React.createElement('div', { className: 'overflow-y-auto space-y-2 flex-1' },
              searchResults.playlists.length > 0 ? [
                ...searchResults.playlists.slice(0, displayLimits.playlists).map(playlist =>
                  React.createElement('button', {
                    key: playlist.title,
                    onClick: () => {
                      setSearchDrawerOpen(false);
                      handlePlaylistClick(playlist);
                    },
                    className: 'w-full text-left p-3 rounded-lg hover:bg-white/10 transition-colors'
                  },
                    React.createElement('div', { className: 'font-medium truncate' }, playlist.title),
                    React.createElement('div', { className: 'text-xs text-gray-500 truncate' },
                      `${playlist.tracks?.length || 0} tracks`
                    )
                  )
                ),
                displayLimits.playlists < searchResults.playlists.length &&
                  React.createElement('button', {
                    key: 'load-more-playlists',
                    onClick: () => handleLoadMore('playlists'),
                    className: 'w-full text-center p-3 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 transition-colors text-purple-400 text-sm font-medium'
                  }, `Load more (${searchResults.playlists.length - displayLimits.playlists} remaining)`)
              ]
              :
                React.createElement('div', { className: 'text-gray-500 text-sm' }, 'No playlists found')
            )
          )
        )
      )
    ),

    // Backdrop - click to close drawer
    searchDrawerOpen && React.createElement('div', {
      onClick: () => setSearchDrawerOpen(false),
      className: 'fixed inset-0 bg-black/40 backdrop-blur-sm z-20',
      style: { top: '64px' }
    }),

    // Main content with sidebar
    React.createElement('div', { 
      className: 'flex-1 flex overflow-hidden'
    },
      // Sidebar
      React.createElement('div', { 
        className: 'w-64 bg-black/20 border-r border-white/10 p-4 flex flex-col gap-2 no-drag overflow-y-auto scrollable-content'
      },
        // Menu buttons
        React.createElement('button', {
          onClick: () => setActiveView('library'),
          className: `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            activeView === 'library' ? 'bg-purple-600' : 'hover:bg-white/10'
          }`
        },
          React.createElement('span', { className: 'text-xl' }, React.createElement(Music)),
          React.createElement('span', null, 'My Library')
        ),
        React.createElement('button', {
          onClick: () => setActiveView('playlists'),
          className: `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            activeView === 'playlists' ? 'bg-purple-600' : 'hover:bg-white/10'
          }`
        },
          React.createElement('span', { className: 'text-xl' }, React.createElement(List)),
          React.createElement('span', null, 'Playlists')
        ),
        React.createElement('button', {
          onClick: () => setActiveView('friends'),
          className: `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            activeView === 'friends' ? 'bg-purple-600' : 'hover:bg-white/10'
          }`
        },
          React.createElement('span', { className: 'text-xl' }, React.createElement(Users)),
          React.createElement('span', null, 'Friends')
        ),
        React.createElement('button', {
          onClick: () => setActiveView('discover'),
          className: `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            activeView === 'discover' ? 'bg-purple-600' : 'hover:bg-white/10'
          }`
        },
          React.createElement('span', { className: 'text-xl' }, React.createElement(Radio)),
          React.createElement('span', null, 'Discover')
        ),

// Resolvers section
          React.createElement('div', { className: 'space-y-3' },
              // Debug info (temporary)
              React.createElement('div', { className: 'text-xs p-2 bg-black/20 rounded space-y-1' },
                React.createElement('div', { className: 'font-semibold mb-2 text-gray-300' }, '🔍 Spotify Status'),
                React.createElement('div', { className: spotifyConnected ? 'text-green-400' : 'text-red-400' }, 
                  `Connected: ${spotifyConnected ? '✓' : '✗'}`
                ),
                React.createElement('div', { className: spotifyToken ? 'text-green-400' : 'text-red-400' }, 
                  `Token: ${spotifyToken ? '✓ Present' : '✗ None'}`
                ),
                React.createElement('div', { className: activeResolvers.includes('spotify') ? 'text-green-400' : 'text-gray-400' }, 
                  `Enabled: ${activeResolvers.includes('spotify') ? '✓' : '✗'}`
                ),
                React.createElement('div', { className: 'text-blue-400 text-xs mt-1' }, 
                  '💡 Using Spotify Connect API'
                ),
                React.createElement('div', { className: 'text-gray-400 text-xs' }, 
                  'Open Spotify app/web to play'
                ),
                React.createElement('button', {
                  onClick: async () => {
                    console.log('=== SPOTIFY STATUS ===');
                    console.log('Connected:', spotifyConnected);
                    console.log('Token:', spotifyToken ? 'Present' : 'None');
                    console.log('Enabled:', activeResolvers.includes('spotify'));
                    
                    if (spotifyToken) {
                      const devices = await getSpotifyDevices();
                      console.log('Available devices:', devices);
                      alert(`Found ${devices.length} Spotify device(s). Check console for details.`);
                    } else {
                      alert('Not connected to Spotify');
                    }
                  },
                  className: 'mt-2 w-full px-2 py-1 bg-blue-600/30 hover:bg-blue-600/50 rounded text-xs'
                },
                  '🔍 Check Devices'
                )
              ),
              ...resolvers.map(resolver => {
                const isSpotify = resolver.id === 'spotify';
                const needsAuth = isSpotify && !spotifyConnected;
                
                return React.createElement('div', {
                  key: resolver.id,
                  className: 'p-4 bg-white/5 rounded-lg border border-white/10'
                },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', { className: 'flex items-center gap-3 flex-1' },
                      React.createElement('div', {
                        className: 'w-4 h-4 rounded-full',
                        style: { backgroundColor: resolver.color }
                      }),
                      React.createElement('div', { className: 'flex-1' },
                        React.createElement('div', { className: 'font-medium' }, resolver.name),
                        React.createElement('div', { className: 'text-xs text-gray-400' },
                          isSpotify && spotifyConnected ? '✓ Connected' :
                          isSpotify && !spotifyConnected ? 'Authentication required' :
                          activeResolvers.includes(resolver.id) ? 'Active' : 'Disabled'
                        )
                      )
                    ),
                    React.createElement('label', { className: 'relative inline-block w-12 h-6' },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: activeResolvers.includes(resolver.id),
                        onChange: () => toggleResolver(resolver.id),
                        disabled: needsAuth,
                        className: 'sr-only peer'
                      }),
                      React.createElement('div', {
                        className: `w-full h-full rounded-full transition-colors ${
                          needsAuth ? 'bg-gray-700' : 'bg-gray-600 peer-checked:bg-purple-600'
                        }`
                      }),
                      React.createElement('div', {
                        className: `absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-6 ${
                          needsAuth ? 'opacity-50' : ''
                        }`
                      })
                    )
                  ),
                  
                  // Spotify Auth Buttons
                  isSpotify && React.createElement('div', { className: 'mt-3 pt-3 border-t border-white/10' },
                    !spotifyConnected ? 
                      React.createElement('div', { className: 'space-y-2' },
                        React.createElement('button', {
                          onClick: connectSpotify,
                          className: 'w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2'
                        },
                          '🔓 Connect Spotify Account'
                        ),
                        React.createElement('button', {
                          onClick: () => {
                            console.log('Manual token check triggered');
                            checkSpotifyToken();
                          },
                          className: 'w-full py-1 px-4 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-xs transition-colors'
                        },
                          '🔄 Refresh Status'
                        )
                      )
                    :
                      React.createElement('div', { className: 'space-y-2' },
                        React.createElement('div', { 
                          className: 'text-sm text-green-400 flex items-center gap-2'
                        },
                          '✓ Authenticated and ready to stream'
                        ),
                        React.createElement('button', {
                          onClick: disconnectSpotify,
                          className: 'w-full py-1.5 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors'
                        },
                          'Disconnect'
                        )
                      )
                  )
                );
              })
            )
          ),
      
      // Main content area - Artist Page (completely separate layout)
      activeView === 'artist' ? React.createElement('div', { 
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Artist page header (not inside scrollable area) - only show when NOT viewing a release
        !currentRelease && React.createElement('div', { 
          className: 'p-6 border-b border-white/10'
        },
          React.createElement('div', { className: 'flex items-center gap-4' },
            React.createElement('button', {
              onClick: () => {
                // If viewing artist page, go back to library
                setActiveView('library');
                setCurrentArtist(null);
                setArtistReleases([]);
                setReleaseTypeFilter('all');
              },
              className: 'p-2 hover:bg-white/10 rounded-full transition-colors no-drag',
              title: 'Back to library'
            }, 
              React.createElement('svg', {
                className: 'w-6 h-6',
                fill: 'none',
                viewBox: '0 0 24 24',
                stroke: 'currentColor'
              },
                React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: 2,
                  d: 'M15 19l-7-7 7-7'
                })
              )
            ),
            !loadingArtist && !loadingRelease && !currentRelease && currentArtist && React.createElement('div', null,
              React.createElement('h1', { className: 'text-3xl font-bold' }, currentArtist.name),
              currentArtist.disambiguation && React.createElement('p', { className: 'text-sm text-gray-400 mt-1' }, currentArtist.disambiguation),
              React.createElement('div', { className: 'flex gap-3 mt-2 text-sm text-gray-500' },
                currentArtist.type && React.createElement('span', null, currentArtist.type),
                currentArtist.country && React.createElement('span', null, `• ${currentArtist.country}`)
              )
            )
          )
        ),
        
        // Loading state for release
        loadingRelease && React.createElement('div', { 
          className: 'flex-1 flex items-center justify-center'
        },
          React.createElement('div', { className: 'text-center' },
            React.createElement('div', { 
              className: 'w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4'
            }),
            React.createElement('div', { className: 'text-gray-400 text-lg' }, 'Loading release...'),
            React.createElement('div', { className: 'text-gray-500 text-sm mt-2' }, 'Fetching track information')
          )
        ),
        
        // Release page header (not inside scrollable area)
        !loadingRelease && currentRelease && React.createElement('div', { 
          className: 'p-6 border-b border-white/10'
        },
          React.createElement('div', { className: 'flex items-center gap-4' },
            React.createElement('button', {
              onClick: () => setCurrentRelease(null),
              className: 'p-2 hover:bg-white/10 rounded-full transition-colors no-drag',
              title: 'Back to artist'
            }, 
              React.createElement('svg', {
                className: 'w-6 h-6',
                fill: 'none',
                viewBox: '0 0 24 24',
                stroke: 'currentColor'
              },
                React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: 2,
                  d: 'M15 19l-7-7 7-7'
                })
              )
            ),
            React.createElement('div', null,
              React.createElement('h1', { className: 'text-3xl font-bold' }, currentRelease.title),
              React.createElement('p', { className: 'text-sm text-gray-400 mt-1' }, 
                `${currentRelease.artist.name} • ${currentRelease.date ? currentRelease.date.split('-')[0] : 'Unknown'}`
              )
            )
          )
        ),
        
        // Release page content (scrollable)
        !loadingRelease && currentRelease && React.createElement('div', { 
          className: 'scrollable-content',
          style: { 
            flex: 1,
            overflowY: 'scroll',
            padding: '24px',
            pointerEvents: 'auto'
          }
        },
          React.createElement(ReleasePage, {
            release: currentRelease,
            handleSearch: handleSearchInput,
            handlePlay: handlePlay,
            trackSources: trackSources,
            resolvers: resolvers
          })
        ),
        
        // Loading state for artist
        !currentRelease && loadingArtist && React.createElement('div', { 
          className: 'flex-1 flex items-center justify-center'
        },
          React.createElement('div', { className: 'text-center' },
            React.createElement('div', { 
              className: 'w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4'
            }),
            React.createElement('div', { className: 'text-gray-400 text-lg' }, 'Loading discography...'),
            React.createElement('div', { className: 'text-gray-500 text-sm mt-2' }, 'Fetching data from MusicBrainz')
          )
        ),
        
        // Artist content (scrollable) - only show if no release is being viewed
        !currentRelease && !loadingArtist && currentArtist && React.createElement('div', { 
          className: 'scrollable-content',
          style: { 
            flex: 1,
            overflowY: 'scroll',
            padding: '24px',
            pointerEvents: 'auto'
          }
        },
          React.createElement('div', { 
            className: 'space-y-6'
          },
            // Release type filters
            React.createElement('div', { className: 'flex gap-2' },
              ['all', 'album', 'ep', 'single'].map(type => {
                const count = type === 'all' 
                  ? artistReleases.length 
                  : artistReleases.filter(r => r.releaseType === type).length;
                
                return React.createElement('button', {
                  key: type,
                  onClick: () => setReleaseTypeFilter(type),
                  className: `px-4 py-2 rounded-full transition-all no-drag ${
                    releaseTypeFilter === type 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-white/10 text-gray-400 hover:bg-white/20'
                  }`,
                }, `${type.charAt(0).toUpperCase() + type.slice(1)}s (${count})`);
              })
            ),
            
            // Releases count
            React.createElement('p', { className: 'text-sm text-gray-400' },
              `${artistReleases.filter(r => releaseTypeFilter === 'all' || r.releaseType === releaseTypeFilter).length} releases`
            ),
            
            // Discography grid
            React.createElement('div', { 
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
            },
              artistReleases.map(release => 
                React.createElement(ReleaseCard, {
                  key: release.id,
                  release: release,
                  currentArtist: currentArtist,
                  fetchReleaseData: fetchReleaseData,
                  isVisible: releaseTypeFilter === 'all' || release.releaseType === releaseTypeFilter
                })
              )
            ),
            
            // Empty state
            artistReleases.filter(r => releaseTypeFilter === 'all' || r.releaseType === releaseTypeFilter).length === 0 && 
              React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                `No ${releaseTypeFilter === 'all' ? '' : releaseTypeFilter + ' '}releases found`
              )
          )
        )
      )
      
      // Main content area - Playlist Page (separate flex layout like Artist page)
      : activeView === 'playlist-view' && selectedPlaylist ? React.createElement('div', {
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Playlist header (non-scrollable)
        React.createElement('div', {
          className: 'border-b border-white/10 p-6 flex-shrink-0',
          style: { pointerEvents: 'auto' }
        },
          React.createElement('div', { className: 'flex items-start gap-6' },
            React.createElement('div', {
              className: 'w-48 h-48 flex-shrink-0 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-6xl shadow-2xl'
            }, '📋'),
            React.createElement('div', { className: 'flex-1 pt-4' },
              React.createElement('div', { className: 'text-sm text-gray-400 mb-2' }, 'PLAYLIST'),
              React.createElement('h1', { className: 'text-5xl font-bold mb-4' }, selectedPlaylist.title),
              React.createElement('div', { className: 'text-gray-300 mb-4' }, 
                `Created by ${selectedPlaylist.creator}`
              ),
              React.createElement('div', { className: 'flex items-center gap-4' },
                React.createElement('button', {
                  onClick: () => {
                    const playableQueue = playlistTracks.filter(t => Object.keys(t.sources || {}).length > 0);
                    if (playableQueue.length > 0) {
                      setCurrentQueue(playableQueue);
                      handlePlay(playableQueue[0]);
                    }
                  },
                  disabled: playlistTracks.filter(t => Object.keys(t.sources || {}).length > 0).length === 0,
                  className: 'px-8 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-full font-semibold transition-colors flex items-center gap-2 no-drag'
                },
                  React.createElement(Play),
                  'Play'
                ),
                React.createElement('button', {
                  onClick: () => handleExportPlaylist(selectedPlaylist),
                  className: 'px-6 py-3 bg-green-600 hover:bg-green-700 rounded-full transition-colors flex items-center gap-2 no-drag'
                },
                  React.createElement('span', null, '📤'),
                  'Export'
                ),
                React.createElement('button', {
                  onClick: () => {
                    setActiveView('playlists');
                    setSelectedPlaylist(null);
                    setPlaylistTracks([]);
                  },
                  className: 'px-6 py-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors no-drag'
                }, 'Back to Playlists')
              )
            )
          )
        ),
        
        // Scrollable track list
        React.createElement('div', {
          className: 'scrollable-content',
          style: {
            flex: 1,
            height: '0',
            overflowY: 'scroll',
            padding: '24px',
            pointerEvents: 'auto'
          }
        },
          React.createElement('div', { className: 'space-y-2' },
            React.createElement('div', { className: 'text-sm text-gray-400 mb-4' },
              playlistTracks.length === 0 ? 'Loading tracks...' : 
              `${playlistTracks.filter(t => Object.keys(t.sources || {}).length > 0).length}/${playlistTracks.length} tracks available`
            ),
            playlistTracks.map((track, index) => {
              const hasResolved = Object.keys(track.sources || {}).length > 0;
              const isResolving = Object.keys(track.sources || {}).length === 0;
              
              return React.createElement('div', {
                key: index,
                className: `group flex items-center gap-4 p-3 rounded-lg transition-colors ${
                  hasResolved ? 'hover:bg-white/5 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                }`,
                onClick: hasResolved ? () => {
                  const availableResolvers = Object.keys(track.sources);
                  const sortedSources = availableResolvers
                    .map(resolverId => ({
                      resolverId,
                      source: track.sources[resolverId],
                      priority: resolverOrder.indexOf(resolverId)
                    }))
                    .filter(s => activeResolvers.includes(s.resolverId))
                    .sort((a, b) => a.priority - b.priority);
                  
                  if (sortedSources.length > 0) {
                    const playableQueue = playlistTracks.filter(t => Object.keys(t.sources || {}).length > 0);
                    setCurrentQueue(playableQueue);
                    handlePlay(sortedSources[0].source);
                  }
                } : undefined
              },
                React.createElement('div', { 
                  className: 'text-gray-400 w-8 text-center',
                  style: { pointerEvents: 'none' }
                }, index + 1),
                React.createElement('div', {
                  className: 'flex-1 min-w-0',
                  style: { pointerEvents: 'none' }
                },
                  React.createElement('div', {
                    className: `font-medium truncate ${hasResolved ? 'group-hover:text-purple-400' : ''}`
                  }, track.title),
                  React.createElement('div', { className: 'text-sm text-gray-400 truncate' }, track.artist),
                  (() => {
                    const resolverId = determineResolverIdFromTrack(track);
                    const resolver = allResolvers.find(r => r.id === resolverId);
                    return resolver ? React.createElement('div', { className: 'text-xs text-slate-400 mt-0.5' }, `via ${resolver.name}`) : null;
                  })()
                ),
                React.createElement('div', { 
                  className: 'hidden md:block text-sm text-gray-400 truncate w-48',
                  style: { pointerEvents: 'none' }
                }, track.album || '-'),
                React.createElement('div', { 
                  className: 'flex items-center gap-2',
                  style: { pointerEvents: 'none' }
                },
                  isResolving ?
                    React.createElement('span', { 
                      className: 'text-xs text-gray-500',
                      title: 'Searching for sources...'
                    }, '🔍')
                  :
                    hasResolved ?
                      Object.entries(track.sources).map(([resolverId, source]) => {
                        const resolver = allResolvers.find(r => r.id === resolverId);
                        if (!resolver) return null;
                        return React.createElement('button', {
                          key: resolverId,
                          className: 'no-drag',
                          onClick: (e) => {
                            e.stopPropagation();
                            const playableQueue = playlistTracks.filter(t => Object.keys(t.sources || {}).length > 0);
                            setCurrentQueue(playableQueue);
                            handlePlay(source);
                          },
                          style: {
                            width: '24px',
                            height: '24px',
                            borderRadius: '4px',
                            backgroundColor: resolver.color,
                            opacity: 0.8,
                            pointerEvents: 'auto'
                          },
                          title: `Play from ${resolver.name}`
                        }, resolver.icon);
                      })
                    :
                      React.createElement('span', { 
                        className: 'text-xs text-gray-500',
                        title: 'Not available on any service'
                      }, '❌')
                ),
                React.createElement('div', { 
                  className: 'text-sm text-gray-400 w-12 text-right',
                  style: { pointerEvents: 'none' }
                }, formatTime(track.duration))
              );
            })
          )
        )
      )
      
      // Main content area - Normal views (Library, Search, etc.)
      : React.createElement('div', {
        className: 'flex-1 overflow-y-auto p-6 scrollable-content',
        style: { 
          minHeight: 0, 
          flexBasis: 0,
          pointerEvents: activeView === 'artist' || activeView === 'playlist-view' ? 'none' : 'auto'
        }
      },
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('h2', { className: 'text-2xl font-bold' },
            activeView === 'library' ? 'My Library' :
            activeView === 'playlists' ? 'Playlists' :
            activeView === 'playlist-view' && selectedPlaylist ? selectedPlaylist.title :
            activeView === 'friends' ? 'Friends' :
            'Discover'
          )
        ),
        // Library view - always shows library tracks
        activeView === 'library' && React.createElement('div', { className: 'space-y-2' },
          library.length === 0 ?
            React.createElement('div', { className: 'text-center py-12 text-gray-400' },
              'Your library is empty. Search for music to add tracks!'
            )
          :
          library.map(track =>
            React.createElement(TrackRow, {
              key: track.id,
              track: track,
              isPlaying: isPlaying && currentTrack?.id === track.id,
              handlePlay: (track) => {
                setCurrentQueue(library);
                handlePlay(track);
              },
              onArtistClick: fetchArtistData,
              allResolvers: allResolvers,
              resolverOrder: resolverOrder,
              activeResolvers: activeResolvers
            })
          )
        ),
        // Playlists View
        activeView === 'playlists' && React.createElement('div', { className: 'space-y-4' },
          // Import button
          React.createElement('div', { className: 'flex justify-end' },
            React.createElement('button', {
              onClick: handleImportPlaylist,
              className: 'px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-2'
            },
              React.createElement('span', null, '📥'),
              'Import Playlist'
            )
          ),
          
          // Playlist grid or empty state
          playlists.length === 0 ?
            React.createElement('div', {
              className: 'text-center py-12 text-gray-400'
            }, '🎵 No playlists yet. Import a playlist to get started!')
          :
            React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' },
              playlists.map(playlist => 
                React.createElement('button', {
                  key: playlist.id,
                  onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🖱️ BUTTON CLICKED! Playlist:', playlist.id, playlist.title);
                    loadPlaylist(playlist.id);
                  },
                  className: 'group text-left bg-white/5 rounded-lg p-4 hover:bg-white/10 transition-colors cursor-pointer border-none'
                },
                  React.createElement('div', {
                    className: 'w-full aspect-square bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg mb-3 flex items-center justify-center text-4xl'
                  }, '📋'),
                  React.createElement('div', { className: 'font-semibold truncate' }, playlist.title),
                  React.createElement('div', { className: 'text-sm text-gray-400 truncate' }, playlist.creator)
                )
              )
            )
        ),
        
        activeView === 'friends' && React.createElement('div', {
          className: 'text-center py-12 text-gray-400'
        }, '👥 Connect with friends to see what they\'re listening to'),
        activeView === 'discover' && React.createElement('div', {
          className: 'text-center py-12 text-gray-400'
        }, '📻 Discover new music from trending charts')
      )
    ),

    // Player bar
    currentTrack && React.createElement('div', {
      className: 'bg-black/40 backdrop-blur-xl border-t border-white/10 p-4 no-drag'
    },
      isExternalPlayback ?
        // External Playback State
        React.createElement('div', { className: 'flex flex-col items-center space-y-4 w-full' },
          React.createElement('div', { className: 'text-center' },
            React.createElement('div', { className: 'text-sm text-slate-400 mb-2' }, '🌐 Playing in browser'),
            React.createElement('div', { className: 'text-lg font-semibold text-white' }, currentTrack.title),
            React.createElement('div', { className: 'text-sm text-slate-400' }, currentTrack.artist),
            React.createElement('div', { className: 'text-xs text-purple-400 mt-1' },
              (() => {
                const resolverId = determineResolverIdFromTrack(currentTrack);
                const resolver = allResolvers.find(r => r.id === resolverId);
                return resolver ? `🌐 via ${resolver.name}` : null;
              })()
            )
          ),

          // Grayed out progress bar
          React.createElement('div', { className: 'w-full max-w-md' },
            React.createElement('div', { className: 'h-1 bg-slate-700 rounded-full opacity-50 border border-dashed border-slate-600' }),
            React.createElement('div', { className: 'flex justify-between text-xs text-slate-500 mt-1' },
              React.createElement('span', null, '0:00'),
              React.createElement('span', null, currentTrack.duration ? Math.floor(currentTrack.duration / 60) + ':' + String(Math.floor(currentTrack.duration % 60)).padStart(2, '0') : '--:--')
            )
          ),

          // Done button
          React.createElement('button', {
            onClick: handleDoneWithExternalTrack,
            className: 'bg-green-600 hover:bg-green-700 text-white py-3 px-8 rounded-lg font-medium transition-colors flex items-center gap-2'
          },
            React.createElement('span', null, '✓'),
            React.createElement('span', null, 'Done - Play Next')
          ),

          // Navigation buttons (grayed)
          React.createElement('div', { className: 'flex gap-4 opacity-50' },
            React.createElement('button', {
              onClick: handlePrevious,
              className: 'w-10 h-10 flex items-center justify-center rounded-full bg-slate-700 text-white'
            }, '⏮'),
            React.createElement('button', {
              onClick: handleNext,
              className: 'w-10 h-10 flex items-center justify-center rounded-full bg-slate-700 text-white'
            }, '⏭')
          )
        )
      :
        // Normal player controls
        React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'flex items-center justify-between mb-2' },
            React.createElement('div', { className: 'flex items-center gap-4' },
              currentTrack.albumArt ?
                React.createElement('img', {
                  src: currentTrack.albumArt,
                  alt: currentTrack.album,
                  className: 'w-14 h-14 rounded-lg object-cover'
                })
              :
                React.createElement('div', {
                  className: 'w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center text-2xl'
                }, React.createElement(Music)),
              React.createElement('div', null,
                React.createElement('div', { className: 'font-semibold' }, currentTrack.title),
                React.createElement('div', { className: 'text-sm text-gray-400 flex items-center gap-2' },
                  React.createElement('button', {
                    onClick: () => {
                      console.log('Navigating to artist:', currentTrack.artist);
                      fetchArtistData(currentTrack.artist);
                    },
                    className: 'hover:text-purple-400 hover:underline transition-colors cursor-pointer no-drag',
                    style: { background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit' }
                  }, currentTrack.artist)
                ),
                React.createElement('div', { className: 'text-xs text-purple-400 mt-1' },
                  (() => {
                    const resolverId = determineResolverIdFromTrack(currentTrack);
                    const resolver = allResolvers.find(r => r.id === resolverId);
                    return resolver ? `▶️ via ${resolver.name}` : null;
                  })()
                )
              )
            ),
            React.createElement('button', {
              className: 'p-2 hover:bg-white/10 rounded-full transition-colors text-xl'
            }, React.createElement(Heart))
          ),
          React.createElement('div', { className: 'flex items-center gap-4' },
            React.createElement('span', { className: 'text-sm text-gray-400 w-12 text-right' }, formatTime(progress)),
            React.createElement('div', { className: 'flex-1' },
              React.createElement('input', {
                type: 'range',
                min: '0',
                max: currentTrack.duration,
                value: progress,
                onChange: async (e) => {
                  const newPosition = Number(e.target.value);
                  setProgress(newPosition);

                  // Seek in Spotify if playing Spotify track
                  if ((currentTrack.sources?.includes('spotify') || currentTrack.spotifyUri) && spotifyPlayer) {
                    try {
                      await spotifyPlayer.seek(newPosition * 1000); // Convert to milliseconds
                      console.log('Seeked to', newPosition);
                    } catch (err) {
                      console.error('Seek error:', err);
                    }
                  }
                },
                className: 'w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer'
              })
            ),
            React.createElement('span', { className: 'text-sm text-gray-400 w-12' }, formatTime(currentTrack.duration))
          ),
          React.createElement('div', { className: 'flex items-center justify-center gap-4 mt-2' },
            React.createElement('button', {
              onClick: handlePrevious,
              className: 'p-2 hover:bg-white/10 rounded-full transition-colors text-xl'
            }, React.createElement(SkipBack)),
            React.createElement('button', {
              onClick: handlePlayPause,
              className: 'p-4 bg-purple-600 hover:bg-purple-700 rounded-full transition-colors text-xl'
            }, isPlaying ? React.createElement(Pause) : React.createElement(Play)),
            React.createElement('button', {
              onClick: handleNext,
              className: 'p-2 hover:bg-white/10 rounded-full transition-colors text-xl'
            }, React.createElement(SkipForward)),
            React.createElement('div', { className: 'flex items-center gap-2 ml-8' },
              React.createElement('span', { className: 'text-xl' }, React.createElement(Volume2)),
              React.createElement('input', {
                type: 'range',
                min: '0',
                max: '100',
                value: volume,
                onChange: (e) => setVolume(Number(e.target.value)),
                className: 'w-24 h-1 bg-white/20 rounded-full appearance-none cursor-pointer'
              })
            )
          )
        )
    ),

    // Settings Modal
    showSettings && React.createElement('div', {
      className: 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50'
    },
      React.createElement('div', {
        className: 'bg-slate-800 rounded-xl p-6 max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col'
      },
        // Header
        React.createElement('div', {
          className: 'flex items-center justify-between mb-6'
        },
          React.createElement('h2', { className: 'text-2xl font-bold' }, 'Settings'),
          React.createElement('button', {
            onClick: () => setShowSettings(false),
            className: 'p-2 hover:bg-white/10 rounded-lg transition-colors text-xl'
          }, React.createElement(X))
        ),

        // Tab Navigation
        React.createElement('div', {
          className: 'flex gap-2 mb-6 border-b border-white/10'
        },
          React.createElement('button', {
            onClick: () => setSettingsTab('installed'),
            className: `px-4 py-2 font-semibold transition-colors ${
              settingsTab === 'installed'
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-gray-400 hover:text-gray-200'
            }`
          }, '🔌 Installed Resolvers'),
          React.createElement('button', {
            onClick: () => setSettingsTab('marketplace'),
            className: `px-4 py-2 font-semibold transition-colors ${
              settingsTab === 'marketplace'
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-gray-400 hover:text-gray-200'
            }`
          }, '🛒 Browse Marketplace')
        ),

        // Tab Content Container
        React.createElement('div', {
          className: 'flex-1 overflow-y-auto'
        },
          // Installed Resolvers Tab
          settingsTab === 'installed' && React.createElement('div', { className: 'space-y-6' },
          React.createElement('div', null,
            React.createElement('h3', { className: 'text-lg font-semibold mb-2' }, '🔌 Resolver Plugins'),
            React.createElement('p', { className: 'text-sm text-gray-400 mb-4' },
              'Drag ⋮⋮ to reorder • Right-click 📦 User resolvers to uninstall'
            ),
            React.createElement('div', { className: 'space-y-2' },
              resolverOrder.map((resolverId, index) => {
                const resolver = allResolvers.find(r => r.id === resolverId);
                if (!resolver) return null;
                
                const isActive = activeResolvers.includes(resolver.id);
                const isDragging = draggedResolver === resolver.id;
                
                return React.createElement('div', {
                  key: resolver.id,
                  onDragOver: handleResolverDragOver,
                  onDrop: (e) => handleResolverDrop(e, resolver.id),
                  onContextMenu: (e) => {
                    console.log('Context menu triggered for:', resolver.name);
                    e.preventDefault();
                    if (window.electron?.resolvers?.showContextMenu) {
                      console.log('Showing context menu for:', resolver.id);
                      window.electron.resolvers.showContextMenu(resolver.id);
                    } else {
                      console.log('showContextMenu not available');
                    }
                  },
                  className: `p-4 rounded-lg border transition-all ${
                    isDragging
                      ? 'opacity-50 bg-purple-900/20 border-purple-500'
                      : isActive
                        ? 'bg-white/10 border-white/20 hover:bg-white/15'
                        : 'bg-white/5 border-white/10 hover:bg-white/8'
                  }`,
                  style: { userSelect: 'none' },
                  title: 'Right-click to uninstall'
                },
                  React.createElement('div', { className: 'flex items-start gap-3' },
                    // Drag handle (only this part is draggable)
                    React.createElement('div', { 
                      draggable: true,
                      onDragStart: (e) => {
                        e.stopPropagation();
                        handleResolverDragStart(e, resolver.id);
                      },
                      onDragEnd: handleResolverDragEnd,
                      className: 'text-gray-500 mt-1 cursor-move',
                      title: 'Drag to reorder'
                    }, '⋮⋮'),
                    
                    // Priority number
                    React.createElement('div', {
                      className: 'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 mt-0.5',
                      style: { 
                        backgroundColor: isActive ? resolver.color + '40' : '#ffffff10',
                        color: isActive ? resolver.color : '#ffffff40'
                      }
                    }, index + 1),
                    
                    // Resolver info
                    React.createElement('div', { className: 'flex-1 min-w-0' },
                      React.createElement('div', { className: 'flex items-center gap-2 mb-1' },
                        React.createElement('span', { className: 'text-lg' }, resolver.icon),
                        React.createElement('span', { className: 'font-semibold' }, resolver.name),
                        resolver.requiresAuth && React.createElement('span', {
                          className: 'text-xs px-2 py-0.5 bg-yellow-900/30 text-yellow-400 rounded-full'
                        }, '🔑 Auth Required')
                      ),
                      React.createElement('p', { 
                        className: 'text-xs text-gray-400 mb-2'
                      }, resolver.description),
                      
                      // Capabilities
                      React.createElement('div', { className: 'flex flex-wrap gap-1.5' },
                        Object.entries(resolver.capabilities).map(([capability, enabled]) => {
                          const icons = {
                            resolve: '🎯',
                            search: '🔍',
                            stream: '▶️',
                            browse: '📁',
                            urlLookup: '🔗'
                          };
                          return enabled && React.createElement('span', {
                            key: capability,
                            className: 'text-xs px-2 py-0.5 bg-white/10 text-gray-300 rounded-full',
                            title: capability
                          }, icons[capability] || '✓', ' ', capability);
                        })
                      )
                    ),
                    
                    // Toggle
                    React.createElement('label', { className: 'relative inline-block w-12 h-6 flex-shrink-0 mt-1' },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: isActive,
                        onChange: () => toggleResolver(resolver.id),
                        className: 'sr-only peer'
                      }),
                      React.createElement('div', {
                        className: 'w-full h-full bg-gray-600 rounded-full peer-checked:bg-purple-600 transition-colors'
                      }),
                      React.createElement('div', {
                        className: 'absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-6'
                      })
                    )
                  )
                );
              })
            ),
            
            // Install Resolver Button
            React.createElement('button', {
              onClick: handleInstallResolver,
              className: 'w-full mt-4 px-4 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2'
            },
              React.createElement('span', null, '📦'),
              React.createElement('span', null, 'Install New Resolver (.axe file)')
            )
          ),
          
          // How It Works Section
          React.createElement('div', null,
            React.createElement('h3', { className: 'text-lg font-semibold mb-4' }, '💡 How Priority Works'),
            React.createElement('div', { className: 'bg-white/5 rounded-lg p-4 space-y-2 text-sm text-gray-300' },
              React.createElement('p', null,
                React.createElement('strong', null, '🎯 Resolution Order: '),
                'When resolving a track, Parachord queries resolvers in priority order (top to bottom). Higher priority resolvers are checked first.'
              ),
              React.createElement('p', null,
                React.createElement('strong', null, '🔀 Track Click Behavior: '),
                'When clicking a track row, Parachord plays from the highest-priority enabled resolver that found a match.'
              ),
              React.createElement('p', null,
                React.createElement('strong', null, '🎵 Source Icons: '),
                'Click specific resolver icons to override priority and play from that specific source.'
              ),
              React.createElement('p', null,
                React.createElement('strong', null, '⋮⋮ Drag Handle: '),
                'Drag the ⋮⋮ icon to reorder resolvers. Changes take effect immediately for new resolutions.'
              ),
              React.createElement('p', null,
                React.createElement('strong', null, '🗑️ Right-Click: '),
                'Right-click user-installed resolvers (with 📦 badge) to uninstall them. Built-in resolvers cannot be removed.'
              )
            )
          ),
          
          // About Section
          React.createElement('div', null,
            React.createElement('h3', { className: 'text-lg font-semibold mb-4' }, 'About'),
            React.createElement('div', { className: 'text-sm text-gray-400 space-y-2' },
              React.createElement('p', null, 'Parachord Desktop v1.0.0'),
              React.createElement('p', null, 'A modern multi-source music player inspired by Tomahawk.'),
              React.createElement('p', null,
                'Built with Electron, React, and Tailwind CSS.'
              )
            )
          )
        ),

        // Marketplace Tab
        settingsTab === 'marketplace' && React.createElement('div', { className: 'space-y-4' },
          // Search and Filter Bar
          React.createElement('div', {
            className: 'flex gap-4 mb-4'
          },
            // Search input
            React.createElement('input', {
              type: 'text',
              placeholder: 'Search resolvers...',
              value: marketplaceSearchQuery,
              onChange: (e) => setMarketplaceSearchQuery(e.target.value),
              className: 'flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500'
            }),

            // Category filter
            React.createElement('select', {
              value: marketplaceCategory,
              onChange: (e) => setMarketplaceCategory(e.target.value),
              className: 'px-4 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500'
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
            className: 'text-center py-12 text-gray-400'
          }, '⏳ Loading marketplace...'),

          // Error state (empty marketplace)
          !marketplaceLoading && marketplaceManifest && marketplaceManifest.resolvers.length === 0 &&
            React.createElement('div', {
              className: 'text-center py-12 text-gray-400'
            }, 'No resolvers available in marketplace yet.'),

          // Resolver grid
          !marketplaceLoading && marketplaceManifest && marketplaceManifest.resolvers.length > 0 &&
            React.createElement('div', {
              className: 'grid grid-cols-1 md:grid-cols-2 gap-4'
            },
              marketplaceManifest.resolvers
                .filter(resolver => {
                  // Filter by search query
                  if (marketplaceSearchQuery) {
                    const query = marketplaceSearchQuery.toLowerCase();
                    const matchesName = resolver.name.toLowerCase().includes(query);
                    const matchesDesc = resolver.description.toLowerCase().includes(query);
                    const matchesAuthor = resolver.author.toLowerCase().includes(query);
                    if (!matchesName && !matchesDesc && !matchesAuthor) return false;
                  }

                  // Filter by category
                  if (marketplaceCategory !== 'all' && resolver.category !== marketplaceCategory) {
                    return false;
                  }

                  return true;
                })
                .map(resolver => {
                  const isInstalled = allResolvers.some(r => r.id === resolver.id);
                  const isInstalling = installingResolvers.has(resolver.id);
                  const installedVersion = allResolvers.find(r => r.id === resolver.id)?.version;
                  const hasUpdate = isInstalled && installedVersion !== resolver.version;

                  return React.createElement('div', {
                    key: resolver.id,
                    className: 'p-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/8 transition-colors'
                  },
                    // Header
                    React.createElement('div', {
                      className: 'flex items-start gap-3 mb-3'
                    },
                      // Icon
                      React.createElement('div', {
                        className: 'text-3xl flex-shrink-0',
                        style: { color: resolver.color }
                      }, resolver.icon),

                      // Name and author
                      React.createElement('div', {
                        className: 'flex-1 min-w-0'
                      },
                        React.createElement('h4', {
                          className: 'font-semibold text-lg truncate'
                        }, resolver.name),
                        React.createElement('p', {
                          className: 'text-xs text-gray-400 truncate'
                        }, 'by ', resolver.author),

                        // Version badge
                        React.createElement('span', {
                          className: 'inline-block text-xs px-2 py-0.5 bg-white/10 text-gray-300 rounded-full mt-1'
                        }, 'v', resolver.version)
                      ),

                      // Status badge
                      isInstalled && React.createElement('span', {
                        className: `text-xs px-2 py-0.5 rounded-full ${
                          hasUpdate
                            ? 'bg-orange-900/30 text-orange-400'
                            : 'bg-green-900/30 text-green-400'
                        }`
                      }, hasUpdate ? '🔄 Update' : '✅ Installed')
                    ),

                    // Description
                    React.createElement('p', {
                      className: 'text-sm text-gray-300 mb-3 line-clamp-2'
                    }, resolver.description),

                    // Capabilities
                    React.createElement('div', {
                      className: 'flex flex-wrap gap-1.5 mb-3'
                    },
                      Object.entries(resolver.capabilities).map(([cap, enabled]) => {
                        if (!enabled) return null;
                        const icons = {
                          resolve: '🎯',
                          search: '🔍',
                          stream: '▶️',
                          browse: '📁',
                          urlLookup: '🔗'
                        };
                        return React.createElement('span', {
                          key: cap,
                          className: 'text-xs px-2 py-0.5 bg-white/10 text-gray-300 rounded-full'
                        }, icons[cap], ' ', cap);
                      })
                    ),

                    // Auth requirement
                    resolver.requiresAuth && React.createElement('div', {
                      className: 'text-xs text-yellow-400 mb-3'
                    }, '🔑 Requires authentication'),

                    // Install button
                    React.createElement('button', {
                      onClick: () => handleInstallFromMarketplace(resolver),
                      disabled: isInstalling,
                      className: `w-full px-4 py-2 rounded-lg font-semibold transition-colors ${
                        isInstalling
                          ? 'bg-gray-600 cursor-not-allowed'
                          : hasUpdate
                            ? 'bg-orange-600 hover:bg-orange-700'
                            : isInstalled
                              ? 'bg-green-600/50 hover:bg-green-600'
                              : 'bg-purple-600 hover:bg-purple-700'
                      }`
                    },
                      isInstalling ? '⏳ Installing...' :
                      hasUpdate ? '🔄 Update' :
                      isInstalled ? 'Reinstall' :
                      'Install'
                    )
                  );
                })
            )
        )
      )
    )
    ),

    // Embedded Player Drawer
    React.createElement('div', {
      className: 'fixed left-0 right-0 bg-slate-900 border-t border-white/20 shadow-2xl transition-all duration-300 ease-in-out z-40',
      style: {
        bottom: drawerOpen ? 0 : -drawerHeight,
        height: drawerHeight + 'px'
      }
    },
      // Drawer header with drag handle
      React.createElement('div', {
        className: 'flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-white/10 cursor-ns-resize',
        onMouseDown: (e) => {
          const startY = e.clientY;
          const startHeight = drawerHeight;

          const handleMouseMove = (moveEvent) => {
            const deltaY = startY - moveEvent.clientY;
            const newHeight = Math.max(200, Math.min(800, startHeight + deltaY));
            setDrawerHeight(newHeight);
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
          className: 'flex items-center gap-2'
        },
          React.createElement('div', {
            className: 'w-8 h-1 bg-white/30 rounded-full'
          }),
          React.createElement('span', {
            className: 'text-sm text-gray-400'
          }, 'Embedded Player')
        ),
        React.createElement('button', {
          onClick: () => setDrawerOpen(false),
          className: 'p-1 hover:bg-white/10 rounded transition-colors'
        }, React.createElement(X))
      ),

      // Drawer content - iframe container
      React.createElement('div', {
        className: 'w-full h-full bg-black',
        style: { height: (drawerHeight - 40) + 'px' }
      },
        drawerUrl ? React.createElement('iframe', {
          src: drawerUrl,
          className: 'w-full h-full',
          style: { border: 'none' },
          allow: 'autoplay; encrypted-media; picture-in-picture',
          allowFullScreen: true
        }) : React.createElement('div', {
          className: 'flex items-center justify-center h-full text-gray-500'
        }, 'No content loaded')
      )
    )
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(Parachord));