package io.nexy.android.ui.projects

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.AutomatedWorkflowStepInfo
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for the Automated Workflow Generator's step list not being scrollable:
 * the plan/steps block used to be a plain unbounded Column placed as a sibling above the one
 * weighted, scrollable element (the chat log LazyColumn), so with many generated steps it just
 * grew and squeezed the chat log toward zero height instead of scrolling. AutomatedWorkflowScreen.kt
 * now renders step cards as items inside the same weighted LazyColumn as the chat log. Mirrors
 * ChatCompletedBadgeTest's convention of testing the at-risk piece in isolation rather than
 * mounting the full screen, since AutomatedWorkflowScreen depends on the live WsRepository singleton.
 */
@RunWith(AndroidJUnit4::class)
class AutomatedWorkflowStepsScrollTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val steps = (1..15).map { n ->
        AutomatedWorkflowStepInfo(
            id = "s$n",
            title = "Step $n",
            summary = "Do part $n of the work",
            agentName = "Agent $n",
            prompt = "Prompt for step $n",
            expectedOutput = "Output $n",
        )
    }

    @Test
    fun manyStepsScrollFullyIntoView() {
        composeRule.setContent {
            LazyColumn(modifier = Modifier.height(300.dp).testTag("workflowStepsList")) {
                itemsIndexed(steps) { index, step ->
                    AutomatedWorkflowStepPreviewCard(index = index, step = step)
                }
            }
        }

        composeRule.onNodeWithText("1. Step 1").assertIsDisplayed()
        composeRule.onNodeWithText("15. Step 15").assertDoesNotExist()

        composeRule.onNodeWithTag("workflowStepsList").performScrollToIndex(14)

        composeRule.onNodeWithText("15. Step 15").assertIsDisplayed()
    }
}
