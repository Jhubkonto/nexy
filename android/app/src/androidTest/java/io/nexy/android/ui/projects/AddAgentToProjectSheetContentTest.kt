package io.nexy.android.ui.projects

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.Agent
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage: the "Add agent to project" sheet used to render agents in a plain
 * Column with no scroll container, so a long agent list overflowed the ModalBottomSheet's
 * bounded height and agents near the top were permanently unreachable. This exercises the
 * extracted LazyColumn-based content directly (no ViewModel/WsRepository wiring needed).
 */
@RunWith(AndroidJUnit4::class)
class AddAgentToProjectSheetContentTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun manyAgents(count: Int) = (1..count).map { Agent(id = "a$it", name = "Agent $it") }

    @Test
    fun showsEmptyStateWhenNoAgentsAvailable() {
        composeRule.setContent {
            AddAgentToProjectSheetContent(available = emptyList(), onSelectAgent = {}, onCancel = {})
        }
        composeRule.onNodeWithText("All agents are already in this project.").assertIsDisplayed()
    }

    @Test
    fun clickingAnAgentInvokesOnSelectAgent() {
        var selected: Agent? = null
        composeRule.setContent {
            AddAgentToProjectSheetContent(
                available = manyAgents(3),
                onSelectAgent = { selected = it },
                onCancel = {},
            )
        }
        composeRule.onNodeWithText("Agent 2").performClick()
        assertEquals("a2", selected?.id)
    }

    @Test
    fun cancelButtonInvokesOnCancel() {
        var cancelled = false
        composeRule.setContent {
            AddAgentToProjectSheetContent(available = manyAgents(3), onSelectAgent = {}, onCancel = { cancelled = true })
        }
        composeRule.onNodeWithText("Cancel").performClick()
        assertEquals(true, cancelled)
    }

    @Test
    fun longListIsScrollableAndFirstAgentIsReachable() {
        var selected: Agent? = null
        composeRule.setContent {
            AddAgentToProjectSheetContent(
                available = manyAgents(40),
                onSelectAgent = { selected = it },
                onCancel = {},
            )
        }
        val list = composeRule.onNode(hasScrollToNodeAction())

        // Scroll to the last agent first, proving the list scrolls past the visible window...
        list.performScrollToNode(hasText("Agent 40"))
        composeRule.onNodeWithText("Agent 40").assertIsDisplayed()

        // ...then back up to the first agent, which a non-scrollable Column would never reach.
        list.performScrollToNode(hasText("Agent 1"))
        composeRule.onNodeWithText("Agent 1").performClick()
        assertEquals("a1", selected?.id)
    }
}
