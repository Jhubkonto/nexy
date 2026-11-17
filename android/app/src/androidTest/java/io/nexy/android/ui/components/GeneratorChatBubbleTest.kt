package io.nexy.android.ui.components

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for item 5 of the UX follow-up roadmap: AutomatedWorkflowScreen hand-rolled
 * its own message bubble instead of the ChatBubble already duplicated identically across the
 * Project/Agent/Skill generator screens. Extracted here as a single shared component all of
 * them (plus Automated Workflow) now use.
 */
@RunWith(AndroidJUnit4::class)
class GeneratorChatBubbleTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersPlainText() {
        composeRule.setContent {
            GeneratorChatBubble(role = "assistant", text = "Hello there")
        }
        composeRule.onNodeWithText("Hello there").assertIsDisplayed()
    }

    @Test
    fun streamingAppendsCursorGlyph() {
        composeRule.setContent {
            GeneratorChatBubble(role = "assistant", text = "Thinking", streaming = true)
        }
        composeRule.onNodeWithText("Thinking▍").assertIsDisplayed()
    }

    @Test
    fun nonStreamingDoesNotAppendCursorGlyph() {
        composeRule.setContent {
            GeneratorChatBubble(role = "assistant", text = "Done")
        }
        composeRule.onNodeWithText("Done▍").assertDoesNotExist()
    }

    @Test
    fun rendersErrorMessage() {
        composeRule.setContent {
            GeneratorChatBubble(role = "assistant", text = "Something went wrong", isError = true)
        }
        composeRule.onNodeWithText("Something went wrong").assertIsDisplayed()
    }
}
