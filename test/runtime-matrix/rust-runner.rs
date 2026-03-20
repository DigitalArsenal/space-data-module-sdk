use std::env;
use std::process::{exit, Command};

fn main() {
    let spec_path = env::args().nth(1).expect("expected spec path");
    let output = Command::new("node")
        .arg("test/runtime-matrix/node-runner.mjs")
        .arg(spec_path)
        .output()
        .expect("failed to execute node runner");

    print!("{}", String::from_utf8_lossy(&output.stdout));
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
    exit(output.status.code().unwrap_or(1));
}
