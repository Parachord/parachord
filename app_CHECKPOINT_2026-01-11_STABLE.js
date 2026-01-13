// Harmonix Desktop App - Electron Version
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

// TrackRow component - defined outside to prevent recreation on every render
const TrackRow = React.memo(({ track, isPlaying, handlePlay, onArtistClick }) => {
  const isSpotifyTrack = track.sources?.includes('spotify');
  const isMusicBrainzTrack = track.sources?.includes('musicbrainz');
  const isBandcampTrack = track.sources?.includes('bandcamp');
  const isQobuzTrack = track.sources?.includes('qobuz');
  
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
        isSpotifyTrack && React.createElement('span', {
          className: 'text-xs px-2 py-0.5 bg-green-600/20 text-green-400 rounded-full'
        }, '♫ Spotify'),
        isMusicBrainzTrack && React.createElement('span', {
          className: 'text-xs px-2 py-0.5 bg-purple-600/20 text-purple-400 rounded-full'
        }, '♪ MusicBrainz'),
        isBandcampTrack && React.createElement('span', {
          className: 'text-xs px-2 py-0.5 bg-cyan-600/20 text-cyan-400 rounded-full'
        }, '▶ Bandcamp'),
        isQobuzTrack && React.createElement('span', {
          className: 'text-xs px-2 py-0.5 bg-blue-600/20 text-blue-400 rounded-full'
        }, '◆ Qobuz')
      )
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
const ReleasePage = ({ release, handleSearch }) => {
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
          React.createElement('div', {},
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
          release.tracks.map((track, index) => 
            React.createElement('div', {
              key: index,
              className: 'flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors no-drag group',
              onClick: () => {
                console.log('Playing track:', track.title);
                handleSearch(`${release.artist.name} ${track.title}`);
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
            )
          )
        )
      :
        React.createElement('div', { className: 'text-center py-12 text-gray-400' },
          'No track information available'
        )
    )
  );
};

const Harmonix = () => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(70);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [resultFilters, setResultFilters] = useState([]); // Which resolvers to show in results
  const [activeView, setActiveView] = useState('library');
  const [currentArtist, setCurrentArtist] = useState(null); // Artist page data
  const [artistReleases, setArtistReleases] = useState([]); // Discography
  const [releaseTypeFilter, setReleaseTypeFilter] = useState('all'); // all, album, ep, single
  const [loadingArtist, setLoadingArtist] = useState(false);
  const [currentRelease, setCurrentRelease] = useState(null); // Release/Album page data
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [activeResolvers, setActiveResolvers] = useState(['youtube', 'soundcloud', 'musicbrainz', 'bandcamp', 'qobuz']);
  const [library, setLibrary] = useState([]);
  const [audioContext, setAudioContext] = useState(null);
  const [currentSource, setCurrentSource] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [qobuzToken, setQobuzToken] = useState(null);
  const [qobuzConnected, setQobuzConnected] = useState(false);

  // Cache for album art URLs (releaseId -> imageUrl)
  const albumArtCache = useRef({});

  const sampleTracks = [
    { id: 1, title: 'Midnight Dreams', artist: 'Luna Echo', album: 'Nocturnal', duration: 245, sources: ['youtube', 'soundcloud'] },
    { id: 2, title: 'Electric Pulse', artist: 'Neon Waves', album: 'Synthwave', duration: 198, sources: ['youtube'] },
    { id: 3, title: 'Ocean Breeze', artist: 'Coastal Drift', album: 'Tides', duration: 267, sources: ['soundcloud', 'youtube'] },
    { id: 4, title: 'Urban Nights', artist: 'City Lights', album: 'Metropolitan', duration: 223, sources: ['youtube'] },
    { id: 5, title: 'Forest Path', artist: 'Nature Sound', album: 'Wilderness', duration: 301, sources: ['youtube', 'soundcloud'] },
  ];

  const resolvers = [
    { id: 'youtube', name: 'YouTube', color: '#FF0000' },
    { id: 'soundcloud', name: 'SoundCloud', color: '#FF5500' },
    { id: 'spotify', name: 'Spotify', color: '#1DB954' },
    { id: 'musicbrainz', name: 'MusicBrainz', color: '#BA478F' },
    { id: 'bandcamp', name: 'Bandcamp', color: '#629AA9' },
    { id: 'qobuz', name: 'Qobuz', color: '#0E7EBF' },
  ];

  const SPOTIFY_CLIENT_ID = 'c040c0ee133344b282e6342198bcbeea';

  useEffect(() => {
    setLibrary(sampleTracks);
    const context = new (window.AudioContext || window.webkitAudioContext)();
    setAudioContext(context);
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

  const handlePlay = async (track) => {
    console.log('=== HANDLEPLAY DEBUG ===');
    console.log('Play track:', track);
    console.log('window.electron available:', !!window.electron);
    console.log('window.electron.shell available:', !!window.electron?.shell);
    console.log('window.electron.shell.openExternal available:', !!window.electron?.shell?.openExternal);
    
    // Check if this is a Bandcamp track (open in browser)
    if (track.sources?.includes('bandcamp') && track.bandcampUrl) {
      console.log('Bandcamp track detected, URL:', track.bandcampUrl);
      
      let opened = false;
      
      // Try Electron shell first
      if (window.electron?.shell?.openExternal) {
        try {
          console.log('Trying Electron shell.openExternal...');
          const result = await window.electron.shell.openExternal(track.bandcampUrl);
          console.log('Shell.openExternal result:', result);
          
          if (result && result.success) {
            console.log('✅ Opened Bandcamp URL via Electron shell');
            opened = true;
          } else {
            console.error('❌ Shell returned failure:', result?.error);
          }
        } catch (error) {
          console.error('❌ Electron shell.openExternal failed:', error);
          console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
          });
          // Will try fallback below
        }
      }
      
      // Fallback to window.open if shell failed or unavailable
      if (!opened) {
        try {
          console.log('Using window.open fallback...');
          const newWindow = window.open(track.bandcampUrl, '_blank');
          if (newWindow) {
            console.log('✅ Opened Bandcamp URL via window.open');
          } else {
            console.error('❌ window.open was blocked (popup blocker?)');
            alert('Could not open Bandcamp link. Please allow popups or copy the URL:\n' + track.bandcampUrl);
          }
        } catch (error) {
          console.error('❌ window.open also failed:', error);
          alert('Failed to open Bandcamp link. Please copy this URL manually:\n' + track.bandcampUrl);
        }
      }
      
      return;
    }
    
    // Check if this is a Qobuz track (preview playback)
    if (track.sources?.includes('qobuz') && track.previewUrl) {
      console.log('Qobuz track detected with preview URL');
      // Play the 30-second preview using HTML5 Audio
      if (!audioContext) {
        console.log('Initializing audio context for Qobuz preview');
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        setAudioContext(ctx);
      }
      
      // Use HTML5 Audio element for streaming preview
      const audio = new Audio(track.previewUrl);
      audio.volume = volume / 100;
      
      audio.addEventListener('loadedmetadata', () => {
        console.log('Qobuz preview loaded, duration:', audio.duration);
        setCurrentTrack(track);
        setIsPlaying(true);
        setProgress(0);
        audio.play().catch(err => {
          console.error('Failed to play Qobuz preview:', err);
          alert('Failed to play Qobuz preview. This is a 30-second sample.');
        });
      });
      
      audio.addEventListener('timeupdate', () => {
        setProgress(audio.currentTime);
      });
      
      audio.addEventListener('ended', () => {
        console.log('Qobuz preview ended (30 seconds)');
        setIsPlaying(false);
        handleNext();
      });
      
      return;
    }
    
    // Check if this is a MusicBrainz track (metadata only, no playback)
    if (track.sources?.includes('musicbrainz') && !track.spotifyUri) {
      alert('MusicBrainz provides metadata only. Try searching for this track on Spotify to play it, or enable other resolvers like YouTube.');
      return;
    }
    
    // Check if this is a Spotify track
    const isSpotifyTrack = track.sources?.includes('spotify') || track.spotifyUri;
    
    if (isSpotifyTrack && spotifyToken) {
      // Play via Spotify Connect (controls external Spotify clients)
      const success = await playOnSpotifyConnect(track);
      if (!success) {
        console.log('Spotify Connect playback failed');
      }
    } else {
      // Play local/demo track with Web Audio API
      if (!audioContext) return;
      setCurrentTrack(track);
      setProgress(0);
      setIsPlaying(true);
      if (audioContext.state === 'suspended') await audioContext.resume();
      playDemoAudio(track);
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
      // Local track - find next in library
      const currentIndex = library.findIndex(t => t.id === currentTrack?.id);
      const nextTrack = library[(currentIndex + 1) % library.length];
      handlePlay(nextTrack);
    }
  };

  const handlePrevious = async () => {
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
      // Local track - find previous in library
      const currentIndex = library.findIndex(t => t.id === currentTrack?.id);
      const prevTrack = library[(currentIndex - 1 + library.length) % library.length];
      handlePlay(prevTrack);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    
    // Initialize filters with all active resolvers when starting a new search
    if (query.trim()) {
      setResultFilters(activeResolvers.slice()); // Copy of active resolvers
      setIsSearching(true);
      
      // Search local library
      const localResults = library.filter(track =>
        track.title.toLowerCase().includes(query.toLowerCase()) ||
        track.artist.toLowerCase().includes(query.toLowerCase())
      );
      
      // Search all enabled resolvers in parallel
      const searchPromises = [];
      
      if (activeResolvers.includes('spotify') && spotifyToken) {
        searchPromises.push(searchSpotify(query));
      }
      
      if (activeResolvers.includes('musicbrainz')) {
        searchPromises.push(searchMusicBrainz(query));
      }
      
      if (activeResolvers.includes('bandcamp')) {
        searchPromises.push(searchBandcamp(query));
      }
      
      if (activeResolvers.includes('qobuz')) {
        searchPromises.push(searchQobuz(query));
      }
      
      try {
        const results = await Promise.all(searchPromises);
        const allRemoteResults = results.flat();
        
        // Combine local and remote results
        const combined = [...localResults, ...allRemoteResults];
        setSearchResults(combined);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults(localResults); // Fall back to local only
      }
      
      setIsSearching(false);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }
  };

  const searchSpotify = async (query) => {
    if (!spotifyToken) return [];
    
    try {
      const response = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=20`,
        {
          headers: {
            'Authorization': `Bearer ${spotifyToken}`
          }
        }
      );
      
      if (!response.ok) {
        console.error('Spotify search failed:', response.status);
        return [];
      }
      
      const data = await response.json();
      
      // Convert Spotify tracks to our format
      return data.tracks.items.map(track => ({
        id: `spotify-${track.id}`,
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        album: track.album.name,
        duration: Math.floor(track.duration_ms / 1000),
        sources: ['spotify'],
        spotifyUri: track.uri,
        spotifyId: track.id,
        albumArt: track.album.images[0]?.url
      }));
    } catch (error) {
      console.error('Spotify search error:', error);
      return [];
    }
  };

  const searchMusicBrainz = async (query) => {
    try {
      const response = await fetch(
        `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&limit=20&fmt=json`,
        {
          headers: {
            'User-Agent': 'Harmonix/1.0.0 (https://github.com/harmonix)'
          }
        }
      );
      
      if (!response.ok) {
        console.error('MusicBrainz search failed:', response.status);
        return [];
      }
      
      const data = await response.json();
      
      // Convert MusicBrainz recordings to our format
      return data.recordings.map(recording => ({
        id: `musicbrainz-${recording.id}`,
        title: recording.title,
        artist: recording['artist-credit']?.map(ac => ac.name).join(', ') || 'Unknown Artist',
        album: recording.releases?.[0]?.title || 'Unknown Album',
        duration: recording.length ? Math.floor(recording.length / 1000) : 180, // default 3 min if unknown
        sources: ['musicbrainz'],
        musicbrainzId: recording.id
      }));
    } catch (error) {
      console.error('MusicBrainz search error:', error);
      return [];
    }
  };

  const searchBandcamp = async (query) => {
    try {
      console.log('Searching Bandcamp for:', query);
      
      // Note: Bandcamp doesn't have a public API, so we scrape search results
      // This may be blocked by CORS in some environments
      const response = await fetch(
        `https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=t`,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        }
      );
      
      if (!response.ok) {
        console.error('Bandcamp search failed:', response.status);
        return [];
      }
      
      const html = await response.text();
      
      // Parse Bandcamp search results from HTML
      const results = [];
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Bandcamp search results are in .searchresult items
      const searchResults = doc.querySelectorAll('.searchresult');
      
      searchResults.forEach((item, index) => {
        if (index >= 20) return; // Limit to 20 results
        
        try {
          const heading = item.querySelector('.heading');
          const subhead = item.querySelector('.subhead');
          const itemUrl = item.querySelector('.itemurl');
          
          if (heading && itemUrl) {
            const title = heading.textContent.trim();
            const artistInfo = subhead ? subhead.textContent.trim() : 'Unknown Artist';
            // Extract artist and album from "by Artist, from Album" or "by Artist" format
            const byMatch = artistInfo.match(/by\s+([^,]+)/);
            const fromMatch = artistInfo.match(/from\s+(.+)/);
            
            const artist = byMatch ? byMatch[1].trim() : 'Unknown Artist';
            const album = fromMatch ? fromMatch[1].trim() : (byMatch ? byMatch[1].trim() : 'Single');
            const url = itemUrl.textContent.trim();
            
            results.push({
              id: `bandcamp-${Date.now()}-${index}`,
              title: title,
              artist: artist,
              album: album,
              duration: 210, // Default 3:30 (Bandcamp doesn't expose duration in search)
              sources: ['bandcamp'],
              bandcampUrl: url
            });
          }
        } catch (itemError) {
          console.error('Error parsing Bandcamp result:', itemError);
        }
      });
      
      console.log(`Found ${results.length} Bandcamp results`);
      return results;
    } catch (error) {
      console.error('Bandcamp search error:', error);
      console.log('Note: Bandcamp search may be blocked by CORS. This is expected in some environments.');
      // Return empty array gracefully - other resolvers will still work
      return [];
    }
  };

  const searchQobuz = async (query) => {
    try {
      console.log('Searching Qobuz for:', query);
      
      // Qobuz requires app_id for API access
      // For now, we'll use the public demo credentials
      // Users should get their own from https://github.com/Qobuz/api-documentation
      const appId = '285473059'; // Public demo app_id
      
      const response = await fetch(
        `https://www.qobuz.com/api.json/0.2/track/search?query=${encodeURIComponent(query)}&limit=20&app_id=${appId}`,
        {
          headers: {
            'User-Agent': 'Harmonix/1.0.0'
          }
        }
      );
      
      if (!response.ok) {
        console.error('Qobuz search failed:', response.status);
        return [];
      }
      
      const data = await response.json();
      
      if (!data.tracks || !data.tracks.items) {
        console.log('No Qobuz results found');
        return [];
      }
      
      // Convert Qobuz tracks to our format
      const results = data.tracks.items.map(track => ({
        id: `qobuz-${track.id}`,
        title: track.title,
        artist: track.performer?.name || track.album?.artist?.name || 'Unknown Artist',
        album: track.album?.title || 'Unknown Album',
        duration: track.duration || 180,
        sources: ['qobuz'],
        qobuzId: track.id,
        albumArt: track.album?.image?.small || track.album?.image?.thumbnail,
        previewUrl: track.preview_url, // 30-second preview
        streamable: track.streamable, // Full stream requires subscription
        quality: track.maximum_bit_depth ? `${track.maximum_bit_depth}bit/${track.maximum_sampling_rate}kHz` : 'CD Quality'
      }));
      
      console.log(`Found ${results.length} Qobuz results`);
      return results;
    } catch (error) {
      console.error('Qobuz search error:', error);
      return [];
    }
  };

  // Fetch artist data and discography from MusicBrainz
  const fetchArtistData = async (artistName) => {
    console.log('Fetching artist data for:', artistName);
    setLoadingArtist(true);
    setActiveView('artist'); // Show artist page immediately with loading animation
    
    try {
      // Step 1: Search for artist by name to get MBID
      const searchResponse = await fetch(
        `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(artistName)}&fmt=json&limit=1`,
        {
          headers: {
            'User-Agent': 'Harmonix/1.0.0 (https://github.com/harmonix)'
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
              'User-Agent': 'Harmonix/1.0.0 (https://github.com/harmonix)'
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
      
      // Sort by date (newest first)
      allReleases.sort((a, b) => {
        const dateA = a.date || '0000';
        const dateB = b.date || '0000';
        return dateB.localeCompare(dateA);
      });
      
      setCurrentArtist({
        name: artist.name,
        mbid: artist.id,
        country: artist.country,
        disambiguation: artist.disambiguation,
        type: artist.type
      });
      
      // Pre-populate releases with cached album art
      const releasesWithCache = allReleases.map(release => ({
        ...release,
        albumArt: albumArtCache.current[release.id] || null
      }));
      
      // Show page immediately (with cached album art if available)
      setArtistReleases(releasesWithCache);
      setLoadingArtist(false);
      
      // Fetch album art in background (lazy loading) - only for releases without cache
      fetchAlbumArtLazy(allReleases);
      
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
      
      // Fetch full release details including recordings (tracks)
      const releaseResponse = await fetch(
        `https://musicbrainz.org/ws/2/release/${release.id}?inc=recordings+artist-credits&fmt=json`,
        { 
          headers: { 'User-Agent': 'Harmonix/1.0.0 (https://github.com/harmonix)' }
        }
      );
      
      if (!releaseResponse.ok) {
        throw new Error('Release not found');
      }
      
      const releaseData = await releaseResponse.json();
      
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
          `https://coverartarchive.org/release/${release.id}`,
          { headers: { 'User-Agent': 'Harmonix/1.0.0 (https://github.com/harmonix)' }}
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
      
    } catch (error) {
      console.error('Error fetching release data:', error);
      alert('Failed to load release data. Please try again.');
      setLoadingRelease(false);
    }
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
            headers: { 'User-Agent': 'Harmonix/1.0.0 (https://github.com/harmonix)' }
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

  const toggleResultFilter = (resolverId) => {
    setResultFilters(prev => {
      if (prev.includes(resolverId)) {
        // Remove from filters
        const newFilters = prev.filter(id => id !== resolverId);
        // If removing the last filter, reset to show all
        if (newFilters.length === 0) {
          return activeResolvers.slice();
        }
        return newFilters;
      } else {
        // Add to filters
        return [...prev, resolverId];
      }
    });
  };

  // Filter results based on selected resolvers
  const getFilteredResults = () => {
    if (!searchQuery) return library;
    
    // If all resolvers are active (no filtering), show all results
    if (resultFilters.length === activeResolvers.length || resultFilters.length === 0) {
      return searchResults;
    }
    
    // Filter results to only show tracks from selected resolvers
    return searchResults.filter(track => {
      // Check if track is from any of the selected resolvers
      return track.sources?.some(source => resultFilters.includes(source));
    });
  };

  // Add Spotify authentication functions
  const checkSpotifyToken = async () => {
    console.log('Checking Spotify token...');
    if (window.electron?.spotify) {
      const tokenData = await window.electron.spotify.checkToken();
      console.log('Token data:', tokenData);
      if (tokenData) {
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
      console.log('Spotify auth success!', data);
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
    
    // Find active device or use first available
    const activeDevice = devices.find(d => d.is_active) || devices[0];
    console.log('Using device:', activeDevice.name);
    
    // Play track on device
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
      alert(`Failed to play on Spotify. Error: ${response.status}`);
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
    // Header (draggable window area)
    React.createElement('div', {
      className: 'flex items-center justify-between p-4 border-b border-white/10',
      style: { WebkitAppRegion: 'drag' }
    },
      React.createElement('div', { className: 'flex items-center gap-3' },
        React.createElement('div', {
          className: 'w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center text-2xl'
        }, React.createElement(Music))
      ),
      React.createElement('div', { className: 'flex-1 max-w-2xl mx-8 no-drag' },
        React.createElement('input', {
          type: 'text',
          placeholder: 'Search music...',
          value: searchQuery,
          onChange: (e) => handleSearch(e.target.value),
          className: 'w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500'
        })
      ),
      React.createElement('button', {
        onClick: () => setShowSettings(!showSettings),
        className: 'p-2 hover:bg-white/10 rounded-lg transition-colors text-xl no-drag'
      }, React.createElement(Settings))
    ),

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
            handleSearch: handleSearch
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
      
      // Main content area - Normal views (Library, Search, etc.)
      : React.createElement('div', { 
        className: 'flex-1 overflow-y-auto p-6 scrollable-content',
        style: { minHeight: 0, flexBasis: 0 }
      },
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('h2', { className: 'text-2xl font-bold' }, 
            searchQuery ? 'Search Results' : 
            activeView === 'library' ? 'My Library' : 
            activeView === 'playlists' ? 'Playlists' : 
            activeView === 'friends' ? 'Friends' : 
            'Discover'
          ),
          // Show active resolvers when searching - now clickable filters
          searchQuery && React.createElement('div', { className: 'flex items-center gap-3 text-xs' },
            React.createElement('span', { className: 'text-gray-400' }, 'Filter:'),
            React.createElement('div', { className: 'flex items-center gap-2' },
              activeResolvers.map(resolverId => {
                const resolver = resolvers.find(r => r.id === resolverId);
                const isActive = resultFilters.includes(resolverId);
                return React.createElement('button', {
                  key: resolverId,
                  onClick: () => toggleResultFilter(resolverId),
                  className: `px-2 py-1 rounded-full transition-all cursor-pointer hover:scale-105 ${
                    isActive ? '' : 'opacity-30 grayscale'
                  }`,
                  style: { 
                    backgroundColor: resolver.color + '33', 
                    color: resolver.color,
                    border: isActive ? `2px solid ${resolver.color}` : '2px solid transparent'
                  },
                  title: isActive ? `Hide ${resolver.name} results` : `Show ${resolver.name} results`
                }, resolver.name);
              })
            ),
            // Show result count and reset button
            !isSearching && React.createElement('div', { className: 'flex items-center gap-2 ml-2' },
              React.createElement('span', { className: 'text-gray-500' }, 
                `${getFilteredResults().length}${resultFilters.length < activeResolvers.length ? `/${searchResults.length}` : ''} results`
              ),
              resultFilters.length < activeResolvers.length && React.createElement('button', {
                onClick: () => setResultFilters(activeResolvers.slice()),
                className: 'text-purple-400 hover:text-purple-300 underline',
                title: 'Show all results'
              }, 'show all')
            )
          )
        ),
        // Loading indicator
        isSearching && React.createElement('div', { className: 'text-center py-8 text-gray-400' },
          React.createElement('div', { className: 'animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-2' }),
          React.createElement('div', null, 'Searching...')
        ),
        // Library/Search results
        activeView === 'library' && !isSearching && React.createElement('div', { className: 'space-y-2' },
          getFilteredResults().length === 0 && searchQuery ?
            React.createElement('div', { className: 'text-center py-12 text-gray-400' },
              resultFilters.length < activeResolvers.length ? 
                '🔍 No results from selected sources. Try clicking more filter badges above.' :
                '🔍 No results found for "' + searchQuery + '"'
            )
          :
          getFilteredResults().map(track =>
            React.createElement(TrackRow, {
              key: track.id,
              track: track,
              isPlaying: isPlaying && currentTrack?.id === track.id,
              handlePlay: handlePlay,
              onArtistClick: fetchArtistData
            })
          )
        ),
        activeView === 'playlists' && React.createElement('div', {
          className: 'text-center py-12 text-gray-400'
        }, '🎵 No playlists yet. Create your first playlist!'),
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
              currentTrack.artist,
              currentTrack.sources?.includes('spotify') && React.createElement('span', {
                className: 'text-xs px-2 py-0.5 bg-green-600/20 text-green-400 rounded-full'
              }, '♫ Spotify')
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
    ),

    // Settings Modal
    showSettings && React.createElement('div', {
      className: 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50'
    },
      React.createElement('div', {
        className: 'bg-slate-800 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto'
      },
        React.createElement('div', {
          className: 'flex items-center justify-between mb-6'
        },
          React.createElement('h2', { className: 'text-2xl font-bold' }, 'Settings'),
          React.createElement('button', {
            onClick: () => setShowSettings(false),
            className: 'p-2 hover:bg-white/10 rounded-lg transition-colors text-xl'
          }, React.createElement(X))
        ),
        
        // Content Resolvers Section
        React.createElement('div', { className: 'space-y-6' },
          React.createElement('div', null,
            React.createElement('h3', { className: 'text-lg font-semibold mb-4' }, 'Content Resolvers'),
            React.createElement('p', { className: 'text-sm text-gray-400 mb-4' },
              'Harmonix searches across multiple music sources to find the best available stream for each track. Enable or disable resolvers based on your preferences.'
            ),
            React.createElement('div', { className: 'space-y-3' },
              ...resolvers.map(resolver =>
                React.createElement('div', {
                  key: resolver.id,
                  className: 'flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10'
                },
                  React.createElement('div', { className: 'flex items-center gap-3' },
                    React.createElement('div', {
                      className: 'w-4 h-4 rounded-full',
                      style: { backgroundColor: resolver.color }
                    }),
                    React.createElement('div', null,
                      React.createElement('div', { className: 'font-medium' }, resolver.name),
                      React.createElement('div', { className: 'text-xs text-gray-400' },
                        activeResolvers.includes(resolver.id) ? 'Active' : 'Disabled'
                      )
                    )
                  ),
                  React.createElement('label', { className: 'relative inline-block w-12 h-6' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: activeResolvers.includes(resolver.id),
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
              )
            )
          ),
          
          // How It Works Section
          React.createElement('div', null,
            React.createElement('h3', { className: 'text-lg font-semibold mb-4' }, 'How It Works'),
            React.createElement('div', { className: 'bg-white/5 rounded-lg p-4 space-y-2 text-sm text-gray-300' },
              React.createElement('p', null,
                React.createElement('strong', null, 'Multi-Source Resolution: '),
                'When you search for or play a track, Harmonix queries all enabled resolvers simultaneously to find the best available source.'
              ),
              React.createElement('p', null,
                React.createElement('strong', null, 'Quality Priority: '),
                'If a track is available on multiple services, Harmonix automatically selects the highest quality stream from your active resolvers.'
              ),
              React.createElement('p', null,
                React.createElement('strong', null, 'Metadata Decoupling: '),
                'Your library stores metadata (title, artist, album) separately from the audio source, allowing seamless switching between services.'
              )
            )
          ),
          
          // About Section
          React.createElement('div', null,
            React.createElement('h3', { className: 'text-lg font-semibold mb-4' }, 'About'),
            React.createElement('div', { className: 'text-sm text-gray-400 space-y-2' },
              React.createElement('p', null, 'Harmonix Desktop v1.0.0'),
              React.createElement('p', null, 'A modern multi-source music player inspired by Tomahawk.'),
              React.createElement('p', null, 
                'Built with Electron, React, and Tailwind CSS.'
              )
            )
          )
        )
      )
    )
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(Harmonix));