package io.nexy.android.ui.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNode
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpToolInfo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for the MCP settings surface. These tests keep the server card's primary
 * identity, connection status, tool count, and overflow actions visible while the surrounding
 * screen evolves.
 */
@RunWith(AndroidJUnit4::class)
class McpServersScreenRowTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersServerNameAndCommand() {
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx -y @modelcontextprotocol/server-filesystem", enabled = true),
                status = "connected",
                onEdit = {},
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNodeWithText("Filesystem").assertIsDisplayed()
        composeRule.onNodeWithText("npx -y @modelcontextprotocol/server-filesystem").assertIsDisplayed()
        composeRule.onNodeWithText("Connected").assertIsDisplayed()
    }

    @Test
    fun showsOffBadgeWhenDisabled() {
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx", enabled = false),
                status = null,
                onEdit = {},
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNodeWithText("Off").assertIsDisplayed()
    }

    @Test
    fun showsToolCountOnServerCard() {
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx", enabled = true),
                status = "connected",
                toolCount = 12,
                onEdit = {},
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNodeWithText("12 tools").assertIsDisplayed()
    }

    @Test
    fun showsServerDescription() {
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx", enabled = true),
                status = "connected",
                description = "Read and search files in a chosen directory.",
                onEdit = {},
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNodeWithText("Read and search files in a chosen directory.").assertIsDisplayed()
    }

    @Test
    fun openingMenuAndTappingEditInvokesOnEdit() {
        var edited = false
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx", enabled = true),
                status = null,
                onEdit = { edited = true },
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNode(hasContentDescription("Server options")).performClick()
        composeRule.onNodeWithText("Edit").performClick()
        assertEquals(true, edited)
    }

    @Test
    fun builtInDesktopNavigatorDoesNotExposeShellEditing() {
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "desktop-navigator", name = "Desktop Navigator", command = "", enabled = true, managed = true),
                status = "connected",
                onEdit = {},
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNodeWithText("Built in").assertIsDisplayed()
        composeRule.onNode(hasContentDescription("Server options")).assertDoesNotExist()
    }

    @Test
    fun rendersToolNameDescriptionAndServerName() {
        composeRule.setContent {
            McpToolEntry(
                tool = McpToolInfo(name = "read_file", description = "Reads a file from disk", serverId = "s1", serverName = "Filesystem"),
            )
        }
        composeRule.onNodeWithText("read_file").assertIsDisplayed()
        composeRule.onNodeWithText("Reads a file from disk").assertIsDisplayed()
        composeRule.onNodeWithText("Filesystem").assertIsDisplayed()
    }
}
