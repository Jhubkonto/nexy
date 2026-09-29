package io.nexy.android.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

enum class SyncStatus {
    SYNCED,
    PENDING,
    FAILED,
    CONFLICT,
}

@Entity(
    tableName = "local_conversations",
    indices = [
        Index("updatedAt"),
        Index("projectId"),
        Index("agentId"),
        Index("syncStatus"),
    ],
)
data class ConversationEntity(
    @PrimaryKey val id: String,
    val title: String,
    val createdAt: Long,
    val updatedAt: Long,
    val agentId: String? = null,
    val agentName: String? = null,
    val agentIcon: String? = null,
    val projectId: String? = null,
    val projectName: String? = null,
    val model: String? = null,
    val conversationHermesProfile: String? = null,
    val thinkingEffortOverride: String? = null,
    val fullAutoApproveOverride: Boolean? = null,
    val agenticModeOverride: Boolean? = null,
    val terminalSandboxOverride: Boolean? = null,
    val cliModeOverride: String? = null,
    val codexExecutionModeOverride: String? = null,
    val lastMessage: String? = null,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val completedAt: Long? = null,
    val kind: String? = null,
    val deleted: Boolean = false,
    val localVersion: Long = 0,
    val remoteVersion: Long = 0,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
)

@Entity(
    tableName = "local_messages",
    indices = [
        Index(value = ["conversationId", "timestamp"]),
        Index("syncStatus"),
    ],
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val conversationId: String,
    val role: String,
    val content: String,
    val model: String? = null,
    val provider: String? = null,
    val finishReason: String? = null,
    val timestamp: Long,
    val timelineOrder: Long? = null,
    val attachmentsJson: String = "[]",
    val thinkingBlocksJson: String = "[]",
    // Ordered response-text bursts when the reply was interrupted by a tool call — mirrors
    // thinkingBlocksJson's shape/purpose but for response text (see HistoryMessage.textSegments).
    val textSegmentsJson: String = "[]",
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val partial: Boolean = false,
    val sendFailed: Boolean = false,
    val deleted: Boolean = false,
    val localVersion: Long = 0,
    val remoteVersion: Long = 0,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
)

@Entity(tableName = "local_agents", indices = [Index("updatedAt"), Index("syncStatus")])
data class AgentEntity(
    @PrimaryKey val id: String,
    val name: String,
    val icon: String,
    val backend: String? = null,
    val cliModel: String? = null,
    val configJson: String = "{}",
    val createdAt: Long,
    val updatedAt: Long,
    val deleted: Boolean = false,
    val localVersion: Long = 0,
    val remoteVersion: Long = 0,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
)

@Entity(tableName = "local_projects", indices = [Index("updatedAt"), Index("syncStatus")])
data class ProjectEntity(
    @PrimaryKey val id: String,
    val name: String,
    val color: String,
    val chatCount: Int = 0,
    val agentIconsJson: String = "[]",
    val rootDirectory: String? = null,
    val configJson: String = "{}",
    val createdAt: Long,
    val updatedAt: Long,
    val deleted: Boolean = false,
    val localVersion: Long = 0,
    val remoteVersion: Long = 0,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
)

/**
 * Prompts, skills and wiki records retain their canonical JSON payload so new optional fields can
 * round-trip through an older Android client without being discarded.
 */
@Entity(
    tableName = "local_library_items",
    primaryKeys = ["kind", "id"],
    indices = [Index("projectId"), Index("updatedAt"), Index("syncStatus")],
)
data class LibraryItemEntity(
    val kind: String,
    val id: String,
    val projectId: String? = null,
    val title: String,
    val body: String,
    val payloadJson: String,
    val createdAt: Long,
    val updatedAt: Long,
    val deleted: Boolean = false,
    val localVersion: Long = 0,
    val remoteVersion: Long = 0,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
)

@Entity(tableName = "local_drafts", indices = [Index("updatedAt")])
data class DraftEntity(
    @PrimaryKey val conversationId: String,
    val text: String,
    val attachmentsJson: String = "[]",
    val updatedAt: Long,
)

@Entity(tableName = "conversation_summaries", indices = [Index("updatedAt")])
data class ConversationSummaryEntity(
    @PrimaryKey val conversationId: String,
    val summary: String,
    val sourceMessageCount: Int,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "sync_outbox",
    indices = [
        Index(value = ["deviceSequence"], unique = true),
        Index("entityId"),
        Index("state"),
    ],
)
data class OutboxEntity(
    @PrimaryKey val operationId: String,
    val deviceId: String,
    val deviceSequence: Long,
    val entityType: String,
    val entityId: String,
    val operation: String,
    val payloadJson: String,
    val baseRemoteVersion: Long,
    val createdAt: Long,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val state: String = "pending",
    val lastError: String? = null,
)

@Entity(tableName = "sync_change_log", indices = [Index(value = ["deviceId", "sequence"], unique = true)])
data class ChangeLogEntity(
    @PrimaryKey val changeId: String,
    val deviceId: String,
    val sequence: Long,
    val entityType: String,
    val entityId: String,
    val operation: String,
    val payloadJson: String,
    val createdAt: Long,
)

@Entity(tableName = "sync_cursors")
data class SyncCursorEntity(
    @PrimaryKey val peerDeviceId: String,
    val lastSentSequence: Long = 0,
    val lastReceivedSequence: Long = 0,
    val lastSuccessfulSyncAt: Long? = null,
    val protocolVersion: Int = 1,
    val lastError: String? = null,
)

@Entity(tableName = "sync_conflicts", indices = [Index("entityId"), Index("resolvedAt")])
data class ConflictEntity(
    @PrimaryKey val id: String,
    val entityType: String,
    val entityId: String,
    val field: String,
    val localValueJson: String,
    val remoteValueJson: String,
    val localVersion: Long,
    val remoteVersion: Long,
    val createdAt: Long,
    val resolvedAt: Long? = null,
    val resolution: String? = null,
)

/**
 * Persistent diagnostic log — the durable backing for the in-memory debug log surfaced in
 * Settings → Debug Log. Survives app restarts so an intermittent failure (e.g. a relayed
 * "Hermes ACP request timed out") can be investigated after the fact. Swept to a one-week
 * retention window on startup so it never grows unbounded.
 */
@Entity(tableName = "diagnostic_logs", indices = [Index("ts")])
data class DiagnosticLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tag: String,
    val message: String,
    val ts: Long,
)

@Entity(tableName = "local_attachments", indices = [Index("messageId"), Index("contentHash")])
data class AttachmentEntity(
    @PrimaryKey val id: String,
    val messageId: String?,
    val displayName: String,
    val mimeType: String,
    val localPath: String?,
    val contentHash: String,
    val sizeBytes: Long,
    val transferState: String = "local",
    val createdAt: Long,
)
