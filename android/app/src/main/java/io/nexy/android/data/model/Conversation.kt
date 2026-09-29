package io.nexy.android.data.model

data class Conversation(
    val id: String,
    val title: String,
    val created_at: String,
    val updated_at: String,
    val agent_id: String? = null,
    val agent_name: String? = null,
    val agent_icon: String? = null,
    val project_id: String? = null,
    val project_name: String? = null,
    val model: String? = null,
    val conversationHermesProfile: String? = null,
    val last_message: String? = null,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val completed_at: Long? = null,
    val thinking_effort_override: String? = null,
    val full_auto_approve_override: Boolean? = null,
    val agentic_mode_override: Boolean? = null,
    val terminal_sandbox_override: Boolean? = null,
    // Per-conversation CLI permission/sandbox mode. One column holds either family — Claude Code
    // ('plan'|'acceptEdits'|'bypassPermissions') or Codex ('read-only'|'workspace-write'|
    // 'danger-full-access'). null = the backend's default behaviour. Only meaningful for CLI chats.
    val cli_mode_override: String? = null,
    val codex_execution_mode_override: String? = null,
    val rating: Int? = null,
    val kind: String? = null, // 'chat' or 'project-conversation-mode'
)

data class ModelOption(
    val id: String,
    val label: String,
    val vendor: String? = null,
    val isCliSourced: Boolean = false,
    val backend: String? = null,
)

data class NewContentConversation(
    val conversationId: String,
    val title: String,
    val projectId: String? = null,
    val projectName: String? = null,
    val agentId: String? = null,
    val agentName: String? = null,
    val preview: String? = null,
    val newContentAt: Long,
)

data class ModelListSource(
    val type: String,
    val label: String,
    val backend: String? = null,
)
