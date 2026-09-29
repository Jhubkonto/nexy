package io.nexy.android.data.model

/** Empty project identifiers represent a project-less chat. */
fun normalizePromptProjectId(projectId: String?): String? =
    projectId?.trim()?.takeIf { it.isNotEmpty() }

/** Project chats can use global prompts and prompts owned by that project only. */
fun PromptEntry.isVisibleInProject(projectId: String?): Boolean {
    if (scope == "global") return true
    val requestedProjectId = normalizePromptProjectId(projectId) ?: return false
    return scope == "project" && normalizePromptProjectId(this.projectId) == requestedProjectId
}
