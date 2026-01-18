# Drag & Drop Track URL Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to drag and drop music service URLs onto the app to play or queue tracks.

**Architecture:** Extend the resolver system with URL pattern matching and `lookupUrl` capability. Add drag/drop event handling to app.js with two drop zones (now playing, queue). Create placeholder track lifecycle with loading/ready/error states.

**Tech Stack:** React (vanilla JS, no JSX), Electron, existing ResolverLoader class

---

## Task 1: Add URL Pattern Registry to ResolverLoader

**Files:**
- Modify: `resolver-loader.js:7-132`

**Step 1: Add URL pattern storage and matching**

Add after line 9 (`this.resolvers = new Map();`):

```javascript
    this.urlPatterns = []; // Array of { pattern: string, resolverId: string }
```

**Step 2: Add pattern registration in createResolverInstance**

Add after line 101 (after `capabilities: capabilities || {},`):

```javascript
      // URL patterns for URL lookup
      urlPatterns: axe.urlPatterns || [],
```

**Step 3: Update loadResolver to register URL patterns**

Add after line 33 (`this.resolvers.set(id, resolver);`):

```javascript
      // Register URL patterns
      if (axe.urlPatterns && Array.isArray(axe.urlPatterns)) {
        for (const pattern of axe.urlPatterns) {
          this.urlPatterns.push({ pattern, resolverId: id });
        }
        console.log(`  📎 Registered ${axe.urlPatterns.length} URL pattern(s) for ${id}`);
      }
```

**Step 4: Add findResolverForUrl method**

Add before the closing brace of the class (before line 186):

```javascript
  /**
   * Find which resolver can handle a given URL
   * @param {string} url - The URL to match
   * @returns {string|null} - Resolver ID or null if no match
   */
  findResolverForUrl(url) {
    for (const { pattern, resolverId } of this.urlPatterns) {
      if (this.matchUrlPattern(url, pattern)) {
        return resolverId;
      }
    }
    return null;
  }

  /**
   * Match a URL against a glob-like pattern
   * Supports: * (any chars except /), *.domain.com (subdomain wildcard)
   */
  matchUrlPattern(url, pattern) {
    try {
      // Normalize URL - remove protocol and trailing slash
      let normalizedUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      let normalizedPattern = pattern.replace(/^https?:\/\//, '').replace(/\/$/, '');

      // Handle spotify: URI scheme
      if (url.startsWith('spotify:') && pattern.startsWith('spotify:')) {
        normalizedUrl = url;
        normalizedPattern = pattern;
      }

      // Convert glob pattern to regex
      // *.domain.com -> [^/]+\.domain\.com
      // path/* -> path/[^/]+
      // path/*/more -> path/[^/]+/more
      const regexPattern = normalizedPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars (except *)
        .replace(/\\\*\\\./g, '[^/]+\\.') // *. at start = subdomain wildcard
        .replace(/\\\*/g, '[^/]+'); // * = any segment

      const regex = new RegExp(`^${regexPattern}$`, 'i');
      return regex.test(normalizedUrl);
    } catch (error) {
      console.error('URL pattern match error:', error);
      return false;
    }
  }

  /**
   * Look up track metadata from a URL
   * @param {string} url - The URL to look up
   * @returns {Promise<{track: object, resolverId: string}|null>}
   */
  async lookupUrl(url) {
    const resolverId = this.findResolverForUrl(url);
    if (!resolverId) {
      return null;
    }

    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.lookupUrl) {
      console.error(`Resolver ${resolverId} does not support URL lookup`);
      return null;
    }

    try {
      const track = await resolver.lookupUrl(url, resolver.config || {});
      if (track) {
        return { track, resolverId };
      }
    } catch (error) {
      console.error(`URL lookup error for ${resolverId}:`, error);
    }

    return null;
  }
```

**Step 5: Add unloadResolver URL pattern cleanup**

Update `unloadResolver` method (around line 151) - add after `this.resolvers.delete(id);`:

```javascript
    // Remove URL patterns for this resolver
    this.urlPatterns = this.urlPatterns.filter(p => p.resolverId !== id);
```

**Step 6: Commit**

```bash
git add resolver-loader.js
git commit -m "feat(resolvers): add URL pattern matching and lookupUrl support"
```

---

## Task 2: Add urlPatterns and lookupUrl to Spotify Resolver

**Files:**
- Modify: `resolvers/spotify.axe`

**Step 1: Update capabilities**

Change line 19 from `"urlLookup": false` to:

```json
    "urlLookup": true
```

**Step 2: Add urlPatterns array**

Add after line 20 (`},` closing capabilities):

```json
  "urlPatterns": [
    "open.spotify.com/track/*",
    "open.spotify.com/intl-*/track/*",
    "spotify.link/*",
    "spotify:track:*"
  ],
```

**Step 3: Add lookupUrl implementation**

Add to the implementation object (after the "cleanup" function, before the closing `}`):

```json
    "lookupUrl": "async function(url, config) { try { let trackId = null; if (url.startsWith('spotify:track:')) { trackId = url.replace('spotify:track:', ''); } else if (url.includes('spotify.link/')) { const response = await fetch(url, { redirect: 'follow' }); const finalUrl = response.url; const match = finalUrl.match(/track\\/([a-zA-Z0-9]+)/); if (match) trackId = match[1]; } else { const match = url.match(/track\\/([a-zA-Z0-9]+)/); if (match) trackId = match[1]; } if (!trackId) return null; if (!config.token) { console.error('Spotify token required for URL lookup'); return null; } const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, { headers: { 'Authorization': `Bearer ${config.token}` } }); if (!response.ok) return null; const track = await response.json(); return { title: track.name, artist: track.artists.map(a => a.name).join(', '), album: track.album.name, duration: Math.floor(track.duration_ms / 1000), albumArt: track.album.images[0]?.url, sourceUrl: url, spotifyId: track.id, spotifyUri: track.uri }; } catch (error) { console.error('Spotify URL lookup error:', error); return null; } }"
```

**Step 4: Commit**

```bash
git add resolvers/spotify.axe
git commit -m "feat(spotify): add URL lookup for track links"
```

---

## Task 3: Add urlPatterns and lookupUrl to Bandcamp Resolver

**Files:**
- Modify: `resolvers/bandcamp.axe`

**Step 1: Add urlPatterns array**

Add after line 20 (`},` closing capabilities):

```json
  "urlPatterns": [
    "*.bandcamp.com/track/*"
  ],
```

**Step 2: Add lookupUrl implementation**

Add to the implementation object (after the "cleanup" function, before the closing `}`):

```json
    "lookupUrl": "async function(url, config) { try { const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }); if (!response.ok) return null; const html = await response.text(); const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); let title = '', artist = '', album = '', duration = 0, albumArt = ''; const ldJson = doc.querySelector('script[type=\"application/ld+json\"]'); if (ldJson) { try { const data = JSON.parse(ldJson.textContent); title = data.name || ''; if (data.byArtist) artist = data.byArtist.name || ''; if (data.inAlbum) album = data.inAlbum.name || ''; if (data.duration) { const match = data.duration.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/); if (match) { duration = (parseInt(match[1] || 0) * 3600) + (parseInt(match[2] || 0) * 60) + parseInt(match[3] || 0); } } } catch (e) { console.error('Failed to parse ld+json:', e); } } if (!title) { const titleEl = doc.querySelector('.trackTitle'); if (titleEl) title = titleEl.textContent.trim(); } if (!artist) { const artistEl = doc.querySelector('#name-section h3 span a'); if (artistEl) artist = artistEl.textContent.trim(); } if (!album) { const albumEl = doc.querySelector('#name-section h3:nth-child(3) span a'); if (albumEl) album = albumEl.textContent.trim(); } const artEl = doc.querySelector('#tralbumArt img'); if (artEl) albumArt = artEl.src; if (!title) return null; return { title, artist: artist || 'Unknown Artist', album: album || 'Single', duration: duration || 210, albumArt, sourceUrl: url, bandcampUrl: url }; } catch (error) { console.error('Bandcamp URL lookup error:', error); return null; } }"
```

**Step 3: Commit**

```bash
git add resolvers/bandcamp.axe
git commit -m "feat(bandcamp): add URL lookup for track links"
```

---

## Task 4: Add urlPatterns and lookupUrl to YouTube Resolver

**Files:**
- Modify: `resolvers/youtube.axe`

**Step 1: Add urlPatterns array**

Add after line 20 (`},` closing capabilities):

```json
  "urlPatterns": [
    "youtube.com/watch?v=*",
    "www.youtube.com/watch?v=*",
    "youtu.be/*",
    "music.youtube.com/watch?v=*",
    "m.youtube.com/watch?v=*"
  ],
```

**Step 2: Add lookupUrl implementation**

Add to the implementation object (after the "cleanup" function, before the closing `}`):

```json
    "lookupUrl": "async function(url, config) { try { let videoId = null; if (url.includes('youtu.be/')) { const match = url.match(/youtu\\.be\\/([a-zA-Z0-9_-]+)/); if (match) videoId = match[1]; } else { const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/); if (match) videoId = match[1]; } if (!videoId) return null; const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`; const response = await fetch(oembedUrl); if (!response.ok) return null; const data = await response.json(); let title = data.title || ''; let artist = data.author_name || 'Unknown Artist'; const dashMatch = title.match(/^(.+?)\\s*[-–—]\\s*(.+)$/); if (dashMatch) { artist = dashMatch[1].trim(); title = dashMatch[2].trim(); } return { title: title || 'Unknown Title', artist, album: 'YouTube', duration: 180, albumArt: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, sourceUrl: url, youtubeId: videoId, youtubeUrl: `https://www.youtube.com/watch?v=${videoId}` }; } catch (error) { console.error('YouTube URL lookup error:', error); return null; } }"
```

**Step 3: Commit**

```bash
git add resolvers/youtube.axe
git commit -m "feat(youtube): add URL lookup for video links"
```

---

## Task 5: Add urlPatterns and lookupUrl to Qobuz Resolver

**Files:**
- Modify: `resolvers/qobuz.axe`

**Step 1: Update capabilities**

Change line 18 from `"urlLookup": false` to:

```json
    "urlLookup": true
```

**Step 2: Add urlPatterns array**

Add after line 19 (`},` closing capabilities):

```json
  "urlPatterns": [
    "play.qobuz.com/track/*",
    "open.qobuz.com/track/*",
    "www.qobuz.com/*/album/*/track/*"
  ],
```

**Step 3: Add lookupUrl implementation**

Add to the implementation object (after the "cleanup" function, before the closing `}`):

```json
    "lookupUrl": "async function(url, config) { try { const match = url.match(/track\\/([0-9]+)/); if (!match) return null; const trackId = match[1]; const appId = config.appId || '285473059'; const response = await fetch(`https://www.qobuz.com/api.json/0.2/track/get?track_id=${trackId}&app_id=${appId}`, { headers: { 'User-Agent': 'Parachord/1.0.0' } }); if (!response.ok) return null; const track = await response.json(); return { title: track.title, artist: track.performer?.name || track.album?.artist?.name || 'Unknown Artist', album: track.album?.title || 'Unknown Album', duration: track.duration || 180, albumArt: track.album?.image?.small || track.album?.image?.thumbnail, sourceUrl: url, qobuzId: track.id, previewUrl: track.preview_url }; } catch (error) { console.error('Qobuz URL lookup error:', error); return null; } }"
```

**Step 4: Commit**

```bash
git add resolvers/qobuz.axe
git commit -m "feat(qobuz): add URL lookup for track links"
```

---

## Task 6: Add Drop Zone State and Handlers to app.js

**Files:**
- Modify: `app.js:520-530` (state declarations area)

**Step 1: Add new state variables**

Find the state declarations (around line 523 where `currentQueue` is declared) and add these new state variables nearby:

```javascript
  // Drag & drop URL state
  const [isDraggingUrl, setIsDraggingUrl] = useState(false);
  const [dropZoneTarget, setDropZoneTarget] = useState(null); // 'now-playing' | 'queue' | null
  const [pendingUrlTracks, setPendingUrlTracks] = useState([]); // Tracks being resolved from URL drops
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add drag and drop URL state variables"
```

---

## Task 7: Add URL Validation and Extraction Helper

**Files:**
- Modify: `app.js` (add after state declarations, around line 600)

**Step 1: Add helper functions**

```javascript
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
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add URL extraction and validation helpers"
```

---

## Task 8: Add handleUrlDrop Function

**Files:**
- Modify: `app.js` (add after the helper functions from Task 7)

**Step 1: Add main URL drop handler**

```javascript
  // Handle URL drop - main entry point
  const handleUrlDrop = async (url, zone) => {
    console.log(`🔗 URL dropped on ${zone}:`, url);

    // Find resolver for this URL
    const resolverId = resolverLoaderRef.current?.findResolverForUrl(url);
    if (!resolverId) {
      console.error('❌ No resolver found for URL:', url);
      // TODO: Show toast notification
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
      const result = await resolverLoaderRef.current.lookupUrl(url);

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
              confidence: 0.9 // High confidence since we have exact metadata
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
  const queueAnimationRef = useRef(null);
  const [queueAnimating, setQueueAnimating] = useState(false);

  const triggerQueueAnimation = () => {
    setQueueAnimating(true);
    if (queueAnimationRef.current) {
      clearTimeout(queueAnimationRef.current);
    }
    queueAnimationRef.current = setTimeout(() => {
      setQueueAnimating(false);
    }, 300);
  };
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add handleUrlDrop function with placeholder lifecycle"
```

---

## Task 9: Add Drag Event Handlers

**Files:**
- Modify: `app.js` (add after handleUrlDrop)

**Step 1: Add drag event handlers**

```javascript
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
    // Check if the related target is outside our drop zones
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
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add drag event handlers for URL drops"
```

---

## Task 10: Modify handleNext to Skip Error Tracks

**Files:**
- Modify: `app.js:1391-1426` (handleNext function)

**Step 1: Update handleNext to skip error tracks**

Find the handleNext function (line 1391) and modify the logic after finding nextTrack. Replace the section that calls `handlePlay(nextTrack)` (around lines 1418-1424) with:

```javascript
    if (currentIndex === -1) {
      // Current track not in queue, play first non-error track
      console.log('⚠️ Current track not found in queue, playing first track');
      const firstPlayable = currentQueue.find(t => t.status !== 'error');
      if (firstPlayable) {
        handlePlay(firstPlayable);
      }
    } else {
      // Play next non-error track, loop to beginning if at end
      let nextIndex = (currentIndex + 1) % currentQueue.length;
      let attempts = 0;

      // Skip error tracks
      while (currentQueue[nextIndex]?.status === 'error' && attempts < currentQueue.length) {
        nextIndex = (nextIndex + 1) % currentQueue.length;
        attempts++;
      }

      if (attempts >= currentQueue.length) {
        console.log('⚠️ All tracks in queue have errors');
        return;
      }

      console.log(`➡️ Moving from index ${currentIndex} to ${nextIndex}`);
      const nextTrack = currentQueue[nextIndex];
      handlePlay(nextTrack);
    }
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): skip error tracks in queue navigation"
```

---

## Task 11: Add Drop Zone Overlay Components

**Files:**
- Modify: `app.js` (add before the main return statement in the Parachord component)

**Step 1: Add DropZoneOverlay component**

Add this component definition inside the Parachord component, before the return statement:

```javascript
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
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add DropZoneOverlay component"
```

---

## Task 12: Add Drop Zone Event Bindings to Now Playing Area

**Files:**
- Modify: `app.js` (find the now playing area rendering)

**Step 1: Find the now playing container**

Search for the now playing section in the render. It's in the player bar area around line 4260-4300. Find the container div that holds the album art and track info.

Add drag event handlers to the now playing container. Locate the div with the album art (around line 4260) and wrap it to add the handlers:

The current structure looks something like:
```javascript
React.createElement('div', { className: 'flex items-center gap-4 min-w-0 flex-1' },
  // Album art
  currentTrack?.albumArt ? ...
```

Modify it to:
```javascript
React.createElement('div', {
  className: 'flex items-center gap-4 min-w-0 flex-1 relative',
  onDragEnter: (e) => handleDragEnter(e, 'now-playing'),
  onDragOver: (e) => handleDragOver(e, 'now-playing'),
  onDragLeave: handleDragLeave,
  onDrop: (e) => handleDrop(e, 'now-playing')
},
  // Drop zone overlay
  React.createElement(DropZoneOverlay, {
    zone: 'now-playing',
    isActive: isDraggingUrl && dropZoneTarget === 'now-playing'
  }),
  // Existing album art and track info...
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add drop zone to now playing area"
```

---

## Task 13: Add Drop Zone Event Bindings to Queue Area

**Files:**
- Modify: `app.js` (find the queue drawer rendering around line 4880-4920)

**Step 1: Add drag handlers to queue drawer**

Find the queue drawer container (search for "Queue content" comment around line 4917) and add the handlers:

```javascript
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
        // Existing queue content...
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add drop zone to queue drawer"
```

---

## Task 14: Add Queue Icon Animation Styles

**Files:**
- Modify: `index.html` (add to the `<style>` section)

**Step 1: Add keyframes and animation class**

Add inside the `<style>` tag (after the existing `.animate-spin` definition around line 72):

```css
    /* Queue icon pulse animation */
    @keyframes queue-pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }

    .queue-pulse {
      animation: queue-pulse 0.3s ease-out;
    }

    /* Queue badge flash */
    @keyframes badge-flash {
      0% { background-color: rgb(147, 51, 234); }
      50% { background-color: rgb(192, 132, 252); }
      100% { background-color: rgb(147, 51, 234); }
    }

    .badge-flash {
      animation: badge-flash 0.3s ease-out;
    }
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat(styles): add queue icon animation keyframes"
```

---

## Task 15: Apply Animation Classes to Queue Button

**Files:**
- Modify: `app.js` (find queue button around line 4379)

**Step 1: Update queue button to use animation state**

Find the queue button (search for `Queue (${currentQueue.length} tracks)`) and update it:

```javascript
            // Queue button
            React.createElement('button', {
              onClick: () => setQueueDrawerOpen(!queueDrawerOpen),
              className: `relative p-2 ml-2 hover:bg-white/10 rounded-full transition-colors ${queueDrawerOpen ? 'bg-purple-600/30 text-purple-400' : ''} ${queueAnimating ? 'queue-pulse' : ''}`,
              title: `Queue (${currentQueue.length} tracks)`
            },
              React.createElement(List),
              currentQueue.length > 0 && React.createElement('span', {
                className: `absolute -top-1 -right-1 bg-purple-600 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 ${queueAnimating ? 'badge-flash' : ''}`
              }, currentQueue.length > 99 ? '99+' : currentQueue.length)
            )
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add animation classes to queue button"
```

---

## Task 16: Add Loading/Error State Rendering to Queue Track Cards

**Files:**
- Modify: `app.js` (find queue track rendering around line 4932)

**Step 1: Update queue track card rendering**

Find where queue tracks are mapped (around line 4932: `currentQueue.map((track, index) => {`). Update the track card to handle loading and error states:

```javascript
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
                className: `flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors ${
                  isCurrentTrack ? 'bg-purple-600/20' : ''
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
                    // Loading state
                    React.createElement('div', null,
                      React.createElement('div', {
                        className: 'font-medium text-gray-400'
                      }, 'Loading...'),
                      React.createElement('div', {
                        className: 'text-sm text-gray-500 truncate'
                      }, `from ${track.sourceDomain || 'unknown'}`)
                    )
                  : isError ?
                    // Error state
                    React.createElement('div', null,
                      React.createElement('div', {
                        className: 'font-medium text-red-400'
                      }, 'Could not load track'),
                      React.createElement('div', {
                        className: 'text-sm text-gray-500 truncate'
                      }, track.errorMessage || 'Unknown error')
                    )
                  :
                    // Normal state
                    React.createElement('div', null,
                      React.createElement('div', {
                        className: `font-medium truncate ${isCurrentTrack ? 'text-purple-400' : 'text-white'}`
                      }, track.title),
                      React.createElement('div', {
                        className: 'text-sm text-gray-400 truncate'
                      }, track.artist)
                    )
                ),

                // Action buttons (right side)
                isError ?
                  // Error actions: Retry and Remove
                  React.createElement('div', {
                    className: 'flex items-center gap-1 flex-shrink-0'
                  },
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        // Retry the URL lookup
                        if (track.sourceUrl) {
                          removeFromQueue(track.id);
                          handleUrlDrop(track.sourceUrl, 'queue');
                        }
                      },
                      className: 'px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors',
                      title: 'Retry'
                    }, '↻ Retry'),
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        removeFromQueue(track.id);
                      },
                      className: 'flex-shrink-0 p-1 text-gray-500 hover:text-red-400 hover:bg-white/10 rounded transition-colors',
                      title: 'Remove from queue'
                    }, React.createElement(X, { size: 16 }))
                  )
                : isLoading ?
                  // Loading: just show remove button
                  React.createElement('button', {
                    onClick: (e) => {
                      e.stopPropagation();
                      removeFromQueue(track.id);
                    },
                    className: 'flex-shrink-0 p-1 text-gray-500 hover:text-red-400 hover:bg-white/10 rounded transition-colors',
                    title: 'Cancel'
                  }, React.createElement(X, { size: 16 }))
                :
                  // Normal: source buttons + remove
                  React.createElement(React.Fragment, null,
                    React.createElement('div', {
                      className: 'flex items-center gap-1 flex-shrink-0'
                    },
                      availableSources.length > 0 ?
                        availableSources.map(resolverId => {
                          const resolver = allResolvers.find(r => r.id === resolverId);
                          if (!resolver) return null;
                          return React.createElement('button', {
                            key: resolverId,
                            onClick: (e) => {
                              e.stopPropagation();
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
                              opacity: 0.8,
                              transition: 'opacity 0.1s, transform 0.1s'
                            },
                            onMouseEnter: (e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.1)'; },
                            onMouseLeave: (e) => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'scale(1)'; },
                            title: `Play via ${resolver.name}`
                          }, resolver.icon);
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
                      className: 'flex-shrink-0 p-1 text-gray-500 hover:text-red-400 hover:bg-white/10 rounded transition-colors',
                      title: 'Remove from queue'
                    }, React.createElement(X, { size: 16 }))
                  )
              );
            })
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(app): add loading and error states to queue track cards"
```

---

## Task 17: Add resolverLoaderRef for URL Lookups

**Files:**
- Modify: `app.js` (find existing ResolverLoader usage)

**Step 1: Add ref to store ResolverLoader instance**

Find where the ResolverLoader is created (search for `new ResolverLoader()` or `resolverLoader`). Around the state declarations, add:

```javascript
  const resolverLoaderRef = useRef(null);
```

**Step 2: Store the instance when resolvers are loaded**

Find where resolvers are loaded and stored (search for `setAllResolvers`). After the ResolverLoader instance is created and resolvers are loaded, store it:

```javascript
  resolverLoaderRef.current = loader; // where loader is the ResolverLoader instance
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(app): add resolverLoaderRef for URL lookup access"
```

---

## Task 18: Integration Test - Manual Testing Checklist

**Step 1: Test Spotify URL drop**

1. Start the app: `npm start` or `electron .`
2. Connect Spotify (if not already)
3. Copy a Spotify track URL: `https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh`
4. Drag and drop onto the queue area
5. Verify:
   - Loading placeholder appears in queue
   - Queue icon animates
   - Track resolves and shows metadata
   - Track can be played

**Step 2: Test Bandcamp URL drop**

1. Copy a Bandcamp track URL: `https://someartist.bandcamp.com/track/somesong`
2. Drag and drop onto now playing area
3. Verify:
   - Loading state shows in now playing
   - Track resolves
   - Playback starts (or external prompt shows)

**Step 3: Test YouTube URL drop**

1. Copy a YouTube URL: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
2. Drop on queue
3. Verify metadata extraction (artist/title from video title)

**Step 4: Test error handling**

1. Drop an invalid URL (e.g., `https://example.com/notatrack`)
2. Verify error toast or no action
3. Drop a valid-looking URL that fails lookup
4. Verify error state in queue with retry/remove buttons

**Step 5: Test queue navigation with errors**

1. Add a track via URL drop
2. Manually set it to error state (or let it fail)
3. Add more tracks
4. Play through queue, verify error tracks are skipped

**Step 6: Commit test results**

```bash
git add -A
git commit -m "test: verify drag and drop URL functionality"
```

---

## Summary

This implementation plan covers:

1. **Tasks 1-5**: Resolver system extensions (URL patterns, lookupUrl methods)
2. **Tasks 6-9**: App state and event handlers for drag/drop
3. **Task 10**: Queue navigation updates to skip error tracks
4. **Tasks 11-13**: Drop zone UI components and bindings
5. **Tasks 14-16**: Animations and loading/error states
6. **Task 17**: Wiring up the ResolverLoader reference
7. **Task 18**: Manual testing checklist

Total: 18 tasks with frequent commits for easy rollback.
