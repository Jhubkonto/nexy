# Nexy development bridge

The development bridge is a temporary, desktop-only MCP connection for people developing Nexy itself. It is not a project capability and never exposes project conversations, wiki entries, artifacts, agents, skills, workflows, schedules, or other operator data.

Open **Settings → Developer → Desktop**. The **Agent-assisted testing** controls appear only when the configured workspace is an accessible Nexy checkout (`package.json` has `"name": "nexy"`). Connect an external agent, copy the generated MCP setup into that agent, and stop access when finished. The token is fresh per connection, loopback-only, and invalidated when stopped, when the workspace changes, or when Nexy exits.

The `nexy-development` server exposes only checkout context; confined file read/search/write; approved shell commands; Git status/diff/log and approved branch/commit operations; build/preflight/history/cancellation; and a disposable loopback Nexy runtime with dynamically available Playwright tools. Every write, command, Git mutation, build, or runtime action is approved in Nexy. Browser tools are available only for the credential-free disposable runtime.

This bridge has no Android or WebSocket control path. Use it from Nexy Desktop only.
