//! Behaviour that differs by operating system, asserted rather than
//! hoped — and asserted without a network, like everything else here.
//!
//! A sibling crate in this family shipped a release whose report used
//! `\` on Windows and `/` everywhere else, red on Windows CI for the
//! whole release before anyone looked. This crate's report carries **one**
//! path — `screenshot` — and it is built from a format string with a
//! literal `/` rather than a `PathBuf`; that shape is pinned by a unit
//! test in `render.rs`, because producing one needs a browser and
//! browsers belong to `scenarios`. What this file can reach without one
//! is every path the tool *prints*: a refusal names the file the caller
//! named, character for character, and never rewrites its separators.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

const BINARY: &str = env!("CARGO_BIN_EXE_scrape-le");
const SIGNATURE: &str = "key = \"kasada\"\nlabel = \"Kasada\"\nglobals = [\"KPSDK\"]\n";

static COUNTER: AtomicUsize = AtomicUsize::new(0);

struct Tree {
    root: PathBuf,
}

impl Tree {
    fn new(name: &str) -> Self {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "scrape-le-platform-{name}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("a temporary directory");
        Self {
            root: std::fs::canonicalize(&root).expect("a canonical directory"),
        }
    }

    fn path(&self) -> &Path {
        &self.root
    }

    fn write(&self, relative: &str, contents: &str) -> PathBuf {
        let target = self.root.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).expect("a parent directory");
        }
        std::fs::write(&target, contents).expect("a file");
        target
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct Run {
    code: i32,
    stdout: String,
    stderr: String,
}

fn run_with(args: &[&str], environment: &[(&str, Option<&str>)]) -> Run {
    let mut command = Command::new(BINARY);
    command.args(args).stdin(Stdio::null());
    for (name, value) in environment {
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    let output = command.output().expect("the binary runs");
    Run {
        code: output.status.code().expect("an exit code, never a signal"),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

fn run(args: &[&str]) -> Run {
    run_with(args, &[])
}

fn skipped(case: &str, why: &str) {
    eprintln!("SKIPPED {case}: {why}");
}

/// A path the caller typed comes back the way the caller typed it. A
/// tool that helpfully normalises separators makes its own messages
/// impossible to grep for, and on Windows it is the step that turns a
/// report into a machine-specific one.
#[test]
fn a_refusal_names_the_path_the_caller_gave_it() {
    let tree = Tree::new("paths");
    let nested = tree.write("a/b/c/signatures.toml", "this is not toml = = =");
    let given = nested.to_string_lossy().into_owned();

    let run = run(&["--signatures", &given]);
    assert_eq!(run.code, 2, "{}", run.stderr);
    assert!(
        run.stderr.contains(&given),
        "the refusal rewrote the path it was given\n  given: {given}\n  said:  {}",
        run.stderr
    );
    assert!(run.stdout.is_empty(), "a refusal wrote to stdout");
}

/// The report carries no local time and reads no clock outside the
/// screenshot's date, so the answer cannot depend on `TZ` — which
/// matters because Windows ignores the variable entirely and a suite
/// that quietly depended on it would be red there and nowhere else.
#[test]
fn the_answer_does_not_depend_on_the_time_zone() {
    let tree = Tree::new("tz");
    let path = tree.write("signatures.toml", SIGNATURE);
    let given = path.to_string_lossy().into_owned();
    let args = ["--signatures", &given];

    let utc = run_with(&args, &[("TZ", Some("UTC"))]);
    let unset = run_with(&args, &[("TZ", None)]);
    let far = run_with(&args, &[("TZ", Some("Pacific/Kiritimati"))]);

    assert_eq!(utc.stderr, unset.stderr, "TZ=UTC differs from TZ unset");
    assert_eq!(utc.stderr, far.stderr, "the answer moved with the clock");
    assert_eq!(utc.code, unset.code);
    assert_eq!(utc.code, far.code);
}

/// `Signatures.toml` and `signatures.toml` are one file on macOS and
/// Windows and two on Linux. Either answer is correct; what must not
/// happen is a crash, or a success that depends on which one it was.
#[test]
fn a_case_folding_filesystem_gives_a_consistent_answer() {
    let tree = Tree::new("case-fold");
    let exact = tree.write("signatures.toml", SIGNATURE);
    let folded = tree.path().join("SIGNATURES.TOML");

    let by_exact = run(&["--signatures", &exact.to_string_lossy()]);
    assert!(
        by_exact.stderr.contains("loaded 1 signature(s)"),
        "{}",
        by_exact.stderr
    );

    let by_folded = run(&["--signatures", &folded.to_string_lossy()]);
    assert_eq!(by_folded.code, 2, "no URL was given either way");
    let found = by_folded.stderr.contains("loaded 1 signature(s)");
    let refused = by_folded.stderr.contains("could not read");
    assert!(
        found || refused,
        "a case-folded path neither loaded nor was refused by name: {}",
        by_folded.stderr
    );
    assert!(
        found == folded.exists(),
        "the walk disagreed with the filesystem about whether {} exists: {}",
        folded.display(),
        by_folded.stderr
    );
}

/// `CON`, `PRN`, `AUX`, `NUL` and `COM1` are device names on Windows and
/// ordinary files everywhere else. The test asserts the tool **survives
/// the creation failing**, never that the files exist.
#[test]
fn reserved_windows_names_do_not_break_the_run() {
    let tree = Tree::new("reserved");
    let mut created = 0;
    for name in ["CON", "PRN", "AUX", "NUL", "COM1"] {
        let target = tree.path().join(format!("{name}.toml"));
        if std::fs::write(&target, SIGNATURE).is_err() {
            continue;
        }
        created += 1;
        let run = run(&["--signatures", &target.to_string_lossy()]);
        assert_eq!(run.code, 2, "{name}: no URL was given");
        assert!(
            (0..=2).contains(&run.code),
            "{name}: {} {}",
            run.code,
            run.stderr
        );
    }
    if created == 0 {
        skipped("reserved-names", "this platform refused every device name");
    }
}

/// **Assert the exit code, never the write.** A child that refuses
/// before draining stdin closes the pipe under the parent's feet; a test
/// that asserted the write succeeded was red on one platform and green
/// on the others for reasons that had nothing to do with the code.
#[test]
fn a_child_that_refuses_early_does_not_fail_on_the_write() {
    let mut child = Command::new(BINARY)
        .arg("--not-a-flag")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary runs");

    // Deliberately more than a pipe buffer, and deliberately unchecked.
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(&vec![b'x'; 1024 * 1024]);
        let _ = stdin.flush();
    }
    drop(child.stdin.take());

    let output = child.wait_with_output().expect("the child finishes");
    assert_eq!(
        output.status.code(),
        Some(2),
        "a malformed question is exit 2 whatever happened to stdin"
    );
}

/// `--input -` reads stdin to end of stream. Closing it immediately is a
/// caller that went away, and the answer is a named refusal rather than
/// a hang or a broken pipe.
#[test]
fn a_batch_from_a_closed_stdin_is_refused_by_name() {
    let mut child = Command::new(BINARY)
        .args(["--input", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary runs");
    drop(child.stdin.take());

    let output = child.wait_with_output().expect("the child finishes");
    assert_eq!(output.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("no URLs in"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty(), "a refusal wrote to stdout");
}

/// The MCP server reads stdin to end of stream. Closing it immediately
/// is a client that went away, and the answer is a clean exit.
#[test]
fn the_mcp_server_exits_cleanly_when_stdin_closes_immediately() {
    let mut child = Command::new(BINARY)
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary runs");
    drop(child.stdin.take());

    let mut stdout = String::new();
    if let Some(pipe) = child.stdout.as_mut() {
        let _ = pipe.read_to_string(&mut stdout);
    }
    let status = child.wait().expect("the child finishes");
    assert_eq!(status.code(), Some(0), "stdout was {stdout:?}");
}
