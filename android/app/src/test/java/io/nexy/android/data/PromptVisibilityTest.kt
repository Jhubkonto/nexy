package io.nexy.android.data

import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.isVisibleInProject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptVisibilityTest {
    private fun prompt(scope: String, projectId: String?): PromptEntry = PromptEntry(
        id = "$scope-${projectId ?: "global"}",
        title = "Prompt",
        body = "Body",
        description = "",
        category = "Custom",
        tags = emptyList(),
        scope = scope,
        projectId = projectId,
        createdAt = 0L,
        updatedAt = 0L,
    )

    @Test
    fun globalPromptsAreVisibleInEveryContext() {
        val global = prompt("global", null)

        assertTrue(global.isVisibleInProject(null))
        assertTrue(global.isVisibleInProject("project-a"))
        assertTrue(global.isVisibleInProject("  "))
    }

    @Test
    fun projectPromptsRequireTheMatchingNonBlankProject() {
        val projectA = prompt("project", "project-a")

        assertTrue(projectA.isVisibleInProject("project-a"))
        assertTrue(projectA.isVisibleInProject(" project-a "))
        assertFalse(projectA.isVisibleInProject(null))
        assertFalse(projectA.isVisibleInProject(""))
        assertFalse(projectA.isVisibleInProject("project-b"))
    }
}
