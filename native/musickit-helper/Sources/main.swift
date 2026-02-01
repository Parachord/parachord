import Foundation
import MusicKit

// MARK: - JSON Message Types

struct Request: Codable {
    let id: String
    let action: String
    let params: [String: AnyCodable]?
}

struct Response: Codable {
    let id: String
    let success: Bool
    let data: AnyCodable?
    let error: String?
}

// AnyCodable wrapper for dynamic JSON values
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let bool as Bool:
            try container.encode(bool)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}

// MARK: - MusicKit Bridge (macOS 14+)

@available(macOS 14.0, *)
@MainActor
class MusicKitBridge {
    private let player = ApplicationMusicPlayer.shared
    private var isAuthorized = false

    // Check current authorization status
    func checkAuthStatus() async -> [String: Any] {
        let status = MusicAuthorization.currentStatus
        isAuthorized = status == .authorized
        return [
            "authorized": isAuthorized,
            "status": statusString(status)
        ]
    }

    // Request authorization
    func authorize() async -> [String: Any] {
        let status = await MusicAuthorization.request()
        isAuthorized = status == .authorized
        return [
            "authorized": isAuthorized,
            "status": statusString(status)
        ]
    }

    private func statusString(_ status: MusicAuthorization.Status) -> String {
        switch status {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        @unknown default: return "unknown"
        }
    }

    // Search for songs
    func search(query: String, limit: Int = 25) async throws -> [[String: Any]] {
        var request = MusicCatalogSearchRequest(term: query, types: [Song.self])
        request.limit = limit

        let response = try await request.response()

        return response.songs.map { song in
            [
                "id": song.id.rawValue,
                "title": song.title,
                "artist": song.artistName,
                "album": song.albumTitle ?? "" as Any,
                "duration": song.duration ?? 0 as Any,
                "artworkUrl": song.artwork?.url(width: 300, height: 300)?.absoluteString ?? "" as Any,
                "isrc": song.isrc ?? "" as Any
            ]
        }
    }

    // Search for a specific song by artist and title
    func resolve(artist: String, title: String, album: String?) async throws -> [String: Any]? {
        var searchTerm = "\(artist) \(title)"
        if let album = album, !album.isEmpty {
            searchTerm += " \(album)"
        }

        var request = MusicCatalogSearchRequest(term: searchTerm, types: [Song.self])
        request.limit = 10

        let response = try await request.response()

        // Find best match
        for song in response.songs {
            let artistMatch = song.artistName.lowercased().contains(artist.lowercased()) ||
                              artist.lowercased().contains(song.artistName.lowercased())
            let titleMatch = song.title.lowercased().contains(title.lowercased()) ||
                             title.lowercased().contains(song.title.lowercased())

            if artistMatch && titleMatch {
                return [
                    "id": song.id.rawValue,
                    "title": song.title,
                    "artist": song.artistName,
                    "album": song.albumTitle ?? "" as Any,
                    "duration": song.duration ?? 0 as Any,
                    "artworkUrl": song.artwork?.url(width: 300, height: 300)?.absoluteString ?? "" as Any,
                    "isrc": song.isrc ?? "" as Any
                ]
            }
        }

        // Return first result if no exact match
        if let song = response.songs.first {
            return [
                "id": song.id.rawValue,
                "title": song.title,
                "artist": song.artistName,
                "album": song.albumTitle ?? "" as Any,
                "duration": song.duration ?? 0 as Any,
                "artworkUrl": song.artwork?.url(width: 300, height: 300)?.absoluteString ?? "" as Any,
                "isrc": song.isrc ?? "" as Any
            ]
        }

        return nil
    }

    // Play a song by Apple Music ID
    func play(songId: String) async throws -> [String: Any] {
        let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(songId))
        let response = try await request.response()

        guard let song = response.items.first else {
            throw NSError(domain: "MusicKitBridge", code: 404, userInfo: [NSLocalizedDescriptionKey: "Song not found"])
        }

        // Set the queue to this song and play
        player.queue = [song]
        try await player.play()

        return [
            "playing": true,
            "song": [
                "id": song.id.rawValue,
                "title": song.title,
                "artist": song.artistName
            ]
        ]
    }

    // Pause playback
    func pause() -> [String: Any] {
        player.pause()
        return ["paused": true]
    }

    // Resume playback
    func resume() async throws -> [String: Any] {
        try await player.play()
        return ["playing": true]
    }

    // Stop playback
    func stop() -> [String: Any] {
        player.stop()
        return ["stopped": true]
    }

    // Skip to next track
    func skipToNext() async throws -> [String: Any] {
        try await player.skipToNextEntry()
        return ["skipped": "next"]
    }

    // Skip to previous track
    func skipToPrevious() async throws -> [String: Any] {
        try await player.skipToPreviousEntry()
        return ["skipped": "previous"]
    }

    // Seek to position (in seconds)
    func seek(position: Double) -> [String: Any] {
        player.playbackTime = position
        return ["position": position]
    }

    // Get current playback state
    func getPlaybackState() -> [String: Any] {
        let state = player.state
        return [
            "status": playbackStatusString(state.playbackStatus),
            "position": player.playbackTime
        ]
    }

    private func playbackStatusString(_ status: MusicPlayer.PlaybackStatus) -> String {
        switch status {
        case .playing: return "playing"
        case .paused: return "paused"
        case .stopped: return "stopped"
        case .interrupted: return "interrupted"
        case .seekingForward: return "seekingForward"
        case .seekingBackward: return "seekingBackward"
        @unknown default: return "unknown"
        }
    }

    // Get now playing info
    func getNowPlaying() -> [String: Any] {
        guard let entry = player.queue.currentEntry else {
            return ["nowPlaying": NSNull()]
        }

        return [
            "nowPlaying": [
                "id": entry.id,
                "title": entry.title,
                "position": player.playbackTime,
                "status": playbackStatusString(player.state.playbackStatus)
            ]
        ]
    }

    // Add song to queue
    func addToQueue(songId: String) async throws -> [String: Any] {
        let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(songId))
        let response = try await request.response()

        guard let song = response.items.first else {
            throw NSError(domain: "MusicKitBridge", code: 404, userInfo: [NSLocalizedDescriptionKey: "Song not found"])
        }

        // Insert at end of queue
        try await player.queue.insert(song, position: .tail)

        return [
            "added": true,
            "song": [
                "id": song.id.rawValue,
                "title": song.title
            ]
        ]
    }

    // Set volume (note: system volume, not player-specific)
    func setVolume(_ volume: Float) -> [String: Any] {
        // ApplicationMusicPlayer doesn't have direct volume control
        // Volume is controlled at the system level
        return ["volume": volume, "note": "Volume controlled at system level"]
    }
}

// MARK: - Main Entry Point

@main
struct MusicKitHelperApp {
    static func main() async {
        guard #available(macOS 14.0, *) else {
            let errorResponse = Response(id: "error", success: false, data: nil, error: "macOS 14.0 (Sonoma) or later required for in-app playback")
            if let data = try? JSONEncoder().encode(errorResponse), let str = String(data: data, encoding: .utf8) {
                print(str)
                fflush(stdout)
            }
            return
        }

        await mainLoop()
    }

    @available(macOS 14.0, *)
    static func mainLoop() async {
        let bridge = await MusicKitBridge()
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        // Send ready signal
        let readyResponse = Response(id: "ready", success: true, data: AnyCodable(["version": "1.0.0", "platform": "macOS 14+"]), error: nil)
        if let data = try? encoder.encode(readyResponse), let str = String(data: data, encoding: .utf8) {
            print(str)
            fflush(stdout)
        }

        // Read commands from stdin
        while let line = readLine() {
            guard !line.isEmpty else { continue }

            do {
                let request = try decoder.decode(Request.self, from: Data(line.utf8))
                let response = await handleRequest(request, bridge: bridge)

                if let data = try? encoder.encode(response), let str = String(data: data, encoding: .utf8) {
                    print(str)
                    fflush(stdout)
                }
            } catch {
                let errorResponse = Response(id: "error", success: false, data: nil, error: "Parse error: \(error.localizedDescription)")
                if let data = try? encoder.encode(errorResponse), let str = String(data: data, encoding: .utf8) {
                    print(str)
                    fflush(stdout)
                }
            }
        }
    }

    @available(macOS 14.0, *)
    @MainActor
    static func handleRequest(_ request: Request, bridge: MusicKitBridge) async -> Response {
        do {
            let result: [String: Any]

            // Extract params - convert AnyCodable values to their underlying values
            var params: [String: Any] = [:]
            if let requestParams = request.params {
                for (key, value) in requestParams {
                    params[key] = value.value
                }
            }

            switch request.action {
            case "checkAuthStatus":
                result = await bridge.checkAuthStatus()

            case "authorize":
                result = await bridge.authorize()

            case "search":
                guard let query = params["query"] as? String else {
                    return Response(id: request.id, success: false, data: nil, error: "Missing query parameter")
                }
                let limit = params["limit"] as? Int ?? 25
                let songs = try await bridge.search(query: query, limit: limit)
                result = ["songs": songs]

            case "resolve":
                guard let artist = params["artist"] as? String,
                      let title = params["title"] as? String else {
                    return Response(id: request.id, success: false, data: nil, error: "Missing artist or title parameter")
                }
                let album = params["album"] as? String
                if let song = try await bridge.resolve(artist: artist, title: title, album: album) {
                    result = ["song": song]
                } else {
                    result = ["song": NSNull()]
                }

            case "play":
                guard let songId = params["songId"] as? String else {
                    return Response(id: request.id, success: false, data: nil, error: "Missing songId parameter")
                }
                result = try await bridge.play(songId: songId)

            case "pause":
                result = bridge.pause()

            case "resume":
                result = try await bridge.resume()

            case "stop":
                result = bridge.stop()

            case "skipToNext":
                result = try await bridge.skipToNext()

            case "skipToPrevious":
                result = try await bridge.skipToPrevious()

            case "seek":
                guard let position = params["position"] as? Double else {
                    return Response(id: request.id, success: false, data: nil, error: "Missing position parameter")
                }
                result = bridge.seek(position: position)

            case "getPlaybackState":
                result = bridge.getPlaybackState()

            case "getNowPlaying":
                result = bridge.getNowPlaying()

            case "addToQueue":
                guard let songId = params["songId"] as? String else {
                    return Response(id: request.id, success: false, data: nil, error: "Missing songId parameter")
                }
                result = try await bridge.addToQueue(songId: songId)

            case "setVolume":
                guard let volume = params["volume"] as? Double else {
                    return Response(id: request.id, success: false, data: nil, error: "Missing volume parameter")
                }
                result = bridge.setVolume(Float(volume))

            case "ping":
                result = ["pong": true]

            case "quit":
                result = ["quitting": true]
                // Exit after sending response
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    exit(0)
                }

            default:
                return Response(id: request.id, success: false, data: nil, error: "Unknown action: \(request.action)")
            }

            return Response(id: request.id, success: true, data: AnyCodable(result), error: nil)

        } catch {
            return Response(id: request.id, success: false, data: nil, error: error.localizedDescription)
        }
    }
}
