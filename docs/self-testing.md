# Testing Nexy from an agent

Nexy does not contain a second test-plan language or a separate test-run product. An agent can
build the current workspace, start one disposable Nexy instance, and use the existing Playwright
MCP capability against that instance.

## Workflow

1. Build the workspace with Nexy's existing Build or project-command capability.
2. Call `start_isolated_nexy_instance` through the project MCP bridge, or from an eligible Nexy
   conversation.
3. Nexy launches the built application with a fresh temporary profile, a separate database, a
   random loopback CDP port, and credentials removed from the child environment.
4. The tool returns the loopback CDP endpoint. The existing Playwright MCP server attaches to it;
   use its normal browser snapshot, click, fill, assertion, and screenshot tools.
5. Ask the agent to report what it found in the conversation. Screenshots or logs can be saved with
   the existing artifact tools when a durable artifact is wanted.
6. Call `stop_isolated_nexy_instance` when finished. Nexy also stops the child on application exit.

The runtime is deliberately limited to one active instance. It is a disposable development target,
not an immutable Git snapshot: rebuild and restart it after source changes.

## External agents

Open **Settings → Developer → Desktop** and, with a configured Nexy source checkout, use **Agent-assisted testing** to connect the external agent.
Choose **Connect external agent**, copy the generated MCP setup into Codex, Claude, or another MCP
client, and keep the project selected as the agent's scope. The bridge is project-scoped and
approval-gated. It is not a managed MCP server consumed by Nexy.

## Safety boundary

The child uses a temporary user-data directory, loopback-only CDP, disabled external services, and
an environment with common credentials removed. The parent process owns cleanup. The application
does not create test plans, persist test runs, or infer pass/fail results; the agent's normal tool
history and final conversation response are the report.
