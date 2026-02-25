# Parachord Mobile Architecture - Android

## Executive Summary

This document outlines the architecture for a native Android version of Parachord that maximizes reuse of existing concepts, plugins (.axe resolvers), and business logic while embracing Android-native patterns for optimal performance and user experience.

**Core Principle:** Keep the JavaScript plugin ecosystem intact by embedding a JS runtime, while wrapping it with native Android UI and system integration.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Parachord Android App                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                         UI Layer (Kotlin)                            │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────────┐│ │
│  │  │ Compose   │ │ ViewModels│ │ Navigation│ │ Material Design 3    ││ │
│  │  │ Components│ │           │ │           │ │ + Parachord Theme     ││ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                      │
│                                    ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    Native Services Layer (Kotlin)                    │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────────┐ │ │
│  │  │ ExoPlayer   │ │ MediaSession │ │ OAuth       │ │ Storage       │ │ │
│  │  │ Service     │ │ Controller   │ │ Manager     │ │ Manager       │ │ │
│  │  └─────────────┘ └──────────────┘ └─────────────┘ └───────────────┘ │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────────┐ │ │
│  │  │ WorkManager │ │ Notification │ │ Foreground  │ │ Network       │ │ │
│  │  │ (Sync)      │ │ Manager      │ │ Service     │ │ Monitor       │ │ │
│  │  └─────────────┘ └──────────────┘ └─────────────┘ └───────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                      │
│                                    ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                       JS Bridge Layer (Kotlin ↔ JS)                  │ │
│  │  ┌──────────────────────────────────────────────────────────────┐   │ │
│  │  │  Hermes/QuickJS Engine                                        │   │ │
│  │  │  • Runs .axe resolver implementations unchanged               │   │ │
│  │  │  • Executes scrobbler plugins                                 │   │ │
│  │  │  • Handles resolution scheduling logic                        │   │ │
│  │  └──────────────────────────────────────────────────────────────┘   │ │
│  │  ┌──────────────────────────────────────────────────────────────┐   │ │
│  │  │  Native Bindings (JNI)                                        │   │ │
│  │  │  • fetch() → OkHttp                                           │   │ │
│  │  │  • storage → DataStore/Room                                   │   │ │
│  │  │  • playback → ExoPlayer commands                              │   │ │
│  │  │  • crypto → Android crypto APIs                               │   │ │
│  │  └──────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                      │
│                                    ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    Reused Business Logic (JavaScript)                │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐ │ │
│  │  │ ResolverLoader │  │ ScrobbleManager│  │ ResolutionScheduler   │ │ │
│  │  │ (resolver-     │  │ (scrobble-     │  │ (resolution-          │ │ │
│  │  │  loader.js)    │  │  manager.js)   │  │  scheduler.js)        │ │ │
│  │  └────────────────┘  └────────────────┘  └────────────────────────┘ │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐ │ │
│  │  │ .axe Resolvers │  │ Scrobbler      │  │ SyncEngine +          │ │ │
│  │  │ (Spotify, YT,  │  │ Plugins        │  │ SyncProviders         │ │ │
│  │  │  Bandcamp...)  │  │                │  │                        │ │ │
│  │  └────────────────┘  └────────────────┘  └────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Mapping: Desktop → Android

| Desktop (Electron)        | Android Equivalent                     | Reuse Level |
|---------------------------|----------------------------------------|-------------|
| **UI: React + Tailwind**  | Jetpack Compose + Material 3           | Redesign    |
| **IPC: electron IPC**     | Kotlin Coroutines + Flow               | Replace     |
| **State: React hooks**    | ViewModels + StateFlow                 | Pattern     |
| **Storage: electron-store** | DataStore / Room                      | Replace     |
| **Resolvers: .axe files** | Same .axe files via JS engine          | **100%**    |
| **ResolverLoader**        | Same JS in Hermes engine               | **100%**    |
| **ScrobbleManager**       | Same JS in Hermes engine               | **100%**    |
| **Scrobblers**            | Same JS plugins                        | **100%**    |
| **SyncEngine**            | Same JS in Hermes engine               | **100%**    |
| **ResolutionScheduler**   | Same JS (with visibility callbacks)    | **100%**    |
| **Audio: HTML5 audio**    | ExoPlayer                              | Replace     |
| **Spotify: Connect API**  | Spotify Android SDK / Connect API      | Adapt       |
| **YouTube: Extension**    | WebView or YouTube IFrame API          | Adapt       |
| **Local files: fs/sqlite**| MediaStore + Room                      | Adapt       |
| **OAuth: Express server** | Custom Tabs + Deep Links               | Replace     |
| **Media keys**            | MediaSession API                       | Replace     |
| **Background: polling**   | Foreground Service + WorkManager       | Replace     |
| **Extension: WebSocket**  | Not applicable (in-app)                | N/A         |

---

## 1. JavaScript Engine Integration

### Technology Choice: Hermes Engine

We'll use **Hermes** (Facebook's lightweight JS engine) for running .axe resolvers and business logic.

**Why Hermes:**
- Optimized for mobile (fast startup, low memory)
- Can execute ES6+ JavaScript
- Already has Android bindings
- Used in production by React Native

**Alternative:** QuickJS - smaller but less battle-tested on Android

### JS Bridge Architecture

```kotlin
// Kotlin side: JSBridge.kt
class JSBridge(private val context: Context) {
    private val hermes = HermesRuntime()

    init {
        // Register native functions available to JS
        hermes.registerNativeModule("fetch", FetchModule(context))
        hermes.registerNativeModule("storage", StorageModule(context))
        hermes.registerNativeModule("playback", PlaybackModule())
        hermes.registerNativeModule("crypto", CryptoModule())
        hermes.registerNativeModule("fs", FileSystemModule(context))

        // Load core business logic
        hermes.evaluateScript(loadAsset("resolver-loader.js"))
        hermes.evaluateScript(loadAsset("scrobble-manager.js"))
        hermes.evaluateScript(loadAsset("resolution-scheduler.js"))
        hermes.evaluateScript(loadAsset("sync-engine/index.js"))
    }

    // Call JS functions from Kotlin
    suspend fun resolveTrack(artist: String, track: String, album: String?): ResolvedSource? {
        return withContext(Dispatchers.Default) {
            hermes.callFunction("resolverLoader.resolve", artist, track, album)
                .await<ResolvedSource>()
        }
    }

    suspend fun loadResolver(axeContent: String): Boolean {
        return hermes.callFunction("resolverLoader.loadResolver", axeContent)
            .await<Boolean>()
    }
}
```

### Native Module Interface

```kotlin
// FetchModule.kt - Provides fetch() API to JS
class FetchModule(private val context: Context) : NativeModule {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .build()

    @JsExport
    fun fetch(url: String, options: JsObject): JsPromise {
        return JsPromise { resolve, reject ->
            val request = Request.Builder()
                .url(url)
                .apply { options.headers?.forEach { addHeader(it.key, it.value) } }
                .build()

            client.newCall(request).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    resolve(JsResponse(response))
                }
                override fun onFailure(call: Call, e: IOException) {
                    reject(e)
                }
            })
        }
    }
}
```

---

## 2. Playback Architecture

### ExoPlayer Integration

```kotlin
// PlaybackService.kt
@AndroidEntryPoint
class PlaybackService : MediaBrowserServiceCompat() {

    @Inject lateinit var jsBridge: JSBridge
    @Inject lateinit var scrobbleManager: ScrobbleManager

    private lateinit var exoPlayer: ExoPlayer
    private lateinit var mediaSession: MediaSession

    override fun onCreate() {
        super.onCreate()

        exoPlayer = ExoPlayer.Builder(this)
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        mediaSession = MediaSession.Builder(this, exoPlayer)
            .setCallback(MediaSessionCallback())
            .build()

        // Track progress for scrobbling
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_ENDED -> scrobbleManager.onTrackEnd()
                }
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                scrobbleManager.onProgressUpdate(newPosition.positionMs / 1000)
            }
        })
    }

    fun playFromResolver(track: Track, resolvedSource: ResolvedSource) {
        when (resolvedSource.type) {
            SourceType.DIRECT_URL -> playDirectUrl(resolvedSource.url)
            SourceType.SPOTIFY -> playViaSpotifySDK(resolvedSource)
            SourceType.YOUTUBE -> playYouTubeAudio(resolvedSource)
            SourceType.LOCAL -> playLocalFile(resolvedSource.path)
        }

        scrobbleManager.onTrackStart(track)
    }

    private fun playDirectUrl(url: String) {
        val mediaItem = MediaItem.fromUri(url)
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare()
        exoPlayer.play()
    }
}
```

### Media Session for System Integration

```kotlin
// Provides lock screen controls, Bluetooth, Android Auto, etc.
class MediaSessionCallback : MediaSession.Callback {

    override fun onPlay() {
        // Resume playback
    }

    override fun onPause() {
        // Pause playback
    }

    override fun onSkipToNext() {
        // Play next in queue
    }

    override fun onSkipToPrevious() {
        // Play previous or restart current
    }

    override fun onSeekTo(pos: Long) {
        // Seek to position
    }

    override fun onCustomAction(action: String, extras: Bundle?) {
        when (action) {
            "RESOLVE_NEXT" -> preResolveNextTrack()
            "TOGGLE_SHUFFLE" -> toggleShuffle()
            "TOGGLE_REPEAT" -> toggleRepeat()
        }
    }
}
```

---

## 3. Resolver Source Handlers

### Source Type Routing

```kotlin
sealed class ResolvedSource {
    data class DirectStream(val url: String, val headers: Map<String, String>?) : ResolvedSource()
    data class SpotifyTrack(val trackId: String, val uri: String) : ResolvedSource()
    data class YouTubeVideo(val videoId: String) : ResolvedSource()
    data class LocalFile(val contentUri: Uri) : ResolvedSource()
    data class WebEmbed(val embedUrl: String) : ResolvedSource()
}

// SourceRouter.kt
class SourceRouter @Inject constructor(
    private val exoPlayerHandler: ExoPlayerHandler,
    private val spotifyHandler: SpotifyHandler,
    private val youTubeHandler: YouTubeHandler,
    private val webViewHandler: WebViewHandler
) {

    suspend fun play(source: ResolvedSource) {
        when (source) {
            is ResolvedSource.DirectStream -> exoPlayerHandler.play(source)
            is ResolvedSource.SpotifyTrack -> spotifyHandler.play(source)
            is ResolvedSource.YouTubeVideo -> youTubeHandler.play(source)
            is ResolvedSource.LocalFile -> exoPlayerHandler.playLocal(source)
            is ResolvedSource.WebEmbed -> webViewHandler.play(source)
        }
    }
}
```

### Spotify Handler

```kotlin
// SpotifyHandler.kt
class SpotifyHandler @Inject constructor(
    private val context: Context,
    private val spotifyAppRemote: SpotifyAppRemote?
) {

    suspend fun play(source: ResolvedSource.SpotifyTrack) {
        // Option 1: Spotify App Remote (requires Spotify app installed)
        spotifyAppRemote?.playerApi?.play(source.uri)

        // Option 2: Spotify Connect API (like desktop)
        // Use JS bridge to call existing Spotify resolver play() function
    }

    suspend fun checkAvailability(): SpotifyAvailability {
        return when {
            SpotifyAppRemote.isSpotifyInstalled(context) -> SpotifyAvailability.APP_AVAILABLE
            hasSpotifyWebToken() -> SpotifyAvailability.WEB_AVAILABLE
            else -> SpotifyAvailability.NOT_AVAILABLE
        }
    }
}
```

### YouTube Handler

```kotlin
// YouTubeHandler.kt
class YouTubeHandler @Inject constructor(
    private val context: Context
) {
    // Option 1: Extract audio URL and play via ExoPlayer
    // (May violate ToS - use with caution)

    // Option 2: WebView with YouTube IFrame API
    suspend fun play(source: ResolvedSource.YouTubeVideo) {
        YouTubePlayerFragment.newInstance(source.videoId)
            .show(fragmentManager, "youtube_player")
    }

    // Option 3: YouTube Music app intent (if installed)
    fun openInYouTubeMusic(videoId: String) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("https://music.youtube.com/watch?v=$videoId")
            setPackage("com.google.android.apps.youtube.music")
        }
        context.startActivity(intent)
    }
}
```

---

## 4. Local Files Integration

### MediaStore Scanner

```kotlin
// LocalFilesScanner.kt
class LocalFilesScanner @Inject constructor(
    private val context: Context,
    private val database: LocalFilesDatabase
) {

    private val mediaStoreProjection = arrayOf(
        MediaStore.Audio.Media._ID,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.DURATION,
        MediaStore.Audio.Media.DATA,
        MediaStore.Audio.Media.ALBUM_ID,
        MediaStore.Audio.Media.DATE_ADDED
    )

    suspend fun scanMediaStore(): List<LocalTrack> = withContext(Dispatchers.IO) {
        val tracks = mutableListOf<LocalTrack>()

        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
        val sortOrder = "${MediaStore.Audio.Media.TITLE} ASC"

        context.contentResolver.query(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            mediaStoreProjection,
            selection,
            null,
            sortOrder
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                tracks.add(LocalTrack(
                    id = cursor.getLong(0),
                    title = cursor.getString(1),
                    artist = cursor.getString(2),
                    album = cursor.getString(3),
                    duration = cursor.getLong(4),
                    path = cursor.getString(5),
                    albumId = cursor.getLong(6),
                    dateAdded = cursor.getLong(7),
                    contentUri = ContentUris.withAppendedId(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        cursor.getLong(0)
                    )
                ))
            }
        }

        // Store in local database
        database.insertTracks(tracks)

        tracks
    }

    // Get album art
    suspend fun getAlbumArt(albumId: Long): Bitmap? {
        val albumArtUri = ContentUris.withAppendedId(
            Uri.parse("content://media/external/audio/albumart"),
            albumId
        )
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                context.contentResolver.loadThumbnail(albumArtUri, Size(512, 512), null)
            } else {
                MediaStore.Images.Media.getBitmap(context.contentResolver, albumArtUri)
            }
        } catch (e: Exception) {
            null
        }
    }
}
```

### Local Files Resolver Bridge

```kotlin
// Bridge between JS LocalFilesResolver and Android MediaStore
class LocalFilesResolverBridge(
    private val scanner: LocalFilesScanner,
    private val database: LocalFilesDatabase
) : NativeModule {

    @JsExport
    fun search(query: String): JsPromise {
        return JsPromise.fromCoroutine {
            database.searchTracks(query).map { it.toJsObject() }
        }
    }

    @JsExport
    fun resolve(artist: String, track: String, album: String?): JsPromise {
        return JsPromise.fromCoroutine {
            database.findBestMatch(artist, track, album)?.toJsObject()
        }
    }

    @JsExport
    fun getStreamUrl(trackId: Long): String {
        // Return content URI that ExoPlayer can play
        return ContentUris.withAppendedId(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            trackId
        ).toString()
    }
}
```

---

## 5. Storage Architecture

### DataStore for Simple Key-Value (replaces electron-store)

```kotlin
// StorageModule.kt - Provides storage API to JS
class StorageModule(private val context: Context) : NativeModule {

    private val dataStore = context.createDataStore(name = "parachord_store")

    @JsExport
    fun get(key: String): JsPromise {
        return JsPromise.fromFlow(dataStore.data.map { prefs ->
            prefs[stringPreferencesKey(key)]
        })
    }

    @JsExport
    fun set(key: String, value: String): JsPromise {
        return JsPromise.fromCoroutine {
            dataStore.edit { prefs ->
                prefs[stringPreferencesKey(key)] = value
            }
        }
    }

    @JsExport
    fun delete(key: String): JsPromise {
        return JsPromise.fromCoroutine {
            dataStore.edit { prefs ->
                prefs.remove(stringPreferencesKey(key))
            }
        }
    }
}
```

### Room Database for Complex Data

```kotlin
// LibraryDatabase.kt
@Database(
    entities = [
        TrackEntity::class,
        AlbumEntity::class,
        ArtistEntity::class,
        PlaylistEntity::class,
        PlaylistTrackEntity::class,
        SyncSourceEntity::class,
        FailedScrobbleEntity::class
    ],
    version = 1
)
abstract class LibraryDatabase : RoomDatabase() {
    abstract fun trackDao(): TrackDao
    abstract fun albumDao(): AlbumDao
    abstract fun artistDao(): ArtistDao
    abstract fun playlistDao(): PlaylistDao
    abstract fun scrobbleDao(): ScrobbleDao
}

// TrackEntity.kt
@Entity(tableName = "tracks")
data class TrackEntity(
    @PrimaryKey val id: String,  // artist-title-album hash
    val title: String,
    val artist: String,
    val album: String?,
    val duration: Long?,
    val addedAt: Long,
    val playCount: Int = 0,
    val lastPlayed: Long? = null
)

// SyncSourceEntity.kt - Multi-source tracking
@Entity(
    tableName = "sync_sources",
    primaryKeys = ["trackId", "providerId"]
)
data class SyncSourceEntity(
    val trackId: String,
    val providerId: String,
    val externalId: String,
    val addedAt: Long,
    val syncedAt: Long
)
```

---

## 6. OAuth & Authentication

### Custom Tabs for OAuth

```kotlin
// OAuthManager.kt
class OAuthManager @Inject constructor(
    private val context: Context
) {

    // Deep link scheme: parachord://auth/callback

    suspend fun authenticateSpotify(): SpotifyToken? {
        val codeVerifier = generateCodeVerifier()
        val codeChallenge = generateCodeChallenge(codeVerifier)

        val authUri = Uri.Builder()
            .scheme("https")
            .authority("accounts.spotify.com")
            .appendPath("authorize")
            .appendQueryParameter("client_id", SPOTIFY_CLIENT_ID)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", "parachord://auth/spotify/callback")
            .appendQueryParameter("scope", SPOTIFY_SCOPES)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", codeChallenge)
            .build()

        // Launch Custom Tab
        val customTabsIntent = CustomTabsIntent.Builder()
            .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
            .build()
        customTabsIntent.launchUrl(context, authUri)

        // Wait for callback via deep link
        return authCallbackChannel.receive()
    }
}

// AndroidManifest.xml deep link config
// <intent-filter>
//     <action android:name="android.intent.action.VIEW" />
//     <category android:name="android.intent.category.DEFAULT" />
//     <category android:name="android.intent.category.BROWSABLE" />
//     <data android:scheme="parachord" android:host="auth" />
// </intent-filter>
```

---

## 7. Background Sync & Work

### WorkManager for Library Sync

```kotlin
// LibrarySyncWorker.kt
@HiltWorker
class LibrarySyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val jsBridge: JSBridge,
    private val database: LibraryDatabase
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            // Call JS sync engine
            val providers = listOf("spotify", "bandcamp", "soundcloud")

            providers.forEach { providerId ->
                val syncResult = jsBridge.callFunction(
                    "syncEngine.syncProvider",
                    providerId
                ).await<SyncResult>()

                // Update database with synced items
                database.trackDao().insertAll(syncResult.tracks)
            }

            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }

    companion object {
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val syncRequest = PeriodicWorkRequestBuilder<LibrarySyncWorker>(
                repeatInterval = 6,
                repeatIntervalTimeUnit = TimeUnit.HOURS
            )
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    "library_sync",
                    ExistingPeriodicWorkPolicy.KEEP,
                    syncRequest
                )
        }
    }
}
```

### Foreground Service for Playback

```kotlin
// Already covered in PlaybackService - uses MediaBrowserServiceCompat
// which automatically manages foreground service and notification
```

---

## 8. UI Layer with Jetpack Compose

### Main Navigation Structure

```kotlin
// MainActivity.kt
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ParachordTheme {
                ParachordApp()
            }
        }
    }
}

// ParachordApp.kt
@Composable
fun ParachordApp() {
    val navController = rememberNavController()

    Scaffold(
        bottomBar = { ParachordBottomNav(navController) }
    ) { paddingValues ->
        NavHost(
            navController = navController,
            startDestination = "collection",
            modifier = Modifier.padding(paddingValues)
        ) {
            composable("collection") { CollectionScreen() }
            composable("search") { SearchScreen() }
            composable("queue") { QueueScreen() }
            composable("settings") { SettingsScreen() }

            composable("artist/{id}") { ArtistScreen(it.arguments?.getString("id")) }
            composable("album/{id}") { AlbumScreen(it.arguments?.getString("id")) }
            composable("playlist/{id}") { PlaylistScreen(it.arguments?.getString("id")) }
        }
    }

    // Mini player overlay
    MiniPlayerBar()
}
```

### Collection Screen (mirrors desktop)

```kotlin
@Composable
fun CollectionScreen(viewModel: CollectionViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Column {
        // Tab row: Tracks | Albums | Artists | Playlists
        TabRow(selectedTabIndex = uiState.selectedTab) {
            Tab(text = { Text("Tracks") }, selected = uiState.selectedTab == 0, ...)
            Tab(text = { Text("Albums") }, selected = uiState.selectedTab == 1, ...)
            Tab(text = { Text("Artists") }, selected = uiState.selectedTab == 2, ...)
            Tab(text = { Text("Playlists") }, selected = uiState.selectedTab == 3, ...)
        }

        when (uiState.selectedTab) {
            0 -> TrackList(tracks = uiState.tracks, onTrackClick = viewModel::playTrack)
            1 -> AlbumGrid(albums = uiState.albums, onAlbumClick = { ... })
            2 -> ArtistList(artists = uiState.artists, onArtistClick = { ... })
            3 -> PlaylistList(playlists = uiState.playlists, onPlaylistClick = { ... })
        }
    }
}
```

### Track Row Component

```kotlin
@Composable
fun TrackRow(
    track: Track,
    resolverStates: Map<String, ResolverState>,
    onPlay: () -> Unit,
    onAddToQueue: () -> Unit,
    onAddToPlaylist: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onPlay() }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Album art
        AsyncImage(
            model = track.albumArt,
            modifier = Modifier.size(48.dp)
        )

        Spacer(Modifier.width(12.dp))

        // Track info
        Column(modifier = Modifier.weight(1f)) {
            Text(track.title, style = MaterialTheme.typography.bodyLarge)
            Text(track.artist, style = MaterialTheme.typography.bodyMedium)
        }

        // Resolver availability indicators (like desktop)
        ResolverIndicators(
            resolvers = resolverStates,
            modifier = Modifier.padding(end = 8.dp)
        )

        // More menu
        IconButton(onClick = { /* show dropdown */ }) {
            Icon(Icons.Default.MoreVert, contentDescription = "More")
        }
    }
}

@Composable
fun ResolverIndicators(resolvers: Map<String, ResolverState>) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        resolvers.forEach { (resolverId, state) ->
            ResolverDot(
                color = state.color,
                state = state.availability  // available, resolving, unavailable
            )
        }
    }
}
```

---

## 9. Scrobbling Integration

### Scrobble Manager Bridge

```kotlin
// ScrobbleManager.kt - Kotlin wrapper around JS ScrobbleManager
class ScrobbleManager @Inject constructor(
    private val jsBridge: JSBridge,
    private val networkMonitor: NetworkMonitor
) {

    private var currentTrack: Track? = null
    private var startTime: Long = 0
    private var accumulatedPlayTime: Long = 0

    suspend fun onTrackStart(track: Track) {
        currentTrack = track
        startTime = System.currentTimeMillis()
        accumulatedPlayTime = 0

        // Call JS scrobble manager
        jsBridge.callFunction("scrobbleManager.onTrackStart", track.toJsObject())
    }

    suspend fun onProgressUpdate(positionSeconds: Long) {
        jsBridge.callFunction("scrobbleManager.onProgressUpdate", positionSeconds)
    }

    suspend fun onTrackEnd() {
        jsBridge.callFunction("scrobbleManager.onTrackEnd")
    }

    // Retry failed scrobbles when online
    fun startRetryLoop() {
        networkMonitor.isOnline.onEach { isOnline ->
            if (isOnline) {
                jsBridge.callFunction("scrobbleManager.retryFailedScrobbles")
            }
        }.launchIn(coroutineScope)
    }
}
```

---

## 10. Resolution Scheduler Adaptation

### Visibility-Aware Resolution (like desktop)

```kotlin
// ResolutionViewModel.kt
@HiltViewModel
class ResolutionViewModel @Inject constructor(
    private val jsBridge: JSBridge
) : ViewModel() {

    private val resolutionScheduler = jsBridge.getObject("resolutionScheduler")

    // Called when LazyColumn items become visible
    fun updateVisibleTracks(contextId: String, visibleIndices: IntRange, allTracks: List<Track>) {
        val visibleTracks = allTracks.slice(visibleIndices)

        viewModelScope.launch {
            jsBridge.callFunction(
                "resolutionScheduler.updateVisibility",
                contextId,
                visibleTracks.map { it.toJsObject() }
            )
        }
    }

    // Register resolution context
    fun registerContext(
        contextId: String,
        type: String,  // "queue", "page", "pool", etc.
        options: Map<String, Any>
    ) {
        viewModelScope.launch {
            jsBridge.callFunction(
                "resolutionScheduler.registerContext",
                contextId,
                type,
                options
            )
        }
    }
}

// In Composable
@Composable
fun TrackList(
    tracks: List<Track>,
    contextId: String,
    resolutionViewModel: ResolutionViewModel = hiltViewModel()
) {
    val listState = rememberLazyListState()

    // Track visible items
    LaunchedEffect(listState) {
        snapshotFlow {
            listState.layoutInfo.visibleItemsInfo
                .map { it.index }
                .let { it.firstOrNull()..it.lastOrNull() }
        }.collect { visibleRange ->
            resolutionViewModel.updateVisibleTracks(contextId, visibleRange, tracks)
        }
    }

    LazyColumn(state = listState) {
        items(tracks, key = { it.id }) { track ->
            TrackRow(track = track, ...)
        }
    }
}
```

---

## 11. Module Structure

```
app/
├── src/main/
│   ├── java/com/parachord/android/
│   │   ├── ParachordApplication.kt
│   │   ├── di/
│   │   │   ├── AppModule.kt
│   │   │   ├── DatabaseModule.kt
│   │   │   ├── JSBridgeModule.kt
│   │   │   └── PlaybackModule.kt
│   │   │
│   │   ├── bridge/
│   │   │   ├── JSBridge.kt
│   │   │   ├── NativeModule.kt
│   │   │   └── modules/
│   │   │       ├── FetchModule.kt
│   │   │       ├── StorageModule.kt
│   │   │       ├── CryptoModule.kt
│   │   │       ├── FileSystemModule.kt
│   │   │       └── LocalFilesModule.kt
│   │   │
│   │   ├── playback/
│   │   │   ├── PlaybackService.kt
│   │   │   ├── SourceRouter.kt
│   │   │   ├── handlers/
│   │   │   │   ├── ExoPlayerHandler.kt
│   │   │   │   ├── SpotifyHandler.kt
│   │   │   │   ├── YouTubeHandler.kt
│   │   │   │   └── WebViewHandler.kt
│   │   │   └── ScrobbleManager.kt
│   │   │
│   │   ├── auth/
│   │   │   ├── OAuthManager.kt
│   │   │   ├── OAuthCallbackActivity.kt
│   │   │   └── TokenRepository.kt
│   │   │
│   │   ├── data/
│   │   │   ├── db/
│   │   │   │   ├── LibraryDatabase.kt
│   │   │   │   ├── entities/
│   │   │   │   └── dao/
│   │   │   ├── repository/
│   │   │   │   ├── LibraryRepository.kt
│   │   │   │   ├── PlaylistRepository.kt
│   │   │   │   └── ResolverRepository.kt
│   │   │   └── datastore/
│   │   │       └── SettingsDataStore.kt
│   │   │
│   │   ├── localfiles/
│   │   │   ├── LocalFilesScanner.kt
│   │   │   └── MediaStoreObserver.kt
│   │   │
│   │   ├── sync/
│   │   │   └── LibrarySyncWorker.kt
│   │   │
│   │   └── ui/
│   │       ├── MainActivity.kt
│   │       ├── ParachordApp.kt
│   │       ├── theme/
│   │       │   └── ParachordTheme.kt
│   │       ├── screens/
│   │       │   ├── collection/
│   │       │   ├── search/
│   │       │   ├── queue/
│   │       │   ├── settings/
│   │       │   ├── artist/
│   │       │   ├── album/
│   │       │   └── playlist/
│   │       ├── components/
│   │       │   ├── TrackRow.kt
│   │       │   ├── AlbumCard.kt
│   │       │   ├── MiniPlayer.kt
│   │       │   ├── NowPlayingSheet.kt
│   │       │   └── ResolverIndicators.kt
│   │       └── viewmodels/
│   │
│   ├── assets/
│   │   ├── js/
│   │   │   ├── resolver-loader.js      (copied from desktop)
│   │   │   ├── scrobble-manager.js     (copied from desktop)
│   │   │   ├── resolution-scheduler.js (copied from desktop)
│   │   │   └── sync-engine/            (copied from desktop)
│   │   └── resolvers/
│   │       ├── spotify.axe
│   │       ├── youtube.axe
│   │       ├── bandcamp.axe
│   │       └── ...
│   │
│   └── res/
│       ├── values/
│       ├── drawable/
│       └── ...
```

---

## 12. Build Configuration

### build.gradle.kts (app)

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.parachord.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.parachord.android"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    // Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")

    // Compose
    implementation(platform("androidx.compose:compose-bom:2024.02.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // Media
    implementation("androidx.media3:media3-exoplayer:1.2.1")
    implementation("androidx.media3:media3-session:1.2.1")
    implementation("androidx.media3:media3-ui:1.2.1")

    // Hilt DI
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")
    implementation("androidx.hilt:hilt-navigation-compose:1.1.0")
    implementation("androidx.hilt:hilt-work:1.1.0")

    // Room
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // DataStore
    implementation("androidx.datastore:datastore-preferences:1.0.0")

    // WorkManager
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // JS Engine (Hermes)
    implementation("com.facebook.hermes:hermes-android:0.72.0")

    // Image loading
    implementation("io.coil-kt:coil-compose:2.5.0")

    // Spotify
    implementation("com.spotify.android:auth:2.1.0")
    // implementation("com.spotify.android:app-remote:0.7.2") // Optional

    // Custom Tabs for OAuth
    implementation("androidx.browser:browser:1.7.0")
}
```

---

## 13. Migration Path

### Phase 1: Core Infrastructure
1. Set up Android project with Compose + Hilt
2. Integrate Hermes JS engine
3. Create native module bindings (fetch, storage, crypto)
4. Load and test resolver-loader.js

### Phase 2: Basic Playback
1. Implement PlaybackService with ExoPlayer
2. Add MediaSession for system integration
3. Create SourceRouter for different playback types
4. Test with direct URL resolvers (SoundCloud previews, etc.)

### Phase 3: Resolver Integration
1. Bundle built-in .axe resolvers
2. Implement Spotify handler (App Remote or Connect API)
3. Implement YouTube handler (WebView or extract)
4. Test resolution chain

### Phase 4: Library Features
1. Implement Room database schema
2. Create MediaStore scanner for local files
3. Integrate sync engine
4. Implement scrobbling

### Phase 5: UI Polish
1. Build all Compose screens
2. Implement resolver indicators
3. Add mini player and now playing sheet
4. Dark theme and styling

### Phase 6: Platform Features
1. WorkManager for background sync
2. Widget for quick access
3. Android Auto integration
4. Wear OS companion (future)

---

## 14. Key Differences from Desktop

| Aspect | Desktop | Android |
|--------|---------|---------|
| **JS Execution** | Node.js in Electron | Hermes engine |
| **UI Framework** | React + Tailwind | Jetpack Compose |
| **Playback** | HTML5 Audio / Spotify | ExoPlayer / Spotify SDK |
| **Background** | Always running | Foreground Service |
| **Storage** | electron-store + SQLite | DataStore + Room |
| **Local Files** | Direct file system | MediaStore API |
| **OAuth** | Express callback server | Custom Tabs + Deep Links |
| **Extensions** | Browser extension | N/A (in-app) |
| **Multi-window** | Electron windows | Single activity |

---

## 15. Future Considerations

### Android Auto Integration
```kotlin
// CarAppService for Android Auto
class ParachordCarAppService : CarAppService() {
    override fun createHostValidator() = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    override fun onCreateSession() = ParachordCarSession()
}
```

### Wear OS Companion
- Now playing display
- Playback controls
- Scrobble indicator

### Widgets
- Now playing widget
- Quick access to playlists
- Resolver status

### Offline Mode
- Download tracks from supported resolvers
- Cache resolved sources
- Queue offline-available tracks only

---

## 16. Recent Desktop Features to Support

These features were recently added to the desktop app and should be included in mobile:

### Purchase/Buy Button (Bandcamp, Qobuz)

The desktop app now shows a "Buy" button in the playbar when playing tracks from resolvers that support purchases (Bandcamp, Qobuz). This requires:

1. **New `purchase` capability in .axe format** - Already supported by JS engine
2. **Purchase URL detection** - Uses `bandcampUrl` or constructs from `qobuzId`
3. **Confidence threshold** - Only shows when resolver confidence is high enough
4. **Artist matching** - Validates artist name matches to avoid wrong purchases

```kotlin
// BuyButtonHandler.kt
class BuyButtonHandler @Inject constructor(
    private val context: Context
) {
    private val MIN_PURCHASE_CONFIDENCE = 0.7

    fun getPurchasableSource(track: Track, resolvedSources: Map<String, ResolvedSource>): PurchaseInfo? {
        // Check Bandcamp
        val bandcamp = resolvedSources["bandcamp"]
        if (bandcamp != null &&
            bandcamp.confidence >= MIN_PURCHASE_CONFIDENCE &&
            artistsMatch(track.artist, bandcamp.artist)) {
            bandcamp.bandcampUrl?.let {
                return PurchaseInfo("bandcamp", "Bandcamp", it)
            }
        }

        // Check Qobuz
        val qobuz = resolvedSources["qobuz"]
        if (qobuz != null &&
            qobuz.confidence >= MIN_PURCHASE_CONFIDENCE &&
            artistsMatch(track.artist, qobuz.artist)) {
            qobuz.qobuzId?.let {
                return PurchaseInfo("qobuz", "Qobuz", "https://www.qobuz.com/us-en/track/$it")
            }
        }

        return null
    }

    fun openPurchaseUrl(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        context.startActivity(intent)
    }
}

data class PurchaseInfo(
    val resolverId: String,
    val resolverName: String,
    val purchaseUrl: String
)
```

**UI Integration:**
```kotlin
// In MiniPlayerView or NowPlayingView
@Composable
fun BuyButton(purchaseInfo: PurchaseInfo?, onClick: () -> Unit) {
    if (purchaseInfo != null) {
        IconButton(onClick = onClick) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Outlined.ShoppingCart,
                    contentDescription = "Buy"
                )
                Text(
                    text = purchaseInfo.resolverName,
                    style = MaterialTheme.typography.labelSmall
                )
            }
        }
    }
}
```

### Conversational DJ / AI Chat Integration

The desktop app is adding a conversational AI DJ feature with pluggable AI backends. This introduces a new `chat` capability for .axe plugins:

**New Plugin Capability:**
```json
{
  "capabilities": {
    "chat": true
  },
  "implementation": {
    "chat": "async function(messages, tools, config) { ... }"
  }
}
```

**Supported Providers:**
- **Ollama** (local, free, private)
- **OpenAI** (cloud, GPT-4o)
- **Google Gemini** (cloud, free tier)
- **Anthropic Claude** (cloud)
- **Groq** (cloud, fast inference)

**Android Implementation:**

```kotlin
// AIChatService.kt
class AIChatService @Inject constructor(
    private val jsBridge: JSBridge
) {
    private val messages = mutableListOf<ChatMessage>()

    suspend fun sendMessage(userMessage: String, context: PlaybackContext): ChatResponse {
        messages.add(ChatMessage(role = "user", content = userMessage))

        // Build system prompt with context
        val systemPrompt = buildSystemPrompt(context)

        // Call JS chat implementation
        val response = jsBridge.callFunction(
            "chatProvider.chat",
            listOf(
                mapOf("role" to "system", "content" to systemPrompt),
                *messages.toTypedArray()
            ),
            DJ_TOOLS,
            config
        ).await<ChatResponse>()

        // Handle tool calls
        if (response.toolCalls.isNotEmpty()) {
            val toolResults = executeTools(response.toolCalls)
            // Get follow-up response after tool execution
            return getFollowUp(response, toolResults)
        }

        messages.add(ChatMessage(role = "assistant", content = response.content))
        return response
    }

    private suspend fun executeTools(toolCalls: List<ToolCall>): List<ToolResult> {
        return toolCalls.map { call ->
            when (call.name) {
                "play" -> executePplay(call.arguments)
                "control" -> executeControl(call.arguments)
                "search" -> executeSearch(call.arguments)
                "queue_add" -> executeQueueAdd(call.arguments)
                "queue_clear" -> executeQueueClear()
                "shuffle" -> executeShuffle(call.arguments)
                else -> ToolResult(success = false, error = "Unknown tool")
            }
        }
    }
}

// DJ Tool definitions (matching desktop)
val DJ_TOOLS = listOf(
    Tool(
        name = "play",
        description = "Play a specific track",
        parameters = mapOf(
            "artist" to ToolParam("string", "Artist name"),
            "title" to ToolParam("string", "Track title")
        )
    ),
    Tool(
        name = "control",
        description = "Control playback",
        parameters = mapOf(
            "action" to ToolParam("string", "pause|resume|skip|previous")
        )
    ),
    Tool(
        name = "search",
        description = "Search for tracks",
        parameters = mapOf(
            "query" to ToolParam("string", "Search query"),
            "limit" to ToolParam("number", "Max results", optional = true)
        )
    ),
    Tool(
        name = "queue_add",
        description = "Add tracks to queue",
        parameters = mapOf(
            "tracks" to ToolParam("array", "Tracks to add"),
            "position" to ToolParam("string", "next|last", optional = true)
        )
    ),
    Tool(
        name = "queue_clear",
        description = "Clear the queue"
    ),
    Tool(
        name = "shuffle",
        description = "Toggle shuffle",
        parameters = mapOf(
            "enabled" to ToolParam("boolean", "Enable shuffle")
        )
    )
)
```

**Chat UI:**
```kotlin
@Composable
fun ChatPanel(
    viewModel: ChatViewModel = hiltViewModel(),
    onDismiss: () -> Unit
) {
    val messages by viewModel.messages.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()

    Column(modifier = Modifier.fillMaxSize()) {
        // Header
        TopAppBar(
            title = { Text("AI DJ") },
            navigationIcon = {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, "Close")
                }
            },
            actions = {
                // Provider selector
                ProviderSelector(
                    providers = viewModel.chatProviders,
                    selected = viewModel.selectedProvider,
                    onSelect = viewModel::selectProvider
                )
            }
        )

        // Messages
        LazyColumn(
            modifier = Modifier.weight(1f),
            reverseLayout = true
        ) {
            items(messages.reversed()) { message ->
                ChatBubble(message)
            }
        }

        // Input
        ChatInput(
            onSend = viewModel::sendMessage,
            isLoading = isLoading
        )
    }
}
```

### Token Refresh Management

The desktop app now proactively refreshes OAuth tokens (e.g., SoundCloud) before they expire:

```kotlin
// TokenRefreshManager.kt
class TokenRefreshManager @Inject constructor(
    private val settingsStore: SettingsStore,
    private val workManager: WorkManager
) {
    fun scheduleTokenRefresh(providerId: String, expiresIn: Long) {
        // Schedule refresh at 80% of expiry time
        val refreshDelay = (expiresIn * 0.8).toLong()

        val refreshWork = OneTimeWorkRequestBuilder<TokenRefreshWorker>()
            .setInitialDelay(refreshDelay, TimeUnit.SECONDS)
            .setInputData(workDataOf("providerId" to providerId))
            .build()

        workManager.enqueueUniqueWork(
            "token_refresh_$providerId",
            ExistingWorkPolicy.REPLACE,
            refreshWork
        )
    }
}

@HiltWorker
class TokenRefreshWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val oAuthManager: OAuthManager
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val providerId = inputData.getString("providerId") ?: return Result.failure()

        return try {
            oAuthManager.refreshToken(providerId)
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}
```

---

## Summary

This architecture achieves **100% reuse** of:
- All .axe resolver plugins
- ResolverLoader logic
- ScrobbleManager and all scrobbler plugins
- SyncEngine and all sync providers
- ResolutionScheduler priority logic

While providing a **native Android experience** through:
- Jetpack Compose UI (Material 3)
- ExoPlayer for high-quality playback
- MediaSession for system integration
- WorkManager for background tasks
- Room/DataStore for persistence
- Android-native OAuth flow
