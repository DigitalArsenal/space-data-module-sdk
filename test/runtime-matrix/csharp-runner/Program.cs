using System.Diagnostics;

if (args.Length < 1)
{
    throw new InvalidOperationException("expected spec path");
}

var process = new Process
{
    StartInfo = new ProcessStartInfo
    {
        FileName = "node",
        Arguments = $"test/runtime-matrix/node-runner.mjs \"{args[0]}\"",
        UseShellExecute = false,
        RedirectStandardOutput = false,
        RedirectStandardError = false,
    },
};

process.Start();
process.WaitForExit();
Environment.Exit(process.ExitCode);
