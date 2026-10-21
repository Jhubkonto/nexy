# Third-party notices

This notice accompanies Nexy source distributions. It is not a license for
Nexy itself. Third-party components retain their own license terms.

## Provider CLIs

Nexy does not include the Claude Code or Codex CLI executables. The app only
detects and launches an executable already installed by the user.

- Codex CLI: the upstream source repository is Apache-2.0 licensed:
  <https://github.com/openai/codex>. Use of the Codex service is separately
  governed by OpenAI's applicable terms.
- Claude Code: no Claude Code executable or source is copied into Nexy. Use is
  governed by Anthropic's applicable Commercial or Consumer Terms:
  <https://code.claude.com/docs/en/legal-and-compliance>.

## Included assets

- Silkscreen font: copyright The Silkscreen Project Authors; SIL Open Font
  License 1.1. The complete notice is in
  [`docs/licenses/SILKSCREEN-OFL-1.1.txt`](docs/licenses/SILKSCREEN-OFL-1.1.txt).
- Optional Supertonic speech model: downloaded separately under the OpenRAIL-M
  license. The model and runtime details are in
  [`docs/licenses/SUPERTONIC.md`](docs/licenses/SUPERTONIC.md).
- Optional managed Node.js runtime for Windows `npx` MCP servers: downloaded
  separately from the official Node.js release archive, verified against a
  release-pinned SHA-256 digest, and stored in Nexy's per-user data directory.
  Node.js is MIT licensed; its source, license, and release notices are at
  <https://github.com/nodejs/node> and <https://nodejs.org>.

## Package dependencies

Nexy uses npm and Gradle dependencies that are redistributed in applicable
desktop/Android builds. Their license files and metadata are retained in the
dependency trees used for each build. Because dependency versions can change,
the exact notice inventory must be generated from the lockfiles and build
artifacts for each release; this file is not a substitute for that inventory.

When preparing a release, inspect at least:

- `package-lock.json` and the packaged `node_modules` tree;
- `android/gradle/libs.versions.toml`, Gradle resolution output, and the APK;
- any generated WASM, native binaries, fonts, models, or downloaded archives.

## No endorsement

Anthropic, Claude, OpenAI, Codex, Google, Firebase, Android, and other provider
names are used only to identify compatible integrations. Nexy is not endorsed
by, sponsored by, or affiliated with those providers unless a separate written
agreement says otherwise.
