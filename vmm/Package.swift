// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "contena-vmm",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "contena-vmm", path: "Sources")
    ]
)
