package io.nexy.android.ui.connection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for item 1 of the UX correctness roadmap: standalone/remote mode
 * must render as a real Switch with a distinct on/off state, not a clickable chip/badge
 * that reads as a second connection-status indicator.
 */
@RunWith(AndroidJUnit4::class)
class StandaloneModeToggleTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersAsAnActualSwitch_offState() {
        composeRule.setContent {
            StandaloneModeToggle(isStandaloneModeEnabled = false, onToggle = {})
        }
        composeRule.onNodeWithText("Standalone mode").assertIsDisplayed()
        composeRule.onNodeWithText(
            "Using the connected desktop's models and CLI backends when it's reachable.",
        ).assertIsDisplayed()
        composeRule.onNode(isToggleable()).assertIsOff()
    }

    @Test
    fun rendersAsAnActualSwitch_onState() {
        composeRule.setContent {
            StandaloneModeToggle(isStandaloneModeEnabled = true, onToggle = {})
        }
        composeRule.onNodeWithText(
            "Using only your locally-configured API keys. Works without a desktop, but CLI models and desktop file/git context stay unavailable.",
        ).assertIsDisplayed()
        composeRule.onNode(isToggleable()).assertIsOn()
    }

    @Test
    fun togglingInvokesCallbackWithFlippedValue() {
        var toggledTo: Boolean? = null
        composeRule.setContent {
            StandaloneModeToggle(
                isStandaloneModeEnabled = false,
                onToggle = { toggledTo = it },
            )
        }
        composeRule.onNode(isToggleable()).performClick()
        assertTrue(toggledTo == true)
    }
}
