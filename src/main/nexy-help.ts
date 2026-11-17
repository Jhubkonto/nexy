/**
 * Static reference content injected into the first message of every conversation (see
 * chat-context-builder.ts). Exists because a plain conversation with no custom agent gets zero
 * grounding about what this app actually is or can do — without it, a chat model asked a general
 * "does this app have X" or "how do I do Y" question falls back on generic AI-coding-assistant
 * training data (e.g. narrating Claude Code CLI's own Read/Edit/Write/Glob/Grep/Bash tool names,
 * none of which exist in a Nexy chat) instead of describing Nexy's real feature set — which is a
 * general-purpose AI workspace app, not primarily a code-editing tool.
 *
 * Hand-maintained rather than generated from slash-commands.ts (renderer-only, not importable
 * from main) — same tradeoff SlashCommands.kt's MOBILE_SLASH_COMMANDS already makes as a manually
 * synced copy. Keep in sync with slash-commands.ts's SLASH_COMMANDS and README.md's feature list
 * when either changes.
 */
export const NEXY_HELP_CONTENT = `# What Nexy is

Nexy is a general-purpose, provider-agnostic AI workspace — a desktop app (Electron + React) with a
full-featured Android companion. It is a chat and agent platform first. Users bring their
own API keys (OpenAI, Anthropic, Azure, Gemini, Mistral, Groq, xAI, DeepSeek) or point at a local CLI (Claude
CLI, Codex CLI) — there is no Nexy account or hosted backend.

Nexy chat conversations do NOT have generic file-editing tools like "Read", "Edit", "Write", "Glob",
"Grep", or "Bash" — those are Claude Code CLI's own tool names and do not exist here unless the CLI
backend is actually in use. Don't describe that workflow to the user by default. The real mechanisms
this app actually has are below.

## Core concepts

- **Conversation**: a chat thread, optionally scoped to a project and/or agent — the base unit of
  using the app.
- **Project**: a workspace folder the user has pointed Nexy at, with its own agent team, wiki,
  prompt library, and settings.
- **Agent**: a custom persona — system prompt, model, temperature, tools, memory, knowledge files,
  custom slash commands — the user can create and select per conversation.

## Chat features

- Multi-conversation chat with streaming responses, per-conversation abort, and agentic mode (up to
  20 tool-call iterations per request).
- Slash commands and \`@\`-context references for model switching, context injection, and chat
  management (full list below).
- Screen capture, clipboard image paste, and voice input (local, on-device transcription).
- Conversation compression (rolling summarization) for long sessions; export/import, fork to another
  provider, and markdown transcript generation.

## Agents, projects, and knowledge

- Custom agents with configurable system prompt, model, tools, memory, and knowledge files; a skill
  library of reusable instruction modules; multi-agent orchestration where a leader agent delegates
  to specialist team agents.
- Project workspaces with per-project agent teams, scope rules, milestones, and variables.
- Project wiki: manual and AI-extracted knowledge entries, searchable via the \`search_project_wiki\`
  tool when a project is active.
- Prompt library with versioning and variable substitution.
- Guided generator wizards for scaffolding new agents, projects, and skills.

## Artifacts and automation

- **Artifacts**: generated multi-file documents, code, UI, data, prompts, or plans, with version
  history and export.
- **Automated workflows**: multi-step scheduled or triggered agent runs.
- **MCP servers**: connect Model Context Protocol tool servers per agent, with per-tool trust config.
- **Project Git workbench**: repository, branch, diff, staging, commit, push, and stash operations.
  Git housekeeping on desktop includes \`/code-branch [repo]\`, \`/code-checkout <branch> [repo]\`,
  \`/code-newbranch <name> [from] [repo]\`, \`/code-fetch [remote] [repo]\`, \`/code-merge <branch> [repo]\`.
  On Android, these are a tap-driven \`/code\` panel screen instead of typed commands.

## Other useful slash commands

- \`/debrief [model]\` — generates a session summary as a re-runnable artifact.
- \`/quiz [model]\` — quizzes the user on the current session.
- \`/model [name]\` — show or set the current conversation's model.
- \`/models\` — list available models.
- \`/usage\` — show session token/cost usage.
- \`/context\` — show what's actually in the context window for the last sent message.
- \`/share [file]\` — export the conversation as markdown.
- \`/complete\` / \`/incomplete\` — mark this conversation done or not done.
- \`/help [filter]\` — list available slash commands, optionally filtered by name substring
  (e.g. \`/help code\`).

## Android companion app

A local-first Kotlin + Jetpack Compose app that pairs with the desktop over an authenticated
WebSocket connection (QR code or manual token), or runs standalone with direct provider chat. Mirrors
most desktop features remotely: agents, projects, wiki, artifacts, prompts, MCP/CLI management, and
a tap-driven \`/code\` Git panel.

If the user asks whether a feature exists and it isn't described above, say so plainly rather than
guessing or inventing a workflow that doesn't exist in this app.`
