//! Inputs a real machine holds and a fixture directory cannot.
//!
//! **Nothing here touches the network.** This crate's product is a page
//! fetch, so its hazards are aimed at the two things it reads from disk
//! and can answer about without leaving the machine: a `--signatures`
//! TOML file, and a `--input` batch file whose every entry is malformed.
//! A batch of malformed entries is refused before a socket is opened,
//! and each test asserts the refusal it expects — which is also the
//! proof that no request went out.
//!
//! The tree is **built at runtime**, not checked in: Windows cannot hold
//! a FIFO, a permission-denied file, or half of these names in git. Each
//! case the platform cannot express says so by name — see `skipped()` —
//! and a skip is never reported as a pass.
//!
//! Every case asserts the same floor: the process does not panic, does
//! not hang, and exits 0, 1 or 2 — never on a signal.

use std::fmt::Write as _;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const BINARY: &str = env!("CARGO_BIN_EXE_scrape-le");

/// Generous enough for a shared runner reading a 1 MB line, tight enough
/// that a blocking read on a FIFO is a failure rather than a coffee
/// break.
const LIMIT: Duration = Duration::from_secs(60);

/// One valid vendor signature, and the label the crate should find in it.
const SIGNATURE: &str =
    "key = \"kasada\"\nlabel = \"Kasada\"\nscript_substrings = [\"kasada.io\"]\n";

static COUNTER: AtomicUsize = AtomicUsize::new(0);

struct Tree {
    root: PathBuf,
}

impl Tree {
    fn new(name: &str) -> Self {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "scrape-le-hazard-{name}-{}-{unique}",
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
        self.write_bytes(relative, contents.as_bytes())
    }

    fn write_bytes(&self, relative: &str, contents: &[u8]) -> PathBuf {
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

/// Runs the binary and **fails rather than blocks**. A hang is the
/// failure mode this file exists to catch — a FIFO with no writer is one
/// `read` away from an eternal CI job — so the child is killed and the
/// case is named.
fn run(case: &str, args: &[&str]) -> Run {
    let mut child = Command::new(BINARY)
        .args(args)
        // Never inherit the terminal: `--input -` reads stdin, and a
        // child waiting on a keyboard that is not there is a hang with
        // an innocent explanation.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary runs");

    // Drained on threads: a child writing more than a pipe buffer would
    // deadlock against a parent that waits before reading.
    let mut out = child.stdout.take().expect("stdout");
    let mut err = child.stderr.take().expect("stderr");
    let out = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = out.read_to_end(&mut buffer);
        buffer
    });
    let err = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = err.read_to_end(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + LIMIT;
    let status = loop {
        match child.try_wait().expect("the child is waitable") {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("{case}: hung for {LIMIT:?} on {args:?}");
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    };

    let code = status.code().unwrap_or_else(|| {
        panic!("{case}: died on a signal rather than exiting ({status:?}) on {args:?}")
    });
    assert!(
        (0..=2).contains(&code),
        "{case}: exit {code} is outside the documented 0/1/2 on {args:?}"
    );
    Run {
        code,
        stdout: String::from_utf8_lossy(&out.join().expect("stdout thread")).into_owned(),
        stderr: String::from_utf8_lossy(&err.join().expect("stderr thread")).into_owned(),
    }
}

/// Loads a signature file and nothing else. No URL is given, so the run
/// stops at "no URL supplied" without a single request leaving the
/// machine — the signature file is still read and parsed first.
fn load_signatures(case: &str, path: &Path) -> Run {
    let run = run(case, &["--signatures", &path.to_string_lossy()]);
    assert_eq!(
        run.code, 2,
        "{case}: no URL was given, so the run must refuse — {}",
        run.stderr
    );
    assert!(
        run.stdout.is_empty(),
        "{case}: a refusal wrote to the protocol stream — {}",
        run.stdout
    );
    run
}

/// Reads a batch file whose every entry is malformed. Malformed on
/// purpose: `run_batch` refuses before it schedules anything, which is
/// how this suite reads a real file without reaching a real host.
fn read_batch(case: &str, path: &Path) -> Run {
    let run = run(case, &["--input", &path.to_string_lossy()]);
    assert_eq!(run.code, 2, "{case}: {}", run.stderr);
    assert!(
        run.stdout.is_empty(),
        "{case}: a refusal wrote to the protocol stream — {}",
        run.stdout
    );
    assert!(
        !run.stderr.contains("clear ·"),
        "{case}: a batch actually ran — a request left the machine\n{}",
        run.stderr
    );
    run
}

fn loaded(run: &Run) -> bool {
    run.stderr.contains("loaded 1 signature(s)")
}

/// How many entries a batch refusal named. Every entry is malformed, so
/// this is the count the input parser found.
fn entries_named(run: &Run) -> usize {
    run.stderr
        .lines()
        .filter(|line| line.contains("is not an http(s) URL"))
        .count()
}

/// A case the platform cannot express. Named on stderr so a green run
/// still says what it did not check — a silent skip is a lie.
fn skipped(case: &str, why: &str) {
    eprintln!("SKIPPED {case}: {why}");
}

/// A batch body of `count` entries, none of which can validate: no dot,
/// and a space where a host would be.
fn malformed_entries(count: usize, decoration: &str) -> Vec<String> {
    (0..count)
        .map(|index| format!("not a url {index}{decoration}"))
        .collect()
}

// ---------------------------------------------------------------- content

/// A byte-order mark is three invisible bytes Notepad, Excel and a
/// PowerShell redirect all add. A file that parses without one must
/// parse with one, or the tool refuses a file its author cannot see
/// anything wrong with.
#[test]
fn a_byte_order_mark_does_not_change_a_signature_file() {
    let tree = Tree::new("bom-signatures");
    let plain = tree.write("plain.toml", SIGNATURE);
    let marked = tree.write("marked.toml", &format!("\u{feff}{SIGNATURE}"));

    let without = load_signatures("bom-signatures", &plain);
    assert!(
        loaded(&without),
        "the control case did not load: {}",
        without.stderr
    );
    let with = load_signatures("bom-signatures", &marked);
    assert!(
        loaded(&with),
        "a byte-order mark made a valid signature file unreadable: {}",
        with.stderr
    );
}

#[test]
fn a_byte_order_mark_does_not_change_a_batch_file() {
    let tree = Tree::new("bom-input");
    let body = serde_json::to_string(&malformed_entries(3, "")).expect("JSON");
    let plain = tree.write("plain.json", &body);
    let marked = tree.write("marked.json", &format!("\u{feff}{body}"));

    let without = read_batch("bom-input", &plain);
    assert_eq!(entries_named(&without), 3, "{}", without.stderr);
    let with = read_batch("bom-input", &marked);
    assert_eq!(
        entries_named(&with),
        3,
        "a byte-order mark changed how a JSON batch was read: {}",
        with.stderr
    );
}

#[test]
fn line_endings_do_not_change_a_batch_file() {
    let tree = Tree::new("line-endings");
    let entries = malformed_entries(4, "");
    for (case, separator) in [("crlf", "\r\n"), ("lf", "\n"), ("no-trailing", "\n")] {
        let mut body = entries.join(separator);
        if case != "no-trailing" {
            body.push_str(separator);
        }
        let path = tree.write(&format!("{case}.csv"), &body);
        let run = read_batch(case, &path);
        assert_eq!(entries_named(&run), 4, "{case}: {}", run.stderr);
    }

    // A lone CR is not a line ending: `str::lines` splits on `\n` only,
    // so the whole file is one entry. Pinned rather than improved.
    let lone = tree.write("cr.csv", &entries.join("\r"));
    let run = read_batch("lone-cr", &lone);
    assert_eq!(entries_named(&run), 1, "{}", run.stderr);
}

#[test]
fn an_empty_or_whitespace_batch_file_is_refused_by_name() {
    let tree = Tree::new("empty-input");
    for (case, body) in [("empty", ""), ("whitespace", "   \n\t\n \n")] {
        let path = tree.write(&format!("{case}.csv"), body);
        let run = run(case, &["--input", &path.to_string_lossy()]);
        assert_eq!(run.code, 2, "{case}");
        assert!(
            run.stderr.contains("no URLs in"),
            "{case}: the refusal does not say what was wrong — {}",
            run.stderr
        );
    }
}

/// A NUL byte is valid UTF-8, so the file is read and the entry carrying
/// it is refused like any other. What must not happen is a panic.
#[test]
fn a_nul_byte_mid_file_refuses_rather_than_panics() {
    let tree = Tree::new("nul");
    let mut body = String::new();
    for entry in malformed_entries(3, "") {
        let _ = writeln!(body, "{entry}");
    }
    body.push_str("not a url \u{0} three\n");
    let path = tree.write("nul.csv", &body);
    let run = read_batch("nul", &path);
    assert_eq!(entries_named(&run), 4, "{}", run.stderr);
}

/// **Never silently absent.** A file that cannot be decoded is named on
/// stderr and refused; what is not allowed is a run that reports on the
/// entries it could read and says nothing about the file it could not.
#[test]
fn an_undecodable_file_is_refused_by_name_and_writes_no_report() {
    for (case, bytes) in [
        ("invalid-utf8", vec![b'n', b'o', 0xff, 0xfe, b'\n']),
        // UTF-16LE with a BOM: what Notepad writes when asked for
        // "Unicode", and not UTF-8 by any reading.
        (
            "utf16le",
            vec![0xff, 0xfe, b'n', 0x00, b'o', 0x00, b't', 0x00],
        ),
    ] {
        let tree = Tree::new(case);
        let path = tree.write_bytes("input.csv", &bytes);
        let batch = run(case, &["--input", &path.to_string_lossy()]);
        assert_eq!(batch.code, 2, "{case}");
        assert!(
            batch.stderr.contains("could not read"),
            "{case}: the refusal does not name the file — {}",
            batch.stderr
        );
        assert!(batch.stdout.is_empty(), "{case}: a refusal wrote a report");

        let signatures = run(case, &["--signatures", &path.to_string_lossy()]);
        assert_eq!(signatures.code, 2, "{case}: signatures");
        assert!(signatures.stdout.is_empty());
    }
}

/// **This crate has no `--strict` and no per-file report line**, so the
/// family's "a binary file is not a report line" assertion has no direct
/// equivalent. The equivalent property here is that a file it cannot
/// parse is a named refusal and never a fabricated result: stdout is
/// protocol, and a refusal leaves it empty.
#[test]
fn a_binary_signature_file_is_refused_rather_than_guessed_at() {
    let tree = Tree::new("binary");
    // A PNG header, the exact case that broke a sibling crate.
    let path = tree.write_bytes(
        "logo.toml",
        &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
    );
    let run = run("binary", &["--signatures", &path.to_string_lossy()]);
    assert_eq!(run.code, 2);
    assert!(run.stdout.is_empty(), "a refusal wrote a report");
    assert!(
        run.stderr.contains("logo.toml"),
        "the refusal does not name the file — {}",
        run.stderr
    );
}

#[test]
fn a_four_byte_character_does_not_break_a_signature_label() {
    let tree = Tree::new("emoji");
    let path = tree.write(
        "emoji.toml",
        "key = \"kasada\"\nlabel = \"Kasada \u{1f389}\"\nglobals = [\"KPSDK\"]\n",
    );
    let run = load_signatures("emoji", &path);
    assert!(loaded(&run), "{}", run.stderr);
}

#[test]
fn a_one_megabyte_line_completes() {
    let tree = Tree::new("long-line");
    let mut body = String::from("not a url ");
    body.push_str(&"x".repeat(1024 * 1024));
    body.push('\n');
    body.push_str("not a url two\n");
    let path = tree.write("long.csv", &body);
    let run = read_batch("long-line", &path);
    assert_eq!(entries_named(&run), 2, "{}", run.stderr);
}

#[test]
fn a_hundred_thousand_lines_complete() {
    let tree = Tree::new("many-lines");
    let mut body = String::new();
    for line in 0..100_000 {
        if line % 100 == 0 {
            let _ = writeln!(body, "not a url {line}");
            continue;
        }
        let _ = writeln!(body, "# a comment line");
    }
    let path = tree.write("many.csv", &body);
    let run = read_batch("many-lines", &path);
    assert_eq!(entries_named(&run), 1_000, "{}", run.stderr);
}

// ------------------------------------------------------------- filesystem

#[cfg(unix)]
fn symlink(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(original, link)
}

/// Windows needs Developer Mode or an elevated process to create one, so
/// a failure here is the platform refusing rather than the code being
/// wrong — the caller skips by name.
#[cfg(windows)]
fn symlink(original: &Path, link: &Path) -> std::io::Result<()> {
    if original.is_dir() {
        return std::os::windows::fs::symlink_dir(original, link);
    }
    std::os::windows::fs::symlink_file(original, link)
}

#[test]
fn a_symlinked_signature_file_is_followed_and_a_broken_one_is_refused() {
    let tree = Tree::new("symlink");
    let target = tree.write("real.toml", SIGNATURE);
    let link = tree.path().join("link.toml");
    if symlink(&target, &link).is_err() {
        skipped("symlink", "this platform refused to create a symlink");
        return;
    }
    let followed = load_signatures("symlink", &link);
    assert!(loaded(&followed), "{}", followed.stderr);

    let broken = tree.path().join("broken.toml");
    let _ = symlink(&tree.path().join("nowhere-at-all"), &broken);
    let refused = run(
        "symlink-broken",
        &["--signatures", &broken.to_string_lossy()],
    );
    assert_eq!(refused.code, 2);
    assert!(refused.stdout.is_empty());
}

#[test]
fn a_symlink_loop_is_refused_rather_than_followed() {
    let tree = Tree::new("symlink-loop");
    let first = tree.path().join("loop-a.toml");
    let second = tree.path().join("loop-b.toml");
    if symlink(&second, &first).is_err() || symlink(&first, &second).is_err() {
        skipped("symlink-loop", "this platform refused to create a symlink");
        return;
    }
    let looped = run("symlink-loop", &["--signatures", &first.to_string_lossy()]);
    assert_eq!(looped.code, 2, "{}", looped.stderr);
    assert!(looped.stdout.is_empty());
}

/// The hang this file exists for. A FIFO with no writer blocks a `read`
/// forever, and both file inputs read straight to a string.
#[cfg(unix)]
#[test]
fn a_fifo_does_not_block_the_run() {
    let tree = Tree::new("fifo");
    let fifo = tree.path().join("pipe.toml");
    // Shelled out rather than called through libc: `unsafe` is forbidden
    // crate-wide and a test is not an exemption.
    let made = Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .is_ok_and(|status| status.success());
    if !made {
        skipped("fifo", "mkfifo is not available on this runner");
        return;
    }

    let signatures = run(
        "fifo-signatures",
        &["--signatures", &fifo.to_string_lossy()],
    );
    assert_eq!(
        signatures.code, 2,
        "a named pipe must be refused, not read: {}",
        signatures.stderr
    );
    let input = run("fifo-input", &["--input", &fifo.to_string_lossy()]);
    assert_eq!(input.code, 2, "{}", input.stderr);
}

#[cfg(not(unix))]
#[test]
fn a_fifo_does_not_block_the_run() {
    skipped("fifo", "Windows has no FIFO in a directory tree");
}

/// An unreadable file is a malformed question here, unlike the crates
/// that walk a tree: the caller named exactly this file, so refusing it
/// with exit 2 is the honest answer rather than a partial result.
#[cfg(unix)]
#[test]
fn a_permission_denied_file_is_refused_by_name() {
    use std::os::unix::fs::PermissionsExt;

    let tree = Tree::new("denied");
    let denied = tree.write("denied.toml", SIGNATURE);
    std::fs::set_permissions(&denied, std::fs::Permissions::from_mode(0o000)).expect("chmod");
    if std::fs::read(&denied).is_ok() {
        skipped(
            "permission-denied",
            "this runner reads a mode-000 file anyway (root)",
        );
        return;
    }

    let run = run("denied", &["--signatures", &denied.to_string_lossy()]);
    assert_eq!(run.code, 2);
    assert!(
        run.stderr.contains("denied.toml"),
        "the refusal does not name the file — {}",
        run.stderr
    );
    assert!(run.stdout.is_empty());
}

#[cfg(not(unix))]
#[test]
fn a_permission_denied_file_is_refused_by_name() {
    skipped(
        "permission-denied",
        "Windows ACLs are not chmod; the unix case covers the read failure",
    );
}

#[test]
fn a_directory_named_like_a_signature_file_is_refused() {
    let tree = Tree::new("dir-toml");
    let directory = tree.path().join("signatures.toml");
    std::fs::create_dir_all(&directory).expect("a directory");
    let run = run("dir-toml", &["--signatures", &directory.to_string_lossy()]);
    assert_eq!(run.code, 2);
    assert!(run.stdout.is_empty());
}

#[test]
fn awkward_file_names_are_read() {
    let tree = Tree::new("names");
    let mut checked = 0;
    for name in [
        "with space.toml",
        "\u{fc}nicode.toml",
        "\u{1f389}.toml",
        "trailing.dots..toml",
    ] {
        if tree.root.join(name).parent().is_none() {
            continue;
        }
        if std::fs::write(tree.root.join(name), SIGNATURE).is_err() {
            skipped("awkward-names", name);
            continue;
        }
        let run = load_signatures("names", &tree.root.join(name));
        assert!(loaded(&run), "{name}: {}", run.stderr);
        checked += 1;
    }
    assert!(checked > 0, "this filesystem refused every awkward name");
}

/// Where Windows differs: `MAX_PATH` is 260 characters unless long paths
/// are enabled, so the creation itself is the platform's answer.
#[test]
fn a_path_over_260_characters_is_read_or_refused_cleanly() {
    let tree = Tree::new("long-path");
    let mut deep = String::new();
    while deep.len() < 300 {
        deep.push_str("a-directory-with-a-long-name/");
    }
    deep.push_str("signatures.toml");
    let target = tree.root.join(&deep);
    if std::fs::create_dir_all(target.parent().expect("a parent")).is_err()
        || std::fs::write(&target, SIGNATURE).is_err()
    {
        skipped(
            "long-path",
            "this platform refused a path over 260 characters",
        );
        return;
    }
    let run = load_signatures("long-path", &target);
    assert!(loaded(&run), "{}", run.stderr);
}

// ------------------------------------------------------------- exit codes

/// Exit 2 is for a malformed question. A file the caller named and the
/// tool cannot read **is** one — there is no partial answer to give when
/// the input itself is the thing that failed.
#[test]
fn every_refusal_exits_two_and_leaves_stdout_empty() {
    let tree = Tree::new("exit-two");
    let missing = tree
        .path()
        .join("not-here.toml")
        .to_string_lossy()
        .into_owned();
    for args in [
        vec!["--signatures", missing.as_str()],
        vec!["--input", missing.as_str()],
        vec!["--not-a-flag"],
        vec!["--concurrency", "0"],
        vec!["--agent"],
    ] {
        let refused = run("exit-two", &args);
        assert_eq!(refused.code, 2, "{args:?}: {}", refused.stderr);
        assert!(
            refused.stdout.is_empty(),
            "{args:?} wrote to the protocol stream"
        );
    }
}
