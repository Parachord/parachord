# Harmonix .axe Resolver Integration Guide

## Current Status

✅ **Created:**
- `.axe` format specification (AXE_FORMAT_SPEC.md)
- Resolver files: spotify.axe, bandcamp.axe, qobuz.axe, musicbrainz.axe
- ResolverLoader class (resolver-loader.js)
- Updated index.html to load resolver-loader.js

## Integration Steps

### 1. Embed .axe Files in app.js

At the top of app.js, embed the .axe files as JSON objects:

```javascript
const BUILTIN_RESOLVERS = [
  // Spotify resolver
  {
    "manifest": { ... },
    "capabilities": { ... },
    "settings": { ... },
    "implementation": { ... }
  },
  // Bandcamp resolver
  { ... },
  // Qobuz resolver
  { ... },
  // MusicBrainz resolver
  { ... }
];
```

### 2. Initialize Resolver Loader

In the Harmonix component, initialize the resolver loader:

```javascript
const Harmonix = () => {
  const [resolvers, setResolvers] = useState([]);
  const resolverLoader = useRef(null);
  
  useEffect(() => {
    // Initialize resolver loader
    resolverLoader.current = new ResolverLoader();
    
    // Load built-in resolvers
    Promise.all(
      BUILTIN_RESOLVERS.map(axe => resolverLoader.current.loadResolver(axe))
    ).then(loadedResolvers => {
      setResolvers(loadedResolvers);
      console.log(`Loaded ${loadedResolvers.length} resolvers`);
    });
  }, []);
  
  // ...
}
```

### 3. Update Search Functions

Replace hardcoded search functions with resolver API calls:

```javascript
// OLD:
const searchSpotify = async (query) => {
  // Hardcoded implementation
};

// NEW:
const searchWithResolver = async (resolverId, query) => {
  const resolver = resolvers.find(r => r.id === resolverId);
  if (!resolver || !resolver.capabilities.search) {
    return [];
  }
  
  try {
    const config = {
      token: resolverId === 'spotify' ? spotifyToken : null,
      appId: resolverId === 'qobuz' ? '285473059' : null,
      volume: volume / 100
    };
    
    return await resolver.search(query, config);
  } catch (error) {
    console.error(`${resolver.name} search error:`, error);
    return [];
  }
};
```

### 4. Update handleSearch

```javascript
const handleSearch = async (query) => {
  setSearchQuery(query);
  
  if (query.trim()) {
    setResultFilters(activeResolvers.slice());
    setIsSearching(true);
    
    // Search using resolver plugins
    const searchPromises = activeResolvers.map(resolverId =>
      searchWithResolver(resolverId, query)
    );
    
    try {
      const results = await Promise.all(searchPromises);
      const allResults = results.flat();
      setSearchResults(allResults);
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    }
    
    setIsSearching(false);
  } else {
    setSearchResults([]);
    setIsSearching(false);
  }
};
```

### 5. Update Resolve Track

```javascript
const resolveTrack = async (track, artistName) => {
  const trackKey = `${track.position}-${track.title}`;
  console.log(`🔍 Resolving: ${artistName} - ${track.title}`);
  
  const query = `${artistName} ${track.title}`;
  const sources = {};
  
  // Query enabled resolvers in priority order
  const enabledResolvers = resolverOrder
    .filter(id => activeResolvers.includes(id))
    .map(id => resolvers.find(r => r.id === id))
    .filter(Boolean);
  
  for (const resolver of enabledResolvers) {
    if (!resolver.capabilities.resolve) continue;
    
    try {
      const config = getResolverConfig(resolver.id);
      const result = await resolver.resolve(artistName, track.title, null, config);
      
      if (result) {
        sources[resolver.id] = {
          ...result,
          confidence: calculateConfidence(track, result)
        };
      }
    } catch (error) {
      console.error(`${resolver.name} resolve error:`, error);
    }
  }
  
  // Update state with found sources
  if (Object.keys(sources).length > 0) {
    setTrackSources(prev => ({
      ...prev,
      [trackKey]: sources
    }));
    console.log(`✅ Found ${Object.keys(sources).length} source(s) for: ${track.title}`);
  }
};
```

### 6. Update handlePlay

```javascript
const handlePlay = async (track) => {
  // Detect resolver from track.sources
  const resolverId = track.sources?.[0];
  const resolver = resolvers.find(r => r.id === resolverId);
  
  if (!resolver || !resolver.capabilities.stream) {
    // Fallback to search or alert
    return;
  }
  
  const config = getResolverConfig(resolverId);
  const success = await resolver.play(track, config);
  
  if (success) {
    setCurrentTrack(track);
    setIsPlaying(true);
  }
};
```

### 7. Helper Function for Config

```javascript
const getResolverConfig = (resolverId) => {
  switch (resolverId) {
    case 'spotify':
      return { token: spotifyToken };
    case 'qobuz':
      return { appId: '285473059', volume: volume / 100 };
    default:
      return {};
  }
};
```

## Benefits

✅ **Modular**: Each resolver is self-contained
✅ **Extensible**: Easy to add new resolvers
✅ **Maintainable**: Resolver code separate from app logic
✅ **Tomahawk-compatible**: Follows similar architecture
✅ **User-installable**: Can load resolvers from files

## File Structure

```
harmonix/
├── index.html
├── app.js
├── resolver-loader.js
└── resolvers/
    ├── spotify.axe
    ├── bandcamp.axe
    ├── qobuz.axe
    └── musicbrainz.axe
```

## Testing

1. Load app → Should see "Loaded 4 resolvers" in console
2. Open settings → Drag/drop resolvers still works
3. Search → Uses resolver.search() methods
4. Click track → Uses resolver.play() methods
5. Console shows which resolver is being used

## Next Steps

1. Complete app.js refactor
2. Test all resolvers work with new system
3. Add localStorage persistence for resolver order
4. Add "Install Resolver" UI (load .axe from file)
5. Create YouTube and SoundCloud .axe files
6. Add resolver update checking
