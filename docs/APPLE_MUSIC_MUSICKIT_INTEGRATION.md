# Apple Music MusicKit Integration Guide

This document describes how to enable full MusicKit API integration once you have an Apple Developer account.

## Current Implementation (iTunes Search API)

The Apple Music resolver currently uses the **iTunes Search API**, which is free and requires no authentication:

### Features Available Now
- Search tracks, albums, and artists via iTunes catalog
- URL lookup for `music.apple.com` track and album links
- 30-second preview playback
- Album metadata and track listings
- No authentication required

### Limitations Without MusicKit
- Cannot access user's Apple Music library
- Cannot fetch full playlist contents from URLs
- No direct streaming (opens in browser/Apple Music app)
- Limited to iTunes catalog (some Apple Music exclusives may not appear)

## MusicKit Integration (Requires Apple Developer Account)

When you have an Apple Developer account, you can enable enhanced features via MusicKit.

### Prerequisites

1. **Apple Developer Account** ($99/year)
   - Sign up at https://developer.apple.com

2. **MusicKit Entitlement**
   - Go to https://developer.apple.com/account/resources/identifiers
   - Create or select an App ID
   - Enable the "MusicKit" capability

3. **Create a MusicKit Key**
   - Go to https://developer.apple.com/account/resources/authkeys
   - Create a new key with MusicKit enabled
   - Download the `.p8` private key file (save it securely!)
   - Note your Key ID and Team ID

### Generating the Developer Token (JWT)

MusicKit uses a JWT (JSON Web Token) signed with your private key. The token:
- Is valid for up to 6 months
- Must be signed with ES256 algorithm
- Contains your Team ID and Key ID

Example token generation (Node.js):

```javascript
const jwt = require('jsonwebtoken');
const fs = require('fs');

const privateKey = fs.readFileSync('AuthKey_XXXXXXXXXX.p8');

const token = jwt.sign({}, privateKey, {
  algorithm: 'ES256',
  expiresIn: '180d',
  issuer: 'YOUR_TEAM_ID',     // e.g., 'ABC123DEF4'
  header: {
    alg: 'ES256',
    kid: 'YOUR_KEY_ID'        // e.g., 'XXXXXXXXXX'
  }
});

console.log(token);
```

Or use the Apple Music Token Generator:
https://github.com/nickytonline/apple-music-token-generator

### Configuration in Parachord

Once you have your developer token:

1. Go to **Settings > Resolvers > Apple Music**
2. Enter your **MusicKit Developer Token** in the configuration field
3. The resolver will automatically use MusicKit API for enhanced features

### Enhanced Features with MusicKit

When MusicKit is configured, the resolver can:

1. **Full Playlist Support**
   - Fetch complete track listings from Apple Music playlist URLs
   - Access Apple Music curated playlists

2. **User Library Access** (with user authorization)
   - Access user's recently played
   - Access user's playlists
   - Access user's library

3. **Better Search Results**
   - Access Apple Music-exclusive content
   - More accurate metadata
   - Higher quality artwork

4. **Potential Future Features**
   - MusicKit Web playback (with additional setup)
   - Real-time listening status
   - Social features

## MusicKit API Endpoints

Key endpoints available with MusicKit:

```
Base URL: https://api.music.apple.com/v1

# Catalog (no user auth needed)
GET /catalog/{storefront}/search?term={query}&types=songs
GET /catalog/{storefront}/songs/{id}
GET /catalog/{storefront}/albums/{id}
GET /catalog/{storefront}/playlists/{id}

# User Library (requires user authorization)
GET /me/library/songs
GET /me/library/playlists
GET /me/recent/played
```

## Implementation Notes for Developers

When MusicKit token is available, the resolver should be updated to:

1. **Check for developerToken in config**
   ```javascript
   if (config.developerToken) {
     // Use MusicKit API
   } else {
     // Fall back to iTunes API
   }
   ```

2. **Add Authorization header**
   ```javascript
   headers: {
     'Authorization': 'Bearer ' + config.developerToken,
     'Music-User-Token': config.userToken  // If user authorized
   }
   ```

3. **Handle storefront correctly**
   ```javascript
   const storefront = config.storefront || 'us';
   const url = `https://api.music.apple.com/v1/catalog/${storefront}/search`;
   ```

## Implementation Roadmap

When ready to implement MusicKit:

- [ ] Add MusicKit API calls when developerToken is present
- [ ] Implement lookupPlaylist with MusicKit
- [ ] Add user authorization flow for library access
- [ ] Add MusicKit Web playback integration
- [ ] Add sync provider for Apple Music library

## Resources

- [MusicKit Documentation](https://developer.apple.com/documentation/musickit)
- [Apple Music API Reference](https://developer.apple.com/documentation/applemusicapi)
- [MusicKit JS (for web playback)](https://developer.apple.com/documentation/musickitjs)
- [Getting Keys and Creating Tokens](https://developer.apple.com/documentation/applemusicapi/generating_developer_tokens)

## Troubleshooting

### "Invalid Developer Token"
- Ensure the JWT is properly signed with ES256
- Check that the Key ID in the header matches your key
- Verify the Team ID in the issuer claim
- Tokens expire after 6 months - regenerate if needed

### "Storefront Not Available"
- Use lowercase two-letter country codes (us, gb, jp, etc.)
- Not all content is available in all storefronts

### Rate Limits
- MusicKit API has rate limits
- Implement caching and request debouncing
- Consider using batch endpoints where available
