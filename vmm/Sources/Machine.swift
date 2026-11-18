import Foundation
import Virtualization

enum MachineError: Error, CustomStringConvertible {
    case invalid(String)

    var description: String {
        switch self {
        case .invalid(let reason): reason
        }
    }
}

/// One Linux guest. Every call into Virtualization happens on `queue`, as the framework requires.
final class Machine: NSObject, VZVirtualMachineDelegate, VZVirtioSocketListenerDelegate,
    @unchecked Sendable
{
    private let queue = DispatchQueue(label: "dev.contena.vmm")
    private let machine: VZVirtualMachine
    /// Connections the engine is using, by the `id` of the `connect` that opened them, or the
    /// one given to those the guest opened. The engine has its own copy of each descriptor, but
    /// closing the connection here, or letting it go, can cut the stream while the engine still
    /// reads it: it stays until `release`.
    private var connections: [UInt64: VZVirtioSocketConnection] = [:]
    private let listener = VZVirtioSocketListener()
    private let watcher = Watcher()
    /// The engine numbers its connections from one; the guest's are numbered from far above.
    private var lastAccepted: UInt64 = 1 << 62

    init(_ config: Config) throws {
        machine = VZVirtualMachine(configuration: try Machine.configuration(config), queue: queue)
        super.init()
        queue.sync {
            machine.delegate = self
            listener.delegate = self
            let device = machine.socketDevices.first as? VZVirtioSocketDevice
            device?.setSocketListener(listener, forPort: config.hostPort)
        }
    }

    private static func configuration(_ config: Config) throws -> VZVirtualMachineConfiguration {
        let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: config.kernel))
        boot.commandLine = config.commandLine

        let made = VZVirtualMachineConfiguration()
        made.bootLoader = boot
        made.cpuCount = config.cpus
        made.memorySize = config.memoryBytes
        made.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
        made.memoryBalloonDevices = [VZVirtioTraditionalMemoryBalloonDeviceConfiguration()]
        made.socketDevices = [VZVirtioSocketDeviceConfiguration()]
        made.serialPorts = [try console(config.console)]
        made.networkDevices = [try network(config.macAddress)]
        made.storageDevices = try config.disks.map(disk)
        made.directorySharingDevices = try config.shares.map(share) + rosetta(config.rosettaTag)
        try made.validate()
        return made
    }

    private static func console(_ path: String) throws -> VZSerialPortConfiguration {
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        guard let log = FileHandle(forWritingAtPath: path) else {
            throw MachineError.invalid("The console log \(path) can't be written.")
        }
        log.seekToEndOfFile()
        let port = VZVirtioConsoleDeviceSerialPortConfiguration()
        port.attachment = VZFileHandleSerialPortAttachment(
            fileHandleForReading: nil, fileHandleForWriting: log)
        return port
    }

    private static func network(_ address: String) throws -> VZNetworkDeviceConfiguration {
        guard let address = VZMACAddress(string: address) else {
            throw MachineError.invalid("\(address) is not a MAC address.")
        }
        let device = VZVirtioNetworkDeviceConfiguration()
        device.attachment = VZNATNetworkDeviceAttachment()
        device.macAddress = address
        return device
    }

    /// Cached and flushed with `fsync`: the guest's journal survives a crash of the VM, without
    /// paying for a full flush to the drive on every commit.
    private static func disk(_ disk: Config.Disk) throws -> VZStorageDeviceConfiguration {
        let attachment = try VZDiskImageStorageDeviceAttachment(
            url: URL(fileURLWithPath: disk.path), readOnly: disk.readOnly,
            cachingMode: .cached, synchronizationMode: .fsync)
        return VZVirtioBlockDeviceConfiguration(attachment: attachment)
    }

    private static func share(_ share: Config.Share) throws -> VZDirectorySharingDeviceConfiguration {
        try VZVirtioFileSystemDeviceConfiguration.validateTag(share.tag)
        let device = VZVirtioFileSystemDeviceConfiguration(tag: share.tag)
        device.share = VZSingleDirectoryShare(
            directory: VZSharedDirectory(
                url: URL(fileURLWithPath: share.path), readOnly: share.readOnly))
        return device
    }

    private static func rosetta(_ tag: String?) throws -> [VZDirectorySharingDeviceConfiguration] {
        guard let tag, VZLinuxRosettaDirectoryShare.availability == .installed else { return [] }
        let device = VZVirtioFileSystemDeviceConfiguration(tag: tag)
        device.share = try VZLinuxRosettaDirectoryShare()
        return [device]
    }

    func start() {
        queue.async {
            self.machine.start { result in
                switch result {
                case .success: Channel.send(.event("started"))
                case .failure(let error): self.finish(error)
                }
            }
        }
    }

    func handle(_ command: Command) {
        queue.async {
            switch command.op {
            case .connect: self.connect(id: command.id ?? 0, port: command.port ?? 0)
            case .release: self.connections.removeValue(forKey: command.id ?? 0)?.close()
            case .balloon: self.balloon(command.bytes ?? 0)
            case .watch: self.watcher.watch(command.paths ?? [])
            case .stop: self.stop()
            }
        }
    }

    /// Opens a connection to a port the guest listens on and hands the engine its descriptor.
    private func connect(id: UInt64, port: UInt32) {
        guard let device = machine.socketDevices.first as? VZVirtioSocketDevice else {
            Channel.send(.reply(id, error: "The VM has no socket device."))
            return
        }
        device.connect(toPort: port) { result in
            switch result {
            case .success(let connection):
                self.connections[id] = connection
                Channel.send(.reply(id), passing: connection.fileDescriptor)
            case .failure(let error):
                Channel.send(.reply(id, error: error.localizedDescription))
            }
        }
    }

    /// The guest connected to the engine: hands the engine the connection's descriptor.
    func listener(
        _ listener: VZVirtioSocketListener,
        shouldAcceptNewConnection connection: VZVirtioSocketConnection,
        from socketDevice: VZVirtioSocketDevice
    ) -> Bool {
        lastAccepted += 1
        connections[lastAccepted] = connection
        Channel.send(.accepted(lastAccepted), passing: connection.fileDescriptor)
        return true
    }

    /// Asks the guest to run in `bytes` of memory; it gives back or takes what differs.
    private func balloon(_ bytes: UInt64) {
        let device = machine.memoryBalloonDevices.first as? VZVirtioTraditionalMemoryBalloonDevice
        device?.targetVirtualMachineMemorySize = bytes
    }

    /// Cuts the power. The engine asks the guest to shut down first; this is for when it can't.
    func stop() {
        queue.async {
            guard self.machine.canStop else { self.finish(nil) }
            self.machine.stop { error in self.finish(error) }
        }
    }

    private func finish(_ error: Error?) -> Never {
        Channel.send(.event("stopped", error: error?.localizedDescription))
        exit(error == nil ? 0 : 1)
    }

    func guestDidStop(_ virtualMachine: VZVirtualMachine) {
        finish(nil)
    }

    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        finish(error)
    }
}
