# Easy8 / Easy Redmine MCP bridge for Nexy

Easy8 (formerly Easy Redmine) already ships an MCP server. It is exposed by an
Easy8 instance at `<EASY8_URL>/mcp` using Streamable HTTP. Nexy currently
starts external MCP servers over stdio, so this integration uses the maintained
`mcp-remote` stdio-to-HTTP bridge. It does **not** add code to Nexy.

## Prerequisites

1. In Easy8, enable **Administration → Settings → AI → Enable MCP**.
2. Create an API key under **My profile → API access key**. A read-only key or
   dedicated low-privilege service account is recommended.
3. Confirm that the machine running Nexy can reach
   `https://your-easy8.example.com/mcp`.

## Add it in Nexy

Open **MCP Servers → Add server** and use the following values. Replace the two
placeholders before saving. Do not put a real key in this repository or in the
example JSON file.

| Field | Value |
| --- | --- |
| Name | `Easy8 (Easy Redmine)` |
| Command | `npx` |
| Arguments | `-y`, `mcp-remote`, `https://your-easy8.example.com/mcp`, `--header`, `X-Easy8-API-Key: YOUR_API_KEY` |
| Network access | Enabled |
| Child-process access | Enabled (required for `npx` on some installations) |

Then choose **Test connection**. Once connected, assign this server to the
agent(s) that should use it and select an appropriate trust level. The live tool
catalog comes from your Easy8 instance, so it may differ according to its
version, installed modules, and API-key permissions.

## Set it up from Android

The Android app can configure this server on a live paired Nexy desktop; the
desktop downloads and runs the managed Node runtime, not the phone.

1. In Android, connect to the target desktop, then open **Settings → MCP
   Servers → Add**.
2. Select **Custom server → npm package** and enter `mcp-remote` as the
   package.
3. In **Extra arguments**, enter one argument per line:

   ```text
   https://your-easy8.example.com/mcp
   --header
   X-Easy8-API-Key: YOUR_API_KEY
   ```

4. Leave **Allow network access** and **Allow child processes** enabled, then
   choose **Test connection** and **Add server**.

Do not add shell quotes around the header line; spaces belong to that single
argument. Nexy also handles surrounding quotes saved by older setups. On
Windows it supplies the bridge's private auth-state directory automatically;
granting access to `C:\Users` or your profile's `.mcp-auth` folder is unnecessary.

The API key travels only in the certificate-pinned pairing session and is kept
in the desktop's encrypted server configuration. Android does not receive it
back; its edit form displays `[saved on desktop]` in place of a saved sensitive
header value.

For older Easy8 deployments that document the legacy header, use
`X-Redmine-API-Key: YOUR_API_KEY` instead. The current Easy8 documentation
lists `X-Easy8-API-Key` for API-key client setup.

## Troubleshooting

- **404:** MCP has not been enabled in Easy8.
- **401:** Verify the key and enable the Easy8 REST API if your deployment
  requires it.
- **403:** The application access policy or API key is read-only, API-only, or
  lacks the relevant Easy8 permissions.
- **Connection fails immediately:** on Windows, Nexy automatically downloads
  its managed Node runtime the first time an `npx` server is used, so a
  system-wide Node installation is not required. Keep network access enabled
  for that first run and for `npx` to download `mcp-remote`. On macOS and
  Linux, install Node.js and make `npx` available on `PATH`.

`mcp-remote` forwards the standard MCP protocol. No project data or API key is
stored in this integration folder; Nexy stores the server configuration in its
own protected settings store.

## Sources

- [Easy8 MCP setup and security](https://developers.easy8.com/AI/mcp-server/)
- [Easy8's MCP bridge configuration](https://github.com/Easy8com/easy8-mcp)
