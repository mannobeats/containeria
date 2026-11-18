import Foundation

/// The engine's end of the conversation: a Unix socket handed over as standard input. Lines of JSON
/// go both ways, and a reply to `connect` carries the connection's file descriptor with it.
struct Channel {
    private static let descriptor: Int32 = 0
    /// Messages come from the VM's queue and the file watcher's: one at a time, each whole.
    private static let sending = NSLock()

    /// Sends one message, with `passing` attached as an `SCM_RIGHTS` descriptor when given.
    static func send(_ message: Message, passing descriptor: Int32? = nil) {
        guard var line = try? JSONEncoder().encode(message) else { return }
        line.append(0x0A)
        sending.lock()
        defer { sending.unlock() }
        line.withUnsafeMutableBytes { bytes in
            var part = iovec(iov_base: bytes.baseAddress, iov_len: bytes.count)
            withUnsafeMutablePointer(to: &part) { parts in
                var header = msghdr()
                header.msg_iov = parts
                header.msg_iovlen = 1
                guard let descriptor else {
                    _ = sendmsg(Channel.descriptor, &header, 0)
                    return
                }
                // Darwin aligns control messages to four bytes: a 12-byte header, then the descriptor.
                var control = [UInt8](repeating: 0, count: 16)
                control.withUnsafeMutableBytes { raw in
                    raw.storeBytes(of: UInt32(16), toByteOffset: 0, as: UInt32.self)
                    raw.storeBytes(of: SOL_SOCKET, toByteOffset: 4, as: Int32.self)
                    raw.storeBytes(of: SCM_RIGHTS, toByteOffset: 8, as: Int32.self)
                    raw.storeBytes(of: descriptor, toByteOffset: 12, as: Int32.self)
                    header.msg_control = raw.baseAddress
                    header.msg_controllen = 16
                    _ = sendmsg(Channel.descriptor, &header, 0)
                }
            }
        }
    }

    /// Calls `handle` for each command until the engine closes its end.
    static func read(_ handle: (Command) -> Void) {
        var pending = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return }
            pending.append(contentsOf: buffer[..<count])
            while let end = pending.firstIndex(of: 0x0A) {
                let line = pending[pending.startIndex..<end]
                pending = Data(pending[pending.index(after: end)...])
                if let command = try? JSONDecoder().decode(Command.self, from: line) {
                    handle(command)
                }
            }
        }
    }
}
