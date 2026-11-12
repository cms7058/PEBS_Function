// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "PEBSDesktop", platforms: [.macOS(.v14)], products: [.executable(name: "PEBS", targets: ["PEBSMac"])], targets: [
    .systemLibrary(name: "CSQLite"),
    .target(name: "PEBSCore", dependencies: ["CSQLite"]),
    .executableTarget(name: "PEBSMac", dependencies: ["PEBSCore"]),
    .executableTarget(name: "PEBSChecks", dependencies: ["PEBSCore"], path: "Checks")
])
