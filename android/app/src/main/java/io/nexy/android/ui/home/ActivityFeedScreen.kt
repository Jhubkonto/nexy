package io.nexy.android.ui.home

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.BackgroundActivity
import io.nexy.android.data.BackgroundActivityTracker
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

/** Full-screen activity feed — styled like the chat/project/agent history screens, per the
 *  edge tab that opens it. Reflects the same [BackgroundActivityTracker] state as the tab. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityFeedScreen(
    onBack: () -> Unit,
    onOpenActivity: (BackgroundActivity) -> Unit,
) {
    val activities by BackgroundActivityTracker.activities.collectAsStateWithLifecycle()
    val conversations by WsRepository.conversations.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    var isRefreshing by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Column {
                        Text("Activity", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "${activities.size} in progress",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                onBack = onBack,
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = {
                isRefreshing = true
                WsRepository.getActivityFeed()
                isRefreshing = false
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (activities.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "Nothing in progress right now.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(activities, key = { it.id }) { activity ->
                        ActivityFeedRow(
                            activity = activity,
                            conversations = conversations,
                            projects = projects,
                            agents = agents,
                            onClick = { onOpenActivity(activity) },
                            onDismiss = { WsRepository.dismissActivity(activity.id) },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityFeedRow(
    activity: BackgroundActivity,
    conversations: List<Conversation>,
    projects: List<Project>,
    agents: List<Agent>,
    onClick: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = resolveActivityContext(activity, conversations, projects, agents)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(start = 16.dp, end = 4.dp, top = 14.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (activity.label != "Background task status unknown") CircularProgressIndicator(
            modifier = Modifier
                .size(16.dp)
                .semantics { contentDescription = "Activity in progress" },
            color = MaterialTheme.colorScheme.primary,
            strokeWidth = 2.dp,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                activity.label,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ActivityContextLine("Chat", context.conversationTitle)
            ActivityContextLine("Project", context.projectName)
            ActivityContextLine("Agent", context.agentName)
            if (context.agentName.isNullOrBlank()) ActivityContextLine("Model", context.model)
            if (
                activity.detail != null &&
                activity.detail !in setOf(
                    context.conversationTitle,
                    context.projectName,
                    context.agentName,
                    context.model,
                )
            ) {
                ActivityContextLine("Details", activity.detail)
            }
        }
        IconButton(onClick = onDismiss) {
            NexyIcon(
                NexyIconName.Close,
                contentDescription = "Dismiss",
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

internal data class ActivityDisplayContext(
    val conversationTitle: String?,
    val projectName: String?,
    val agentName: String?,
    val model: String?,
)

internal fun resolveActivityContext(
    activity: BackgroundActivity,
    conversations: List<Conversation>,
    projects: List<Project>,
    agents: List<Agent>,
): ActivityDisplayContext {
    val conversation = activity.conversationId?.let { id -> conversations.find { it.id == id } }
    val projectId = activity.projectId ?: conversation?.project_id
    val agentId = activity.agentId ?: conversation?.agent_id
    return ActivityDisplayContext(
        conversationTitle = activity.conversationTitle ?: conversation?.title,
        projectName = activity.projectName
            ?: conversation?.project_name
            ?: projectId?.let { id -> projects.find { it.id == id }?.name },
        agentName = activity.agentName
            ?: conversation?.agent_name
            ?: agentId?.let { id -> agents.find { it.id == id }?.name },
        model = activity.model ?: conversation?.model,
    )
}

@Composable
private fun ActivityContextLine(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Text(
        text = "$label: $value",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
