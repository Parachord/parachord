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

// MARK: - MusicKit Bridge

@available(macOS 12.0, *)
class MusicKitBridge {
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

    // Play a song by Apple Music ID - opens in Music app
    func play(songId: String) async throws -> [String: Any] {
        let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(songId))
        let response = try await request.response()

        guard let song = response.items.first else {
            throw NSError(domain: "MusicKitBridge", code: 404, userInfo: [NSLocalizedDescriptionKey: "Song not found"])
        }

        // Open the song in Apple Music app
        if let url = song.url {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = [url.absoluteString]
            try process.run()
            process.waitUntilExit()
        }

        return [
            "playing": true,
            "song": [
                "id": song.id.rawValue,
                "title": song.title,
                "artist": song.artistName
            ],
            "note": "Opened in Apple Music app"
        ]
    }

    // Control playback via AppleScript (works with Music app)
    func pause() -> [String: Any] {
        runAppleScript("tell application \"Music\" to pause")
        return ["paused": true]
    }

    func resume() -> [String: Any] {
        runAppleScript("tell application \"Music\" to play")
        return ["playing": true]
    }

    func stop() -> [String: Any] {
        runAppleScript("tell application \"Music\" to stop")
        return ["stopped": true]
    }

    func skipToNext() -> [String: Any] {
        runAppleScript("tell application \"Music\" to next track")
        return ["skipped": "next"]
    }

    func skipToPrevious() -> [String: Any] {
        runAppleScript("tell application \"Music\" to previous track")
        return ["skipped": "previous"]
    }

    func seek(position: Double) -> [String: Any] {
        runAppleScript("tell application \"Music\" to set player position to \(position)")
        return ["position": position]
    }

    func getPlaybackState() -> [String: Any] {
        let stateScript = """
        tell application "Music"
            if player state is playing then
                return "playing"
            else if player state is paused then
                return "paused"
            else
                return "stopped"
            end if
        end tell
        """
        let state = runAppleScriptWithResult(stateScript) ?? "unknown"

        let positionScript = """
        tell application "Music"
            try
                return player position
            on error
                return 0
            end try
        end tell
        """
        let positionStr = runAppleScriptWithResult(positionScript) ?? "0"
        let position = Double(positionStr) ?? 0

        return [
            "status": state,
            "position": position
        ]
    }

    func getNowPlaying() -> [String: Any] {
        let script = """
        tell application "Music"
            if player state is not stopped then
                set trackName to name of current track
                set trackArtist to artist of current track
                set trackAlbum to album of current track
                set trackDuration to duration of current track
                return trackName & "|" & trackArtist & "|" & trackAlbum & "|" & trackDuration
            else
                return ""
            end if
        end tell
        """

        if let result = runAppleScriptWithResult(script), !result.isEmpty {
            let parts = result.components(separatedBy: "|")
            if parts.count >= 4 {
                return [
                    "nowPlaying": [
                        "title": parts[0],
                        "artist": parts[1],
                        "album": parts[2],
                        "duration": Double(parts[3]) ?? 0
                    ]
                ]
            }
        }

        return ["nowPlaying": NSNull()]
    }

    func setVolume(_ volume: Float) -> [String: Any] {
        let volumeInt = Int(volume * 100)
        runAppleScript("tell application \"Music\" to set sound volume to \(volumeInt)")
        return ["volume": volume]
    }

    // Helper to run AppleScript
    private func runAppleScript(_ script: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
        process.waitUntilExit()
    }

    private func runAppleScriptWithResult(_ script: String) -> String? {
        let process = Process()
        let pipe = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        try? process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Main Entry Point

@main
struct MusicKitHelperApp {
    static func main() async {
        guard #available(macOS 12.0, *) else {
            let errorResponse = Response(id: "error", success: false, data: nil, error: "macOS 12.0 or later required")
            if let data = try? JSONEncoder().encode(errorResponse), let str = String(data: data, encoding: .utf8) {
                print(str)
                fflush(stdout)
            }
            return
        }

        let bridge = MusicKitBridge()
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        // Send ready signal
        let readyResponse = Response(id: "ready", success: true, data: AnyCodable(["version": "1.0.0"]), error: nil)
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

    @available(macOS 12.0, *)
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
                result = bridge.resume()

            case "stop":
                result = bridge.stop()

            case "skipToNext":
                result = bridge.skipToNext()

            case "skipToPrevious":
                result = bridge.skipToPrevious()

            case "seek":
                guard let position = params["position"] as? Double else {
                    return Response(id: request.id, success: false, data: nil, error: "Missing position parameter")
                }
                result = bridge.seek(position: position)

            case "getPlaybackState":
                result = bridge.getPlaybackState()

            case "getNowPlaying":
                result = bridge.getNowPlaying()

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
