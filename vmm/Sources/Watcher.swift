import CoreServices
import Foundation

/// Tells the engine what changes on the Mac under the folders it names. The guest can't see
/// those changes happen, so the engine passes them on to it.
final class Watcher: @unchecked Sendable {
    private let queue = DispatchQueue(label: "dev.contena.vmm.files")
    /// One stream for each folder, so naming another leaves the watching of the rest alone.
    private var streams: [String: FSEventStreamRef] = [:]

    /// Watches these folders and no others.
    func watch(_ paths: [String]) {
        queue.async { self.change(to: Set(paths)) }
    }

    private func change(to wanted: Set<String>) {
        // The new ones start before the old ones stop: when a folder takes over from one inside
        // it, a change in between is reported twice rather than not at all.
        for path in wanted where streams[path] == nil {
            streams[path] = Watcher.start(path, on: queue)
        }
        for (path, stream) in streams where !wanted.contains(path) {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            streams[path] = nil
        }
    }

    private static func start(_ path: String, on queue: DispatchQueue) -> FSEventStreamRef? {
        var context = FSEventStreamContext()
        // One event for each file, sent as it happens, with paths as strings.
        let flags = UInt32(
            kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer
                | kFSEventStreamCreateFlagUseCFTypes)
        // Only what happens from now on: asking for earlier events has the Mac read its
        // history first, which can hold the new ones back.
        let now = FSEventStreamEventId(kFSEventStreamEventIdSinceNow)
        guard
            let stream = FSEventStreamCreate(
                nil, report, &context, [path] as CFArray, now, 0, flags)
        else { return nil }
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
        return stream
    }

    private static let report: FSEventStreamCallback = { _, _, count, paths, flags, _ in
        let paths = Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as NSArray
        let changes = (0..<count).compactMap { index in
            (paths[index] as? String).map { Message.Change(path: $0, flags: flags[index]) }
        }
        Channel.send(.changed(changes))
    }
}
