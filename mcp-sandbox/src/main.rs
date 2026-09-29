use serde::Deserialize;
use serde_json::Value;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
#[cfg(not(windows))]
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

#[cfg(windows)]
mod windows_backend;

const PROTOCOL_VERSION: u64 = 1;

#[derive(Debug, Deserialize)]
pub(crate) struct Launch {
    command: String,
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    env: std::collections::BTreeMap<String, String>,
    profile: Profile,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Profile {
    network: String,
    #[serde(rename = "childProcesses")]
    child_processes: String,
    filesystem: Vec<Grant>,
    #[serde(rename = "memoryLimitMiB")]
    memory_limit_mib: u64,
    #[serde(rename = "maxProcesses")]
    max_processes: u64,
    #[serde(rename = "maxDiagnosticBytes", default = "default_diagnostic_bytes")]
    max_diagnostic_bytes: usize,
}

fn default_diagnostic_bytes() -> usize { 65_536 }

#[derive(Debug, Deserialize)]
pub(crate) struct Grant {
    path: String,
    access: String,
}

fn fail(message: impl AsRef<str>) -> ! {
    eprintln!("mcp-sandbox: {}", message.as_ref());
    std::process::exit(2)
}

fn connect(endpoint: &str) -> TcpStream {
    for _ in 0..150 {
        if let Ok(stream) = TcpStream::connect(endpoint) {
            return stream;
        }
        thread::sleep(Duration::from_millis(100));
    }
    fail(format!("could not connect to broker at {endpoint}"));
}

fn request_launch(endpoint: &str, token: &str) -> Launch {
    let mut stream = connect(endpoint);
    writeln!(stream, "{{\"type\":\"hello\",\"token\":{}}}", serde_json::to_string(token).unwrap()).unwrap_or_else(|_| fail("could not authenticate with broker"));
    let mut line = String::new();
    BufReader::new(&mut stream).read_line(&mut line).unwrap_or_else(|_| fail("could not read launch descriptor"));
    let message: Value = serde_json::from_str(&line).unwrap_or_else(|_| fail("broker returned invalid control data"));
    if message.get("type").and_then(Value::as_str) != Some("launch") {
        fail(message.get("error").and_then(Value::as_str).unwrap_or("broker refused launch"));
    }
    let protocol = message.get("protocolVersion").and_then(Value::as_u64).unwrap_or(0);
    if protocol != PROTOCOL_VERSION { fail("unsupported broker protocol version"); }
    serde_json::from_value(message).unwrap_or_else(|_| fail("invalid launch descriptor"))
}

fn validate_profile(profile: &Profile) {
    if profile.network != "blocked" && profile.network != "allowed" { fail("invalid network policy"); }
    if profile.child_processes != "blocked" && profile.child_processes != "allowed" { fail("invalid child-process policy"); }
    if profile.memory_limit_mib != 512 { fail("memory limit is fixed at 512 MiB"); }
    let expected = if profile.child_processes == "allowed" { 8 } else { 1 };
    if profile.max_processes != expected { fail("invalid process limit"); }
    if profile.max_diagnostic_bytes == 0 || profile.max_diagnostic_bytes > 65_536 { fail("invalid diagnostic limit"); }
    for grant in &profile.filesystem {
        if grant.path.trim().is_empty() || (grant.access != "read-only" && grant.access != "read-write") { fail("invalid filesystem grant"); }
    }
}

#[cfg(not(windows))]
fn canonical_path(path: &str) -> String {
    std::fs::canonicalize(path).unwrap_or_else(|_| fail(format!("filesystem path does not exist: {path}"))).to_string_lossy().into_owned()
}

#[cfg(target_os = "linux")]
fn sandbox_command(launch: &Launch) -> Command {
    let mut command = Command::new("bwrap");
    command.arg("--die-with-parent").arg("--new-session").arg("--proc").arg("/proc").arg("--dev").arg("/dev");
    if launch.profile.network == "blocked" { command.arg("--unshare-net"); }
    // The base system is readable, while writes are only opened for the configured cwd/grants.
    command.arg("--ro-bind").arg("/").arg("/");
    if let Some(cwd) = &launch.cwd {
        let cwd = canonical_path(cwd);
        command.arg("--bind").arg(&cwd).arg(&cwd).arg("--chdir").arg(&cwd);
    }
    for grant in &launch.profile.filesystem {
        let path = canonical_path(&grant.path);
        command.arg(if grant.access == "read-write" { "--bind" } else { "--ro-bind" }).arg(&path).arg(&path);
    }
    for (key, value) in &launch.env { command.arg("--setenv").arg(key).arg(value); }
    command.arg("--").arg(&launch.command).args(&launch.args);
    command
}

#[cfg(target_os = "macos")]
fn sandbox_command(launch: &Launch) -> Command {
    let mut profile = String::from("(version 1) (deny default) (allow file-read*) (allow process-exec)");
    if launch.profile.network == "allowed" { profile.push_str(" (allow network*)"); }
    if launch.profile.child_processes == "allowed" { profile.push_str(" (allow process-fork) (allow process-exec)"); }
    if let Some(cwd) = &launch.cwd { profile.push_str(&format!(" (allow file-write* (subpath \"{}\"))", canonical_path(cwd).replace('"', ""))); }
    for grant in &launch.profile.filesystem {
        if grant.access == "read-write" { profile.push_str(&format!(" (allow file-write* (subpath \"{}\"))", canonical_path(&grant.path).replace('"', ""))); }
    }
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command.arg("-p").arg(profile).arg(&launch.command).args(&launch.args);
    for (key, value) in &launch.env { command.env(key, value); }
    if let Some(cwd) = &launch.cwd { command.current_dir(cwd); }
    command
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn sandbox_command(_launch: &Launch) -> Command { fail("unsupported operating system") }

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|arg| arg == "--version") {
        println!("mcp-sandbox {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let endpoint = args.windows(2).find(|pair| pair[0] == "--control").map(|pair| pair[1].clone()).unwrap_or_else(|| fail("--control is required"));
    let token = args.windows(2).find(|pair| pair[0] == "--session").map(|pair| pair[1].clone()).unwrap_or_else(|| fail("--session is required"));
    let launch = request_launch(&endpoint, &token);
    validate_profile(&launch.profile);

    #[cfg(windows)]
    {
        std::process::exit(windows_backend::run(&launch));
    }

    #[cfg(not(windows))]
    {
    #[cfg(target_os = "linux")]
    if Command::new("bwrap").arg("--version").output().is_err() { fail("bubblewrap is required on Linux"); }

    let mut command = sandbox_command(&launch);
    command.stdin(Stdio::inherit()).stdout(Stdio::inherit());
    #[cfg(unix)]
    command.stderr(Stdio::piped());
    #[cfg(not(unix))]
    command.stderr(Stdio::inherit());
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        let max_processes = launch.profile.max_processes;
        command.pre_exec(|| {
            // Ensure the target cannot survive the helper if Electron tears down the
            // stdio transport unexpectedly.
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            let limit = libc::rlimit { rlim_cur: 512 * 1024 * 1024, rlim_max: 512 * 1024 * 1024 };
            libc::setrlimit(libc::RLIMIT_AS, &limit);
            #[cfg(target_os = "linux")]
            {
                let process_limit = libc::rlimit { rlim_cur: max_processes, rlim_max: max_processes };
                libc::setrlimit(libc::RLIMIT_NPROC, &process_limit);
            }
            Ok(())
        });
    }
    let mut child = command.spawn().unwrap_or_else(|error| fail(format!("sandboxed server launch failed: {error}")));
    #[cfg(unix)]
    let stderr = child.stderr.take().map(|mut pipe| {
        let max = launch.profile.max_diagnostic_bytes;
        thread::spawn(move || {
            use std::io::Read;
            let mut bytes = Vec::new();
            pipe.take((max + 1) as u64).read_to_end(&mut bytes).ok();
            bytes.truncate(max);
            bytes
        })
    });
    let status = child.wait().unwrap_or_else(|error| fail(format!("sandboxed server wait failed: {error}")));
    #[cfg(unix)]
    if let Some(reader) = stderr { if let Ok(bytes) = reader.join() { if !bytes.is_empty() { let _ = std::io::stderr().write_all(&bytes); } } }
    if !status.success() { std::process::exit(status.code().unwrap_or(1)); }
    }
}
