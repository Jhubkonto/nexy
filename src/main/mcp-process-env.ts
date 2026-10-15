/**
 * The minimal, secret-free set of host environment variables every sandboxed MCP
 * process (and the sandbox helper itself) needs. Windows refuses to create an
 * AppContainer process whose environment block lacks variables such as
 * SystemRoot (Win32 error 203, ERROR_ENVVAR_NOT_FOUND), so every launch path —
 * including Nexy's managed runtimes — must start from this allowlist.
 */
export const INHERITED_MCP_ENV_KEYS: ReadonlySet<string> = new Set([
  'PATH', 'Path', 'PATHEXT', 'ComSpec', 'COMSPEC', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
  'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL',
])

/** Keep provider credentials and other desktop secrets out of third-party MCP processes. */
export function buildMcpProcessEnv(explicitEnv: Record<string, string> = {}): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => INHERITED_MCP_ENV_KEYS.has(key) && typeof value === 'string'),
  ) as Record<string, string>
  return { ...inherited, ...explicitEnv }
}
