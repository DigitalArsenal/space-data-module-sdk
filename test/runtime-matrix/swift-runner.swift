import Foundation

guard CommandLine.arguments.count >= 2 else {
  fatalError("expected spec path")
}

let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
process.arguments = ["node", "test/runtime-matrix/node-runner.mjs", CommandLine.arguments[1]]
process.standardInput = nil
process.standardOutput = FileHandle.standardOutput
process.standardError = FileHandle.standardError

try process.run()
process.waitUntilExit()
exit(process.terminationStatus)
