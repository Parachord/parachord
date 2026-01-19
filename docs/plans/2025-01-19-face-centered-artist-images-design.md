# Face-Centered Artist Images Design

## Overview

Automatically position artist hero images to center on faces/eyes, improving the visual presentation of the artist page header.

## Approach

- Use browser's native `FaceDetector` API (Chromium/Electron)
- Detect faces when image first loads, cache the position
- For multiple faces, use the largest one (likely main artist)
- Fall back to `center 25%` (top-third) if detection fails

## Data Flow

```
getArtistImage(artistName)
    ↓
Check cache for { url, facePosition }
    ├─ Hit with position → Return both immediately
    └─ Miss or no position →
        1. Fetch image URL from Spotify
        2. Load image, run FaceDetector
        3. Calculate vertical center of largest face
        4. Cache { url, facePosition, timestamp }
        5. Return both
    ↓
Hero header uses facePosition for backgroundPosition
```

## Cache Structure

```javascript
// Updated structure
artistImageCache = {
  "radiohead": {
    url: "https://i.scdn.co/image/...",
    facePosition: "center 35%",  // or null if detection failed
    timestamp: 1705612800000
  }
}
```

## Implementation

### Face Detection Function

```javascript
const detectFacePosition = async (imageUrl) => {
  if (!('FaceDetector' in window)) {
    console.log('FaceDetector API not available');
    return null;
  }

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageUrl;
    });

    const detector = new FaceDetector();
    const faces = await detector.detect(img);

    if (faces.length === 0) return null;

    // Find largest face (by bounding box area)
    const largest = faces.reduce((a, b) =>
      (a.boundingBox.width * a.boundingBox.height) >
      (b.boundingBox.width * b.boundingBox.height) ? a : b
    );

    // Calculate vertical center of face as percentage
    const faceCenter = largest.boundingBox.y + (largest.boundingBox.height / 2);
    const percentage = Math.round((faceCenter / img.height) * 100);

    return `center ${percentage}%`;
  } catch (error) {
    console.error('Face detection failed:', error);
    return null;
  }
};
```

### State Changes

```javascript
// Add new state for image position
const [artistImagePosition, setArtistImagePosition] = useState('center 25%');

// Clear both on navigation
setArtistImage(null);
setArtistImagePosition('center 25%');
```

### Modified getArtistImage

Returns `{ url, facePosition }` instead of just the URL string. Runs face detection after fetching URL, caches result.

### Hero Header Update

```javascript
// Dynamic positioning based on face detection
backgroundPosition: artistImagePosition
```

## Fallback Behavior

- FaceDetector unavailable → `center 25%`
- No faces detected → `center 25%`
- Multiple faces → Use largest face
- CORS error loading image → `center 25%`

## Files to Modify

1. `app.js`:
   - Add `detectFacePosition` function
   - Add `artistImagePosition` state
   - Update `getArtistImage` to return object and run detection
   - Update `fetchArtistData` to handle new return format
   - Update hero header to use dynamic position
   - Update cache load/save for new structure
