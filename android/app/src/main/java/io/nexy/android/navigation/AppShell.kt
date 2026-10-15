package io.nexy.android.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import io.nexy.android.data.BackgroundActivityTracker
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.home.ActivityEdgeTab
import io.nexy.android.ui.home.PinnedChatsEdgeTab
import kotlinx.coroutines.flow.MutableStateFlow

@Composable
fun AppShell(
    onRequestNotificationPermission: () -> Unit = {},
    pendingDeeplink: MutableStateFlow<String?> = MutableStateFlow(null),
) {
    val navController = rememberNavController()
    val backgroundActivities by BackgroundActivityTracker.activities.collectAsStateWithLifecycle()
    val conversations by WsRepository.conversations.collectAsStateWithLifecycle()
    val density = LocalDensity.current
    // Edge tabs sit above the NavHost.  Keeping them visible while the IME is open
    // puts the centred tab over the chat composer's action row on edge-to-edge
    // devices, making controls such as voice input impossible to tap.
    val isKeyboardVisible = WindowInsets.ime.getBottom(density) > 0
    Box(modifier = Modifier.fillMaxSize()) {
        NavGraph(
            providedNavController = navController,
            onRequestNotificationPermission = onRequestNotificationPermission,
            pendingDeeplink = pendingDeeplink,
        )
        ActivityEdgeTab(
            visible = !isKeyboardVisible && backgroundActivities.isNotEmpty(),
            onClick = { navController.openActivityFeed() },
            modifier = Modifier.align(Alignment.CenterStart),
        )
        PinnedChatsEdgeTab(
            visible = !isKeyboardVisible && conversations.any { it.pinned },
            onClick = { navController.openPinnedChats() },
            modifier = Modifier.align(Alignment.CenterEnd),
        )
    }
}
