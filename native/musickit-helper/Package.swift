// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MusicKitHelper",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(name: "musickit-helper", targets: ["MusicKitHelper"])
    ],
    targets: [
        .executableTarget(
            name: "MusicKitHelper",
            path: "Sources"
        )
    ]
)
