/**
 * Launch helpers for Nexy's own stdio worker scripts (the in-process MCP bridges and the
 * bundled Playwright CLI).
 *
 * Nexy ships no standalone `node` binary, so the only JavaScript runtime guaranteed to be
 * present on a user's machine is the Electron executable Nexy itself runs as. These workers
 * are therefore spawned as `process.execPath <script>`.
 *
 * Electron only behaves like `node` when `ELECTRON_RUN_AS_NODE=1` is set in the child's
 * environment. Without it, `process.execPath <script>` boots a *second Electron app
 * instance* and never executes the script, so the stdio MCP handshake never happens and the
 * MCP client reports the server as `CONNECTION_CLOSED` / "failed to connect". That is how
 * this surfaced in chat: Claude could not call `nexy_plan.exit_plan_mode` (nor the native
 * `ExitPlanMode`, which does not exist in `--print` sessions) and dead-ended the turn by
 * asking the user to approve the plan by hand.
 *
 * The variable cannot be inherited either: {@link buildCliChildEnv} deliberately strips
 * `ELECTRON_RUN_AS_NODE` from the CLI child environment (it would otherwise break the
 * Node-based `claude`/`codex`/`hermes` CLIs), and the MCP workers are spawned *by* that CLI
 * child. Every worker launch descriptor must set it explicitly.
 */

/** The binary that runs Nexy's worker scripts: the Electron executable, used as Node. */
export function nodeWorkerCommand(): string {
  return process.execPath
}

/**
 * Build the environment for a Nexy stdio worker, forcing Electron into Node mode.
 * `ELECTRON_RUN_AS_NODE` is applied last so it can never be clobbered by a caller's vars.
 */
export function nodeWorkerEnv<T extends Record<string, string>>(env?: T): T & { ELECTRON_RUN_AS_NODE: '1' } {
  return { ...(env ?? ({} as T)), ELECTRON_RUN_AS_NODE: '1' }
}
