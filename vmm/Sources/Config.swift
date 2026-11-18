import Foundation

/// What the engine asks for, as JSON in the file named on the command line.
struct Config: Decodable {
    struct Disk: Decodable {
        var path: String
        var readOnly: Bool
    }

    /// A Mac folder the guest mounts by `tag` over virtiofs.
    struct Share: Decodable {
        var tag: String
        var path: String
        var readOnly: Bool
    }

    var cpus: Int
    var memoryBytes: UInt64
    var kernel: String
    var commandLine: String
    /// In order: the guest sees them as /dev/vda, /dev/vdb and so on.
    var disks: [Disk]
    var shares: [Share]
    /// Shares Rosetta under this tag when the Mac has it installed.
    var rosettaTag: String?
    /// The guest's console is appended to this file.
    var console: String
    /// Kept across starts so the Mac's DHCP server gives the guest the same address.
    var macAddress: String
    /// The port the guest connects to when it wants something on the Mac. Each connection is
    /// handed to the engine with an `accepted` event.
    var hostPort: UInt32
}

/// What the engine sends on standard input, one JSON object per line.
struct Command: Decodable {
    enum Operation: String, Decodable {
        case connect
        case release
        case balloon
        case watch
        case stop
    }

    var op: Operation
    /// Names a connection: echoed in the reply to `connect`, and given again to `release` it.
    var id: UInt64?
    var port: UInt32?
    var bytes: UInt64?
    /// The folders to `watch`, replacing those watched before.
    var paths: [String]?
}

/// What the engine reads back: a reply carries the `id` of its command and no event. An
/// `accepted` event carries the `id` the engine releases the new connection by, and a `changed`
/// event what the Mac reported about watched folders.
struct Message: Encodable {
    /// One file or folder, and what happened to it as FSEvents flags it.
    struct Change: Encodable {
        var path: String
        var flags: UInt32
    }

    var id: UInt64?
    var event: String?
    var error: String?
    var changes: [Change]?

    static func reply(_ id: UInt64, error: String? = nil) -> Message {
        Message(id: id, event: nil, error: error)
    }

    static func event(_ name: String, error: String? = nil) -> Message {
        Message(id: nil, event: name, error: error)
    }

    static func accepted(_ id: UInt64) -> Message {
        Message(id: id, event: "accepted", error: nil)
    }

    static func changed(_ changes: [Change]) -> Message {
        Message(id: nil, event: "changed", error: nil, changes: changes)
    }
}
