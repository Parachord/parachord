# API Credentials Setup Guide

This guide explains how to set up API credentials for all music resolvers in Parachord.

---

## 🔐 Quick Setup

### 1. Copy the Environment Template
```bash
cp .env.example .env
```

### 2. Add Your Credentials
Open `.env` and fill in your API keys (see sections below for how to get them).

### 3. Install Dependencies
```bash
npm install
```
The `dotenv` package is already in `package.json` and will be installed automatically.

### 4. Restart the App
```bash
npm start
```

---

## 📋 Required Credentials

### ✅ **Spotify** (BYOK — Bring Your Own Key)

**Status:** Each user must provide their own Spotify Client ID

Spotify limits developer apps to 5 users in development mode. To work around this, each Parachord user registers their own free Spotify Developer app (you are the only user of your own app, so you'll never hit the limit).

**How to Get:**
1. Go to: https://developer.spotify.com/dashboard
2. Log in with your **Spotify Premium** account
3. Click **"Create App"**
4. Fill in:
   - **App Name:** "Parachord" (or your choice)
   - **App Description:** "Personal music player"
   - **Redirect URI:** `http://127.0.0.1:8888/callback` (important!)
   - **API:** Check "Web API"
5. Click **"Save"**
6. Click **"Settings"**
7. Copy your **Client ID** (you do NOT need the client secret)

**Option A — Configure in Settings (recommended):**
Open Parachord Settings, paste your Client ID in the Spotify section, and click Save.

**Option B — Add to .env:**
```bash
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

**Important Notes:**
- **No client secret needed** — Parachord uses the PKCE OAuth flow
- Requires **Spotify Premium** for playback
- Tokens refresh automatically

---

## 📋 Optional Credentials

These resolvers don't require API keys yet (or at all):

### ⚪ **MusicBrainz** (No API Key Needed)

**Status:** Working without credentials

**Why:** MusicBrainz is a free, open API that doesn't require authentication. Just needs a User-Agent header, which is already set in the code.

**Configuration:** None needed! ✨

---

### ⚪ **Bandcamp** (No API Available)

**Status:** Working via web scraping

**Why:** Bandcamp doesn't have a public API. The app uses web scraping to search, which may be blocked by CORS in some cases.

**Configuration:** None needed!

**Note:** When you click a Bandcamp result, it opens in your browser.

---

### 🔮 **YouTube** (Future Implementation)

**Status:** Not yet implemented

**When Implemented:** Will need YouTube Data API v3 key

**How to Get (for future):**
1. Go to: https://console.cloud.google.com/
2. Create a new project
3. Enable **YouTube Data API v3**
4. Create credentials (API key)
5. Restrict the key to YouTube Data API

**Add to .env (when implemented):**
```bash
YOUTUBE_API_KEY=your_api_key_here
```

**Current Status:** YouTube resolver is a placeholder and doesn't search anything yet.

---

### 🟢 **SoundCloud** (OAuth 2.1 + PKCE)

**Status:** Fully implemented with OAuth 2.1 authentication (PKCE mandatory)

**What Works:**
- OAuth 2.1 login with PKCE (S256 code challenge)
- Search SoundCloud catalog from within Parachord
- URL resolution for SoundCloud track links
- Audio streaming via official API
- Browser extension can scrape tracks, playlists, and artist pages from SoundCloud

**How to Get Credentials:**
1. Go to: https://soundcloud.com/you/apps
2. Register a new app
3. Get your Client ID and Client Secret

**Add to .env:**
```bash
SOUNDCLOUD_CLIENT_ID=your_client_id_here
SOUNDCLOUD_CLIENT_SECRET=your_client_secret_here
```

**Note:** SoundCloud migrated to [OAuth 2.1 with mandatory PKCE](https://developers.soundcloud.com/blog/oauth-migration). Parachord's integration is fully compliant. Fallback credentials are included for convenience, but users can provide their own via Settings or environment variables.

---

### ⚪ **Qobuz** (Public Demo Credentials)

**Status:** Working with public demo app_id

**What Works:**
- Search Qobuz catalog
- Display results with quality info
- Play 30-second previews
- No authentication needed for basic features

**Current Credentials:**
Using public demo `app_id: 285473059` - works for search and previews!

**How to Get Your Own (optional):**
1. Go to: https://github.com/Qobuz/api-documentation
2. Request API access from Qobuz
3. Wait for approval (may take time)
4. Get your app_id and secret

**Add to .env (optional):**
```bash
QOBUZ_APP_ID=your_app_id_here
QOBUZ_SECRET=your_secret_here
```

**Why Get Your Own:**
- Higher rate limits
- Full track streaming (with subscription)
- User authentication
- Production use

**Current Limitations:**
- Preview-only playback (30 seconds)
- Public demo may have rate limits
- No full streaming without subscription

---

## 🔧 Configuration Reference

### Complete .env File Structure:

```bash
# Spotify API Credentials (BYOK — each user needs their own)
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback

# YouTube API Credentials (optional - for future implementation)
YOUTUBE_API_KEY=

# SoundCloud API Credentials (optional - extension scraping works, desktop resolver WIP)
SOUNDCLOUD_CLIENT_ID=
SOUNDCLOUD_CLIENT_SECRET=

# MusicBrainz (no credentials needed)
# Bandcamp (no credentials needed)

# Server Configuration
AUTH_SERVER_PORT=8888
```

---

## 🐛 Troubleshooting

### "Please enter your Spotify Client ID"

**Problem:** No Spotify Client ID configured

**Solution:**
1. Go to https://developer.spotify.com/dashboard and create an app
2. Add redirect URI: `http://127.0.0.1:8888/callback`
3. Copy your Client ID
4. Either paste it in Parachord Settings or add to `.env` file
5. Restart the app if using `.env`

### Environment variables not loading

**Problem:** dotenv not installed or .env in wrong location

**Solution:**
1. Make sure `.env` is in the same directory as `main.js`
2. Run `npm install` to ensure dotenv is installed
3. Check `package.json` has `"dotenv"` in dependencies
4. Restart the app

---

## 🔒 Security Best Practices

### ✅ DO:
- Keep `.env` file in `.gitignore`
- Use `.env.example` as a template (without real keys)
- Keep your client secret private
- Rotate credentials if accidentally exposed

### ❌ DON'T:
- Commit `.env` to GitHub
- Share your client secret publicly
- Hardcode credentials in source files
- Use production credentials for testing

---

## 📦 package.json Dependencies

Make sure you have this in `package.json`:

```json
{
  "dependencies": {
    "dotenv": "^16.0.3",
    "electron-store": "^8.1.0",
    "express": "^4.18.2"
  }
}
```

If `dotenv` is missing:
```bash
npm install dotenv --save
```

---

## 🎯 Testing Your Setup

### 1. Check Environment Variables Load:

Add this to the top of `main.js` temporarily:
```javascript
require('dotenv').config();
console.log('Spotify Client ID:', process.env.SPOTIFY_CLIENT_ID ? 'Found' : 'Missing');
```

### 2. Test Spotify Connection:

1. Start app: `npm start`
2. Click "Connect Spotify"
3. Complete OAuth flow
4. Check console for: `Token exchange successful`

### 3. Test Search:

1. Search for any artist
2. Should see results from:
   - ✅ Spotify (if connected)
   - ✅ MusicBrainz (always)
   - ✅ Bandcamp (if not blocked by CORS)

---

## 📚 Additional Resources

- **Spotify API Docs:** https://developer.spotify.com/documentation/web-api
- **MusicBrainz API:** https://musicbrainz.org/doc/MusicBrainz_API
- **YouTube Data API:** https://developers.google.com/youtube/v3
- **SoundCloud API:** https://developers.soundcloud.com/docs/api/guide

---

## 🎉 Ready to Go!

Once you've:
- ✅ Added Spotify credentials to `.env`
- ✅ Installed dependencies (`npm install`)
- ✅ Restarted the app
- ✅ Connected Spotify successfully

You're all set! The app will securely load credentials from `.env` instead of having them hardcoded in the source files.

**Remember:** The `.env` file is in `.gitignore`, so it won't be committed to git. Other developers will need to create their own `.env` file using `.env.example` as a template.
