# MCP sandbox boundary

Third-party MCP servers are never launched directly by Nexy. The main process creates a short-lived, bearer-authenticated loopback session and launches the bundled `mcp-sandbox` helper through the MCP stdio transport. The helper obtains the target command, arguments, working directory, environment, and profile only from that authenticated session.

The boundary has two independent controls:

- Nexy controls server assignment, tool provenance, approval, blocking, lifecycle, and secret ownership.
- `mcp-sandbox` controls the MCP process's operating-system access and process lifetime.

The default profile blocks network access and child-process creation, gives the configured working directory read/write access, permits only explicit additional filesystem grants, caps memory at 512 MiB, and bounds process count and diagnostics. Legacy configurations are normalized to this profile.

The helper must be present for the current platform and architecture. Missing,
incompatible, modified, or unsupported helpers produce a sandbox-unavailable
failure. Packaged helpers carry a release-generated SHA-256 integrity record;
platform code signing can be enabled by the release pipeline but is not a
user-facing setup prerequisite. Nexy does not launch the configured command
directly as a fallback.

Linux uses `bubblewrap` with a private process/network boundary and explicit bind mounts. macOS uses Seatbelt through `sandbox-exec` with generated file and network rules. Windows uses a signed helper that launches third-party servers in an AppContainer, grants the AppContainer SID only the requested paths for the lifetime of the process, applies the requested network capability, and assigns the process tree to a Job Object with memory/process limits. A missing or unusable backend remains fail-closed; Nexy never silently launches a third-party server unsandboxed.

## Start-up diagnostics

The MCP SDK reports nearly every start-up failure as `MCP error -32000: Connection closed`. The actual cause is on the helper's stderr: the helper's own `mcp-sandbox: …` failure lines, followed by the server's buffered error output, which the helper flushes (bounded by `maxDiagnosticBytes`) as the server exits. Nexy continuously drains that stream into a rolling tail (`McpSandboxHandle.stderrTail`), waits briefly for it to settle after a failed handshake, and passes it to `mcp-launch-diagnostics.ts`, which:

- classifies the failure (sandbox, missing command, filesystem grant, permission, server crash, silent exit, timeout, missing runtime, browser launch) into a plain-language title, explanation, and remediation actions (`retry`, `repair-sandbox`, `download-browser`, `edit-setup`);
- builds the start-up checklist shown in the UI — managed runtime installed → sandbox started → MCP server started → tools listed → (managed Playwright) Chromium opened a page;
- redacts configured environment values and common credential shapes before anything is displayed or logged.

Every failed start (Test connection, Diagnose connection, or a live connect) records the full report in the error log; the UI links to it with **View logs**. "Test connection" for the managed Playwright runtime additionally opens and closes `about:blank`, because the MCP handshake succeeds without ever launching the browser.

## Managed Playwright on Windows

`@playwright/mcp` must create Windows IPC objects when it launches Chromium. AppContainer blocks that operation, causing Node/libuv to retry indefinitely on `ERROR_ACCESS_DENIED`. Nexy's bundled Playwright server therefore has a deliberately narrow Windows-only exception: the helper starts that fixed, application-owned runtime outside AppContainer.

The exception is not available to configured third-party MCP servers. The main process removes `managedRuntime` from every ordinary configuration; only `createManagedPlaywrightLaunch()` can create the `managedRuntime: "playwright"` descriptor accepted by the helper. It still uses the secret-free MCP environment, the helper-owned diagnostic pipe, and a non-breakaway Job Object with kill-on-close, a 1 GiB aggregate memory limit, and a 16-process limit. Chromium is launched with its own browser sandbox enabled; the managed command never supplies `--no-sandbox`.

The managed descriptor retains the read-only runtime paths and isolated writable session directory for consistent launch metadata and for non-Windows backends, although Windows does not apply temporary AppContainer ACL grants to this application-owned runtime.

Application-owned bridges such as Desktop Navigator, the development bridge, and user-input remain internal Nexy components and are not third-party MCP processes.
