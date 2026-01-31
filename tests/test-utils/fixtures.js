/**
 * Test Fixtures for Parachord
 * Common test data and scenarios
 */

/**
 * Resolver configurations
 */
const resolverConfigs = {
  spotify: {
    id: 'spotify',
    name: 'Spotify',
    capabilities: { resolve: true, search: true, stream: false },
    priority: 1
  },
  localfiles: {
    id: 'localfiles',
    name: 'Local Files',
    capabilities: { resolve: true, search: true, stream: true },
    priority: 0
  },
  soundcloud: {
    id: 'soundcloud',
    name: 'SoundCloud',
    capabilities: { resolve: true, search: true, stream: true },
    priority: 2
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    capabilities: { resolve: true, search: true, stream: false },
    priority: 3
  },
  bandcamp: {
    id: 'bandcamp',
    name: 'Bandcamp',
    capabilities: { resolve: true, search: false, stream: false },
    priority: 4
  }
};

/**
 * Sample playlist with mixed sources
 */
const mixedSourcePlaylist = [
  {
    id: 'track-1',
    title: 'First Song',
    artist: 'Artist One',
    album: 'Album One',
    duration: 180000,
    sources: {
      spotify: { id: 's1', spotifyUri: 'spotify:track:s1', confidence: 0.95 }
    }
  },
  {
    id: 'track-2',
    title: 'Second Song',
    artist: 'Artist Two',
    album: 'Album Two',
    duration: 200000,
    sources: {
      localfiles: { id: 'l2', path: '/music/song2.mp3', confidence: 1.0 }
    }
  },
  {
    id: 'track-3',
    title: 'Third Song',
    artist: 'Artist Three',
    album: 'Album Three',
    duration: 240000,
    sources: {
      soundcloud: { id: 'sc3', soundcloudId: '333333', confidence: 0.9 }
    }
  },
  {
    id: 'track-4',
    title: 'Fourth Song',
    artist: 'Artist Four',
    album: 'Album Four',
    duration: 210000,
    sources: {
      youtube: { id: 'y4', youtubeId: 'abc123def', confidence: 0.85 }
    }
  },
  {
    id: 'track-5',
    title: 'Fifth Song',
    artist: 'Artist Five',
    album: 'Album Five',
    duration: 195000,
    sources: {
      spotify: { id: 's5', spotifyUri: 'spotify:track:s5', confidence: 0.92 },
      localfiles: { id: 'l5', path: '/music/song5.flac', confidence: 1.0 }
    }
  }
];

/**
 * Queue with some error tracks
 */
const queueWithErrors = [
  {
    id: 'good-track-1',
    title: 'Good Track 1',
    artist: 'Artist',
    status: 'ready',
    sources: { spotify: { id: 'g1', confidence: 0.9 } }
  },
  {
    id: 'error-track-1',
    title: 'Error Track 1',
    artist: 'Artist',
    status: 'error',
    sources: {}
  },
  {
    id: 'error-track-2',
    title: 'Error Track 2',
    artist: 'Artist',
    status: 'error',
    sources: {}
  },
  {
    id: 'good-track-2',
    title: 'Good Track 2',
    artist: 'Artist',
    status: 'ready',
    sources: { localfiles: { id: 'g2', path: '/music/good2.mp3', confidence: 1.0 } }
  }
];

/**
 * Spotify API response fixtures
 */
const spotifyResponses = {
  currentlyPlaying: {
    is_playing: true,
    progress_ms: 45000,
    item: {
      id: 'spotify-track-id',
      name: 'Test Track',
      duration_ms: 180000,
      artists: [{ name: 'Test Artist' }],
      album: {
        name: 'Test Album',
        images: [{ url: 'https://example.com/album-art.jpg', width: 300, height: 300 }]
      },
      uri: 'spotify:track:spotify-track-id'
    },
    device: {
      id: 'device-123',
      name: 'Test Computer',
      type: 'Computer',
      is_active: true
    }
  },
  devices: {
    devices: [
      { id: 'device-1', name: 'Computer', type: 'Computer', is_active: true },
      { id: 'device-2', name: 'Phone', type: 'Smartphone', is_active: false },
      { id: 'device-3', name: 'Speaker', type: 'Speaker', is_active: false }
    ]
  },
  noPlayback: null
};

/**
 * Browser extension message fixtures
 */
const extensionMessages = {
  playing: {
    type: 'status',
    status: 'playing',
    tabId: 123,
    source: 'youtube',
    track: {
      title: 'YouTube Video Title',
      artist: 'Channel Name',
      duration: 300
    }
  },
  paused: {
    type: 'status',
    status: 'paused',
    tabId: 123
  },
  ended: {
    type: 'status',
    status: 'ended',
    tabId: 123
  },
  progress: {
    type: 'progress',
    tabId: 123,
    currentTime: 45,
    duration: 300
  }
};

/**
 * Auto-advance test scenarios
 */
const autoAdvanceScenarios = {
  spotifyToLocal: {
    current: {
      id: 'spotify-current',
      title: 'Spotify Track',
      _activeResolver: 'spotify',
      sources: { spotify: { spotifyUri: 'spotify:track:current' } }
    },
    next: {
      id: 'local-next',
      title: 'Local Track',
      sources: { localfiles: { path: '/music/next.mp3' } }
    }
  },
  localToSoundcloud: {
    current: {
      id: 'local-current',
      title: 'Local Track',
      _activeResolver: 'localfiles',
      sources: { localfiles: { path: '/music/current.mp3' } }
    },
    next: {
      id: 'soundcloud-next',
      title: 'SoundCloud Track',
      sources: { soundcloud: { soundcloudId: '123456' } }
    }
  },
  soundcloudToYoutube: {
    current: {
      id: 'soundcloud-current',
      title: 'SoundCloud Track',
      _activeResolver: 'soundcloud',
      sources: { soundcloud: { soundcloudId: '789012' } }
    },
    next: {
      id: 'youtube-next',
      title: 'YouTube Track',
      sources: { youtube: { youtubeId: 'dQw4w9WgXcQ' } }
    }
  },
  youtubeToSpotify: {
    current: {
      id: 'youtube-current',
      title: 'YouTube Track',
      _activeResolver: 'youtube',
      sources: { youtube: { youtubeId: 'abc123' } }
    },
    next: {
      id: 'spotify-next',
      title: 'Spotify Track',
      sources: { spotify: { spotifyUri: 'spotify:track:next' } }
    }
  }
};

/**
 * Resolution scheduler test data
 */
const schedulerTestData = {
  pageContext: {
    id: 'page-collection-1',
    type: 'page',
    tracks: [
      { key: 'page-track-1', data: { title: 'Page Track 1', artist: 'Artist 1' } },
      { key: 'page-track-2', data: { title: 'Page Track 2', artist: 'Artist 2' } },
      { key: 'page-track-3', data: { title: 'Page Track 3', artist: 'Artist 3' } }
    ]
  },
  queueContext: {
    id: 'queue-main',
    type: 'queue',
    playbackLookahead: 5,
    tracks: [
      { key: 'queue-track-1', data: { title: 'Queue Track 1', artist: 'Artist 1' } },
      { key: 'queue-track-2', data: { title: 'Queue Track 2', artist: 'Artist 2' } }
    ]
  },
  sidebarContext: {
    id: 'sidebar-friends',
    type: 'sidebar',
    tracks: [
      { key: 'friend-track-1', data: { title: 'Friend Track 1', artist: 'Friend 1' } }
    ]
  }
};

module.exports = {
  resolverConfigs,
  mixedSourcePlaylist,
  queueWithErrors,
  spotifyResponses,
  extensionMessages,
  autoAdvanceScenarios,
  schedulerTestData
};
