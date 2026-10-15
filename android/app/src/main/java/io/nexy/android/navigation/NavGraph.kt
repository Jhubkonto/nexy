package io.nexy.android.navigation

import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import io.nexy.android.data.model.WsEvent
import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import androidx.navigation.NavDestination
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.navigation.NavType
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.agentgenerator.AgentGeneratorScreen
import io.nexy.android.ui.skillgenerator.SkillGeneratorScreen
import io.nexy.android.ui.chat.ChatScreen
import io.nexy.android.ui.codepanel.CodePanelScreen
import io.nexy.android.ui.fileexplorer.FileExplorerScreen
import io.nexy.android.ui.fileviewer.MarkdownViewerScreen
import io.nexy.android.ui.fileviewer.ImageViewerScreen
import io.nexy.android.ui.projectpeek.ProjectPeekScreen
import io.nexy.android.ui.projectpeek.ProjectPeekViewerScreen
import io.nexy.android.ui.projects.ProjectConfigScreen
import io.nexy.android.ui.projects.ProjectHomeScreen
import io.nexy.android.ui.projects.AutomatedWorkflowListScreen
import io.nexy.android.ui.ratings.RatingsScreen
import io.nexy.android.ui.projects.AutomatedWorkflowScreen
import io.nexy.android.ui.home.ActivityFeedScreen
import io.nexy.android.ui.home.PinnedChatsScreen
import io.nexy.android.ui.home.NewContentScreen
import io.nexy.android.ui.home.AgentConfigScreen
import io.nexy.android.ui.home.HistoryScope
import io.nexy.android.ui.home.HomeScreen
import io.nexy.android.ui.home.ScopedChatHistoryScreen
import io.nexy.android.ui.pairing.PairingScreen
import io.nexy.android.ui.pairing.PairingStartScreen
import io.nexy.android.ui.artifacts.ArtifactsScreen
import io.nexy.android.ui.projectgenerator.ProjectGeneratorScreen
import io.nexy.android.ui.prompts.PromptsScreen
import io.nexy.android.ui.wiki.WikiScreen
import io.nexy.android.ui.settings.AppearanceScreen
import io.nexy.android.ui.settings.ConnectionScreen
import io.nexy.android.ui.settings.DiagnosticsScreen
import io.nexy.android.ui.settings.GlobalSettingsScreen
import io.nexy.android.ui.settings.BuildDashboardScreen
import io.nexy.android.ui.settings.DebugLogScreen
import io.nexy.android.ui.settings.McpServersScreen
import io.nexy.android.ui.settings.CliModelsScreen
import io.nexy.android.ui.settings.ModelsScreen
import io.nexy.android.ui.settings.NotificationsScreen
import io.nexy.android.ui.settings.VoiceAudioScreen
import io.nexy.android.ui.settings.ProvidersScreen
import io.nexy.android.ui.settings.SettingsScreen
import io.nexy.android.ui.settings.UpdatesScreen
import io.nexy.android.ui.settings.BackupRecoveryScreen
import io.nexy.android.ui.settings.CredentialManagerScreen
import io.nexy.android.ui.scheduler.ScheduledScreen
import io.nexy.android.ui.scheduler.SchedulerTaskDetailScreen
import io.nexy.android.ui.scheduler.SchedulerTaskConfigScreen
import io.nexy.android.ui.schedulegenerator.ScheduleGeneratorScreen
import io.nexy.android.ui.skills.SkillsScreen
import io.nexy.android.ui.splash.SplashScreen
import io.nexy.android.ui.onboarding.WelcomeScreen
import io.nexy.android.ui.debrief.DebriefScreen
import io.nexy.android.ui.quiz.QuizScreen
import io.nexy.android.ui.teachback.TeachbackScreen
import io.nexy.android.ui.share.ShareToChatScreen

internal const val CHAT_ROUTE = "chat/{conversationId}?agentId={agentId}&projectId={projectId}&messageId={messageId}&shareId={shareId}"

internal fun shouldDeferNotificationDeeplink(currentRoute: String?): Boolean =
    currentRoute == null || currentRoute == "splash"

@Composable
fun NavGraph(
    providedNavController: NavHostController? = null,
    onRequestNotificationPermission: () -> Unit = {},
    pendingDeeplink: MutableStateFlow<String?> = MutableStateFlow(null),
) {
    val navController = providedNavController ?: rememberNavController()
    // Track IDs navigated to from a "create" flow so config screens know to animate on save
    var newProjectId by remember { mutableStateOf<String?>(null) }
    var newAgentId by remember { mutableStateOf<String?>(null) }

    // Track whether this was a brand-new pairing (no saved profiles before connecting).
    val wasFirstPairing = androidx.compose.runtime.remember {
        androidx.compose.runtime.mutableStateOf(!WsRepository.hasPairedServer())
    }
    val onPairingConnected: () -> Unit = androidx.compose.runtime.remember(navController, onRequestNotificationPermission) {
        {
            if (wasFirstPairing.value) {
                onRequestNotificationPermission()
                wasFirstPairing.value = false
            }
            navController.navigate("home") {
                popUpTo("pairing") { inclusive = true }
            }
        }
    }

    val context = LocalContext.current

    // The splash is branding only. First launch continues to a short setup choice; returning users
    // go straight to Home. Computed
    // once (remember) so it stays stable across recompositions and Activity recreation.
    val startDestination = remember {
        if (io.nexy.android.data.PreferenceStore.getInstance(context).hasCompletedFirstLaunch()) {
            "home"
        } else {
            "splash"
        }
    }

    LaunchedEffect(navController) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.CodeChangeError -> Toast.makeText(context, event.error, Toast.LENGTH_LONG).show()
                else -> {}
            }
        }
    }

    // App-global navigation intents from chrome that has no screen-local navigator — currently the
    // persistent connection sheet's "Scan new QR code" action (see AppNavigator).
    LaunchedEffect(navController) {
        AppNavigator.routes.collect { route ->
            navController.navigate(route)
        }
    }

    // Consume deeplinks from notification taps (cold-start and while-running)
    LaunchedEffect(navController) {
        pendingDeeplink.filterNotNull().collect { deeplink ->
            pendingDeeplink.value = null
            val currentRoute = navController.currentBackStackEntry?.destination?.route
            if (shouldDeferNotificationDeeplink(currentRoute)) {
                navController.addOnDestinationChangedListener(object :
                    NavController.OnDestinationChangedListener {
                    override fun onDestinationChanged(
                        controller: NavController,
                        destination: NavDestination,
                        arguments: Bundle?,
                    ) {
                        if (destination.route == "home") {
                            controller.removeOnDestinationChangedListener(this)
                            controller.navigate(deeplink)
                        }
                    }
                })
            } else {
                navController.navigate(deeplink) {
                    launchSingleTop = true
                }
            }
        }
    }

    NavHost(navController = navController, startDestination = startDestination) {
        composable("splash") {
            SplashScreen(onFinished = {
                navController.navigate("welcome") {
                    popUpTo("splash") { inclusive = true }
                }
            })
        }

        composable("welcome") {
            WelcomeScreen(
                onPairDesktop = {
                    io.nexy.android.data.PreferenceStore.getInstance(context).setFirstLaunchCompleted()
                    navController.navigate("pairing") {
                        popUpTo("welcome") { inclusive = true }
                    }
                },
                onUseStandalone = {
                    io.nexy.android.data.PreferenceStore.getInstance(context).setFirstLaunchCompleted()
                    navController.navigate("home") {
                        popUpTo("welcome") { inclusive = true }
                    }
                },
            )
        }

        composable("pairing") {
            PairingStartScreen(
                onScanQr = { navController.navigate("pairing/scan") },
                onManualEntry = { navController.navigate("pairing/manual") },
                onConnected = { onPairingConnected() },
            )
        }

        composable("pairing/scan") {
            PairingScreen(
                onBack = { navController.popBackStack() },
                onConnected = { onPairingConnected() },
            )
        }

        composable("pairing/manual") {
            PairingScreen(
                initialShowManual = true,
                onBack = { navController.popBackStack() },
                onConnected = { onPairingConnected() },
            )
        }

        composable("home") {
            HomeScreen(
                onOpenChat = { conversationId ->
                    navController.navigate("chat/$conversationId")
                },
                onOpenDraftChat = { conversationId, agentId, projectId ->
                    val agentParam = Uri.encode(agentId.orEmpty())
                    val projectParam = Uri.encode(projectId.orEmpty())
                    navController.navigate("chat/$conversationId?agentId=$agentParam&projectId=$projectParam")
                },
                onOpenAgentHistory = { agentId ->
                    navController.navigate("history/agent/${Uri.encode(agentId)}")
                },
                onOpenAgentConfig = { agentId ->
                    navController.navigate("agent-config/${Uri.encode(agentId)}")
                },
                onOpenAgentConfigNew = { agentId ->
                    newAgentId = agentId
                    navController.navigate("agent-config/${Uri.encode(agentId)}")
                },
                onOpenProjectHistory = { projectId ->
                    navController.navigate("history/project/${Uri.encode(projectId)}")
                },
                onOpenProjectConfig = { projectId ->
                    navController.navigate("project-home/${Uri.encode(projectId)}")
                },
                onOpenProjectConfigNew = { projectId ->
                    newProjectId = projectId
                    navController.navigate("project-config/${Uri.encode(projectId)}")
                },
                onOpenProjectGenerator = {
                    navController.navigate("project-generator")
                },
                onOpenCodePanel = { projectId ->
                    navController.navigate("code-panel/${Uri.encode(projectId)}")
                },
                onOpenAgentGenerator = {
                    navController.navigate("agent-generator")
                },
                onOpenArtifacts = {
                    navController.navigate("artifacts?artifactId=")
                },
                onOpenSkills = {
                    navController.navigate("skills")
                },
                onOpenScheduled = {
                    navController.navigate("scheduled")
                },
                onOpenAutomatedWorkflows = {
                    navController.navigate("automated-workflows?projectId=")
                },
                onOpenRatings = {
                    navController.navigate("ratings")
                },
                onOpenSkillGenerator = {
                    navController.navigate("skill-generator")
                },
                onOpenSettings = {
                    navController.navigate("settings")
                },
                onOpenNewContent = { navController.openNewContent() },
                onNavigateRoute = { route ->
                    navController.navigate(route)
                },
            )
        }

        composable("home/add-server") {
            PairingScreen(
                onBack = { navController.popBackStack() },
                onConnected = { navController.popBackStack() },
            )
        }

        composable(ACTIVITY_FEED_ROUTE) {
            ActivityFeedScreen(
                onBack = { navController.popBackStack() },
                onOpenActivity = { activity -> navController.openActivityRoute(activity.route) },
            )
        }

        composable(PINNED_CHATS_ROUTE) {
            PinnedChatsScreen(
                onBack = { navController.popBackStack() },
                onOpenChat = { conversationId ->
                    navController.openPinnedChat("chat/${Uri.encode(conversationId)}")
                },
            )
        }

        composable(NEW_CONTENT_ROUTE) {
            NewContentScreen(
                onBack = { navController.popBackStack() },
                onOpenChat = { conversationId ->
                    navController.navigate("chat/${Uri.encode(conversationId)}") { launchSingleTop = true }
                },
            )
        }

        composable(
            route = "share/{batchId}",
            arguments = listOf(navArgument("batchId") { type = NavType.StringType }),
        ) { backStack ->
            val batchId = backStack.arguments?.getString("batchId") ?: return@composable
            ShareToChatScreen(
                batchId = batchId,
                onBack = { navController.popBackStack() },
                onSelectConversation = { conversationId ->
                    navController.navigate("chat/${Uri.encode(conversationId)}?shareId=${Uri.encode(batchId)}") {
                        popUpTo("share/{batchId}") { inclusive = true }
                    }
                },
                onNewChat = { projectId ->
                    val projectParam = Uri.encode(projectId.orEmpty())
                    navController.navigate(
                        "chat/${java.util.UUID.randomUUID()}?shareId=${Uri.encode(batchId)}&projectId=$projectParam",
                    ) {
                        popUpTo("share/{batchId}") { inclusive = true }
                    }
                },
            )
        }

        composable(
            route = "history/{scope}/{scopeId}",
            arguments = listOf(
                navArgument("scope") { type = NavType.StringType },
                navArgument("scopeId") { type = NavType.StringType },
            ),
        ) { backStack ->
            val scope = when (backStack.arguments?.getString("scope")) {
                "agent" -> HistoryScope.Agent
                "project" -> HistoryScope.Project
                else -> HistoryScope.Project
            }
            val scopeId = backStack.arguments?.getString("scopeId") ?: ""
            ScopedChatHistoryScreen(
                scopeType = scope,
                scopeId = scopeId,
                onBack = { navController.popBackStack() },
                onOpenChat = { conversationId -> navController.navigate("chat/$conversationId") },
                onOpenDraftChat = { conversationId, agentId, projectId ->
                    val agentParam = Uri.encode(agentId.orEmpty())
                    val projectParam = Uri.encode(projectId.orEmpty())
                    navController.navigate("chat/$conversationId?agentId=$agentParam&projectId=$projectParam")
                },
                onOpenDebrief = { conversationId -> navController.navigate("debrief/${Uri.encode(conversationId)}") },
                onOpenQuiz = { conversationId -> navController.navigate("quiz/${Uri.encode(conversationId)}") },
            )
        }

        composable(
            route = CHAT_ROUTE,
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("agentId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("projectId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("messageId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("shareId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
            enterTransition = { androidx.compose.animation.EnterTransition.None },
            exitTransition = { androidx.compose.animation.ExitTransition.None },
        ) { backStack ->
            val conversationId = backStack.arguments?.getString("conversationId") ?: ""
            val agentId = backStack.arguments?.getString("agentId")?.takeIf { it.isNotBlank() }
            val projectId = backStack.arguments?.getString("projectId")?.takeIf { it.isNotBlank() }
            val messageId = backStack.arguments?.getString("messageId")?.takeIf { it.isNotBlank() }
            val shareId = backStack.arguments?.getString("shareId")?.takeIf { it.isNotBlank() }
            ChatScreen(
                conversationId = conversationId,
                agentId = agentId,
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onOpenArtifacts = { artifactId ->
                    navController.navigate("artifacts?artifactId=${Uri.encode(artifactId.orEmpty())}")
                },
                onOpenDebrief = { cid -> navController.navigate("debrief/${Uri.encode(cid)}") },
                onOpenQuiz = { cid, artifactId ->
                    navController.navigate("quiz/${Uri.encode(cid)}?artifactId=${Uri.encode(artifactId)}")
                },
                onOpenTeachback = { cid, artifactId ->
                    navController.navigate("teachback/${Uri.encode(cid)}?artifactId=${Uri.encode(artifactId)}")
                },
                onOpenFork = { forkedId -> navController.navigate("chat/$forkedId") },
                onOpenCodePanel = { pid -> navController.navigate("code-panel/${Uri.encode(pid)}") },
                onOpenProjectPeek = { peekProjectId -> navController.navigate("project-peek/${Uri.encode(peekProjectId)}") },
                onOpenAutomatedWorkflow = { workflowProjectId -> navController.navigate("automated-workflow/${Uri.encode(workflowProjectId)}") },
                onOpenDesktopPathPicker = {
                    navController.navigate("file-explorer?projectId=&startPath=&selectionMode=attachment")
                },
                onOpenMcpServers = {
                    navController.navigate("settings/mcp-servers")
                },
                initialMessageId = messageId,
                sharedBatchId = shareId,
                onNewChat = { newAgentId, newProjectId ->
                    val newConversationId = java.util.UUID.randomUUID().toString()
                    val agentParam = Uri.encode(newAgentId.orEmpty())
                    val projectParam = Uri.encode(newProjectId.orEmpty())
                    // /new starts an unrelated conversation, not a branch of this one — replace
                    // this chat entry instead of stacking on top of it, so Back from the new chat
                    // lands wherever the user was before *this* chat (home/history), never back
                    // into an unrelated conversation.
                    navController.navigate(
                        "chat/$newConversationId?agentId=$agentParam&projectId=$projectParam",
                    ) {
                        popUpTo(CHAT_ROUTE) {
                            inclusive = true
                        }
                    }
                },
            )
        }

        composable("settings") {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onForgetServer = {
                    navController.navigate("pairing") {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onOpenAppearance = { navController.navigate("settings/appearance") },
                onOpenConnection = { navController.navigate("settings/connection") },
                onOpenModels = { navController.navigate("settings/models") },
                onOpenNotifications = { navController.navigate("settings/notifications") },
                onOpenVoiceAudio = { navController.navigate("settings/voice-audio") },
                onOpenUpdates = { navController.navigate("settings/updates") },
                onOpenDiagnostics = { navController.navigate("settings/diagnostics") },
                onOpenProviders = { navController.navigate("providers") },
                onOpenCredentials = { navController.navigate("settings/credentials") },
                onOpenPromptLibrary = { navController.navigate("prompts") },
                onOpenGlobalSettings = { navController.navigate("settings/global") },
                onOpenMcpServers = { navController.navigate("settings/mcp-servers") },
                onOpenCliModels = { navController.navigate("settings/cli-models") },
                onOpenBuildDashboard = { navController.navigate("settings/build-dashboard") },
                onOpenDebugLog = { navController.navigate("settings/debug-log") },
                onOpenBackupRecovery = { navController.navigate("settings/backup") },
            )
        }

        composable(
            "settings/build-dashboard?tab={tab}",
            arguments = listOf(navArgument("tab") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { backStackEntry ->
            BuildDashboardScreen(
                onBack = { navController.popBackStack() },
                initialTab = backStackEntry.arguments?.getString("tab"),
            )
        }

        composable("settings/debug-log") {
            DebugLogScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/backup") {
            BackupRecoveryScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/credentials") {
            CredentialManagerScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/global") {
            GlobalSettingsScreen(
                onBack = { navController.popBackStack() },
                onOpenProviders = { navController.navigate("providers") },
            )
        }

        composable("settings/mcp-servers") {
            McpServersScreen(
                onBack = { navController.popBackStack() },
            )
        }

        composable("settings/cli-models") {
            CliModelsScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/appearance") {
            AppearanceScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/connection") {
            ConnectionScreen(
                onBack = { navController.popBackStack() },
                onForgetServer = {
                    navController.navigate("pairing") {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onOpenPairingScan = {
                    navController.navigate("home/add-server")
                },
            )
        }

        composable("settings/models") {
            ModelsScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/notifications") {
            NotificationsScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/voice-audio") {
            VoiceAudioScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/updates") {
            UpdatesScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/diagnostics") {
            DiagnosticsScreen(
                onBack = { navController.popBackStack() },
                onForgetServer = {
                    navController.navigate("pairing") {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }

        composable("providers") {
            ProvidersScreen(onBack = { navController.popBackStack() })
        }

        composable("project-generator") {
            ProjectGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable("agent-generator") {
            AgentGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable(
            route = "project-home/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectHomeScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onOpenSettings = { navController.navigate("project-config/${Uri.encode(projectId)}") },
                onOpenFiles = {
                    navController.navigate("file-explorer?projectId=${Uri.encode(projectId)}&startPath=&selectionMode=browse")
                },
                onOpenWiki = { navController.navigate("wiki/${Uri.encode(projectId)}") },
                onOpenArtifacts = { navController.navigate("artifacts?artifactId=") },
                onOpenWorkflow = { navController.navigate("automated-workflow/${Uri.encode(projectId)}") },
            )
        }

        composable(
            route = "project-config/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectConfigScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                isNew = projectId == newProjectId,
                onOpenFileExplorer = { startPath ->
                    navController.navigate("file-explorer?projectId=${Uri.encode(projectId)}&startPath=${Uri.encode(startPath)}&selectionMode=folder")
                },
                onAddSourceFolder = {
                    navController.navigate("file-explorer?projectId=${Uri.encode(projectId)}&startPath=&selectionMode=source")
                },
                onOpenMcpServers = { navController.navigate("settings/mcp-servers") },
            )
        }

        composable(
            route = "file-explorer?projectId={projectId}&startPath={startPath}&selectionMode={selectionMode}",
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType; defaultValue = "" },
                navArgument("startPath") { type = NavType.StringType; defaultValue = "" },
                navArgument("selectionMode") { type = NavType.StringType; defaultValue = "folder" },
            ),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId").orEmpty()
            val startPath = backStackEntry.arguments?.getString("startPath").orEmpty()
            val selectionMode = backStackEntry.arguments?.getString("selectionMode").orEmpty()
            FileExplorerScreen(
                onBack = { navController.popBackStack() },
                projectId = projectId,
                onOpenProjectSettings = if (selectionMode == "browse" && projectId.isNotBlank()) {
                    { navController.navigate("project-config/${Uri.encode(projectId)}") }
                } else null,
                onFolderSelected = { path ->
                    if (selectionMode == "attachment") {
                        WsRepository.pendingSelectedAttachmentPath.value = path
                    } else if (selectionMode == "source") {
                        WsRepository.addProjectSource(projectId, path)
                    } else {
                        WsRepository.pendingSelectedDirectory.value = path
                    }
                    if (selectionMode != "source") navController.popBackStack()
                },
                initialPath = startPath,
                allowFileSelection = selectionMode == "attachment",
                isAddingProjectSource = selectionMode == "source",
                browseMode = selectionMode == "browse",
                // Reading Markdown is a browse-mode affordance only; the folder picker
                // (selectionMode == "folder") stays a pure path chooser.
                onMarkdownSelected = if (selectionMode == "browse") { path -> navController.navigate("markdown-viewer?path=${Uri.encode(path)}") } else null,
                onImageSelected = if (selectionMode == "browse") { path -> navController.navigate("image-viewer?path=${Uri.encode(path)}") } else null,
            )
        }

        composable(
            route = "project-peek/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectPeekScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onPreview = { sourceId, entry ->
                    navController.navigate(
                        "project-peek-preview/${Uri.encode(projectId)}/${Uri.encode(sourceId)}?path=${Uri.encode(entry.relativePath)}&category=${Uri.encode(entry.category)}",
                    )
                },
            )
        }

        composable(
            route = "project-peek-preview/{projectId}/{sourceId}?path={path}&category={category}",
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType },
                navArgument("sourceId") { type = NavType.StringType },
                navArgument("path") { type = NavType.StringType },
                navArgument("category") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            val sourceId = backStackEntry.arguments?.getString("sourceId") ?: return@composable
            val path = backStackEntry.arguments?.getString("path") ?: return@composable
            val category = backStackEntry.arguments?.getString("category") ?: return@composable
            ProjectPeekViewerScreen(projectId, sourceId, path, category, onBack = { navController.popBackStack() })
        }

        composable(
            route = "markdown-viewer?path={path}",
            arguments = listOf(navArgument("path") { type = NavType.StringType }),
        ) { backStackEntry ->
            val path = backStackEntry.arguments?.getString("path") ?: return@composable
            MarkdownViewerScreen(path = path, onBack = { navController.popBackStack() })
        }

        composable(
            route = "image-viewer?path={path}",
            arguments = listOf(navArgument("path") { type = NavType.StringType }),
        ) { backStackEntry ->
            val path = backStackEntry.arguments?.getString("path") ?: return@composable
            ImageViewerScreen(path = path, onBack = { navController.popBackStack() })
        }

        composable(
            route = "automated-workflow/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            AutomatedWorkflowScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onOpenConversation = { conversationId -> navController.navigate("chat/$conversationId") },
            )
        }

        // Standalone (project-less) generation entry point — reached from the global Automated
        // Workflows list's "New" action, additive to the project-nested route above.
        composable(route = "automated-workflow-generate") {
            AutomatedWorkflowScreen(
                projectId = null,
                onBack = { navController.popBackStack() },
                onOpenConversation = { conversationId -> navController.navigate("chat/$conversationId") },
            )
        }

        composable(
            route = "automated-workflows?projectId={projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType; defaultValue = "" }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId")?.takeIf { it.isNotBlank() }
            AutomatedWorkflowListScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onNewWorkflow = {
                    navController.navigate(
                        if (projectId != null) "automated-workflow/${Uri.encode(projectId)}" else "automated-workflow-generate",
                    )
                },
                onOpenConversation = { conversationId -> navController.navigate("chat/$conversationId") },
            )
        }

        composable(route = "ratings") {
            RatingsScreen(
                onBack = { navController.popBackStack() },
                onOpenConversation = { conversationId -> navController.navigate("chat/$conversationId") },
            )
        }

        composable(
            route = "artifacts?artifactId={artifactId}",
            arguments = listOf(
                navArgument("artifactId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStackEntry ->
            val artifactId = backStackEntry.arguments?.getString("artifactId")?.takeIf { it.isNotBlank() }
            ArtifactsScreen(
                onBack = { navController.popBackStack() },
                onOpenMarkdown = { path -> navController.navigate("markdown-viewer?path=${Uri.encode(path)}") },
                initialArtifactId = artifactId,
            )
        }

        composable("skills") {
            SkillsScreen(
                onBack = { navController.popBackStack() },
                onOpenSkillGenerator = { navController.navigate("skill-generator") },
            )
        }

        composable("skill-generator") {
            SkillGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable("scheduled") {
            ScheduledScreen(
                onBack = { navController.popBackStack() },
                onNewTask = { navController.navigate("scheduled/new") },
                onOpenGenerator = { navController.navigate("scheduled/generator") },
                onTaskDetail = { taskId -> navController.navigate("scheduled/$taskId") },
            )
        }

        composable("scheduled/generator") {
            ScheduleGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable("scheduled/new") {
            SchedulerTaskConfigScreen(
                taskId = null,
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = "scheduled/{taskId}",
            arguments = listOf(navArgument("taskId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val taskId = backStackEntry.arguments?.getString("taskId") ?: return@composable
            LaunchedEffect(taskId) {
                io.nexy.android.notification.ActivityBadgeManager.markSeen(
                    context,
                    io.nexy.android.notification.ActivityBadgeManager.scheduledDestination(taskId),
                )
            }
            SchedulerTaskDetailScreen(
                taskId = taskId,
                onBack = { navController.popBackStack() },
                onEdit = { id -> navController.navigate("scheduled/$id/edit") },
            )
        }

        composable(
            route = "scheduled/{taskId}/edit",
            arguments = listOf(navArgument("taskId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val taskId = backStackEntry.arguments?.getString("taskId") ?: return@composable
            SchedulerTaskConfigScreen(
                taskId = taskId,
                onBack = { navController.popBackStack() },
            )
        }

        composable("prompts") {
            PromptsScreen(onBack = { navController.popBackStack() })
        }

        composable(
            route = "code-panel/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStack ->
            val projectId = backStack.arguments?.getString("projectId") ?: ""
            CodePanelScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = "agent-config/{agentId}",
            arguments = listOf(navArgument("agentId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val agentId = backStackEntry.arguments?.getString("agentId") ?: return@composable
            AgentConfigScreen(
                agentId = agentId,
                onBack = { navController.popBackStack() },
                isNew = agentId == newAgentId,
            )
        }

        composable(
            route = "wiki/{projectId}?entryId={entryId}",
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType },
                navArgument("entryId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            val entryId = backStackEntry.arguments?.getString("entryId")?.takeIf { it.isNotBlank() }
            WikiScreen(
                projectId = projectId,
                initialEntryId = entryId,
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = "debrief/{conversationId}",
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
            enterTransition = { androidx.compose.animation.EnterTransition.None },
            exitTransition = { androidx.compose.animation.ExitTransition.None },
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            DebriefScreen(
                conversationId = conversationId,
                onBack = { navController.popBackStack() },
                onQuizMe = { cid -> navController.navigate("quiz/${Uri.encode(cid)}") },
            )
        }

        composable(
            route = "quiz/{conversationId}?artifactId={artifactId}",
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("artifactId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
            enterTransition = { androidx.compose.animation.EnterTransition.None },
            exitTransition = { androidx.compose.animation.ExitTransition.None },
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            val artifactId = backStackEntry.arguments?.getString("artifactId")?.takeIf { it.isNotBlank() }
            QuizScreen(
                conversationId = conversationId,
                artifactId = artifactId,
                onBack = { navController.popBackStack() },
            )
        }
        composable(
            route = "teachback/{conversationId}?artifactId={artifactId}",
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("artifactId") { type = NavType.StringType; defaultValue = "" },
            ),
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            val artifactId = backStackEntry.arguments?.getString("artifactId")?.takeIf { it.isNotBlank() }
            TeachbackScreen(conversationId, artifactId, onBack = { navController.popBackStack() })
        }
    }
}
