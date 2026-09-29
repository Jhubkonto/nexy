# mcp-sandbox

This helper is the only permitted launch boundary for user-configured MCP servers.

Build and stage a helper with:

```text
npm run build:mcp-sandbox -- win x64
```

The script builds the target-specific Rust binary, stages it at
`mcp-sandbox/bin/{win|mac|linux}-{x64|arm64}/mcp-sandbox[.exe]`, and writes a
SHA-256 integrity record next to it. The packaging script runs this step for
each architecture and verifies the resulting helper before Electron packaging;
it never accepts a missing or modified artifact. Windows and macOS signing are
optional release hardening steps. If signing credentials are present, the
helper is signed automatically; users never need to install signing tools,
certificates, Rust, or a sandbox dependency to configure an MCP server.

For a production release, set `NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE=1` in the
release pipeline and provide the normal platform signing identity. Ordinary
local packaging intentionally uses the bundled integrity record instead.

The Linux backend requires `bubblewrap`; macOS requires Seatbelt via
`/usr/bin/sandbox-exec`. Windows launches the server in a short-lived
AppContainer with explicit temporary ACL grants, capability-based network
access, bounded diagnostics, and a Job Object enforcing memory/process limits.
Batch launchers (`.cmd`/`.bat`) are supported through `ComSpec`; the wrapper
counts against the Job Object process limit. It never falls back to launching
the target directly.
