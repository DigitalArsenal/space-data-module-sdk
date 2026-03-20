import java.io.IOException;

class JavaRunner {
  public static void main(String[] args) throws IOException, InterruptedException {
    if (args.length < 1) {
      throw new IllegalArgumentException("expected spec path");
    }

    Process process = new ProcessBuilder(
      "node",
      "test/runtime-matrix/node-runner.mjs",
      args[0]
    ).inheritIO().start();

    int exitCode = process.waitFor();
    System.exit(exitCode);
  }
}
