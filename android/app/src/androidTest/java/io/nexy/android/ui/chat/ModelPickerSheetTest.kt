package io.nexy.android.ui.chat

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.ModelOption
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ModelPickerSheetTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun navigatesProvidersAndSelectsSourceQualifiedModel() {
        var selection: String? = null
        composeRule.setContent {
            ModelPickerSheet(
                title = "Choose model",
                models = listOf(
                    ModelOption("openai:gpt-test", "Test model", "OpenAI"),
                    ModelOption("openrouter:gpt-test", "Test model", "OpenRouter"),
                ),
                cliStatus = emptyMap(), selectedModelId = "openai:gpt-test",
                onSelect = { selection = it },
            )
        }
        composeRule.onNodeWithText("Active: Test model · OpenAI").assertExists()
        composeRule.onNodeWithText("OpenRouter  ›").performClick()
        composeRule.onNodeWithText("Test model").performClick()
        composeRule.runOnIdle { assertEquals("openrouter:gpt-test", selection) }
        composeRule.onNodeWithText("‹  OpenRouter").performClick()
        composeRule.onNodeWithText("OpenAI  ›").assertExists()
    }
}
