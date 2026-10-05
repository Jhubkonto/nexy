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

Linux uses `bubblewrap` with a private process/network boundary and explicit bind mounts. macOS uses Seatbelt through `sandbox-exec` with generated file and network rules. Windows uses a signed helper that launches the server in an AppContainer, grants the AppContainer SID only the requested paths for the lifetime of the process, applies the requested network capability, and assigns the process tree to a Job Object with memory/process limits. A missing or unusable backend remains fail-closed; Nexy never silently launches a server unsandboxed.

Application-owned bridges such as Desktop Navigator, the development bridge, and user-input remain internal Nexy components and are not third-party MCP processes.
