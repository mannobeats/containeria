// containeria-vmm runs one Linux guest with Apple Virtualization for the Containeria engine.
//
//   containeria-vmm <config.json>
//
// Standard input is a Unix socket to the engine (see Channel). The guest stops when the engine
// closes it, so a VM never outlives the engine that started it.

import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: containeria-vmm <config.json>\n".utf8))
    exit(64)
}

do {
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let machine = try Machine(try JSONDecoder().decode(Config.self, from: data))
    signal(SIGPIPE, SIG_IGN)
    machine.start()
    Thread.detachNewThread {
        Channel.read(machine.handle)
        machine.stop()
    }
    dispatchMain()
} catch {
    Channel.send(.event("stopped", error: "\(error)"))
    exit(1)
}
