// Parachord Desktop App - Electron Version
const { useState, useEffect, useRef, useCallback } = React;

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
    className: 'group flex items-center gap-4 p-3 rounded-lg hover:bg-gray-100 transition-colors no-drag'
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
  }, [artist.name, getArtistImage]);

  const cardStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    cursor: 'pointer',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    transition: 'transform 0.2s, background-color 0.2s'
  };

  return React.createElement('button', {
    onClick: onNavigate,
    className: 'no-drag',
    style: {
      ...cardStyle,
      width: '100%',
      textAlign: 'left'
    },
    onMouseEnter: (e) => {
      e.currentTarget.style.transform = 'scale(1.05)';
      e.currentTarget.style.backgroundColor = 'rgba(124, 58, 237, 0.2)';
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.transform = 'scale(1)';
      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    }
  },
    // Artist image container
    React.createElement('div', {
      style: {
        width: '100%',
        aspectRatio: '1',
        borderRadius: '8px',
        background: imageUrl ? 'none' : 'linear-gradient(135deg, #9333ea 0%, #ec4899 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '12px',
        pointerEvents: 'none',
        overflow: 'hidden',
        position: 'relative'
      }
    },
      imageLoading && React.createElement('div', {
        className: 'w-full h-full flex items-center justify-center'
      },
        React.createElement('div', {
          className: 'w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin'
        })
      ),
      !imageLoading && imageUrl && React.createElement('img', {
        src: imageUrl,
        alt: artist.name,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none'
        }
      }),
      !imageLoading && !imageUrl && React.createElement('div', {
        className: 'w-full h-full flex items-center justify-center'
      },
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
            d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
          })
        )
      )
    ),
    // Artist name
    React.createElement('h3', {
      style: {
        fontWeight: '600',
        fontSize: '14px',
        marginBottom: '4px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'black',
        pointerEvents: 'none'
      },
      title: artist.name
    }, artist.name)
  );
};

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
              className: 'flex items-center gap-4 p-3 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors no-drag group',
              onClick: () => {
                console.log('Track row clicked:', track.title);

                // Create a track object with sources for handlePlay to select the best one
                if (availableResolvers.length > 0) {
                  // Generate unique ID for queue tracking
                  const trackId = `${release.artist.name || 'unknown'}-${track.title || 'untitled'}-${release.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                  const trackWithSources = {
                    ...track,
                    id: trackId,
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
                className: 'text-xs text-gray-400 w-8 flex-shrink-0',
                style: { pointerEvents: 'none' }
              }, track.position),

              // Track title
              React.createElement('span', {
                className: 'text-xs text-gray-900 flex-1 transition-colors',
                style: { pointerEvents: 'none' }
              }, track.title),

              // Duration
              track.length && React.createElement('span', {
                className: 'text-xs text-gray-500 flex-shrink-0',
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
                  
                  // Show resolver icons for available sources (only if they support playback)
                  return availableResolvers.map(resolverId => {
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

                        // Generate unique ID for queue tracking
                        const trackId = `${release.artist.name || 'unknown'}-${track.title || 'untitled'}-${release.title || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        // Create full track object with sources and preferred resolver
                        const trackWithSources = {
                          ...track,
                          id: trackId,
                          artist: release.artist.name,
                          album: release.title,
                          sources: sources,
                          preferredResolver: resolverId
                        };
                        handlePlay(trackWithSources);
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
                      const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM' };
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
  const [viewHistory, setViewHistory] = useState(['library']); // Navigation history for back button
  const [artistHistory, setArtistHistory] = useState([]); // Stack of previous artist names for back navigation
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [currentArtist, setCurrentArtist] = useState(null); // Artist page data
  const [artistImage, setArtistImage] = useState(null); // Artist image from Spotify
  const [artistImagePosition, setArtistImagePosition] = useState('center 25%'); // Face-centered position
  const [artistReleases, setArtistReleases] = useState([]); // Discography
  const [releaseTypeFilter, setReleaseTypeFilter] = useState('all'); // all, album, ep, single
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false); // Artist page header collapse state
  const [artistPageTab, setArtistPageTab] = useState('music'); // music | biography | related
  const [artistBio, setArtistBio] = useState(null); // Artist biography from Last.fm
  const [relatedArtists, setRelatedArtists] = useState([]); // Related artists from Last.fm
  const [loadingBio, setLoadingBio] = useState(false);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [loadingArtist, setLoadingArtist] = useState(false);
  const [currentRelease, setCurrentRelease] = useState(null); // Release/Album page data
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [trackSources, setTrackSources] = useState({}); // Resolved sources for each track: { trackId: { youtube: {...}, soundcloud: {...} } }
  const [activeResolvers, setActiveResolvers] = useState(['spotify', 'bandcamp', 'qobuz', 'youtube']);
  const [resolverOrder, setResolverOrder] = useState(['spotify', 'bandcamp', 'qobuz', 'youtube', 'soundcloud']);
  const resolverSettingsLoaded = useRef(false);  // Track if we've loaded settings from storage
  const [draggedResolver, setDraggedResolver] = useState(null);
  const [library, setLibrary] = useState([]);
  const [audioContext, setAudioContext] = useState(null);
  const [currentSource, setCurrentSource] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const [isExternalPlayback, setIsExternalPlayback] = useState(false);
  const [showExternalPrompt, setShowExternalPrompt] = useState(false);
  const [pendingExternalTrack, setPendingExternalTrack] = useState(null);
  const externalTrackTimeoutRef = useRef(null);
  const playbackPollerRef = useRef(null);
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
  const [qobuzToken, setQobuzToken] = useState(null);
  const [qobuzConnected, setQobuzConnected] = useState(false);
  const [showUrlImportDialog, setShowUrlImportDialog] = useState(false);
  const [urlImportValue, setUrlImportValue] = useState('');
  const [urlImportLoading, setUrlImportLoading] = useState(false);
  const [refreshingPlaylist, setRefreshingPlaylist] = useState(null); // Track which playlist is refreshing

  // Drag & drop URL state
  const [isDraggingUrl, setIsDraggingUrl] = useState(false);
  const [dropZoneTarget, setDropZoneTarget] = useState(null); // 'now-playing' | 'queue' | null
  const queueAnimationRef = useRef(null);
  const [queueAnimating, setQueueAnimating] = useState(false);
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

  // Keep refs in sync with state
  useEffect(() => { currentQueueRef.current = currentQueue; }, [currentQueue]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { spotifyTokenRef.current = spotifyToken; }, [spotifyToken]);

  // Artist page scroll handler for header collapse
  const handleArtistPageScroll = useCallback((e) => {
    const scrollTop = e.target.scrollTop;
    setIsHeaderCollapsed(scrollTop > 100);
  }, []);

  // Reset header collapse and tab when navigating away from artist page or to new artist
  useEffect(() => {
    setIsHeaderCollapsed(false);
    setArtistPageTab('music');
    setArtistBio(null);
    setRelatedArtists([]);
  }, [currentArtist]);

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
      const config = getResolverConfig(resolverId);
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
          const config = getResolverConfig(resolver.id);
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

  // Cache TTLs (in milliseconds)
  const CACHE_TTL = {
    albumArt: 90 * 24 * 60 * 60 * 1000,    // 90 days
    artistData: 30 * 24 * 60 * 60 * 1000,  // 30 days
    trackSources: 7 * 24 * 60 * 60 * 1000, // 7 days (track availability changes)
    artistImage: 90 * 24 * 60 * 60 * 1000  // 90 days
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
    // Skip progress tracking for streaming tracks (Spotify) - they have their own polling
    // Also skip if duration is 0 or missing to prevent infinite handleNext loop
    const isStreamingTrack = currentTrack?.sources?.spotify || currentTrack?.spotifyUri;
    const hasValidDuration = currentTrack?.duration && currentTrack.duration > 0;

    if (isPlaying && audioContext && currentTrack && !isStreamingTrack && hasValidDuration) {
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
    // Skip until we've loaded settings from storage to avoid overwriting saved settings
    if (!resolverSettingsLoaded.current) return;

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
      const config = getResolverConfig(resolverId);
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
              // Use ref to avoid stale closure in interval callback
              if (handleNextRef.current) handleNextRef.current();
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

  const clearQueue = () => {
    setCurrentQueue([]);
    console.log('🗑️ Cleared queue');
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
      // Skip resolvers that can't resolve or can't play (no point resolving if we can't play)
      if (!resolver.capabilities.resolve || !resolver.play) return;

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

    // Save current artist to history stack before loading new one (for back navigation)
    if (currentArtist && currentArtist.name !== artistName) {
      setArtistHistory(prev => [...prev, currentArtist.name]);
    }

    // Check cache first BEFORE clearing state
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

      // Fetch artist image from Spotify (async, non-blocking)
      getArtistImage(artistName).then(result => {
        if (result) {
          setArtistImage(result.url);
          setArtistImagePosition(result.facePosition || 'center 25%');
        }
      });

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
        albumArt: albumArtCache.current[release.id]?.url || null
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
      navigateTo('artist');
    } catch (error) {
      console.error('Error fetching album from search:', error);
      alert('Failed to load album. Please try again.');
    }
  };

  // Handle playlist click from search
  const handlePlaylistClick = (playlist) => {
    setSearchDrawerOpen(false);
    loadPlaylist(playlist);
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
      // Skip resolvers that can't resolve or can't play (no point resolving if we can't play)
      if (!resolver.capabilities.resolve || !resolver.play) return;

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

        // Find the best matching artist (prefer exact name match)
        const artists = data.artists?.items || [];
        let artist = artists.find(a => a.name.toLowerCase() === artistName.toLowerCase());
        if (!artist && artists.length > 0) {
          artist = artists[0]; // Fall back to first result
        }

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

  // Fetch artist biography from Last.fm (lazy loaded on Biography tab click)
  const getArtistBio = async (artistName) => {
    if (!artistName) return null;

    setLoadingBio(true);
    try {
      const apiKey = '3b09ef20686c217dbd8e2e8e5da1ec7a';
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

    setLoadingRelated(true);
    try {
      const apiKey = '3b09ef20686c217dbd8e2e8e5da1ec7a';
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

        // Step 1.5: Fetch album art for tracks that don't have it (background, non-blocking)
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
          console.log(`🔍 Resolving: ${track.artist} - ${track.title}`);

          // Resolve all sources for this track
          for (const resolverId of activeResolvers) {
            const resolver = allResolvers.find(r => r.id === resolverId);
            if (!resolver || !resolver.capabilities.resolve) continue;

            try {
              const config = getResolverConfig(resolverId);
              const resolved = await resolver.resolve(track.artist, track.title, track.album, config);

              if (resolved) {
                console.log(`  ✅ ${resolver.name}: Found match`);
                // Update the track's sources and trigger re-render
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

        console.log(`✅ Finished resolving ${tracksWithIds.length} tracks`);
      }
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

    // Update queue items with resolved sources from playlistTracks
    setCurrentQueue(prevQueue =>
      prevQueue.map(queueTrack => {
        const playlistTrack = playlistTracks.find(t => t.id === queueTrack.id);
        if (playlistTrack && Object.keys(playlistTrack.sources || {}).length > Object.keys(queueTrack.sources || {}).length) {
          // Playlist track has more sources, update the queue track
          return { ...queueTrack, sources: { ...queueTrack.sources, ...playlistTrack.sources } };
        }
        return queueTrack;
      })
    );
  }, [playlistTracks]);

  // Navigation helpers
  const navigateTo = (view) => {
    if (view !== activeView) {
      setViewHistory(prev => [...prev, view]);
      setActiveView(view);
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
        const currentResolverHash = getResolverSettingsHash();

        // Check if artist image is in cache
        const normalizedName = previousArtist.trim().toLowerCase();
        const cachedImage = artistImageCache.current[normalizedName];
        const imageCacheValid = cachedImage && (now - cachedImage.timestamp) < CACHE_TTL.artistImage;

        const cacheValid = cachedData &&
                          (now - cachedData.timestamp) < CACHE_TTL.artistData &&
                          cachedData.resolverHash === currentResolverHash;

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
        alert('Failed to parse XSPF file from URL');
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
            ? { ...p, xspf: content, title: parsed.title, creator: parsed.creator, lastUpdated: Date.now() }
            : p
        ));
        console.log(`🔄 Updated hosted playlist: ${parsed.title}`);
        return { updated: true, playlist: parsed };
      }

      // Add new hosted playlist
      const newPlaylist = {
        id: id,
        filename: null,  // No local file for hosted playlists
        title: parsed.title,
        creator: parsed.creator,
        xspf: content,
        sourceUrl: url,  // Track the source URL for updates
        lastUpdated: Date.now()
      };

      setPlaylists(prev => [...prev, newPlaylist]);

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
                const config = getResolverConfig(resolverId);
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
        className: 'w-64 bg-gray-50 border-r border-gray-200 flex flex-col no-drag'
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

        // Search
        React.createElement('div', { className: 'px-4 py-2' },
          React.createElement('div', {
            className: 'flex items-center gap-2 text-gray-500 hover:text-gray-700 cursor-pointer',
            onClick: () => document.getElementById('sidebar-search')?.focus()
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
            ),
            React.createElement('input', {
              id: 'sidebar-search',
              type: 'text',
              placeholder: 'Search',
              value: searchQuery,
              onChange: (e) => handleSearchInput(e.target.value),
              className: 'flex-1 bg-transparent border-none outline-none text-sm text-gray-700 placeholder-gray-400'
            })
          )
        ),

        // Scrollable navigation area
        React.createElement('div', { className: 'flex-1 overflow-y-auto scrollable-content px-2 py-2' },
          // DISCOVER section
          React.createElement('div', { className: 'mb-4' },
            React.createElement('div', { className: 'px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Discover'),
            React.createElement('button', {
              onClick: () => navigateTo('discover'),
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeView === 'discover' ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'
              }`
            }, 'Charts'),
            React.createElement('button', {
              onClick: () => navigateTo('new-releases'),
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeView === 'new-releases' ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'
              }`
            }, 'New Releases')
          ),

          // YOUR MUSIC section
          React.createElement('div', { className: 'mb-4' },
            React.createElement('div', { className: 'px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Your Music'),
            React.createElement('button', {
              onClick: () => navigateTo('library'),
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeView === 'library' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`
            },
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' })
              ),
              'Collection'
            ),
            React.createElement('button', {
              onClick: () => navigateTo('playlists'),
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeView === 'playlists' || activeView === 'playlist-view' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`
            },
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 6h16M4 10h16M4 14h16M4 18h16' })
              ),
              'Playlists'
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

      // Main content area
      React.createElement('div', {
        className: 'flex-1 flex flex-col overflow-hidden bg-white'
      },

    // External Track Prompt Modal
    showExternalPrompt && pendingExternalTrack && React.createElement('div', {
      className: 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'
    },
      React.createElement('div', {
        className: 'bg-white rounded-lg p-8 max-w-md w-full mx-4 border border-gray-200 shadow-xl'
      },
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

    // Search Drawer - slides down from top
    searchDrawerOpen && React.createElement('div', {
      className: `fixed left-64 right-0 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-2xl transition-all duration-300 ease-in-out overflow-hidden`,
      style: {
        top: '0',
        height: '50vh',
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
                    className: 'w-full text-left p-3 rounded-lg hover:bg-gray-100 transition-colors'
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
                    className: 'w-full text-left p-2 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-3'
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
                    className: 'w-full text-left p-3 rounded-lg hover:bg-gray-100 transition-colors'
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

      // Main content area - Artist Page (completely separate layout)
      activeView === 'artist' ? React.createElement('div', { 
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Artist page hero header (not inside scrollable area) - only show when NOT viewing a release
        !currentRelease && React.createElement('div', {
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
          !loadingArtist && !loadingRelease && currentArtist && !isHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10',
            style: {
              opacity: isHeaderCollapsed ? 0 : 1,
              transition: 'opacity 300ms ease'
            }
          },
            React.createElement('h1', {
              className: 'text-5xl font-bold text-white',
              style: {
                textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                letterSpacing: '0.2em',
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
          !loadingArtist && !loadingRelease && currentArtist && isHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-16 z-10',
            style: {
              opacity: isHeaderCollapsed ? 1 : 0,
              transition: 'opacity 300ms ease'
            }
          },
            // Left side: Artist name
            React.createElement('h1', {
              className: 'text-2xl font-bold mr-6 text-white',
              style: {
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap'
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
          ref: artistPageScrollRef,
          className: 'scrollable-content',
          style: {
            flex: 1,
            overflowY: 'scroll',
            padding: '24px',
            pointerEvents: 'auto'
          },
          onScroll: handleArtistPageScroll
        },
          // MUSIC TAB - Discography
          artistPageTab === 'music' && React.createElement('div', {
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
                }, `${type.charAt(0).toUpperCase() + type.slice(1)}${type !== 'all' ? 's' : ''} (${count})`);
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
          ),

          // BIOGRAPHY TAB
          artistPageTab === 'biography' && React.createElement('div', {
            className: 'max-w-3xl mx-auto'
          },
            // Loading state
            loadingBio && React.createElement('div', { className: 'flex items-center justify-center py-12' },
              React.createElement('div', {
                className: 'w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin'
              })
            ),
            // Bio content
            !loadingBio && artistBio && React.createElement('div', { className: 'space-y-4' },
              React.createElement('div', {
                className: 'text-black leading-relaxed whitespace-pre-wrap'
              }, artistBio.bio),
              artistBio.url && React.createElement('a', {
                href: artistBio.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'inline-block mt-4 text-purple-400 hover:text-purple-300 text-sm'
              }, 'Read more on Last.fm →')
            ),
            // No bio found
            !loadingBio && !artistBio && React.createElement('div', {
              className: 'text-center py-12 text-gray-400'
            }, 'No biography available for this artist.')
          ),

          // RELATED ARTISTS TAB
          artistPageTab === 'related' && React.createElement('div', null,
            // Loading state
            loadingRelated && React.createElement('div', { className: 'flex items-center justify-center py-12' },
              React.createElement('div', {
                className: 'w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin'
              })
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
                    // Add all tracks to queue (resolved or not) - they'll resolve when played
                    if (playlistTracks.length > 0) {
                      setCurrentQueue(playlistTracks);
                      handlePlay(playlistTracks[0]);
                    }
                  },
                  disabled: playlistTracks.length === 0,
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
                    navigateBack();
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
                className: `group flex items-center gap-4 p-3 rounded-lg transition-colors hover:bg-gray-100 cursor-pointer ${
                  isResolving ? 'opacity-60' : ''
                }`,
                onClick: () => {
                  // Queue tracks AFTER the clicked track (not including it)
                  const tracksAfter = playlistTracks.slice(index + 1);
                  setCurrentQueue(tracksAfter);
                  handlePlay(track);  // Pass full track object - will resolve if needed
                }
              },
                React.createElement('div', {
                  className: 'text-xs text-gray-400 w-8 text-center',
                  style: { pointerEvents: 'none' }
                }, index + 1),
                React.createElement('div', {
                  className: 'flex-1 min-w-0',
                  style: { pointerEvents: 'none' }
                },
                  React.createElement('div', {
                    className: `text-xs font-medium truncate ${hasResolved ? 'text-gray-900' : 'text-gray-500'}`
                  }, track.title),
                  React.createElement('div', { className: 'text-xs text-gray-500 truncate' }, track.artist),
                  (() => {
                    const resolverId = determineResolverIdFromTrack(track);
                    const resolver = allResolvers.find(r => r.id === resolverId);
                    return resolver ? React.createElement('div', { className: 'text-xs text-gray-400 mt-0.5' }, `via ${resolver.name}`) : null;
                  })()
                ),
                React.createElement('div', {
                  className: 'hidden md:block text-xs text-gray-500 truncate w-48 flex-shrink-0',
                  style: { pointerEvents: 'none' }
                }, track.album || '-'),
                React.createElement('div', {
                  className: 'flex items-center justify-end gap-1.5 w-24 flex-shrink-0',
                  style: { pointerEvents: 'none' }
                },
                  isResolving ?
                    React.createElement('div', {
                      className: 'w-5 h-5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin',
                      title: 'Searching for sources...'
                    })
                  :
                    hasResolved ?
                      Object.entries(track.sources).map(([resolverId, source]) => {
                        const resolver = allResolvers.find(r => r.id === resolverId);
                        if (!resolver || !resolver.play) return null;
                        return React.createElement('button', {
                          key: resolverId,
                          className: 'no-drag',
                          onClick: (e) => {
                            e.stopPropagation();
                            // Queue tracks AFTER the clicked track (not including it)
                            const tracksAfter = playlistTracks.slice(index + 1);
                            setCurrentQueue(tracksAfter);
                            // Pass track with preferredResolver hint so queue ID is preserved
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
                          // Custom abbreviations for resolvers
                          const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM' };
                          return abbrevMap[resolverId] || resolver.name.slice(0, 2).toUpperCase();
                        })());
                      })
                    :
                      React.createElement('span', {
                        className: 'text-xs text-gray-500',
                        title: 'Not available on any service'
                      }, '❌')
                ),
                React.createElement('div', {
                  className: 'text-xs text-gray-500 w-12 text-right flex-shrink-0',
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
          library.map((track, index) =>
            React.createElement(TrackRow, {
              key: track.id,
              track: track,
              isPlaying: isPlaying && currentTrack?.id === track.id,
              handlePlay: (track) => {
                // Queue tracks AFTER the clicked track (not including it)
                const tracksAfter = library.slice(index + 1);
                setCurrentQueue(tracksAfter);
                handlePlay(track);
              },
              onArtistClick: fetchArtistData,
              allResolvers: allResolvers,
              resolverOrder: resolverOrder,
              activeResolvers: activeResolvers
            })
          )
        ),
        // Playlists View - Tomahawk/Rdio style with hero header
        activeView === 'playlists' && React.createElement('div', { className: 'flex flex-col h-full' },
          // Hero Header
          React.createElement('div', {
            className: 'relative h-64 flex-shrink-0 bg-gradient-to-b from-gray-300 to-gray-200 flex items-center justify-center overflow-hidden'
          },
            // Placeholder background image (to be replaced with actual hero image)
            React.createElement('div', {
              className: 'absolute inset-0 bg-cover bg-center opacity-60',
              style: { backgroundImage: 'url(https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&q=80)' }
            }),
            // Overlay gradient
            React.createElement('div', { className: 'absolute inset-0 bg-gradient-to-b from-transparent via-white/30 to-white/80' }),
            // Hero content
            React.createElement('div', { className: 'relative z-10 text-center' },
              React.createElement('div', { className: 'flex items-center justify-center gap-3 mb-2' },
                React.createElement('div', { className: 'w-3 h-3 bg-green-500 rounded-full' })
              ),
              React.createElement('h1', { className: 'text-4xl font-light text-gray-800 tracking-wide mb-2' }, 'PLAYLISTS'),
              React.createElement('p', { className: 'text-gray-600 mb-4' }, `${playlists.length} Playlist${playlists.length !== 1 ? 's' : ''}`),
              React.createElement('button', {
                onClick: () => setShowUrlImportDialog(true),
                className: 'inline-flex items-center gap-2 px-6 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-full transition-colors text-sm font-medium'
              },
                React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 4v16m8-8H4' })
                ),
                'Import Playlist'
              )
            )
          ),

          // Playlist tabs
          React.createElement('div', { className: 'flex items-center gap-6 px-6 py-3 border-b border-gray-200 bg-white' },
            React.createElement('button', { className: 'text-sm font-medium text-gray-900 border-b-2 border-gray-900 pb-2' }, 'PLAYLISTS'),
            React.createElement('button', { className: 'text-sm font-medium text-gray-400 pb-2 hover:text-gray-600' }, 'LAST PLAYED'),
            React.createElement('div', { className: 'flex-1' }),
            React.createElement('button', { className: 'text-gray-400 hover:text-gray-600' },
              React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
              )
            ),
            React.createElement('button', {
              onClick: () => setShowUrlImportDialog(true),
              className: 'flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600'
            },
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 4v16m8-8H4' })
              ),
              'NEW'
            )
          ),

          // Playlist grid
          React.createElement('div', { className: 'flex-1 overflow-y-auto p-6 bg-white scrollable-content' },
            playlists.length === 0 ?
              React.createElement('div', {
                className: 'text-center py-12 text-gray-400'
              }, 'No playlists yet. Import a playlist to get started!')
            :
              React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6' },
                playlists.map(playlist => {
                  // Get first 4 tracks for mosaic
                  const tracks = playlist.tracks || [];
                  const mosaicTracks = tracks.slice(0, 4);
                  const hasMosaic = mosaicTracks.length >= 4 && mosaicTracks.some(t => t.albumArt);

                  return React.createElement('div', {
                    key: playlist.id,
                    onClick: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      loadPlaylist(playlist);
                    },
                    className: 'group cursor-pointer'
                  },
                    // Album art mosaic or placeholder
                    React.createElement('div', {
                      className: 'relative aspect-square rounded-lg overflow-hidden mb-3 shadow-md group-hover:shadow-lg transition-shadow'
                    },
                      hasMosaic ?
                        // 2x2 mosaic grid
                        React.createElement('div', { className: 'grid grid-cols-2 grid-rows-2 w-full h-full' },
                          mosaicTracks.slice(0, 4).map((track, idx) =>
                            track.albumArt ?
                              React.createElement('img', {
                                key: idx,
                                src: track.albumArt,
                                alt: '',
                                className: 'w-full h-full object-cover'
                              })
                            :
                              React.createElement('div', {
                                key: idx,
                                className: 'w-full h-full bg-gray-200 flex items-center justify-center'
                              }, React.createElement(Music, { size: 20, className: 'text-gray-400' }))
                          )
                        )
                      :
                        // Placeholder
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
              )
          )
        ),
        
        activeView === 'friends' && React.createElement('div', {
          className: 'text-center py-12 text-gray-400'
        }, '👥 Connect with friends to see what they\'re listening to'),
        activeView === 'discover' && React.createElement('div', {
          className: 'text-center py-12 text-gray-400'
        }, '📻 Discover new music from trending charts'),
        activeView === 'new-releases' && React.createElement('div', {
          className: 'text-center py-12 text-gray-400'
        }, '🆕 New releases coming soon')
      )
    )
    ), // Close the sidebar + main wrapper

    // Player bar (always visible) - New Tomahawk-inspired layout
    // Layout: [Left: transport + queue] [Center: track info] [Right: progress + shuffle + repeat + volume]
    React.createElement('div', {
      className: 'bg-gray-800/90 backdrop-blur-xl border-t border-gray-700 px-4 py-3 no-drag flex-shrink-0',
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
            currentTrack.albumArt ?
              React.createElement('img', {
                key: 'album-art',
                src: currentTrack.albumArt,
                alt: currentTrack.album,
                className: 'w-12 h-12 rounded object-cover flex-shrink-0'
              })
            :
              React.createElement('div', {
                key: 'album-placeholder',
                className: 'w-12 h-12 bg-gray-700 rounded flex items-center justify-center flex-shrink-0'
              }, React.createElement(Music, { size: 20, className: 'text-gray-500' })),
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

        // RIGHT: Progress bar + Shuffle + Repeat + Volume
        React.createElement('div', { className: 'flex items-center gap-3' },
          // Progress section
          React.createElement('div', { className: 'flex items-center gap-2 min-w-[200px]' },
            React.createElement('span', { className: 'text-xs text-gray-400 w-10 text-right font-mono' },
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
                  }
                },
                className: `w-full h-1 rounded-full appearance-none ${!currentTrack || browserPlaybackActive ? 'bg-gray-700 cursor-not-allowed' : 'bg-gray-600 cursor-pointer'}`
              })
            ),
            React.createElement('span', { className: 'text-xs text-gray-400 w-10 font-mono' },
              currentTrack ? formatTime(currentTrack.duration) : '0:00'
            )
          ),
          // Shuffle button (placeholder)
          React.createElement('button', {
            disabled: true,
            className: 'p-2 rounded text-gray-600 cursor-not-allowed',
            title: 'Shuffle (coming soon)'
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
            )
          ),
          // Repeat button (placeholder)
          React.createElement('button', {
            disabled: true,
            className: 'p-2 rounded text-gray-600 cursor-not-allowed',
            title: 'Repeat (coming soon)'
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
            )
          ),
          // Volume
          React.createElement('div', { className: 'flex items-center gap-1' },
            React.createElement('span', { className: 'text-gray-400' }, React.createElement(Volume2, { size: 16 })),
            React.createElement('input', {
              type: 'range',
              min: '0',
              max: '100',
              value: volume,
              onChange: (e) => setVolume(Number(e.target.value)),
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
                alert(result.updated
                  ? `🔄 Updated playlist: ${result.playlist.title}`
                  : `✅ Imported playlist: ${result.playlist.title}`
                );
              } catch (error) {
                alert(`❌ Failed to import: ${error.message}`);
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

    // Queue Drawer
    React.createElement('div', {
      className: 'fixed left-0 right-0 bg-white border-t border-gray-200 shadow-2xl transition-all duration-300 ease-in-out z-40',
      style: {
        bottom: queueDrawerOpen ? 0 : -queueDrawerHeight,
        height: queueDrawerHeight + 'px'
      }
    },
      // Drawer header with drag handle
      React.createElement('div', {
        className: 'flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 cursor-ns-resize',
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
            className: 'w-8 h-1 bg-gray-300 rounded-full'
          }),
          React.createElement('span', {
            className: 'text-sm font-medium text-gray-900'
          }, 'Queue'),
          React.createElement('span', {
            className: 'text-xs text-gray-500'
          }, `${currentQueue.length} track${currentQueue.length !== 1 ? 's' : ''}`)
        ),
        React.createElement('div', {
          className: 'flex items-center gap-2'
        },
          currentQueue.length > 0 && React.createElement('button', {
            onClick: clearQueue,
            className: 'text-xs text-gray-500 hover:text-gray-900 px-2 py-1 hover:bg-gray-200 rounded transition-colors'
          }, 'Clear'),
          React.createElement('button', {
            onClick: () => setQueueDrawerOpen(false),
            className: 'p-1 hover:bg-gray-200 rounded transition-colors text-gray-500 hover:text-gray-700'
          }, React.createElement(X))
        )
      ),

      // Queue content
      React.createElement('div', {
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
            className: 'flex flex-col items-center justify-center h-full text-gray-400'
          },
            React.createElement('span', { className: 'text-4xl mb-2' }, '🎵'),
            React.createElement('span', { className: 'text-gray-600' }, 'Queue is empty'),
            React.createElement('span', { className: 'text-sm text-gray-400 mt-1' }, 'Play a playlist to add tracks')
          )
        :
          React.createElement('div', { className: 'divide-y divide-gray-100' },
            currentQueue.map((track, index) => {
              const isCurrentTrack = currentTrack?.id === track.id;
              const isLoading = track.status === 'loading';
              const isError = track.status === 'error';
              const availableSources = Object.keys(track.sources || {});

              return React.createElement('div', {
                key: track.id,
                draggable: !isLoading && !isError,
                onDragStart: () => !isLoading && !isError && setDraggedQueueTrack(index),
                onDragOver: (e) => e.preventDefault(),
                onDrop: () => {
                  if (draggedQueueTrack !== null && draggedQueueTrack !== index) {
                    moveInQueue(draggedQueueTrack, index);
                  }
                  setDraggedQueueTrack(null);
                },
                onDragEnd: () => setDraggedQueueTrack(null),
                className: `flex items-center gap-3 px-4 py-2 hover:bg-gray-50 transition-colors ${
                  isCurrentTrack ? 'bg-purple-50' : ''
                } ${draggedQueueTrack === index ? 'opacity-50' : ''} ${
                  isError ? 'opacity-50' : ''
                } ${isLoading || isError ? '' : 'cursor-grab active:cursor-grabbing'}`
              },
                // Track number / status indicator
                React.createElement('div', {
                  className: 'w-6 text-center text-gray-500 text-sm flex-shrink-0'
                },
                  isLoading ? React.createElement('span', { className: 'animate-spin inline-block' }, '◌') :
                  isError ? '⚠' :
                  isCurrentTrack ? '▶' : index + 1
                ),

                // Track info
                React.createElement('div', {
                  className: `flex-1 min-w-0 ${isLoading || isError ? '' : 'cursor-pointer'}`,
                  onClick: () => !isLoading && !isError && handlePlay(track)
                },
                  isLoading ?
                    React.createElement('div', null,
                      React.createElement('div', {
                        className: 'font-medium text-gray-500'
                      }, 'Loading...'),
                      React.createElement('div', {
                        className: 'text-sm text-gray-400 truncate'
                      }, `from ${track.sourceDomain || 'unknown'}`)
                    )
                  : isError ?
                    React.createElement('div', null,
                      React.createElement('div', {
                        className: 'font-medium text-red-500'
                      }, 'Could not load track'),
                      React.createElement('div', {
                        className: 'text-sm text-gray-400 truncate'
                      }, track.errorMessage || 'Unknown error')
                    )
                  :
                    React.createElement('div', null,
                      React.createElement('div', {
                        className: `font-medium truncate ${isCurrentTrack ? 'text-purple-600' : 'text-gray-900'}`
                      }, track.title),
                      React.createElement('div', {
                        className: 'text-sm text-gray-500 truncate'
                      }, track.artist)
                    )
                ),

                // Action buttons (right side)
                isError ?
                  React.createElement('div', {
                    className: 'flex items-center gap-1 flex-shrink-0'
                  },
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        if (track.sourceUrl) {
                          removeFromQueue(track.id);
                          handleUrlDrop(track.sourceUrl, 'queue');
                        }
                      },
                      className: 'px-2 py-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors',
                      title: 'Retry'
                    }, '↻ Retry'),
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        removeFromQueue(track.id);
                      },
                      className: 'flex-shrink-0 p-1 text-gray-400 hover:text-red-500 hover:bg-gray-200 rounded transition-colors',
                      title: 'Remove from queue'
                    }, React.createElement(X, { size: 16 }))
                  )
                : isLoading ?
                  React.createElement('button', {
                    onClick: (e) => {
                      e.stopPropagation();
                      removeFromQueue(track.id);
                    },
                    className: 'flex-shrink-0 p-1 text-gray-400 hover:text-red-500 hover:bg-gray-200 rounded transition-colors',
                    title: 'Cancel'
                  }, React.createElement(X, { size: 16 }))
                :
                  React.createElement(React.Fragment, null,
                    React.createElement('div', {
                      className: 'flex items-center gap-1.5 flex-shrink-0'
                    },
                      availableSources.length > 0 ?
                        availableSources.map(resolverId => {
                          const resolver = allResolvers.find(r => r.id === resolverId);
                          if (!resolver) return null;
                          const abbrevMap = { spotify: 'SP', bandcamp: 'BC', youtube: 'YT', qobuz: 'QZ', applemusic: 'AM' };
                          const abbrev = abbrevMap[resolverId] || resolver.name.slice(0, 2).toUpperCase();
                          return React.createElement('button', {
                            key: resolverId,
                            onClick: (e) => {
                              e.stopPropagation();
                              handlePlay({ ...track, preferredResolver: resolverId });
                            },
                            className: 'w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold text-white hover:scale-110 transition-transform cursor-pointer',
                            style: { backgroundColor: resolver.color },
                            title: `Play via ${resolver.name}`
                          }, abbrev);
                        })
                      :
                        React.createElement('span', {
                          className: 'text-xs text-gray-500'
                        }, '—')
                    ),
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        removeFromQueue(track.id);
                      },
                      className: 'flex-shrink-0 p-1 text-gray-400 hover:text-red-500 hover:bg-gray-200 rounded transition-colors',
                      title: 'Remove from queue'
                    }, React.createElement(X, { size: 16 }))
                  )
              );
            })
          )
      )
    )
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(Parachord));