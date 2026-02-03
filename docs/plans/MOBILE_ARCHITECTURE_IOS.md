# Parachord Mobile Architecture - iOS

## Executive Summary

This document outlines the architecture for a native iOS version of Parachord that maximizes reuse of existing concepts, plugins (.axe resolvers), and business logic while embracing iOS-native patterns with SwiftUI and Apple's frameworks.

**Core Principle:** Leverage JavaScriptCore (built into iOS) to run the JavaScript plugin ecosystem unchanged, while wrapping it with native Swift UI and Apple system integration.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Parachord iOS App                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                         UI Layer (Swift)                             │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────────┐│ │
│  │  │ SwiftUI   │ │ Observable│ │ Navigation│ │ Human Interface       ││ │
│  │  │ Views     │ │ Objects   │ │ Stack     │ │ Guidelines Theme      ││ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                      │
│                                    ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    Native Services Layer (Swift)                     │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────────┐ │ │
│  │  │ AVPlayer    │ │ MPNowPlaying │ │ ASWebAuth   │ │ FileManager   │ │ │
│  │  │ Service     │ │ InfoCenter   │ │ Session     │ │ + MediaPlayer │ │ │
│  │  └─────────────┘ └──────────────┘ └─────────────┘ └───────────────┘ │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────────┐ │ │
│  │  │ BGTaskSched │ │ MPRemote     │ │ Audio       │ │ Network       │ │ │
│  │  │ (Sync)      │ │ CommandCenter│ │ Session     │ │ Monitor       │ │ │
│  │  └─────────────┘ └──────────────┘ └─────────────┘ └───────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                      │
│                                    ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                       JS Bridge Layer (Swift ↔ JS)                   │ │
│  │  ┌──────────────────────────────────────────────────────────────┐   │ │
│  │  │  JavaScriptCore (Built-in)                                    │   │ │
│  │  │  • Runs .axe resolver implementations unchanged               │   │ │
│  │  │  • Executes scrobbler plugins                                 │   │ │
│  │  │  • Handles resolution scheduling logic                        │   │ │
│  │  └──────────────────────────────────────────────────────────────┘   │ │
│  │  ┌──────────────────────────────────────────────────────────────┐   │ │
│  │  │  Native Bindings (@objc exports)                              │   │ │
│  │  │  • fetch() → URLSession                                       │   │ │
│  │  │  • storage → UserDefaults/SwiftData                           │   │ │
│  │  │  • playback → AVPlayer commands                               │   │ │
│  │  │  • crypto → CryptoKit                                         │   │ │
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

## Component Mapping: Desktop → iOS

| Desktop (Electron)        | iOS Equivalent                         | Reuse Level |
|---------------------------|----------------------------------------|-------------|
| **UI: React + Tailwind**  | SwiftUI + Custom Theme                 | Redesign    |
| **IPC: electron IPC**     | Swift Concurrency (async/await)        | Replace     |
| **State: React hooks**    | @Observable / @State                   | Pattern     |
| **Storage: electron-store** | UserDefaults / SwiftData              | Replace     |
| **Resolvers: .axe files** | Same .axe files via JavaScriptCore     | **100%**    |
| **ResolverLoader**        | Same JS in JSC engine                  | **100%**    |
| **ScrobbleManager**       | Same JS in JSC engine                  | **100%**    |
| **Scrobblers**            | Same JS plugins                        | **100%**    |
| **SyncEngine**            | Same JS in JSC engine                  | **100%**    |
| **ResolutionScheduler**   | Same JS (with visibility callbacks)    | **100%**    |
| **Audio: HTML5 audio**    | AVPlayer / AVQueuePlayer               | Replace     |
| **Spotify: Connect API**  | Spotify iOS SDK / Connect API          | Adapt       |
| **YouTube: Extension**    | WKWebView or YouTube IFrame API        | Adapt       |
| **Local files: fs/sqlite**| MPMediaQuery + SwiftData               | Adapt       |
| **OAuth: Express server** | ASWebAuthenticationSession             | Replace     |
| **Media keys**            | MPRemoteCommandCenter                  | Replace     |
| **Background: polling**   | BGTaskScheduler + Audio background     | Replace     |
| **Extension: WebSocket**  | Not applicable (in-app)                | N/A         |

---

## 1. JavaScriptCore Integration

### Why JavaScriptCore

JavaScriptCore is **built into iOS** - no external dependencies needed:
- Ships with every iOS device
- Optimized by Apple for mobile
- Native Swift ↔ JavaScript bridging via `@objc` exports
- Supports ES6+ JavaScript

### JS Bridge Architecture

```swift
// JSBridge.swift
import JavaScriptCore

@MainActor
class JSBridge: ObservableObject {
    private let context: JSContext

    init() {
        context = JSContext()!

        // Set up exception handler
        context.exceptionHandler = { context, exception in
            print("JS Error: \(exception?.toString() ?? "unknown")")
        }

        // Register native modules
        registerFetchModule()
        registerStorageModule()
        registerPlaybackModule()
        registerCryptoModule()
        registerFileSystemModule()

        // Load core business logic from bundle
        loadScript("resolver-loader")
        loadScript("scrobble-manager")
        loadScript("resolution-scheduler")
        loadScript("sync-engine/index")
    }

    private func loadScript(_ name: String) {
        guard let path = Bundle.main.path(forResource: name, ofType: "js"),
              let script = try? String(contentsOfFile: path, encoding: .utf8) else {
            fatalError("Failed to load \(name).js")
        }
        context.evaluateScript(script)
    }

    // Call JS functions from Swift
    func resolveTrack(artist: String, track: String, album: String?) async throws -> ResolvedSource? {
        return try await withCheckedThrowingContinuation { continuation in
            let callback: @convention(block) (JSValue?) -> Void = { result in
                if let result = result, !result.isNull && !result.isUndefined {
                    continuation.resume(returning: ResolvedSource(jsValue: result))
                } else {
                    continuation.resume(returning: nil)
                }
            }

            context.setObject(callback, forKeyedSubscript: "_resolveCallback" as NSString)
            context.evaluateScript("""
                resolverLoader.resolve('\(artist)', '\(track)', '\(album ?? "")')
                    .then(result => _resolveCallback(result))
                    .catch(err => _resolveCallback(null))
            """)
        }
    }

    func loadResolver(axeContent: String) -> Bool {
        let result = context.evaluateScript("resolverLoader.loadResolver(\(axeContent))")
        return result?.toBool() ?? false
    }
}
```

### Native Module: Fetch

```swift
// FetchModule.swift
extension JSBridge {
    private func registerFetchModule() {
        let fetch: @convention(block) (String, JSValue?) -> JSValue = { [weak self] url, options in
            guard let self = self else { return JSValue(nullIn: self?.context) }

            let promise = JSValue(newPromiseIn: context) { resolve, reject in
                Task {
                    do {
                        var request = URLRequest(url: URL(string: url)!)

                        // Apply headers from options
                        if let headers = options?.forProperty("headers")?.toDictionary() as? [String: String] {
                            headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
                        }

                        // Apply method
                        if let method = options?.forProperty("method")?.toString() {
                            request.httpMethod = method
                        }

                        // Apply body
                        if let body = options?.forProperty("body")?.toString() {
                            request.httpBody = body.data(using: .utf8)
                        }

                        let (data, response) = try await URLSession.shared.data(for: request)

                        let jsResponse = self.createJSResponse(data: data, response: response as! HTTPURLResponse)
                        resolve?.call(withArguments: [jsResponse])
                    } catch {
                        reject?.call(withArguments: [error.localizedDescription])
                    }
                }
            }

            return promise!
        }

        context.setObject(fetch, forKeyedSubscript: "fetch" as NSString)
    }

    private func createJSResponse(data: Data, response: HTTPURLResponse) -> JSValue {
        let jsResponse = JSValue(newObjectIn: context)!
        jsResponse.setObject(response.statusCode, forKeyedSubscript: "status" as NSString)
        jsResponse.setObject(response.statusCode >= 200 && response.statusCode < 300,
                            forKeyedSubscript: "ok" as NSString)

        // json() method
        let json: @convention(block) () -> JSValue = {
            if let jsonString = String(data: data, encoding: .utf8) {
                return self.context.evaluateScript("(\(jsonString))")!
            }
            return JSValue(nullIn: self.context)
        }
        jsResponse.setObject(json, forKeyedSubscript: "json" as NSString)

        // text() method
        let text: @convention(block) () -> String = {
            return String(data: data, encoding: .utf8) ?? ""
        }
        jsResponse.setObject(text, forKeyedSubscript: "text" as NSString)

        return jsResponse
    }
}
```

### Native Module: Storage

```swift
// StorageModule.swift
extension JSBridge {
    private func registerStorageModule() {
        let storage = JSValue(newObjectIn: context)!

        let get: @convention(block) (String) -> JSValue? = { key in
            if let value = UserDefaults.standard.string(forKey: "parachord.\(key)") {
                // Return as JS object if it's JSON
                if value.hasPrefix("{") || value.hasPrefix("[") {
                    return self.context.evaluateScript("(\(value))")
                }
                return JSValue(object: value, in: self.context)
            }
            return JSValue(nullIn: self.context)
        }

        let set: @convention(block) (String, JSValue) -> Void = { key, value in
            let stringValue: String
            if value.isString {
                stringValue = value.toString()
            } else {
                // Serialize objects to JSON
                let jsonData = try? JSONSerialization.data(
                    withJSONObject: value.toObject() as Any
                )
                stringValue = String(data: jsonData ?? Data(), encoding: .utf8) ?? ""
            }
            UserDefaults.standard.set(stringValue, forKey: "parachord.\(key)")
        }

        let delete: @convention(block) (String) -> Void = { key in
            UserDefaults.standard.removeObject(forKey: "parachord.\(key)")
        }

        storage.setObject(get, forKeyedSubscript: "get" as NSString)
        storage.setObject(set, forKeyedSubscript: "set" as NSString)
        storage.setObject(delete, forKeyedSubscript: "delete" as NSString)

        context.setObject(storage, forKeyedSubscript: "storage" as NSString)
    }
}
```

### Native Module: Crypto

```swift
// CryptoModule.swift
import CryptoKit

extension JSBridge {
    private func registerCryptoModule() {
        let crypto = JSValue(newObjectIn: context)!

        let md5: @convention(block) (String) -> String = { input in
            let digest = Insecure.MD5.hash(data: input.data(using: .utf8)!)
            return digest.map { String(format: "%02hhx", $0) }.joined()
        }

        let sha256: @convention(block) (String) -> String = { input in
            let digest = SHA256.hash(data: input.data(using: .utf8)!)
            return digest.map { String(format: "%02hhx", $0) }.joined()
        }

        crypto.setObject(md5, forKeyedSubscript: "md5" as NSString)
        crypto.setObject(sha256, forKeyedSubscript: "sha256" as NSString)

        context.setObject(crypto, forKeyedSubscript: "crypto" as NSString)
    }
}
```

---

## 2. Playback Architecture

### AVPlayer-Based Playback Service

```swift
// PlaybackService.swift
import AVFoundation
import MediaPlayer

@MainActor
@Observable
class PlaybackService {
    static let shared = PlaybackService()

    private var player: AVPlayer?
    private var playerItemObserver: NSKeyValueObservation?
    private var timeObserver: Any?

    var currentTrack: Track?
    var isPlaying: Bool = false
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var playbackState: PlaybackState = .stopped

    private let jsBridge: JSBridge
    private let scrobbleManager: ScrobbleManager

    init(jsBridge: JSBridge = .shared, scrobbleManager: ScrobbleManager = .shared) {
        self.jsBridge = jsBridge
        self.scrobbleManager = scrobbleManager

        setupAudioSession()
        setupRemoteCommandCenter()
        setupNowPlayingInfoCenter()
    }

    private func setupAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: [.allowAirPlay, .allowBluetooth]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Failed to set up audio session: \(error)")
        }
    }

    func play(track: Track, source: ResolvedSource) async {
        currentTrack = track

        switch source {
        case .directURL(let url, let headers):
            await playDirectURL(url, headers: headers)
        case .spotify(let trackId):
            await playViaSpotify(trackId: trackId)
        case .youtube(let videoId):
            await playYouTube(videoId: videoId)
        case .localFile(let url):
            await playLocalFile(url)
        }

        await scrobbleManager.onTrackStart(track)
        updateNowPlayingInfo()
    }

    private func playDirectURL(_ urlString: String, headers: [String: String]?) async {
        guard let url = URL(string: urlString) else { return }

        var asset: AVURLAsset
        if let headers = headers {
            asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        } else {
            asset = AVURLAsset(url: url)
        }

        let playerItem = AVPlayerItem(asset: asset)
        setupPlayerItemObservers(playerItem)

        if player == nil {
            player = AVPlayer(playerItem: playerItem)
        } else {
            player?.replaceCurrentItem(with: playerItem)
        }

        player?.play()
        isPlaying = true
        playbackState = .playing
    }

    private func playLocalFile(_ url: URL) async {
        let playerItem = AVPlayerItem(url: url)
        setupPlayerItemObservers(playerItem)

        if player == nil {
            player = AVPlayer(playerItem: playerItem)
        } else {
            player?.replaceCurrentItem(with: playerItem)
        }

        player?.play()
        isPlaying = true
        playbackState = .playing
    }

    private func setupPlayerItemObservers(_ item: AVPlayerItem) {
        // Observe when track ends
        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                await self?.onTrackEnded()
            }
        }

        // Observe duration
        playerItemObserver = item.observe(\.duration, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                self?.duration = item.duration.seconds
            }
        }

        // Periodic time observer for progress
        timeObserver = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 1),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                self?.currentTime = time.seconds
                await self?.scrobbleManager.onProgressUpdate(Int(time.seconds))
            }
        }
    }

    private func onTrackEnded() async {
        await scrobbleManager.onTrackEnd()
        // Advance to next track in queue
        await QueueManager.shared.playNext()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        playbackState = .paused
        updateNowPlayingInfo()
    }

    func resume() {
        player?.play()
        isPlaying = true
        playbackState = .playing
        updateNowPlayingInfo()
    }

    func seek(to time: TimeInterval) {
        player?.seek(to: CMTime(seconds: time, preferredTimescale: 1))
        currentTime = time
    }

    func stop() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        isPlaying = false
        playbackState = .stopped
        currentTrack = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
}
```

### Remote Command Center (Lock Screen, AirPods, CarPlay)

```swift
// PlaybackService+RemoteCommands.swift
extension PlaybackService {
    func setupRemoteCommandCenter() {
        let commandCenter = MPRemoteCommandCenter.shared()

        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.resume()
            return .success
        }

        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }

        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            if self?.isPlaying == true {
                self?.pause()
            } else {
                self?.resume()
            }
            return .success
        }

        commandCenter.nextTrackCommand.addTarget { _ in
            Task {
                await QueueManager.shared.playNext()
            }
            return .success
        }

        commandCenter.previousTrackCommand.addTarget { _ in
            Task {
                await QueueManager.shared.playPrevious()
            }
            return .success
        }

        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.seek(to: event.positionTime)
            return .success
        }

        // Skip forward/backward (for AirPods double/triple tap)
        commandCenter.skipForwardCommand.preferredIntervals = [15]
        commandCenter.skipForwardCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.seek(to: self.currentTime + 15)
            return .success
        }

        commandCenter.skipBackwardCommand.preferredIntervals = [15]
        commandCenter.skipBackwardCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.seek(to: max(0, self.currentTime - 15))
            return .success
        }
    }

    func updateNowPlayingInfo() {
        guard let track = currentTrack else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var nowPlayingInfo: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]

        if let album = track.album {
            nowPlayingInfo[MPMediaItemPropertyAlbumTitle] = album
        }

        // Load album art asynchronously
        Task {
            if let artworkImage = await loadAlbumArt(for: track) {
                let artwork = MPMediaItemArtwork(boundsSize: artworkImage.size) { _ in
                    artworkImage
                }
                nowPlayingInfo[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
            }
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
    }

    private func loadAlbumArt(for track: Track) async -> UIImage? {
        // Try to load from cache or fetch from URL
        if let artworkURL = track.artworkURL,
           let url = URL(string: artworkURL) {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                return UIImage(data: data)
            } catch {
                return nil
            }
        }
        return nil
    }
}
```

---

## 3. Resolver Source Handlers

### Source Type Routing

```swift
// ResolvedSource.swift
enum ResolvedSource {
    case directURL(url: String, headers: [String: String]?)
    case spotify(trackId: String)
    case youtube(videoId: String)
    case localFile(url: URL)
    case webEmbed(embedURL: String)

    init?(jsValue: JSValue) {
        guard let type = jsValue.forProperty("type")?.toString() else { return nil }

        switch type {
        case "direct":
            let url = jsValue.forProperty("url")?.toString() ?? ""
            let headers = jsValue.forProperty("headers")?.toDictionary() as? [String: String]
            self = .directURL(url: url, headers: headers)
        case "spotify":
            let trackId = jsValue.forProperty("trackId")?.toString() ?? ""
            self = .spotify(trackId: trackId)
        case "youtube":
            let videoId = jsValue.forProperty("videoId")?.toString() ?? ""
            self = .youtube(videoId: videoId)
        case "local":
            let path = jsValue.forProperty("path")?.toString() ?? ""
            self = .localFile(url: URL(fileURLWithPath: path))
        case "embed":
            let embedURL = jsValue.forProperty("embedUrl")?.toString() ?? ""
            self = .webEmbed(embedURL: embedURL)
        default:
            return nil
        }
    }
}

// SourceRouter.swift
@MainActor
class SourceRouter {
    static let shared = SourceRouter()

    private let playbackService = PlaybackService.shared
    private let spotifyHandler = SpotifyHandler()
    private let youTubeHandler = YouTubeHandler()

    func play(track: Track, source: ResolvedSource) async {
        switch source {
        case .directURL, .localFile:
            await playbackService.play(track: track, source: source)

        case .spotify(let trackId):
            await spotifyHandler.play(trackId: trackId)

        case .youtube(let videoId):
            await youTubeHandler.play(videoId: videoId)

        case .webEmbed(let embedURL):
            // Open in-app browser or sheet
            NotificationCenter.default.post(
                name: .openWebEmbed,
                object: nil,
                userInfo: ["url": embedURL, "track": track]
            )
        }
    }
}
```

### Spotify Handler

```swift
// SpotifyHandler.swift
import SpotifyiOS

class SpotifyHandler: NSObject {
    private var appRemote: SPTAppRemote?
    private var accessToken: String?

    private let clientID = "YOUR_SPOTIFY_CLIENT_ID"
    private let redirectURI = URL(string: "parachord://spotify-callback")!

    override init() {
        super.init()

        let configuration = SPTConfiguration(clientID: clientID, redirectURL: redirectURI)
        appRemote = SPTAppRemote(configuration: configuration, logLevel: .debug)
        appRemote?.delegate = self
    }

    func play(trackId: String) async {
        let uri = "spotify:track:\(trackId)"

        if let appRemote = appRemote, appRemote.isConnected {
            // Play via Spotify App Remote
            appRemote.playerAPI?.play(uri)
        } else if let accessToken = accessToken {
            // Fall back to Connect API (like desktop)
            await playViaConnectAPI(uri: uri, accessToken: accessToken)
        } else {
            // Need to authenticate first
            await authenticate()
        }
    }

    private func playViaConnectAPI(uri: String, accessToken: String) async {
        // Use existing Spotify resolver's play logic via JS bridge
        await JSBridge.shared.callFunction(
            "resolverLoader.getResolver('spotify').play",
            arguments: [["uri": uri]]
        )
    }

    func authenticate() async {
        // Try to connect to Spotify app first
        appRemote?.authorizeAndPlayURI("")
    }

    func checkAvailability() -> SpotifyAvailability {
        if appRemote?.isConnected == true {
            return .appConnected
        } else if accessToken != nil {
            return .webAvailable
        } else {
            return .notAvailable
        }
    }
}

extension SpotifyHandler: SPTAppRemoteDelegate {
    func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        // Connected to Spotify app
    }

    func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        // Fall back to web API
    }

    func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
        // Handle disconnection
    }
}
```

### YouTube Handler

```swift
// YouTubeHandler.swift
import WebKit

class YouTubeHandler {
    func play(videoId: String) async {
        // Option 1: Open YouTube Music app if installed
        if canOpenYouTubeMusic() {
            openInYouTubeMusic(videoId: videoId)
            return
        }

        // Option 2: Present WebView with YouTube embed
        await MainActor.run {
            NotificationCenter.default.post(
                name: .presentYouTubePlayer,
                object: nil,
                userInfo: ["videoId": videoId]
            )
        }
    }

    private func canOpenYouTubeMusic() -> Bool {
        guard let url = URL(string: "youtubemusic://") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    private func openInYouTubeMusic(videoId: String) {
        guard let url = URL(string: "youtubemusic://watch?v=\(videoId)") else { return }
        UIApplication.shared.open(url)
    }
}

// YouTubePlayerView.swift (SwiftUI wrapper for WKWebView)
struct YouTubePlayerView: View {
    let videoId: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            YouTubeWebView(videoId: videoId)
                .navigationTitle("YouTube")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

struct YouTubeWebView: UIViewRepresentable {
    let videoId: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let embedHTML = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { margin: 0; background: #000; }
                iframe { width: 100%; height: 100vh; border: none; }
            </style>
        </head>
        <body>
            <iframe src="https://www.youtube.com/embed/\(videoId)?autoplay=1&playsinline=1"
                    allow="autoplay; encrypted-media" allowfullscreen></iframe>
        </body>
        </html>
        """
        webView.loadHTMLString(embedHTML, baseURL: nil)
    }
}
```

---

## 4. Local Files Integration

### MPMediaQuery for iTunes/Music Library

```swift
// LocalFilesScanner.swift
import MediaPlayer

@MainActor
@Observable
class LocalFilesScanner {
    var tracks: [LocalTrack] = []
    var albums: [LocalAlbum] = []
    var artists: [LocalArtist] = []

    private let database: LocalFilesDatabase

    init(database: LocalFilesDatabase = .shared) {
        self.database = database
    }

    func requestPermission() async -> Bool {
        let status = await MPMediaLibrary.requestAuthorization()
        return status == .authorized
    }

    func scanMediaLibrary() async -> [LocalTrack] {
        guard await requestPermission() else { return [] }

        let query = MPMediaQuery.songs()

        guard let items = query.items else { return [] }

        let scannedTracks = items.compactMap { item -> LocalTrack? in
            guard let title = item.title else { return nil }

            return LocalTrack(
                id: item.persistentID,
                title: title,
                artist: item.artist ?? "Unknown Artist",
                album: item.albumTitle,
                duration: item.playbackDuration,
                assetURL: item.assetURL,
                albumArtwork: item.artwork,
                dateAdded: item.dateAdded
            )
        }

        // Store in local database
        await database.insertTracks(scannedTracks)

        tracks = scannedTracks
        return scannedTracks
    }

    func search(query: String) async -> [LocalTrack] {
        let lowercasedQuery = query.lowercased()

        return tracks.filter { track in
            track.title.lowercased().contains(lowercasedQuery) ||
            track.artist.lowercased().contains(lowercasedQuery) ||
            (track.album?.lowercased().contains(lowercasedQuery) ?? false)
        }
    }

    func resolve(artist: String, track: String, album: String?) async -> LocalTrack? {
        // Fuzzy matching similar to desktop
        let candidates = tracks.filter { localTrack in
            localTrack.artist.lowercased().contains(artist.lowercased()) &&
            localTrack.title.lowercased().contains(track.lowercased())
        }

        // Score candidates
        let scored = candidates.map { candidate -> (LocalTrack, Int) in
            var score = 0

            // Exact title match
            if candidate.title.lowercased() == track.lowercased() {
                score += 100
            }

            // Exact artist match
            if candidate.artist.lowercased() == artist.lowercased() {
                score += 50
            }

            // Album match (if provided)
            if let album = album, let candidateAlbum = candidate.album,
               candidateAlbum.lowercased() == album.lowercased() {
                score += 25
            }

            return (candidate, score)
        }

        return scored.max(by: { $0.1 < $1.1 })?.0
    }
}

// LocalTrack.swift
struct LocalTrack: Identifiable, Codable {
    let id: UInt64  // MPMediaItem.persistentID
    let title: String
    let artist: String
    let album: String?
    let duration: TimeInterval
    let assetURL: URL?
    let dateAdded: Date?

    // Not Codable - transient
    var albumArtwork: MPMediaItemArtwork?

    enum CodingKeys: String, CodingKey {
        case id, title, artist, album, duration, assetURL, dateAdded
    }
}
```

### Local Files Resolver Bridge

```swift
// LocalFilesResolverBridge.swift
extension JSBridge {
    func registerLocalFilesModule() {
        let localFiles = JSValue(newObjectIn: context)!
        let scanner = LocalFilesScanner.shared

        let search: @convention(block) (String) -> JSValue = { query in
            let promise = JSValue(newPromiseIn: self.context) { resolve, reject in
                Task {
                    let results = await scanner.search(query: query)
                    let jsResults = results.map { $0.toJSValue(in: self.context) }
                    resolve?.call(withArguments: [jsResults])
                }
            }
            return promise!
        }

        let resolve: @convention(block) (String, String, String?) -> JSValue = { artist, track, album in
            let promise = JSValue(newPromiseIn: self.context) { resolve, reject in
                Task {
                    if let result = await scanner.resolve(artist: artist, track: track, album: album) {
                        resolve?.call(withArguments: [result.toJSValue(in: self.context)])
                    } else {
                        resolve?.call(withArguments: [JSValue(nullIn: self.context)!])
                    }
                }
            }
            return promise!
        }

        let getStreamURL: @convention(block) (Double) -> String? = { trackId in
            let persistentID = UInt64(trackId)
            if let track = scanner.tracks.first(where: { $0.id == persistentID }) {
                return track.assetURL?.absoluteString
            }
            return nil
        }

        localFiles.setObject(search, forKeyedSubscript: "search" as NSString)
        localFiles.setObject(resolve, forKeyedSubscript: "resolve" as NSString)
        localFiles.setObject(getStreamURL, forKeyedSubscript: "getStreamUrl" as NSString)

        context.setObject(localFiles, forKeyedSubscript: "localFiles" as NSString)
    }
}
```

---

## 5. Storage Architecture

### SwiftData for Complex Data (iOS 17+)

```swift
// Models.swift
import SwiftData

@Model
class TrackEntity {
    @Attribute(.unique) var id: String  // artist-title-album hash
    var title: String
    var artist: String
    var album: String?
    var duration: Double?
    var addedAt: Date
    var playCount: Int = 0
    var lastPlayed: Date?

    @Relationship(deleteRule: .cascade, inverse: \SyncSourceEntity.track)
    var syncSources: [SyncSourceEntity] = []

    init(id: String, title: String, artist: String, album: String?, duration: Double?, addedAt: Date) {
        self.id = id
        self.title = title
        self.artist = artist
        self.album = album
        self.duration = duration
        self.addedAt = addedAt
    }
}

@Model
class SyncSourceEntity {
    var providerId: String
    var externalId: String
    var addedAt: Date
    var syncedAt: Date

    var track: TrackEntity?

    init(providerId: String, externalId: String, addedAt: Date, syncedAt: Date) {
        self.providerId = providerId
        self.externalId = externalId
        self.addedAt = addedAt
        self.syncedAt = syncedAt
    }
}

@Model
class PlaylistEntity {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .cascade)
    var entries: [PlaylistEntryEntity] = []

    init(id: UUID = UUID(), name: String, createdAt: Date = Date()) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.updatedAt = createdAt
    }
}

@Model
class PlaylistEntryEntity {
    var position: Int
    var trackId: String
    var addedAt: Date

    init(position: Int, trackId: String, addedAt: Date = Date()) {
        self.position = position
        self.trackId = trackId
        self.addedAt = addedAt
    }
}

@Model
class FailedScrobbleEntity {
    var trackTitle: String
    var trackArtist: String
    var trackAlbum: String?
    var timestamp: Date
    var scrobblerId: String
    var retryCount: Int = 0
    var lastRetry: Date?

    init(trackTitle: String, trackArtist: String, trackAlbum: String?, timestamp: Date, scrobblerId: String) {
        self.trackTitle = trackTitle
        self.trackArtist = trackArtist
        self.trackAlbum = trackAlbum
        self.timestamp = timestamp
        self.scrobblerId = scrobblerId
    }
}
```

### Database Container

```swift
// DatabaseContainer.swift
import SwiftData

@MainActor
class DatabaseContainer {
    static let shared = DatabaseContainer()

    let container: ModelContainer

    init() {
        let schema = Schema([
            TrackEntity.self,
            SyncSourceEntity.self,
            PlaylistEntity.self,
            PlaylistEntryEntity.self,
            FailedScrobbleEntity.self
        ])

        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false
        )

        do {
            container = try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }

    var mainContext: ModelContext {
        container.mainContext
    }
}
```

### UserDefaults for Simple Settings (replaces electron-store simple keys)

```swift
// SettingsStore.swift
import Foundation

@Observable
class SettingsStore {
    static let shared = SettingsStore()

    private let defaults = UserDefaults.standard
    private let prefix = "parachord."

    var resolverPriority: [String] {
        get { defaults.stringArray(forKey: prefix + "resolverPriority") ?? [] }
        set { defaults.set(newValue, forKey: prefix + "resolverPriority") }
    }

    var scrobblersEnabled: [String: Bool] {
        get { defaults.dictionary(forKey: prefix + "scrobblersEnabled") as? [String: Bool] ?? [:] }
        set { defaults.set(newValue, forKey: prefix + "scrobblersEnabled") }
    }

    var lastfmSessionKey: String? {
        get { defaults.string(forKey: prefix + "lastfm.sessionKey") }
        set { defaults.set(newValue, forKey: prefix + "lastfm.sessionKey") }
    }

    var listenbrainzToken: String? {
        get { defaults.string(forKey: prefix + "listenbrainz.token") }
        set { defaults.set(newValue, forKey: prefix + "listenbrainz.token") }
    }

    var spotifyAccessToken: String? {
        get { defaults.string(forKey: prefix + "spotify.accessToken") }
        set { defaults.set(newValue, forKey: prefix + "spotify.accessToken") }
    }

    var spotifyRefreshToken: String? {
        get { defaults.string(forKey: prefix + "spotify.refreshToken") }
        set { defaults.set(newValue, forKey: prefix + "spotify.refreshToken") }
    }
}
```

---

## 6. OAuth & Authentication

### ASWebAuthenticationSession for OAuth

```swift
// OAuthManager.swift
import AuthenticationServices

@MainActor
class OAuthManager: NSObject {
    static let shared = OAuthManager()

    private var authSession: ASWebAuthenticationSession?

    func authenticateSpotify() async throws -> SpotifyTokens {
        let codeVerifier = generateCodeVerifier()
        let codeChallenge = generateCodeChallenge(codeVerifier)

        var components = URLComponents(string: "https://accounts.spotify.com/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: SpotifyConfig.clientID),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: "parachord://auth/spotify/callback"),
            URLQueryItem(name: "scope", value: SpotifyConfig.scopes),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "code_challenge", value: codeChallenge)
        ]

        let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            authSession = ASWebAuthenticationSession(
                url: components.url!,
                callbackURLScheme: "parachord"
            ) { callbackURL, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let callbackURL = callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: OAuthError.noCallback)
                }
            }

            authSession?.presentationContextProvider = self
            authSession?.prefersEphemeralWebBrowserSession = false
            authSession?.start()
        }

        // Extract code from callback URL
        let components2 = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)!
        guard let code = components2.queryItems?.first(where: { $0.name == "code" })?.value else {
            throw OAuthError.noCode
        }

        // Exchange code for tokens
        return try await exchangeCodeForTokens(code: code, codeVerifier: codeVerifier)
    }

    private func exchangeCodeForTokens(code: String, codeVerifier: String) async throws -> SpotifyTokens {
        var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type=authorization_code",
            "code=\(code)",
            "redirect_uri=parachord://auth/spotify/callback",
            "client_id=\(SpotifyConfig.clientID)",
            "code_verifier=\(codeVerifier)"
        ].joined(separator: "&")

        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(SpotifyTokens.self, from: data)
    }

    private func generateCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func generateCodeChallenge(_ verifier: String) -> String {
        let data = verifier.data(using: .utf8)!
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
        }
        return Data(hash).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension OAuthManager: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

struct SpotifyTokens: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let tokenType: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case tokenType = "token_type"
    }
}
```

---

## 7. Background Sync & Tasks

### BGTaskScheduler for Library Sync

```swift
// BackgroundTaskManager.swift
import BackgroundTasks

class BackgroundTaskManager {
    static let shared = BackgroundTaskManager()

    private let syncTaskIdentifier = "com.parachord.sync"
    private let scrobbleRetryTaskIdentifier = "com.parachord.scrobbleRetry"

    func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: syncTaskIdentifier,
            using: nil
        ) { task in
            self.handleSyncTask(task as! BGAppRefreshTask)
        }

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: scrobbleRetryTaskIdentifier,
            using: nil
        ) { task in
            self.handleScrobbleRetryTask(task as! BGProcessingTask)
        }
    }

    func scheduleLibrarySync() {
        let request = BGAppRefreshTaskRequest(identifier: syncTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 60 * 60) // 6 hours

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("Could not schedule sync: \(error)")
        }
    }

    func scheduleScrobbleRetry() {
        let request = BGProcessingTaskRequest(identifier: scrobbleRetryTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("Could not schedule scrobble retry: \(error)")
        }
    }

    private func handleSyncTask(_ task: BGAppRefreshTask) {
        // Schedule next sync
        scheduleLibrarySync()

        let syncOperation = Task {
            do {
                try await SyncManager.shared.syncAllProviders()
                task.setTaskCompleted(success: true)
            } catch {
                task.setTaskCompleted(success: false)
            }
        }

        task.expirationHandler = {
            syncOperation.cancel()
        }
    }

    private func handleScrobbleRetryTask(_ task: BGProcessingTask) {
        let retryOperation = Task {
            do {
                try await ScrobbleManager.shared.retryFailedScrobbles()
                task.setTaskCompleted(success: true)
            } catch {
                task.setTaskCompleted(success: false)
            }
        }

        task.expirationHandler = {
            retryOperation.cancel()
        }
    }
}
```

### Info.plist Configuration

```xml
<!-- Required for background audio -->
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>fetch</string>
    <string>processing</string>
</array>

<!-- Background task identifiers -->
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.parachord.sync</string>
    <string>com.parachord.scrobbleRetry</string>
</array>
```

---

## 8. UI Layer with SwiftUI

### App Entry Point

```swift
// ParachordApp.swift
import SwiftUI
import SwiftData

@main
struct ParachordApp: App {
    @State private var playbackService = PlaybackService.shared
    @State private var jsBridge = JSBridge.shared
    @State private var queueManager = QueueManager.shared

    init() {
        BackgroundTaskManager.shared.registerBackgroundTasks()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(playbackService)
                .environment(jsBridge)
                .environment(queueManager)
                .modelContainer(DatabaseContainer.shared.container)
        }
    }
}

// ContentView.swift
struct ContentView: View {
    @State private var selectedTab: Tab = .collection

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                CollectionView()
                    .tabItem {
                        Label("Collection", systemImage: "music.note.house")
                    }
                    .tag(Tab.collection)

                SearchView()
                    .tabItem {
                        Label("Search", systemImage: "magnifyingglass")
                    }
                    .tag(Tab.search)

                QueueView()
                    .tabItem {
                        Label("Queue", systemImage: "list.bullet")
                    }
                    .tag(Tab.queue)

                SettingsView()
                    .tabItem {
                        Label("Settings", systemImage: "gear")
                    }
                    .tag(Tab.settings)
            }

            // Mini player overlay
            MiniPlayerView()
                .padding(.bottom, 49) // Tab bar height
        }
    }

    enum Tab {
        case collection, search, queue, settings
    }
}
```

### Collection View (mirrors desktop)

```swift
// CollectionView.swift
struct CollectionView: View {
    @State private var selectedSegment: CollectionSegment = .tracks
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Segmented control
                Picker("View", selection: $selectedSegment) {
                    Text("Tracks").tag(CollectionSegment.tracks)
                    Text("Albums").tag(CollectionSegment.albums)
                    Text("Artists").tag(CollectionSegment.artists)
                    Text("Playlists").tag(CollectionSegment.playlists)
                }
                .pickerStyle(.segmented)
                .padding()

                // Content based on selection
                switch selectedSegment {
                case .tracks:
                    TrackListView()
                case .albums:
                    AlbumGridView()
                case .artists:
                    ArtistListView()
                case .playlists:
                    PlaylistListView()
                }
            }
            .navigationTitle("Collection")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Sync Library", systemImage: "arrow.triangle.2.circlepath") {
                            Task { await SyncManager.shared.syncAllProviders() }
                        }
                        Button("Scan Local Files", systemImage: "folder") {
                            Task { await LocalFilesScanner.shared.scanMediaLibrary() }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
    }

    enum CollectionSegment {
        case tracks, albums, artists, playlists
    }
}
```

### Track List with Resolver Indicators

```swift
// TrackListView.swift
struct TrackListView: View {
    @Query(sort: \TrackEntity.addedAt, order: .reverse) private var tracks: [TrackEntity]
    @Environment(PlaybackService.self) private var playbackService
    @State private var resolutionViewModel = ResolutionViewModel()

    var body: some View {
        List {
            ForEach(tracks) { track in
                TrackRowView(track: track)
                    .onAppear {
                        resolutionViewModel.trackBecameVisible(track)
                    }
                    .onDisappear {
                        resolutionViewModel.trackBecameHidden(track)
                    }
            }
        }
        .listStyle(.plain)
    }
}

// TrackRowView.swift
struct TrackRowView: View {
    let track: TrackEntity
    @Environment(PlaybackService.self) private var playbackService
    @State private var resolverStates: [String: ResolverState] = [:]

    var body: some View {
        HStack(spacing: 12) {
            // Album artwork
            AsyncImage(url: URL(string: track.artworkURL ?? "")) { image in
                image.resizable()
            } placeholder: {
                Rectangle()
                    .fill(Color.gray.opacity(0.3))
                    .overlay(Image(systemName: "music.note"))
            }
            .frame(width: 48, height: 48)
            .cornerRadius(4)

            // Track info
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title)
                    .font(.body)
                    .lineLimit(1)
                Text(track.artist)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            // Resolver availability indicators (like desktop)
            ResolverIndicatorsView(states: resolverStates)

            // Context menu trigger
            Menu {
                Button("Add to Queue", systemImage: "text.append") {
                    QueueManager.shared.addToQueue(track)
                }
                Button("Add to Playlist...", systemImage: "plus") {
                    // Show playlist picker
                }
                Divider()
                Button("Go to Artist", systemImage: "person") {
                    // Navigate to artist
                }
                Button("Go to Album", systemImage: "square.stack") {
                    // Navigate to album
                }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            Task {
                await playbackService.playTrack(track)
            }
        }
    }
}

// ResolverIndicatorsView.swift
struct ResolverIndicatorsView: View {
    let states: [String: ResolverState]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(states.keys.sorted()), id: \.self) { resolverId in
                if let state = states[resolverId] {
                    Circle()
                        .fill(state.color)
                        .frame(width: 8, height: 8)
                        .opacity(state.availability == .unavailable ? 0.3 : 1.0)
                        .overlay {
                            if state.availability == .resolving {
                                ProgressView()
                                    .scaleEffect(0.5)
                            }
                        }
                }
            }
        }
    }
}

struct ResolverState {
    let availability: Availability
    let color: Color

    enum Availability {
        case available, resolving, unavailable
    }
}
```

### Mini Player

```swift
// MiniPlayerView.swift
struct MiniPlayerView: View {
    @Environment(PlaybackService.self) private var playbackService
    @State private var showFullPlayer = false

    var body: some View {
        if let track = playbackService.currentTrack {
            VStack(spacing: 0) {
                // Progress bar
                GeometryReader { geometry in
                    Rectangle()
                        .fill(Color.accentColor)
                        .frame(width: geometry.size.width * (playbackService.currentTime / max(playbackService.duration, 1)))
                }
                .frame(height: 2)

                HStack(spacing: 12) {
                    // Album art
                    AsyncImage(url: URL(string: track.artworkURL ?? "")) { image in
                        image.resizable()
                    } placeholder: {
                        Rectangle().fill(Color.gray.opacity(0.3))
                    }
                    .frame(width: 40, height: 40)
                    .cornerRadius(4)

                    // Track info
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)
                        Text(track.artist)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    // Play/pause button
                    Button {
                        if playbackService.isPlaying {
                            playbackService.pause()
                        } else {
                            playbackService.resume()
                        }
                    } label: {
                        Image(systemName: playbackService.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title2)
                    }

                    // Next button
                    Button {
                        Task { await QueueManager.shared.playNext() }
                    } label: {
                        Image(systemName: "forward.fill")
                            .font(.title3)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .background(.ultraThinMaterial)
            .onTapGesture {
                showFullPlayer = true
            }
            .sheet(isPresented: $showFullPlayer) {
                NowPlayingView()
            }
        }
    }
}
```

### Now Playing Sheet

```swift
// NowPlayingView.swift
struct NowPlayingView: View {
    @Environment(PlaybackService.self) private var playbackService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                // Large album artwork
                AsyncImage(url: URL(string: playbackService.currentTrack?.artworkURL ?? "")) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                } placeholder: {
                    Rectangle()
                        .fill(Color.gray.opacity(0.3))
                        .aspectRatio(1, contentMode: .fit)
                        .overlay(Image(systemName: "music.note").font(.system(size: 60)))
                }
                .frame(maxWidth: 300, maxHeight: 300)
                .cornerRadius(8)
                .shadow(radius: 10)

                // Track info
                VStack(spacing: 8) {
                    Text(playbackService.currentTrack?.title ?? "Not Playing")
                        .font(.title2)
                        .fontWeight(.bold)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)

                    Text(playbackService.currentTrack?.artist ?? "")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                // Progress slider
                VStack(spacing: 4) {
                    Slider(
                        value: Binding(
                            get: { playbackService.currentTime },
                            set: { playbackService.seek(to: $0) }
                        ),
                        in: 0...max(playbackService.duration, 1)
                    )
                    .tint(.primary)

                    HStack {
                        Text(formatTime(playbackService.currentTime))
                        Spacer()
                        Text(formatTime(playbackService.duration))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(.horizontal)

                // Playback controls
                HStack(spacing: 40) {
                    Button {
                        Task { await QueueManager.shared.playPrevious() }
                    } label: {
                        Image(systemName: "backward.fill")
                            .font(.title)
                    }

                    Button {
                        if playbackService.isPlaying {
                            playbackService.pause()
                        } else {
                            playbackService.resume()
                        }
                    } label: {
                        Image(systemName: playbackService.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 64))
                    }

                    Button {
                        Task { await QueueManager.shared.playNext() }
                    } label: {
                        Image(systemName: "forward.fill")
                            .font(.title)
                    }
                }

                Spacer()

                // Additional controls
                HStack(spacing: 60) {
                    Button { } label: {
                        Image(systemName: "shuffle")
                    }
                    Button { } label: {
                        Image(systemName: "repeat")
                    }
                    Button { } label: {
                        Image(systemName: "airplayaudio")
                    }
                    Button { } label: {
                        Image(systemName: "list.bullet")
                    }
                }
                .font(.title3)
                .foregroundStyle(.secondary)

                Spacer()
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                }
            }
        }
    }

    private func formatTime(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", minutes, secs)
    }
}
```

---

## 9. Scrobbling Integration

### Scrobble Manager Bridge

```swift
// ScrobbleManager.swift
@MainActor
@Observable
class ScrobbleManager {
    static let shared = ScrobbleManager()

    private let jsBridge = JSBridge.shared
    private let database = DatabaseContainer.shared

    private var currentTrack: Track?
    private var startTime: Date?
    private var accumulatedPlayTime: TimeInterval = 0

    func onTrackStart(_ track: Track) async {
        currentTrack = track
        startTime = Date()
        accumulatedPlayTime = 0

        // Call JS scrobble manager
        await jsBridge.callFunction("scrobbleManager.onTrackStart", arguments: [track.toJSObject()])
    }

    func onProgressUpdate(_ positionSeconds: Int) async {
        await jsBridge.callFunction("scrobbleManager.onProgressUpdate", arguments: [positionSeconds])
    }

    func onTrackEnd() async {
        await jsBridge.callFunction("scrobbleManager.onTrackEnd", arguments: [])
    }

    func retryFailedScrobbles() async throws {
        // Get failed scrobbles from database
        let context = database.mainContext
        let descriptor = FetchDescriptor<FailedScrobbleEntity>(
            predicate: #Predicate { $0.retryCount < 10 },
            sortBy: [SortDescriptor(\.timestamp)]
        )

        let failedScrobbles = try context.fetch(descriptor)

        for scrobble in failedScrobbles {
            do {
                try await retryScrobble(scrobble)
                context.delete(scrobble)
            } catch {
                scrobble.retryCount += 1
                scrobble.lastRetry = Date()
            }
        }

        try context.save()
    }

    private func retryScrobble(_ scrobble: FailedScrobbleEntity) async throws {
        await jsBridge.callFunction("scrobbleManager.submitScrobble", arguments: [
            [
                "title": scrobble.trackTitle,
                "artist": scrobble.trackArtist,
                "album": scrobble.trackAlbum as Any
            ],
            scrobble.timestamp.timeIntervalSince1970
        ])
    }
}
```

---

## 10. Resolution Scheduler Adaptation

### Visibility-Aware Resolution

```swift
// ResolutionViewModel.swift
@MainActor
@Observable
class ResolutionViewModel {
    private let jsBridge = JSBridge.shared
    private var visibleTracks: Set<String> = []

    func trackBecameVisible(_ track: TrackEntity) {
        visibleTracks.insert(track.id)
        scheduleResolution(for: track)
    }

    func trackBecameHidden(_ track: TrackEntity) {
        visibleTracks.remove(track.id)
    }

    private func scheduleResolution(for track: TrackEntity) {
        Task {
            await jsBridge.callFunction(
                "resolutionScheduler.updateVisibility",
                arguments: ["collection-page", Array(visibleTracks)]
            )
        }
    }

    func registerContext(contextId: String, type: String, options: [String: Any] = [:]) {
        Task {
            await jsBridge.callFunction(
                "resolutionScheduler.registerContext",
                arguments: [contextId, type, options]
            )
        }
    }

    func abortContext(contextId: String) {
        Task {
            await jsBridge.callFunction(
                "resolutionScheduler.abortContext",
                arguments: [contextId]
            )
        }
    }
}
```

---

## 11. Module Structure

```
Parachord/
├── App/
│   ├── ParachordApp.swift
│   └── ContentView.swift
│
├── Bridge/
│   ├── JSBridge.swift
│   ├── JSBridge+Fetch.swift
│   ├── JSBridge+Storage.swift
│   ├── JSBridge+Crypto.swift
│   ├── JSBridge+LocalFiles.swift
│   └── JSBridge+Playback.swift
│
├── Playback/
│   ├── PlaybackService.swift
│   ├── PlaybackService+RemoteCommands.swift
│   ├── QueueManager.swift
│   ├── SourceRouter.swift
│   └── Handlers/
│       ├── SpotifyHandler.swift
│       ├── YouTubeHandler.swift
│       └── YouTubePlayerView.swift
│
├── Auth/
│   ├── OAuthManager.swift
│   └── TokenManager.swift
│
├── Data/
│   ├── Models.swift
│   ├── DatabaseContainer.swift
│   ├── SettingsStore.swift
│   └── Repositories/
│       ├── LibraryRepository.swift
│       ├── PlaylistRepository.swift
│       └── ResolverRepository.swift
│
├── LocalFiles/
│   ├── LocalFilesScanner.swift
│   └── LocalFilesDatabase.swift
│
├── Sync/
│   ├── SyncManager.swift
│   └── BackgroundTaskManager.swift
│
├── Scrobbling/
│   └── ScrobbleManager.swift
│
├── Resolution/
│   └── ResolutionViewModel.swift
│
├── Views/
│   ├── Collection/
│   │   ├── CollectionView.swift
│   │   ├── TrackListView.swift
│   │   ├── TrackRowView.swift
│   │   ├── AlbumGridView.swift
│   │   ├── ArtistListView.swift
│   │   └── PlaylistListView.swift
│   │
│   ├── Search/
│   │   └── SearchView.swift
│   │
│   ├── Queue/
│   │   └── QueueView.swift
│   │
│   ├── Settings/
│   │   ├── SettingsView.swift
│   │   ├── ResolverSettingsView.swift
│   │   └── ScrobblerSettingsView.swift
│   │
│   ├── Player/
│   │   ├── MiniPlayerView.swift
│   │   └── NowPlayingView.swift
│   │
│   └── Components/
│       ├── ResolverIndicatorsView.swift
│       ├── AlbumArtView.swift
│       └── TrackContextMenu.swift
│
├── Resources/
│   ├── Assets.xcassets/
│   ├── js/
│   │   ├── resolver-loader.js      (copied from desktop)
│   │   ├── scrobble-manager.js     (copied from desktop)
│   │   ├── resolution-scheduler.js (copied from desktop)
│   │   └── sync-engine/            (copied from desktop)
│   └── resolvers/
│       ├── spotify.axe
│       ├── youtube.axe
│       ├── bandcamp.axe
│       └── ...
│
└── Info.plist
```

---

## 12. Platform-Specific Features

### CarPlay Integration

```swift
// CarPlaySceneDelegate.swift
import CarPlay

class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    var interfaceController: CPInterfaceController?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController

        let tabBar = CPTabBarTemplate(templates: [
            createCollectionTab(),
            createQueueTab(),
            createSearchTab()
        ])

        interfaceController.setRootTemplate(tabBar, animated: true)
    }

    private func createCollectionTab() -> CPListTemplate {
        let section = CPListSection(items: [
            CPListItem(text: "Tracks", detailText: nil),
            CPListItem(text: "Albums", detailText: nil),
            CPListItem(text: "Playlists", detailText: nil)
        ])

        let template = CPListTemplate(title: "Collection", sections: [section])
        template.tabImage = UIImage(systemName: "music.note.house")
        return template
    }

    private func createQueueTab() -> CPListTemplate {
        // ... queue items
    }

    private func createSearchTab() -> CPListTemplate {
        // ... voice search support
    }
}
```

### Apple Watch Companion (WatchOS)

```swift
// WatchApp.swift (separate WatchOS target)
import SwiftUI

@main
struct ParachordWatch: App {
    var body: some Scene {
        WindowGroup {
            WatchNowPlayingView()
        }
    }
}

struct WatchNowPlayingView: View {
    @State private var nowPlaying: NowPlayingInfo?

    var body: some View {
        VStack {
            if let nowPlaying = nowPlaying {
                Text(nowPlaying.title)
                    .font(.headline)
                Text(nowPlaying.artist)
                    .font(.caption)

                HStack {
                    Button(action: previous) {
                        Image(systemName: "backward.fill")
                    }
                    Button(action: togglePlayPause) {
                        Image(systemName: nowPlaying.isPlaying ? "pause.fill" : "play.fill")
                    }
                    Button(action: next) {
                        Image(systemName: "forward.fill")
                    }
                }
            } else {
                Text("Not Playing")
            }
        }
        .onAppear {
            // Connect to phone via WatchConnectivity
        }
    }
}
```

### Widgets

```swift
// ParachordWidget.swift
import WidgetKit
import SwiftUI

struct NowPlayingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NowPlaying", provider: NowPlayingProvider()) { entry in
            NowPlayingWidgetView(entry: entry)
        }
        .configurationDisplayName("Now Playing")
        .description("Shows the currently playing track")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct NowPlayingProvider: TimelineProvider {
    func placeholder(in context: Context) -> NowPlayingEntry {
        NowPlayingEntry(date: Date(), track: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (NowPlayingEntry) -> Void) {
        let entry = NowPlayingEntry(date: Date(), track: getCurrentTrack())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NowPlayingEntry>) -> Void) {
        let entry = NowPlayingEntry(date: Date(), track: getCurrentTrack())
        let timeline = Timeline(entries: [entry], policy: .never)
        completion(timeline)
    }
}

struct NowPlayingWidgetView: View {
    let entry: NowPlayingEntry

    var body: some View {
        if let track = entry.track {
            HStack {
                // Album art
                if let artworkData = track.artworkData,
                   let image = UIImage(data: artworkData) {
                    Image(uiImage: image)
                        .resizable()
                        .frame(width: 50, height: 50)
                        .cornerRadius(4)
                }

                VStack(alignment: .leading) {
                    Text(track.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text(track.artist)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        } else {
            Text("Not Playing")
                .foregroundStyle(.secondary)
        }
    }
}
```

---

## 13. Key Differences from Desktop

| Aspect | Desktop | iOS |
|--------|---------|-----|
| **JS Execution** | Node.js in Electron | JavaScriptCore (built-in) |
| **UI Framework** | React + Tailwind | SwiftUI |
| **Playback** | HTML5 Audio / Spotify | AVPlayer / Spotify SDK |
| **Background** | Always running | BGTaskScheduler + Audio mode |
| **Storage** | electron-store + SQLite | UserDefaults + SwiftData |
| **Local Files** | Direct file system | MPMediaQuery |
| **OAuth** | Express callback server | ASWebAuthenticationSession |
| **Extensions** | Browser extension | N/A (in-app) |
| **Multi-window** | Electron windows | Single app + extensions |
| **System Integration** | Media keys | MPRemoteCommandCenter |
| **Car** | N/A | CarPlay |
| **Watch** | N/A | WatchOS companion |

---

## 14. Migration Path

### Phase 1: Core Infrastructure
1. Create Xcode project with SwiftUI
2. Integrate JavaScriptCore
3. Create native module bindings (fetch, storage, crypto)
4. Load and test resolver-loader.js

### Phase 2: Basic Playback
1. Implement PlaybackService with AVPlayer
2. Set up AVAudioSession for background audio
3. Add MPRemoteCommandCenter for system controls
4. Test with direct URL resolvers

### Phase 3: Resolver Integration
1. Bundle built-in .axe resolvers
2. Implement Spotify handler (iOS SDK or Connect API)
3. Implement YouTube handler (WKWebView)
4. Test resolution chain

### Phase 4: Library Features
1. Implement SwiftData models
2. Create MPMediaQuery scanner for local files
3. Integrate sync engine
4. Implement scrobbling

### Phase 5: UI Polish
1. Build all SwiftUI views
2. Implement resolver indicators
3. Add mini player and now playing sheet
4. iOS design language refinements

### Phase 6: Platform Features
1. BGTaskScheduler for background sync
2. CarPlay integration
3. Widget extension
4. WatchOS companion (future)

---

## 15. iOS-Specific Considerations

### App Store Guidelines
- No private API usage
- YouTube playback must comply with ToS
- Clear privacy policy for scrobbling services
- Proper entitlements for background audio

### Performance
- JavaScriptCore is highly optimized on iOS
- Use `@Observable` for efficient UI updates
- Lazy loading of album artwork
- Background fetch for sync (battery conscious)

### Privacy
- Request media library access explicitly
- Explain why location/network needed (if applicable)
- Store OAuth tokens in Keychain for sensitive data

### Accessibility
- VoiceOver support for all controls
- Dynamic Type support
- Sufficient color contrast

---

## Summary

This architecture achieves **100% reuse** of:
- All .axe resolver plugins
- ResolverLoader logic
- ScrobbleManager and all scrobbler plugins
- SyncEngine and all sync providers
- ResolutionScheduler priority logic

While providing a **native iOS experience** through:
- SwiftUI for native look and feel
- AVPlayer for high-quality playback
- MPRemoteCommandCenter for system integration
- BGTaskScheduler for background tasks
- SwiftData for persistence
- ASWebAuthenticationSession for OAuth
- CarPlay, Widgets, and WatchOS support
