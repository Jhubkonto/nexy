package io.nexy.android.ui.projects

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.AutomatedWorkflowStepInfo
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for item 2 of the UX correctness roadmap: the Automated Workflow
 * Generator used to discard everything except a flattened title/summary string, so a
 * generated plan couldn't actually be used (no prompt, no agent, no way to copy it out).
 */
@RunWith(AndroidJUnit4::class)
class AutomatedWorkflowStepPreviewCardTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val step = AutomatedWorkflowStepInfo(
        id = "s1",
        title = "Run tests",
        summary = "Execute the full suite",
        agentName = "Builder",
        prompt = "Run the full test suite and report failures",
        expectedOutput = "All tests green",
    )

    @Test
    fun showsTitleAgentSummaryAndOutput() {
        composeRule.setContent {
            AutomatedWorkflowStepPreviewCard(index = 0, step = step)
        }
        composeRule.onNodeWithText("1. Run tests").assertIsDisplayed()
        composeRule.onNodeWithText("Builder · Output: All tests green").assertIsDisplayed()
        composeRule.onNodeWithText("Execute the full suite").assertIsDisplayed()
    }

    @Test
    fun showsUnassignedWhenNoAgentGiven() {
        composeRule.setContent {
            AutomatedWorkflowStepPreviewCard(index = 1, step = step.copy(agentName = null, expectedOutput = ""))
        }
        composeRule.onNodeWithText("Unassigned").assertIsDisplayed()
    }

    @Test
    fun showsModelBadgeWhenStepIsFulfilledByBareModelInsteadOfAgent() {
        // A step fulfilled by a bare model (no agent) never gets skill augmentation — the UI must
        // make that distinction visible rather than falling back to "Unassigned".
        composeRule.setContent {
            AutomatedWorkflowStepPreviewCard(
                index = 0,
                step = step.copy(agentName = null, model = "claude-sonnet-4-6"),
            )
        }
        composeRule.onNodeWithText("Model: claude-sonnet-4-6 · Output: All tests green").assertIsDisplayed()
    }

    @Test
    fun copyButtonIsShownWhenPromptIsPresent() {
        composeRule.setContent {
            AutomatedWorkflowStepPreviewCard(index = 0, step = step)
        }
        composeRule.onNodeWithText("Copy prompt").assertIsDisplayed()
    }

    @Test
    fun copyButtonIsHiddenWhenPromptIsBlank() {
        composeRule.setContent {
            AutomatedWorkflowStepPreviewCard(index = 0, step = step.copy(prompt = ""))
        }
        composeRule.onNodeWithText("Copy prompt").assertDoesNotExist()
    }
}
