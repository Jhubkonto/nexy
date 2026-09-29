use crate::Launch;
use std::ffi::c_void;
use std::fs::{metadata, File};
use std::io::{Read, Write};
use std::mem::{size_of, zeroed};
use std::os::windows::io::FromRawHandle;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::thread;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT,
    INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::{
    BuildTrusteeWithSidW, ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW,
    SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS, SE_FILE_OBJECT, TRUSTEE_W,
};
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile,
};
use windows_sys::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES,
    SID_AND_ATTRIBUTES, PSID, FreeSid,
};
use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE};
use windows_sys::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOBOBJECT_BASIC_LIMIT_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_JOB_MEMORY,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, SetInformationJobObject,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
    InitializeProcThreadAttributeList, ResumeThread,
    UpdateProcThreadAttribute, WaitForSingleObject, EXTENDED_STARTUPINFO_PRESENT,
    INFINITE, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
};

const WAIT_FAILED: u32 = 0xFFFF_FFFF;
const GENERIC_READ_WRITE: u32 = FILE_GENERIC_READ | FILE_GENERIC_WRITE;
const APP_CONTAINER_INTERNET_CLIENT_SID: &str = "S-1-15-3-1";

fn fail(message: impl AsRef<str>) -> ! {
    eprintln!("mcp-sandbox: Windows sandbox: {}", message.as_ref());
    std::process::exit(2);
}

fn wide(value: &str) -> Vec<u16> {
    if value.contains('\0') {
        fail("launch data contains an embedded NUL");
    }
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn last_error(context: &str) -> ! {
    fail(format!("{context} (Win32 error {})", unsafe { GetLastError() }))
}

fn quote_arg(value: &str) -> String {
    if value.is_empty() { return "\"\"".to_owned(); }
    if !value.chars().any(|c| c.is_whitespace() || c == '"') { return value.to_owned(); }
    let mut result = String::from("\"");
    let mut slashes = 0;
    for character in value.chars() {
        match character {
            '\\' => slashes += 1,
            '"' => {
                result.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                result.push('"');
                slashes = 0;
            }
            _ => {
                result.extend(std::iter::repeat_n('\\', slashes));
                result.push(character);
                slashes = 0;
            }
        }
    }
    result.extend(std::iter::repeat_n('\\', slashes * 2));
    result.push('"');
    result
}

fn environment_block(launch: &Launch) -> Vec<u16> {
    let mut entries: Vec<_> = launch.env.iter().collect();
    entries.sort_by(|left, right| left.0.cmp(right.0));
    let mut block = Vec::new();
    for (key, value) in entries {
        if key.contains('=') || key.contains('\0') || value.contains('\0') {
            fail("launch environment contains an invalid key or value");
        }
        block.extend(format!("{key}={value}").encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

fn resolve_command(launch: &Launch) -> (String, bool) {
    let command = Path::new(&launch.command);
    let explicit = command.is_absolute() || command.components().count() > 1;
    let candidates = if explicit {
        vec![command.to_path_buf()]
    } else {
        let path_value = launch.env.get("Path").or_else(|| launch.env.get("PATH")).cloned().unwrap_or_default();
        let extensions = launch.env.get("PATHEXT").cloned().unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_owned());
        let mut extensions: Vec<String> = extensions.split(';').map(|value| value.to_ascii_lowercase()).collect();
        if command.extension().is_some() { extensions = vec![String::new()]; }
        path_value.split(';').flat_map(|directory| {
            extensions.iter().map(move |extension| PathBuf::from(directory).join(format!("{}{}", launch.command, extension)))
        }).collect()
    };
    let executable = candidates.into_iter().find(|candidate| candidate.is_file())
        .unwrap_or_else(|| fail(format!("could not resolve MCP command '{}' through PATH", launch.command)));
    let executable = std::fs::canonicalize(executable).unwrap_or_else(|_| fail("could not canonicalize the MCP executable"));
    let wrapper = executable.extension().map(|value| {
        let extension = value.to_string_lossy().to_ascii_lowercase();
        extension == "cmd" || extension == "bat"
    }).unwrap_or(false);
    (executable.to_string_lossy().into_owned(), wrapper)
}

fn command_line(launch: &Launch, executable: &str, wrapper: bool) -> Vec<u16> {
    let mut command = if wrapper {
        let comspec = launch.env.get("ComSpec").or_else(|| launch.env.get("COMSPEC")).cloned().unwrap_or_else(|| "C:\\Windows\\System32\\cmd.exe".to_owned());
        let mut script = quote_arg(executable);
        for argument in &launch.args {
            script.push(' ');
            script.push_str(&quote_arg(argument));
        }
        format!("{} /d /s /c {}", quote_arg(&comspec), quote_arg(&script))
    } else {
        quote_arg(executable)
    };
    if !wrapper {
    for argument in &launch.args {
        command.push(' ');
        command.push_str(&quote_arg(argument));
    }
    }
    wide(&command)
}

struct AppContainer {
    name: Vec<u16>,
    sid: PSID,
    capability_sid: PSID,
}

impl AppContainer {
    fn create(network_allowed: bool) -> Self {
        let name = wide(&format!("NexyMcp{}", uuid_suffix()));
        let display = wide("Nexy MCP server");
        let description = wide("Short-lived isolated MCP server");
        let mut sid: PSID = null_mut();
        let result = unsafe {
            CreateAppContainerProfile(
                name.as_ptr(), display.as_ptr(), description.as_ptr(), null(), 0, &mut sid,
            )
        };
        if result < 0 || sid.is_null() { fail(format!("CreateAppContainerProfile failed (HRESULT 0x{:08x})", result as u32)); }

        let capability_sid = if network_allowed {
            let capability_name = wide(APP_CONTAINER_INTERNET_CLIENT_SID);
            let mut capability: PSID = null_mut();
            if unsafe { ConvertStringSidToSidW(capability_name.as_ptr(), &mut capability) } == 0 {
                unsafe { FreeSid(sid); DeleteAppContainerProfile(name.as_ptr()); }
                fail("could not create the Windows internetClient capability SID");
            }
            capability
        } else { null_mut() };
        Self { name, sid, capability_sid }
    }
}

impl Drop for AppContainer {
    fn drop(&mut self) {
        unsafe {
            if !self.capability_sid.is_null() { LocalFree(self.capability_sid as *mut c_void); }
            if !self.sid.is_null() { FreeSid(self.sid); }
            DeleteAppContainerProfile(self.name.as_ptr());
        }
    }
}

struct DaclGrant {
    path: Vec<u16>,
    security_descriptor: *mut c_void,
    old_dacl: *mut ACL,
    new_dacl: *mut ACL,
}

impl DaclGrant {
    fn apply(path: &Path, sid: PSID, access: u32, inherit: bool) -> Result<Self, String> {
        let path_text = path.to_string_lossy();
        let path_w = wide(&path_text);
        let mut security_descriptor: *mut c_void = null_mut();
        let mut old_dacl: *mut ACL = null_mut();
        let result = unsafe {
            GetNamedSecurityInfoW(
                path_w.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
                null_mut(), null_mut(), &mut old_dacl, null_mut(), &mut security_descriptor,
            )
        };
        if result != 0 { return Err(format!("could not read ACL for {} (error {result})", path_text)); }

        let mut trustee = TRUSTEE_W::default();
        unsafe { BuildTrusteeWithSidW(&mut trustee, sid); }
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: access,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: if inherit { 3 } else { 0 }, // CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE
            Trustee: trustee,
        };
        let mut new_dacl: *mut ACL = null_mut();
        let result = unsafe { SetEntriesInAclW(1, &entry, old_dacl, &mut new_dacl) };
        if result != 0 {
            unsafe { LocalFree(security_descriptor); }
            return Err(format!("could not construct ACL for {} (error {result})", path_text));
        }
        let result = unsafe {
            SetNamedSecurityInfoW(
                path_w.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
                null_mut(), null_mut(), new_dacl, null_mut(),
            )
        };
        if result != 0 {
            unsafe { LocalFree(new_dacl as *mut c_void); LocalFree(security_descriptor); }
            return Err(format!("could not grant AppContainer access to {} (error {result})", path_text));
        }
        Ok(Self { path: path_w, security_descriptor, old_dacl, new_dacl })
    }
}

impl Drop for DaclGrant {
    fn drop(&mut self) {
        unsafe {
            // Restore the exact original DACL, then release both ACL buffers returned by
            // the Windows security APIs. If restoration fails, the helper reports it rather
            // than silently leaving a temporary AppContainer grant behind.
            let result = SetNamedSecurityInfoW(
                self.path.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
                null_mut(), null_mut(), self.old_dacl, null_mut(),
            );
            if result != 0 { eprintln!("mcp-sandbox: could not restore a temporary filesystem ACL (error {result})"); }
            LocalFree(self.new_dacl as *mut c_void);
            LocalFree(self.security_descriptor);
        }
    }
}

fn uuid_suffix() -> String {
    // A process-local random suffix is sufficient because the profile is deleted before
    // this helper exits. Avoid a second dependency in the native boundary.
    format!("{:x}{:x}", std::process::id(), unsafe { GetStdHandle(STD_INPUT_HANDLE) as usize })
}

fn grant_paths(launch: &Launch, executable: &str, app: &AppContainer) -> Vec<DaclGrant> {
    let command_path = PathBuf::from(executable);
    let command_parent = command_path.parent().filter(|path| !path.as_os_str().is_empty());
    let mut paths: Vec<(PathBuf, u32, bool)> = Vec::new();
    if let Some(parent) = command_parent { paths.push((parent.to_path_buf(), FILE_GENERIC_READ | FILE_GENERIC_EXECUTE, true)); }
    // Parent inheritance is needed by runtimes that load adjacent DLLs, while
    // the explicit file grant also covers existing files whose ACLs disable
    // inheritance.
    paths.push((command_path, FILE_GENERIC_READ | FILE_GENERIC_EXECUTE, false));
    if let Some(cwd) = &launch.cwd { paths.push((PathBuf::from(cwd), GENERIC_READ_WRITE, true)); }
    for grant in &launch.profile.filesystem {
        let path = PathBuf::from(&grant.path);
        let access = if grant.access == "read-write" { GENERIC_READ_WRITE } else { FILE_GENERIC_READ | FILE_GENERIC_EXECUTE };
        let is_directory = metadata(&path).map(|value| value.is_dir()).unwrap_or(false);
        paths.push((path, access, is_directory));
    }
    let mut grants = Vec::new();
    for (path, access, inherit) in paths {
        let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| fail(format!("filesystem path does not exist: {}", path.display())));
        match DaclGrant::apply(&canonical, app.sid, access, inherit) {
            Ok(grant) => grants.push(grant),
            Err(error) => {
                drop(grants);
                fail(error);
            }
        }
    }
    grants
}

fn set_inheritable(handle: HANDLE) {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE { return; }
    if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0 {
        last_error("could not make a standard handle inheritable");
    }
}

fn diagnostic_pipe() -> (HANDLE, HANDLE) {
    let mut read_pipe: HANDLE = null_mut();
    let mut write_pipe: HANDLE = null_mut();
    let attributes = SECURITY_ATTRIBUTES { nLength: size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: null_mut(), bInheritHandle: 1 };
    if unsafe { CreatePipe(&mut read_pipe, &mut write_pipe, &attributes, 0) } == 0 {
        last_error("could not create the MCP diagnostic pipe");
    }
    if unsafe { SetHandleInformation(read_pipe, HANDLE_FLAG_INHERIT, 0) } == 0 {
        unsafe { CloseHandle(read_pipe); CloseHandle(write_pipe); }
        last_error("could not protect the MCP diagnostic pipe");
    }
    (read_pipe, write_pipe)
}

fn run_inner(launch: &Launch) -> Result<u32, String> {
    let app = AppContainer::create(launch.profile.network == "allowed");
    let (executable, wrapper) = resolve_command(launch);
    let _grants = grant_paths(launch, &executable, &app);
    let (diagnostic_read, diagnostic_write) = diagnostic_pipe();
    let stdin = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    let stdout = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    set_inheritable(stdin);
    set_inheritable(stdout);

    let mut capabilities = Vec::new();
    if !app.capability_sid.is_null() {
        capabilities.push(SID_AND_ATTRIBUTES { Sid: app.capability_sid, Attributes: 4 }); // SE_GROUP_ENABLED
    }
    let security_capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: app.sid,
        Capabilities: if capabilities.is_empty() { null_mut() } else { capabilities.as_mut_ptr() },
        CapabilityCount: capabilities.len() as u32,
        Reserved: 0,
    };

    let mut attribute_size = 0usize;
    unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut attribute_size); }
    if attribute_size == 0 { return Err("could not size the AppContainer process attribute list".to_owned()); }
    let mut attribute_storage = vec![0u8; attribute_size];
    let attribute_list = attribute_storage.as_mut_ptr() as *mut c_void;
    if unsafe { InitializeProcThreadAttributeList(attribute_list, 1, 0, &mut attribute_size) } == 0 {
        return Err("could not initialize the AppContainer process attribute list".to_owned());
    }
    if unsafe {
        UpdateProcThreadAttribute(
            attribute_list, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            &security_capabilities as *const _ as *const c_void,
            size_of::<SECURITY_CAPABILITIES>(), null_mut(), null(),
        )
    } == 0 {
        unsafe { DeleteProcThreadAttributeList(attribute_list); }
        return Err("could not attach the AppContainer security capabilities".to_owned());
    }

    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin;
    startup.StartupInfo.hStdOutput = stdout;
    startup.StartupInfo.hStdError = diagnostic_write;
    startup.lpAttributeList = attribute_list;
    let mut process_info: PROCESS_INFORMATION = unsafe { zeroed() };
    let mut command_line = command_line(launch, &executable, wrapper);
    let current_directory = launch.cwd.as_ref().map(|value| wide(value));
    let mut environment = environment_block(launch);
    let creation_flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;
    let created = unsafe {
        CreateProcessW(
            null(), command_line.as_mut_ptr(), null(), null(), 1, creation_flags,
            environment.as_mut_ptr() as *const c_void,
            current_directory.as_ref().map_or(null(), |value| value.as_ptr()),
            &startup.StartupInfo, &mut process_info,
        )
    };
    unsafe { DeleteProcThreadAttributeList(attribute_list); CloseHandle(diagnostic_write); }
    if created == 0 {
        unsafe { CloseHandle(diagnostic_read); }
        return Err(format!("could not create the AppContainer process (Win32 error {})", unsafe { GetLastError() }));
    }

    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation = JOBOBJECT_BASIC_LIMIT_INFORMATION {
        LimitFlags: JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        // .cmd/.bat launchers need one infrastructure process (cmd.exe). The
        // limit still prevents the launched server from creating any process
        // when childProcesses is blocked.
        ActiveProcessLimit: launch.profile.max_processes as u32 + u32::from(wrapper),
        ..unsafe { zeroed() }
    };
    limits.JobMemoryLimit = (launch.profile.memory_limit_mib as usize) * 1024 * 1024;
    let job = unsafe { CreateJobObjectW(null(), null()) };
    if job.is_null() {
        unsafe { CloseHandle(process_info.hThread); CloseHandle(process_info.hProcess); CloseHandle(diagnostic_read); }
        return Err(format!("could not create the MCP Job Object (Win32 error {})", unsafe { GetLastError() }));
    }
    if unsafe { SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const c_void, size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) } == 0
        || unsafe { AssignProcessToJobObject(job, process_info.hProcess) } == 0
    {
        unsafe { CloseHandle(job); CloseHandle(process_info.hThread); CloseHandle(process_info.hProcess); CloseHandle(diagnostic_read); }
        return Err(format!("could not apply MCP Job Object limits (Win32 error {})", unsafe { GetLastError() }));
    }
    if unsafe { ResumeThread(process_info.hThread) } == u32::MAX {
        unsafe { CloseHandle(job); CloseHandle(process_info.hThread); CloseHandle(process_info.hProcess); CloseHandle(diagnostic_read); }
        return Err("could not resume the sandboxed MCP process".to_owned());
    }
    unsafe { CloseHandle(process_info.hThread); }

    let max_diagnostics = launch.profile.max_diagnostic_bytes;
    let diagnostic_read = diagnostic_read as usize;
    let diagnostics = thread::spawn(move || {
        let file = unsafe { File::from_raw_handle(diagnostic_read as *mut _) };
        let mut bytes = Vec::new();
        file.take((max_diagnostics + 1) as u64).read_to_end(&mut bytes).ok();
        bytes.truncate(max_diagnostics);
        bytes
    });
    let wait_status = unsafe { WaitForSingleObject(process_info.hProcess, INFINITE) };
    let mut exit_code = 1u32;
    if wait_status == WAIT_FAILED || unsafe { GetExitCodeProcess(process_info.hProcess, &mut exit_code) } == 0 {
        exit_code = 1;
    }
    unsafe { CloseHandle(process_info.hProcess); CloseHandle(job); }
    if let Ok(bytes) = diagnostics.join() {
        if !bytes.is_empty() { let _ = std::io::stderr().write_all(&bytes); }
    }
    Ok(exit_code)
}

pub(crate) fn run(launch: &Launch) -> i32 {
    match run_inner(launch) {
        Ok(code) => code as i32,
        Err(error) => fail(error),
    }
}
