// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "containeria-vmm",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "containeria-vmm", path: "Sources")
    ]
)
