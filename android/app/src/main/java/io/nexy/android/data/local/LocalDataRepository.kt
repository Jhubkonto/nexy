package io.nexy.android.data.local

import android.content.Context
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.CredentialVault
import io.nexy.android.data.parsePromptEntry
import io.nexy.android.data.parseAgentFullConfig
import io.nexy.android.data.parseProjectSettingsConfig
import io.nexy.android.data.parseSkillConfig
import io.nexy.android.data.parseWikiEntry
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.repository.AgentRepository
import io.nexy.android.data.repository.CapabilityState
import io.nexy.android.data.repository.ConversationRepository
import io.nexy.android.data.repository.DataFreshness
import io.nexy.android.data.repository.InternetState
import io.nexy.android.data.repository.MessageRepository
import io.nexy.android.data.repository.ProjectRepository
import io.nexy.android.data.repository.SyncRepository
import java.time.Instant
import java.util.UUID
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import android.util.Base64
import androidx.room.withTransaction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.yield
import org.json.JSONArray
import org.json.JSONObject

data class AttachmentDownload(val contentHash: String, val nextOffset: Long)

/** A newest-first cursor window, returned in chronological order for chat rendering. */
data class LocalHistoryPage(
    val messages: List<HistoryMessage>,
    val hasMore: Boolean,
    val nextBeforeTimestamp: Long?,
    val nextBeforeId: String?,
)

// Pure decision extracted from discardOrphanedOperations() for testability: a failed message-sync
// operation is orphaned if its conversation is gone (never existed locally, or has been tombstoned).
internal fun isOrphanedConversationReference(conversationId: String?, conversationDeleted: Boolean?): Boolean {
    if (conversationId == null) return true
    if (conversationDeleted == null) return true
    return conversationDeleted
}

/**
 * Android's durable source of truth. Remote events are projections into this store; UI consumers
 * never need to discard cached data merely because the desktop connection disappeared.
 */
class LocalDataRepository private constructor(
    context: Context,
) : ConversationRepository, MessageRepository, AgentRepository, ProjectRepository, SyncRepository {
    private val database = NexyDatabase.get(context)
    private val credentialVault = CredentialVault.get(context)
    private val identityStore = DeviceIdentityStore(context)
    private val attachmentDirectory = File(context.filesDir, "standalone-attachments").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val deviceId: String = identityStore.deviceId()

    /** Appends one persistent diagnostic-log row. Best-effort — a logging failure never propagates. */
    suspend fun recordDiagnostic(tag: String, message: String, ts: Long) {
        runCatching { database.diagnostics().insert(DiagnosticLogEntity(tag = tag, message = message, ts = ts)) }
    }

    /** Most-recent persisted diagnostics, newest first, capped at [limit]. */
    suspend fun recentDiagnostics(limit: Int = 500): List<DiagnosticLogEntity> =
        runCatching { database.diagnostics().recent(limit) }.getOrDefault(emptyList())

    /** Deletes diagnostics older than [cutoff] (epoch millis); returns rows removed. */
    suspend fun pruneDiagnostics(cutoff: Long): Int =
        runCatching { database.diagnostics().pruneOlderThan(cutoff) }.getOrDefault(0)

    suspend fun clearDiagnostics() {
        runCatching { database.diagnostics().clear() }
    }

    fun historyVersion(conversationId: String): String? =
        identityStore.historyVersion(conversationId)

    fun saveHistoryVersion(conversationId: String, version: String) =
        identityStore.saveHistoryVersion(conversationId, version)

    suspend fun desktopSyncSequence(datasetId: String): Long =
        database.sync().cursor(datasetId)?.lastReceivedSequence ?: 0L

    suspend fun saveDesktopSyncSequence(datasetId: String, sequence: Long, protocolVersion: Int = 2) {
        if (sequence <= 0) return
        val current = database.sync().cursor(datasetId)
        database.sync().upsertCursor(
            SyncCursorEntity(
                peerDeviceId = datasetId,
                lastSentSequence = current?.lastSentSequence ?: 0,
                lastReceivedSequence = maxOf(current?.lastReceivedSequence ?: 0, sequence),
                lastSuccessfulSyncAt = System.currentTimeMillis(),
                protocolVersion = protocolVersion,
            ),
        )
    }
    private val desktopConnected = MutableStateFlow(false)
    private val internetState = MutableStateFlow(InternetState.UNKNOWN)
    private val lastSuccessfulSyncAt = MutableStateFlow<Long?>(null)

    override val conversations: StateFlow<List<Conversation>> =
        database.conversations().observeAll()
            .map { rows -> rows.map(ConversationEntity::toModel) }
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    override val agents: StateFlow<List<Agent>> =
        database.agents().observeAll()
            .map { rows -> rows.map(AgentEntity::toModel) }
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    override val projects: StateFlow<List<Project>> =
        database.projects().observeAll()
            .map { rows -> rows.map(ProjectEntity::toModel) }
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    val wikiEntries: StateFlow<List<WikiEntry>> =
        database.library().observeKind("wiki")
            .map { rows -> rows.mapNotNull { runCatching { parseWikiEntry(JSONObject(it.payloadJson)) }.getOrNull() } }
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    val promptEntries: StateFlow<List<PromptEntry>> =
        database.library().observeKind("prompt")
            .map { rows -> rows.mapNotNull { runCatching { parsePromptEntry(JSONObject(it.payloadJson)) }.getOrNull() } }
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    val skills: StateFlow<List<SkillConfig>> =
        database.library().observeKind("skill")
            .map { rows -> rows.mapNotNull { runCatching { parseSkillConfig(JSONObject(it.payloadJson)) }.getOrNull() } }
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    override val outbox: StateFlow<List<OutboxEntity>> =
        database.sync().observeOutbox()
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    override val conflicts: StateFlow<List<ConflictEntity>> =
        database.sync().observeConflicts()
            .stateIn(scope, SharingStarted.Eagerly, emptyList())

    override val capabilities: StateFlow<CapabilityState> =
        combine(outbox, conflicts, desktopConnected, internetState, lastSuccessfulSyncAt) {
                pending, currentConflicts, connected, internet, lastSync ->
            CapabilityState(
                desktopConnected = connected,
                internetState = internet,
                freshness = when {
                    pending.isNotEmpty() -> DataFreshness.LOCAL_ONLY
                    connected -> DataFreshness.CURRENT
                    else -> DataFreshness.STALE
                },
                pendingChanges = pending.count { it.state == "pending" },
                failedChanges = pending.count { it.state == "failed" },
                conflicts = currentConflicts.size,
                lastSuccessfulSyncAt = lastSync,
            )
        }.stateIn(scope, SharingStarted.Eagerly, CapabilityState())

    fun setDesktopConnected(connected: Boolean) {
        desktopConnected.value = connected
    }

    fun setInternetState(state: InternetState) {
        internetState.value = state
    }

    fun bindDataset(datasetId: String): Boolean = identityStore.bindDataset(datasetId)

    override fun observe(conversationId: String): Flow<List<HistoryMessage>> =
        database.messages().observeForConversation(conversationId)
            .map { rows -> rows.map(MessageEntity::toModel) }

    override suspend fun list(conversationId: String): List<HistoryMessage> =
        database.messages().getForConversation(conversationId).map(MessageEntity::toModel)

    /**
     * Reads just one history window from Room. The database query runs newest-first so it can use
     * its ordering directly; the result is reversed before returning because the chat timeline is
     * chronological.
     */
    suspend fun listPage(
        conversationId: String,
        limit: Int,
        beforeTimestamp: Long? = null,
        beforeId: String? = null,
    ): LocalHistoryPage {
        val pageSize = limit.coerceIn(1, 100)
        val rows = database.messages().getPageForConversation(
            conversationId = conversationId,
            limit = pageSize + 1,
            beforeTimestamp = beforeTimestamp,
            beforeId = beforeId,
        )
        val hasMore = rows.size > pageSize
        val pageRows = if (hasMore) rows.dropLast(1) else rows
        val oldest = pageRows.lastOrNull()
        return LocalHistoryPage(
            messages = pageRows.asReversed().map(MessageEntity::toModel),
            hasMore = hasMore,
            nextBeforeTimestamp = oldest?.timestamp,
            nextBeforeId = oldest?.id,
        )
    }

    /**
     * Returns the ids of the top [limit] conversations (same ordering as the Home list) that have no
     * cached message bodies yet. Used to drive a bounded post-connect prefetch: after a shell
     * snapshot the most-likely taps still cost a round-trip, so warming just these into Room makes
     * them open instantly. Conversations already carrying bodies (full-mode snapshot, or previously
     * opened) are skipped so this is a no-op when there is nothing to warm.
     */
    suspend fun conversationsNeedingPrefetch(limit: Int): List<String> =
        database.conversations().topConversationIds(limit)
            .filter { database.messages().countForConversation(it) == 0 }

    suspend fun getRetryableUserMessage(id: String, conversationId: String): HistoryMessage? =
        database.messages().get(id)
            ?.takeIf { it.conversationId == conversationId && it.role == "user" && !it.deleted }
            ?.toModel()

    suspend fun listForProvider(conversationId: String, retryMessageId: String?): List<HistoryMessage> =
        database.messages().getForConversation(conversationId)
            .filter { !it.sendFailed || it.id == retryMessageId }
            .map(MessageEntity::toModel)

    override suspend fun createConversation(title: String, agentId: String?, projectId: String?): Conversation {
        val now = System.currentTimeMillis()
        val entity = ConversationEntity(
            id = UUID.randomUUID().toString(),
            title = title.ifBlank { "New Chat" },
            createdAt = now,
            updatedAt = now,
            agentId = agentId,
            projectId = projectId,
            localVersion = 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.conversations().upsert(entity)
            enqueue("conversation", entity.id, "upsert", entity.toSyncJson(), 0)
        }
        return entity.toModel()
    }

    override suspend fun renameConversation(id: String, title: String) {
        val current = database.conversations().get(id) ?: return
        val normalizedTitle = title.trim().take(MAX_CONVERSATION_TITLE_LENGTH)
        if (normalizedTitle.isBlank()) return
        val updated = current.copy(
            title = normalizedTitle,
            updatedAt = System.currentTimeMillis(),
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.conversations().upsert(updated)
            enqueue("conversation", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
    }

    override suspend fun setConversationPinned(id: String, pinned: Boolean) {
        val current = database.conversations().get(id) ?: return
        val updated = current.copy(
            pinned = pinned,
            updatedAt = System.currentTimeMillis(),
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.conversations().upsert(updated)
            enqueue("conversation", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
    }

    override suspend fun archiveConversation(id: String) {
        val current = database.conversations().get(id) ?: return
        val now = System.currentTimeMillis()
        val updated = current.copy(
            archived = true,
            updatedAt = now,
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.conversations().upsert(updated)
            enqueue("conversation", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
    }

    override suspend fun deleteConversation(id: String) {
        val current = database.conversations().get(id) ?: return
        val now = System.currentTimeMillis()
        database.withTransaction {
            database.conversations().tombstone(id, now)
            enqueue("conversation", id, "delete", JSONObject().put("id", id).put("deletedAt", now).toString(), current.remoteVersion)
            // Cancel any outstanding sync operations for this conversation's messages — they can
            // never be meaningfully applied once the conversation itself is gone, and left
            // unresolved they fail identically forever (e.g. a foreign-key rejection on the
            // desktop) every time a retry resends the same now-orphaned payload.
            cancelOutboxForConversationMessages(id)
        }
    }

    private suspend fun cancelOutboxForConversationMessages(conversationId: String) {
        val messageIds = database.messages().idsForConversation(conversationId)
        if (messageIds.isEmpty()) return
        val staleOps = database.sync().outboxForEntities("message", messageIds)
        staleOps.forEach { op ->
            database.messages().markSynced(op.entityId)
            database.sync().acknowledge(listOf(op.operationId))
            database.sync().discardChange(op.operationId)
        }
    }

    // Runs after a batch sync failure: a "sync:error" from the desktop aborts the whole batch, so
    // every currently-pending operation gets marked failed even though only one may actually be
    // broken. This sweep tells the two apart — an operation referencing a conversation that no
    // longer exists locally can never succeed and is discarded silently. Everything else was just
    // collateral damage and was already left in "failed" state with a proper exponential backoff
    // by markFailed() moments earlier; it must NOT be touched here. Calling retryOperation() on it
    // would reset nextAttemptAt to 0, undoing that backoff and making it instantly eligible again —
    // combined with the flushStandaloneOutbox() call right after this sweep, that previously caused
    // an infinite push/error/retry loop for any non-orphaned failure. It retries on its own, with no
    // user action, once its backoff naturally elapses on a future flush trigger.
    suspend fun discardOrphanedOperations() {
        val failedOps = database.sync().failedOutbox()
        for (op in failedOps) {
            val orphaned = if (op.entityType == "message") {
                val conversationId = database.messages().get(op.entityId)?.conversationId
                val conversationDeleted = conversationId?.let { database.conversations().get(it)?.deleted }
                isOrphanedConversationReference(conversationId, conversationDeleted)
            } else {
                false
            }
            if (orphaned) {
                discardOperation(op.operationId)
            }
        }
    }

    override suspend fun searchConversations(query: String): List<Conversation> =
        database.conversations().search(query.trim()).map(ConversationEntity::toModel)

    suspend fun forkConversation(
        conversationId: String,
        cutoffTimestamp: Long?,
        targetProjectId: String? = null,
        projectWasSelected: Boolean = false,
    ): Pair<Conversation, Int>? {
        val source = database.conversations().get(conversationId) ?: return null
        if (projectWasSelected && targetProjectId != null && projects.value.none { it.id == targetProjectId }) {
            throw IllegalArgumentException("Target project not found.")
        }
        val sourceMessages = database.messages().getForConversation(conversationId)
            .filter { cutoffTimestamp == null || it.timestamp <= cutoffTimestamp }
            .filterNot { message ->
                message.role == "tool-call" ||
                    message.role == "team-activity" ||
                    (
                        message.role == "system" &&
                            (
                                message.content.trimStart().startsWith("[Portable tool-call summary]") ||
                                    message.content.trimStart().startsWith("[Portable team-activity summary]")
                            )
                    )
            }
        val now = System.currentTimeMillis()
        val forkTitle = "${source.title.removeSuffix(" (branch)")} (branch)"
        val fork = source.copy(
            id = UUID.randomUUID().toString(),
            title = forkTitle,
            createdAt = now,
            updatedAt = now,
            lastMessage = sourceMessages.lastOrNull()?.content,
            projectId = if (projectWasSelected) targetProjectId else source.projectId,
            projectName = if (projectWasSelected) {
                targetProjectId?.let { id -> projects.value.firstOrNull { it.id == id }?.name }
            } else {
                source.projectName
            },
            pinned = false,
            completedAt = null,
            deleted = false,
            localVersion = 1,
            remoteVersion = 0,
            syncStatus = SyncStatus.PENDING,
        )
        val copies = sourceMessages.map { message ->
            message.copy(
                id = UUID.randomUUID().toString(),
                conversationId = fork.id,
                localVersion = 1,
                remoteVersion = 0,
                syncStatus = SyncStatus.PENDING,
            )
        }
        database.withTransaction {
            database.conversations().upsert(fork)
            database.messages().upsertAll(copies)
            enqueue("conversation", fork.id, "upsert", fork.toSyncJson(), 0)
            copies.forEach { enqueue("message", it.id, "upsert", it.toSyncJson(), 0) }
        }
        return fork.toModel() to copies.size
    }

    override suspend fun insertMessage(
        conversationId: String,
        role: String,
        content: String,
        timestamp: Long,
        partial: Boolean,
        attachments: List<AttachmentMeta>,
        thinkingBlocks: List<ThinkingBlock>,
    ): HistoryMessage {
        val entity = MessageEntity(
            id = UUID.randomUUID().toString(),
            conversationId = conversationId,
            role = role,
            content = content,
            timestamp = timestamp,
            attachmentsJson = attachments.toAttachmentsJson(),
            thinkingBlocksJson = thinkingBlocks.toThinkingBlocksJson(),
            partial = partial,
            localVersion = 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.messages().upsert(entity)
            database.conversations().get(conversationId)?.let {
                database.conversations().upsert(
                    it.copy(lastMessage = content, updatedAt = timestamp),
                )
            }
            enqueue("message", entity.id, "upsert", entity.toSyncJson(), 0)
        }
        return entity.toModel()
    }

    suspend fun persistImageAttachments(messageId: String, images: List<Map<*, *>>) {
        images.forEach { image ->
            val dataUrl = image["dataUrl"] as? String ?: return@forEach
            val comma = dataUrl.indexOf(',')
            if (comma <= 5 || !dataUrl.substring(0, comma).endsWith(";base64")) return@forEach
            val mimeType = dataUrl.substring(5, comma).removeSuffix(";base64")
            val bytes = runCatching { Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT) }.getOrNull()
                ?: return@forEach
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            val existing = database.attachments().byHash(hash)
            val path = existing?.localPath ?: File(attachmentDirectory, hash).also { file ->
                if (!file.exists()) file.writeBytes(bytes)
            }.absolutePath
            database.attachments().upsert(
                AttachmentEntity(
                    id = image["id"] as? String ?: UUID.randomUUID().toString(),
                    messageId = messageId,
                    displayName = image["name"] as? String ?: "image",
                    mimeType = mimeType,
                    localPath = path,
                    contentHash = hash,
                    sizeBytes = bytes.size.toLong(),
                    transferState = "pending",
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    suspend fun pendingAttachmentUploads(): List<AttachmentEntity> = database.attachments().pendingUploads()

    suspend fun attachmentChunk(hash: String, offset: Long): String? {
        val attachment = database.attachments().byHash(hash) ?: return null
        val file = attachment.localPath?.let(::File)?.takeIf(File::isFile) ?: return null
        if (!file.canonicalPath.startsWith(attachmentDirectory.canonicalPath)) return null
        if (offset < 0 || offset > file.length()) return null
        val length = minOf(64 * 1024L, file.length() - offset).toInt()
        val bytes = ByteArray(length)
        file.inputStream().use {
            if (offset > 0) it.skip(offset)
            var read = 0
            while (read < length) {
                val count = it.read(bytes, read, length - read)
                if (count < 0) break
                read += count
            }
        }
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    suspend fun markAttachmentTransferred(hash: String) {
        database.attachments().updateTransfer(hash, "synced")
    }

    suspend fun prepareAttachmentDownloads(snapshot: JSONObject): List<AttachmentDownload> {
        val manifests = snapshot.optJSONArray("attachments") ?: return emptyList()
        val downloads = mutableListOf<AttachmentDownload>()
        manifests.forEachObject { manifest ->
            val hash = manifest.optString("contentHash")
            val size = manifest.optLong("sizeBytes", -1)
            if (!hash.matches(Regex("^[a-f0-9]{64}$")) || size !in 0..20L * 1024L * 1024L) return@forEachObject
            val target = File(attachmentDirectory, "$hash.download")
            val existing = database.attachments().byHash(hash)
            val completed = existing?.localPath?.let(::File)?.takeIf(File::isFile)
                ?.takeIf { it.length() == size && it.sha256() == hash }
            if (completed != null) {
                database.attachments().updateTransfer(hash, "synced", completed.absolutePath)
                return@forEachObject
            }
            if (target.length() > size) target.delete()
            database.attachments().upsert(
                AttachmentEntity(
                    id = existing?.id ?: manifest.nullableString("attachmentId") ?: UUID.randomUUID().toString(),
                    messageId = existing?.messageId ?: manifest.nullableString("messageId"),
                    displayName = manifest.optString("displayName", "attachment"),
                    mimeType = manifest.optString("mimeType", "application/octet-stream"),
                    localPath = target.absolutePath,
                    contentHash = hash,
                    sizeBytes = size,
                    transferState = "downloading",
                    createdAt = existing?.createdAt ?: System.currentTimeMillis(),
                ),
            )
            downloads += AttachmentDownload(hash, target.length())
        }
        return downloads
    }

    suspend fun appendAttachmentChunk(
        hash: String,
        expectedSize: Long,
        offset: Long,
        dataBase64: String,
        complete: Boolean,
    ): AttachmentDownload? {
        val attachment = database.attachments().byHash(hash) ?: return null
        val file = attachment.localPath?.let(::File) ?: return null
        val bytes = runCatching { Base64.decode(dataBase64, Base64.DEFAULT) }.getOrNull() ?: return null
        if (bytes.size > 64 * 1024 || file.length() != offset || expectedSize != attachment.sizeBytes) {
            return AttachmentDownload(hash, file.length())
        }
        FileOutputStream(file, true).use { it.write(bytes) }
        val reachedEnd = file.length() == expectedSize
        if (complete && reachedEnd && file.sha256() != hash) {
            file.delete()
            database.attachments().updateTransfer(hash, "downloading", file.absolutePath)
            return AttachmentDownload(hash, 0)
        }
        val done = complete && reachedEnd
        if (done) {
            val finalFile = File(attachmentDirectory, hash)
            if (finalFile.exists()) finalFile.delete()
            check(file.renameTo(finalFile)) { "Unable to finalize attachment download." }
            database.attachments().updateTransfer(hash, "synced", finalFile.absolutePath)
        }
        return if (done) null else AttachmentDownload(hash, file.length())
    }

    override suspend fun updateMessageContent(id: String, content: String, partial: Boolean, sendFailed: Boolean) {
        val current = database.messages().get(id) ?: return
        val updated = current.copy(
            content = content,
            partial = partial,
            sendFailed = sendFailed,
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.messages().upsert(updated)
            enqueue("message", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
    }

    suspend fun finalizeAssistantMessage(
        id: String,
        content: String,
        thinkingBlocks: List<ThinkingBlock>,
        inputTokens: Int,
        outputTokens: Int,
        provider: String,
        model: String,
        finishReason: String?,
    ) {
        val current = database.messages().get(id) ?: return
        val updated = current.copy(
            content = content,
            thinkingBlocksJson = thinkingBlocks.toThinkingBlocksJson(),
            inputTokens = inputTokens,
            outputTokens = outputTokens,
            provider = provider,
            model = model,
            finishReason = finishReason,
            partial = false,
            sendFailed = false,
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.messages().upsert(updated)
            enqueue("message", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
    }

    override suspend fun deleteMessage(id: String) {
        val current = database.messages().get(id) ?: return
        database.withTransaction {
            database.messages().tombstone(id)
            enqueue("message", id, "delete", JSONObject().put("id", id).toString(), current.remoteVersion)
        }
    }

    override suspend fun deleteMessagesAfter(conversationId: String, timestamp: Long) {
        val affected = database.messages().getForConversation(conversationId).filter { it.timestamp >= timestamp }
        database.withTransaction {
            database.messages().tombstoneAfter(conversationId, timestamp)
            affected.forEach {
                enqueue("message", it.id, "delete", JSONObject().put("id", it.id).toString(), it.remoteVersion)
            }
        }
    }

    override suspend fun createAgent(name: String, icon: String): Agent {
        val now = System.currentTimeMillis()
        val entity = AgentEntity(
            id = UUID.randomUUID().toString(),
            name = name,
            icon = icon,
            createdAt = now,
            updatedAt = now,
            localVersion = 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.agents().upsert(entity)
            enqueue("agent", entity.id, "upsert", entity.toSyncJson(), 0)
        }
        return entity.toModel()
    }

    override suspend fun updateAgent(id: String, name: String, icon: String) {
        val current = database.agents().get(id) ?: return
        val updated = current.copy(
            name = name,
            icon = icon,
            updatedAt = System.currentTimeMillis(),
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.agents().upsert(updated)
            enqueue("agent", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
    }

    override suspend fun deleteAgent(id: String) {
        val current = database.agents().get(id) ?: return
        val now = System.currentTimeMillis()
        database.withTransaction {
            database.agents().tombstone(id, now)
            enqueue("agent", id, "delete", JSONObject().put("id", id).put("deletedAt", now).toString(), current.remoteVersion)
        }
    }

    override suspend fun createProject(name: String, color: String): Project {
        val now = System.currentTimeMillis()
        val entity = ProjectEntity(
            id = UUID.randomUUID().toString(),
            name = name,
            color = color,
            createdAt = now,
            updatedAt = now,
            localVersion = 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.projects().upsert(entity)
            enqueue("project", entity.id, "upsert", entity.toSyncJson(), 0)
        }
        return entity.toModel()
    }

    override suspend fun renameProject(id: String, name: String, color: String?) {
        val current = database.projects().get(id) ?: return
        val updated = current.copy(
            name = name,
            color = color ?: current.color,
            updatedAt = System.currentTimeMillis(),
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.projects().upsert(updated)
            enqueue("project", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
    }

    override suspend fun deleteProject(id: String, deleteChats: Boolean) {
        val current = database.projects().get(id) ?: return
        val now = System.currentTimeMillis()
        database.withTransaction {
            if (deleteChats) {
                database.conversations().byProject(id).forEach { conversation ->
                    database.conversations().tombstone(conversation.id, now)
                    enqueue(
                        "conversation",
                        conversation.id,
                        "delete",
                        JSONObject().put("id", conversation.id).put("deletedAt", now).toString(),
                        conversation.remoteVersion,
                    )
                    cancelOutboxForConversationMessages(conversation.id)
                }
            }
            database.projects().tombstone(id, now)
            enqueue("project", id, "delete", JSONObject().put("id", id).put("deletedAt", now).toString(), current.remoteVersion)
        }
    }

    override suspend fun pendingBatch(limit: Int): List<OutboxEntity> =
        database.sync().pendingOutbox(System.currentTimeMillis(), limit)

    override suspend fun acknowledge(operationIds: List<String>) {
        if (operationIds.isNotEmpty()) {
            val operations = outbox.value.filter { it.operationId in operationIds }
            database.withTransaction {
                operations.forEach { operation ->
                    when (operation.entityType) {
                        "conversation" -> database.conversations().markSynced(operation.entityId)
                        "message" -> database.messages().markSynced(operation.entityId)
                        "agent" -> database.agents().markSynced(operation.entityId)
                        "project" -> database.projects().markSynced(operation.entityId)
                        "wiki", "prompt", "skill" -> database.library().markSynced(operation.entityType, operation.entityId)
                    }
                }
                database.sync().acknowledge(operationIds)
                val firstRemaining = database.sync().minOutboxSequence(deviceId)
                val compactThrough = firstRemaining?.minus(1) ?: operations.maxOfOrNull { it.deviceSequence }
                if (compactThrough != null && compactThrough > 0) {
                    database.sync().compactChanges(deviceId, compactThrough)
                }
            }
        }
        lastSuccessfulSyncAt.value = System.currentTimeMillis()
    }

    override suspend fun markFailed(operationId: String, error: String) {
        val operation = outbox.value.firstOrNull { it.operationId == operationId }
        val attempts = (operation?.attempts ?: 0) + 1
        val delay = (1_000L shl attempts.coerceAtMost(6)).coerceAtMost(60_000L)
        database.sync().markFailed(operationId, System.currentTimeMillis() + delay, error)
    }

    suspend fun retryOperation(operationId: String) {
        database.sync().retry(operationId)
    }

    suspend fun discardOperation(operationId: String) {
        database.withTransaction {
            val operation = database.sync().outboxOperation(operationId) ?: return@withTransaction
            when (operation.entityType) {
                "conversation" -> database.conversations().markSynced(operation.entityId)
                "message" -> database.messages().markSynced(operation.entityId)
                "agent" -> database.agents().markSynced(operation.entityId)
                "project" -> database.projects().markSynced(operation.entityId)
                "wiki", "prompt", "skill" -> database.library().markSynced(operation.entityType, operation.entityId)
            }
            database.sync().acknowledge(listOf(operationId))
            database.sync().discardChange(operationId)
        }
    }

    override suspend fun resolveConflict(conflictId: String, resolution: String) {
        val conflict = database.sync().conflict(conflictId)
        database.withTransaction {
            if (conflict != null && conflict.resolvedAt == null) {
                applyConflictResolution(conflict, resolution)
            }
            database.sync().resolveConflict(conflictId, resolution, System.currentTimeMillis())
        }
    }

    /**
     * Reconcile the entity a resolved conflict points at so the sheet clearing also fixes the data
     * behind it — otherwise "resolving" only hid the row while leaving the entity stuck in
     * [SyncStatus.CONFLICT]. Resolution vocabulary follows the desktop's perspective: "remote" means
     * this device's queued value wins, "local" means the desktop value wins.
     */
    private suspend fun applyConflictResolution(conflict: ConflictEntity, resolution: String) {
        val deviceValueWins = resolution == "remote"
        when (conflict.entityType) {
            "conversation" -> {
                val current = database.conversations().get(conflict.entityId) ?: return
                if (deviceValueWins) {
                    // Keep our value and re-queue the push so the desktop adopts it.
                    val updated = current.copy(
                        localVersion = current.localVersion + 1,
                        syncStatus = SyncStatus.PENDING,
                    )
                    database.conversations().upsert(updated)
                    enqueue("conversation", current.id, "upsert", updated.toSyncJson(), current.remoteVersion)
                } else {
                    val remoteTitle = decodeConflictValue(conflict.remoteValueJson)
                    database.conversations().upsert(
                        current.copy(
                            title = if (conflict.field == "title") remoteTitle else current.title,
                            syncStatus = SyncStatus.SYNCED,
                        ),
                    )
                }
            }
            // Other entity types simply clear the conflict flag; the next desktop snapshot
            // reconciles their fields authoritatively.
            "agent" -> database.agents().get(conflict.entityId)?.let {
                database.agents().upsert(it.copy(syncStatus = if (deviceValueWins) SyncStatus.PENDING else SyncStatus.SYNCED))
            }
            "project" -> database.projects().get(conflict.entityId)?.let {
                database.projects().upsert(it.copy(syncStatus = if (deviceValueWins) SyncStatus.PENDING else SyncStatus.SYNCED))
            }
            "message" -> database.messages().get(conflict.entityId)?.let {
                database.messages().upsert(it.copy(syncStatus = if (deviceValueWins) SyncStatus.PENDING else SyncStatus.SYNCED))
            }
        }
    }

    /** Values are stored JSON-quoted (see [recordConflict]); decode back to the raw string. */
    private fun decodeConflictValue(json: String): String =
        runCatching { org.json.JSONTokener(json).nextValue() as? String }.getOrNull() ?: json

    suspend fun saveDraft(conversationId: String, text: String, attachmentsJson: String = "[]") {
        if (text.isBlank() && attachmentsJson == "[]") {
            database.drafts().delete(conversationId)
        } else {
            database.drafts().upsert(DraftEntity(conversationId, text, attachmentsJson, System.currentTimeMillis()))
        }
    }

    fun observeDraft(conversationId: String): Flow<DraftEntity?> = database.drafts().observe(conversationId)

    suspend fun clearDraft(conversationId: String) = database.drafts().delete(conversationId)

    suspend fun getConversationSummary(conversationId: String): ConversationSummaryEntity? =
        database.summaries().get(conversationId)

    suspend fun saveConversationSummary(conversationId: String, summary: String, sourceMessageCount: Int) {
        val current = database.summaries().get(conversationId)
        val now = System.currentTimeMillis()
        database.summaries().upsert(
            ConversationSummaryEntity(
                conversationId = conversationId,
                summary = summary,
                sourceMessageCount = sourceMessageCount,
                createdAt = current?.createdAt ?: now,
                updatedAt = now,
            ),
        )
    }

    suspend fun ensureConversation(
        id: String,
        title: String = "New Chat",
        agentId: String? = null,
        projectId: String? = null,
    ): Conversation {
        database.conversations().get(id)?.let { return it.toModel() }
        val now = System.currentTimeMillis()
        val entity = ConversationEntity(
            id = id,
            title = title,
            createdAt = now,
            updatedAt = now,
            agentId = agentId,
            projectId = projectId,
            localVersion = 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.conversations().upsert(entity)
            enqueue("conversation", id, "upsert", entity.toSyncJson(), 0)
        }
        return entity.toModel()
    }

    suspend fun markMessageFailed(id: String, failed: Boolean) {
        val current = database.messages().get(id) ?: return
        database.messages().upsert(current.copy(sendFailed = failed, partial = false))
    }

    suspend fun recoverInterruptedTurns() {
        database.messages().recoverInterruptedTurns()
    }

    suspend fun applySyncSnapshot(
        snapshot: JSONObject,
        priorityConversationId: String? = null,
        onProgress: (completed: Int, total: Int) -> Unit = { _, _ -> },
    ) {
        val versions = snapshot.optJSONObject("versions") ?: JSONObject()
        val synchronizedArrays = listOf("projects", "agents", "conversations", "messages", "wiki", "prompts", "skills")
        val total = synchronizedArrays.sumOf { snapshot.optJSONArray(it)?.length() ?: 0 }
        var completed = 0
        fun reportItemApplied() {
            completed += 1
            onProgress(completed, total)
        }
        onProgress(0, total)

        snapshot.optJSONArray("projects")?.forEachObjectBatched(database) { row ->
            val id = row.optString("id")
            if (id.isBlank()) return@forEachObjectBatched
            val current = database.projects().get(id)
            val fields = projectFieldsFromSnapshotRow(row)
            val remoteVersion = versions.optLong("project:$id", 1L)
            val remote = ProjectEntity(
                id = id,
                name = fields.name,
                color = fields.color,
                rootDirectory = fields.rootDirectory,
                configJson = fields.configJson,
                createdAt = row.optLong("created_at", System.currentTimeMillis()),
                updatedAt = row.optLong("updated_at", System.currentTimeMillis()),
                remoteVersion = remoteVersion,
            )
            if (current?.syncStatus == SyncStatus.PENDING) {
                if (current.name != remote.name || current.color != remote.color) {
                    recordConflict("project", id, "config", current.toSyncJson(), remote.toSyncJson(), current.localVersion, remoteVersion)
                    database.projects().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remoteVersion))
                } else {
                    database.projects().upsert(current.copy(remoteVersion = remoteVersion))
                }
            } else {
                database.projects().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
            }
            reportItemApplied()
        }

        snapshot.optJSONArray("agents")?.forEachObjectBatched(database) { row ->
            val id = row.optString("id")
            if (id.isBlank()) return@forEachObjectBatched
            val current = database.agents().get(id)
            val fields = agentFieldsFromSnapshotRow(row)
            val remoteVersion = versions.optLong("agent:$id", 1L)
            val remote = AgentEntity(
                id = id,
                name = fields.name,
                icon = fields.icon,
                backend = fields.backend,
                cliModel = fields.cliModel,
                configJson = fields.configJson,
                createdAt = row.optLong("created_at", System.currentTimeMillis()),
                updatedAt = row.optLong("updated_at", System.currentTimeMillis()),
                remoteVersion = remoteVersion,
            )
            if (current?.syncStatus == SyncStatus.PENDING) {
                if (current.name != remote.name || current.icon != remote.icon) {
                    recordConflict("agent", id, "config", current.toSyncJson(), remote.toSyncJson(), current.localVersion, remoteVersion)
                    database.agents().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remoteVersion))
                } else {
                    database.agents().upsert(current.copy(remoteVersion = remoteVersion))
                }
            } else {
                database.agents().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
            }
            reportItemApplied()
        }

        snapshot.optJSONArray("conversations")?.forEachObjectBatched(database) { row ->
            val id = row.optString("id")
            if (id.isBlank()) return@forEachObjectBatched
            val current = database.conversations().get(id)
            val remoteVersion = versions.optLong("conversation:$id", 1L)
            val remote = ConversationEntity(
                id = id,
                title = row.optString("title", "New Chat"),
                createdAt = row.optLong("created_at", System.currentTimeMillis()),
                updatedAt = row.optLong("updated_at", System.currentTimeMillis()),
                agentId = row.nullableString("agent_id"),
                agentName = row.nullableString("agent_name"),
                agentIcon = row.nullableString("agent_icon"),
                projectId = row.nullableString("project_id"),
                projectName = row.nullableString("project_name"),
                model = row.nullableString("model"),
                conversationHermesProfile = row.nullableString("conversation_hermes_profile"),
                thinkingEffortOverride = row.nullableString("thinking_effort_override"),
                fullAutoApproveOverride = row.nullableBoolean("full_auto_approve_override"),
                agenticModeOverride = row.nullableBoolean("agentic_mode_override"),
                terminalSandboxOverride = row.nullableBoolean("terminal_sandbox_override"),
                cliModeOverride = row.nullableString("cli_mode_override"),
                codexExecutionModeOverride = row.nullableString("codex_execution_mode_override"),
                lastMessage = row.nullableString("last_message"),
                pinned = row.optInt("pinned", 0) != 0,
                archived = row.optInt("archived", 0) != 0,
                completedAt = row.nullableLong("completed_at"),
                kind = row.nullableString("kind"),
                remoteVersion = remoteVersion,
            )
            if (current?.syncStatus == SyncStatus.PENDING) {
                if (current.title != remote.title && !isPlaceholderTitle(current.title)) {
                    recordConflict("conversation", id, "title", current.title, remote.title, current.localVersion, remoteVersion)
                    database.conversations().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remoteVersion))
                } else {
                    // Titles match, or the local title is still the placeholder the desktop just
                    // auto-named — adopt the desktop title. The pending creation stays queued.
                    database.conversations().upsert(current.copy(title = remote.title, remoteVersion = remoteVersion))
                }
            } else {
                database.conversations().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
            }
            reportItemApplied()
        }

        yield()
        val messageRows = snapshot.optJSONArray("messages")?.let { array ->
            (0 until array.length()).mapNotNull(array::optJSONObject)
        }.orEmpty().sortedBy { row ->
            if (priorityConversationId != null && row.optString("conversation_id") == priorityConversationId) 0 else 1
        }
        messageRows.chunked(50).forEach { chunk ->
            database.withTransaction {
                chunk.forEach { row ->
                    mergeSnapshotMessage(row, versions)
                    reportItemApplied()
                }
            }
            yield()
        }

        snapshot.optJSONArray("wiki")?.forEachObjectBatched(database) { row ->
            val entry = parseWikiEntry(row)
            mergeSnapshotLibrary(
                kind = "wiki",
                id = entry.id,
                projectId = entry.projectId,
                title = entry.title,
                body = entry.body,
                payload = entry.toJson(),
                createdAt = entry.createdAt,
                updatedAt = entry.updatedAt,
                remoteVersion = versions.optLong("wiki:${entry.id}", 1L),
            )
            reportItemApplied()
        }
        snapshot.optJSONArray("prompts")?.forEachObjectBatched(database) { row ->
            val entry = parsePromptEntry(row)
            mergeSnapshotLibrary(
                kind = "prompt",
                id = entry.id,
                projectId = entry.projectId,
                title = entry.title,
                body = entry.body,
                payload = entry.toJson(),
                createdAt = entry.createdAt,
                updatedAt = entry.updatedAt,
                remoteVersion = versions.optLong("prompt:${entry.id}", 1L),
            )
            reportItemApplied()
        }
        snapshot.optJSONArray("skills")?.forEachObjectBatched(database) { row ->
            val skill = parseSkillConfig(row)
            mergeSnapshotLibrary(
                kind = "skill",
                id = skill.id,
                projectId = null,
                title = skill.name,
                body = skill.instructions,
                payload = skill.toJson(),
                createdAt = skill.createdAt ?: 0,
                updatedAt = skill.updatedAt ?: 0,
                remoteVersion = versions.optLong("skill:${skill.id}", 1L),
            )
            reportItemApplied()
        }

        applyTombstones(snapshot.optJSONArray("tombstones"))
        applySyncConflicts(snapshot.optJSONArray("conflicts")?.toString() ?: "[]")
        // These arrays contain metadata and permission scopes only. Credential payloads remain
        // device-local in the Keystore-backed vault.
        credentialVault.applyRemoteMetadata(
            snapshot.optJSONArray("credentials"),
            snapshot.optJSONArray("credentialBindings"),
        )
        lastSuccessfulSyncAt.value = System.currentTimeMillis()
    }

    /** Persists arbitrary mobile data-URL attachments in the same content-addressed store used by
     * images, so PDFs, archives, and office files remain first-class message attachments. */
    suspend fun persistDataUrlAttachments(messageId: String, attachments: List<Map<*, *>>) {
        persistImageAttachments(messageId, attachments)
    }

    suspend fun applySyncSnapshot(snapshotJson: String, priorityConversationId: String? = null) {
        applySyncSnapshot(JSONObject(snapshotJson), priorityConversationId)
    }

    private suspend fun mergeSnapshotMessage(row: JSONObject, versions: JSONObject) {
        val id = row.optString("id")
        if (id.isBlank()) return
        val current = database.messages().get(id)
        val remoteVersion = versions.optLong("message:$id", 1L)
        val remote = MessageEntity(
            id = id,
            conversationId = row.optString("conversation_id"),
            role = row.optString("role"),
            content = row.optString("content"),
            model = row.nullableString("model"),
            provider = row.nullableString("provider"),
            finishReason = row.nullableString("finish_reason") ?: row.nullableString("finishReason"),
            timestamp = row.optLong("timestamp", System.currentTimeMillis()),
            timelineOrder = row.takeUnless { it.isNull("timeline_order") }?.optLong("timeline_order"),
            attachmentsJson = row.jsonArrayOrString("attachments")?.toString() ?: "[]",
            thinkingBlocksJson = row.jsonArrayOrString("thinking_blocks")?.toString() ?: "[]",
            textSegmentsJson = row.jsonArrayOrString("text_segments")?.toString() ?: "[]",
            inputTokens = row.optInt("input_tokens", 0),
            outputTokens = row.optInt("output_tokens", 0),
            remoteVersion = remoteVersion,
        )
        if (current?.syncStatus == SyncStatus.PENDING) {
            if (current.content != remote.content) {
                recordConflict("message", id, "content", current.content, remote.content, current.localVersion, remoteVersion)
                database.messages().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remoteVersion))
            } else {
                database.messages().upsert(current.copy(remoteVersion = remoteVersion))
            }
        } else {
            database.messages().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
        }
    }

    suspend fun applySyncConflicts(conflictsJson: String) {
        val conflicts = runCatching { JSONArray(conflictsJson) }.getOrElse { return }
        conflicts.forEachObject { item ->
            val id = item.optString("id")
            if (id.isBlank()) return@forEachObject
            database.sync().upsertConflict(
                ConflictEntity(
                    id = id,
                    entityType = item.optString("entityType"),
                    entityId = item.optString("entityId"),
                    field = item.optString("field", "*"),
                    localValueJson = item.optString("localValueJson", "null"),
                    remoteValueJson = item.optString("remoteValueJson", "null"),
                    localVersion = item.optLong("localVersion", 0),
                    remoteVersion = item.optLong("remoteVersion", 0),
                    createdAt = item.optLong("createdAt", System.currentTimeMillis()),
                ),
            )
        }
    }

    suspend fun createWiki(projectId: String, title: String, body: String, tags: List<String>): WikiEntry {
        val now = System.currentTimeMillis()
        val entry = WikiEntry(UUID.randomUUID().toString(), projectId, title, body, tags, null, now, now)
        upsertLocalLibrary("wiki", entry.id, projectId, title, body, entry.toJson(), 0)
        return entry
    }

    suspend fun updateWiki(id: String, title: String, body: String, tags: List<String>): WikiEntry? {
        val current = database.library().get("wiki", id) ?: return null
        val old = parseWikiEntry(JSONObject(current.payloadJson))
        val entry = old.copy(title = title, body = body, tags = tags, updatedAt = System.currentTimeMillis())
        upsertLocalLibrary("wiki", id, old.projectId, title, body, entry.toJson(), current.remoteVersion)
        return entry
    }

    suspend fun createPromptLocal(
        title: String,
        body: String,
        description: String,
        category: String,
        tags: List<String>,
        promptScope: String,
        projectId: String?,
    ): PromptEntry {
        val now = System.currentTimeMillis()
        val entry = PromptEntry(UUID.randomUUID().toString(), title, body, description, category, tags, promptScope, projectId, now, now)
        upsertLocalLibrary("prompt", entry.id, projectId, title, body, entry.toJson(), 0)
        return entry
    }

    suspend fun updatePromptLocal(
        id: String,
        title: String,
        body: String,
        description: String,
        category: String,
        tags: List<String>,
    ): PromptEntry? {
        val current = database.library().get("prompt", id) ?: return null
        val old = parsePromptEntry(JSONObject(current.payloadJson))
        val entry = old.copy(title = title, body = body, description = description, category = category, tags = tags, updatedAt = System.currentTimeMillis())
        upsertLocalLibrary("prompt", id, old.projectId, title, body, entry.toJson(), current.remoteVersion)
        return entry
    }

    suspend fun upsertSkillLocal(payload: JSONObject, id: String? = null): SkillConfig {
        val skillId = id ?: payload.optString("id").takeIf(String::isNotBlank) ?: UUID.randomUUID().toString()
        payload.put("id", skillId)
        val now = System.currentTimeMillis()
        if (!payload.has("created_at")) payload.put("created_at", now)
        payload.put("updated_at", now)
        val skill = parseSkillConfig(payload)
        val current = database.library().get("skill", skillId)
        upsertLocalLibrary("skill", skillId, null, skill.name, skill.instructions, payload, current?.remoteVersion ?: 0)
        return skill
    }

    suspend fun getAgentFull(id: String): AgentFullConfig? {
        val entity = database.agents().get(id) ?: return null
        val payload = runCatching { JSONObject(entity.configJson) }.getOrDefault(JSONObject())
            .put("id", entity.id)
            .put("name", entity.name)
            .put("icon", entity.icon)
            .put("backend", entity.backend)
            .put("cliModel", entity.cliModel)
        return parseAgentFullConfig(payload)
    }

    suspend fun updateAgentFull(id: String, payload: JSONObject): AgentFullConfig? {
        val current = database.agents().get(id) ?: return null
        payload.put("id", id)
        val config = parseAgentFullConfig(payload)
        val updated = current.copy(
            name = config.name,
            icon = config.icon,
            backend = config.backend,
            cliModel = config.cliModel,
            configJson = payload.toString(),
            updatedAt = System.currentTimeMillis(),
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.agents().upsert(updated)
            enqueue("agent", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
        return config
    }

    suspend fun getProjectConfig(id: String): ProjectSettingsConfig? {
        val entity = database.projects().get(id) ?: return null
        return parseProjectSettingsConfig(runCatching { JSONObject(entity.configJson) }.getOrDefault(JSONObject()))
    }

    suspend fun updateProjectConfig(id: String, payload: JSONObject): ProjectSettingsConfig? {
        val current = database.projects().get(id) ?: return null
        val config = parseProjectSettingsConfig(payload)
        val updated = current.copy(
            rootDirectory = config.rootDirectory,
            configJson = payload.toString(),
            updatedAt = System.currentTimeMillis(),
            localVersion = current.localVersion + 1,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.projects().upsert(updated)
            enqueue("project", id, "upsert", updated.toSyncJson(), current.remoteVersion)
        }
        return config
    }

    suspend fun deleteLibraryItem(kind: String, id: String) {
        val current = database.library().get(kind, id) ?: return
        val now = System.currentTimeMillis()
        database.withTransaction {
            database.library().tombstone(kind, id, now)
            enqueue(kind, id, "delete", JSONObject().put("id", id).put("deletedAt", now).toString(), current.remoteVersion)
        }
    }

    private suspend fun upsertLocalLibrary(
        kind: String,
        id: String,
        projectId: String?,
        title: String,
        body: String,
        payload: JSONObject,
        remoteVersion: Long,
    ) {
        val current = database.library().get(kind, id)
        val now = System.currentTimeMillis()
        val entity = LibraryItemEntity(
            kind = kind,
            id = id,
            projectId = projectId,
            title = title,
            body = body,
            payloadJson = payload.toString(),
            createdAt = current?.createdAt ?: now,
            updatedAt = now,
            localVersion = (current?.localVersion ?: 0) + 1,
            remoteVersion = remoteVersion,
            syncStatus = SyncStatus.PENDING,
        )
        database.withTransaction {
            database.library().upsert(entity)
            enqueue(kind, id, "upsert", payload.toString(), remoteVersion)
        }
    }

    private suspend fun applyTombstones(tombstones: JSONArray?) {
        tombstones?.forEachObject { item ->
            val type = item.optString("entityType")
            val id = item.optString("entityId")
            if (id.isBlank()) return@forEachObject
            when (type) {
                "conversation" -> database.conversations().get(id)?.let {
                    if (it.syncStatus == SyncStatus.SYNCED) database.conversations().upsert(it.copy(deleted = true, remoteVersion = item.optLong("version")))
                    else recordConflict(type, id, "deleted", it.toSyncJson(), "true", it.localVersion, item.optLong("version"))
                }
                "message" -> database.messages().get(id)?.let {
                    if (it.syncStatus == SyncStatus.SYNCED) database.messages().upsert(it.copy(deleted = true, remoteVersion = item.optLong("version")))
                    else recordConflict(type, id, "deleted", it.toSyncJson(), "true", it.localVersion, item.optLong("version"))
                }
                "agent" -> database.agents().get(id)?.let {
                    if (it.syncStatus == SyncStatus.SYNCED) database.agents().upsert(it.copy(deleted = true, remoteVersion = item.optLong("version")))
                    else recordConflict(type, id, "deleted", it.toSyncJson(), "true", it.localVersion, item.optLong("version"))
                }
                "project" -> database.projects().get(id)?.let {
                    if (it.syncStatus == SyncStatus.SYNCED) database.projects().upsert(it.copy(deleted = true, remoteVersion = item.optLong("version")))
                    else recordConflict(type, id, "deleted", it.toSyncJson(), "true", it.localVersion, item.optLong("version"))
                }
                "wiki", "prompt", "skill" -> database.library().get(type, id)?.let {
                    if (it.syncStatus == SyncStatus.SYNCED) {
                        database.library().upsert(it.copy(deleted = true, remoteVersion = item.optLong("version")))
                    } else {
                        recordConflict(type, id, "deleted", it.payloadJson, "true", it.localVersion, item.optLong("version"))
                    }
                }
            }
        }
    }

    private suspend fun mergeSnapshotLibrary(
        kind: String,
        id: String,
        projectId: String?,
        title: String,
        body: String,
        payload: JSONObject,
        createdAt: Long,
        updatedAt: Long,
        remoteVersion: Long,
    ) {
        if (id.isBlank()) return
        val current = database.library().get(kind, id)
        val remote = LibraryItemEntity(
            kind = kind,
            id = id,
            projectId = projectId,
            title = title,
            body = body,
            payloadJson = payload.toString(),
            createdAt = createdAt,
            updatedAt = updatedAt,
            remoteVersion = remoteVersion,
        )
        if (current?.syncStatus == SyncStatus.PENDING) {
            if (current.title != title || current.body != body) {
                recordConflict(kind, id, "payload", current.payloadJson, remote.payloadJson, current.localVersion, remoteVersion)
                database.library().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remoteVersion))
            } else {
                database.library().upsert(current.copy(remoteVersion = remoteVersion))
            }
        } else {
            database.library().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
        }
    }

    /**
     * Persist an authoritative desktop event while retaining local pending edits. Pending values
     * are never overwritten silently; a field conflict is recorded for explicit review.
     */
    suspend fun applyRemoteEvent(event: WsEvent) {
        when (event) {
            is WsEvent.ConversationList -> event.conversations.forEach { mergeRemoteConversation(it) }
            is WsEvent.ConversationPage -> event.conversations.forEach { mergeRemoteConversation(it) }
            is WsEvent.ConversationModelUpdated -> updateRemoteConversation(event.conversationId) {
                it.copy(model = event.model, conversationHermesProfile = event.hermesProfile)
            }
            is WsEvent.ConversationModeUpdated -> updateRemoteConversation(event.conversationId) {
                it.copy(
                    thinkingEffortOverride = event.thinkingEffortOverride,
                    fullAutoApproveOverride = event.fullAutoApproveOverride,
                    agenticModeOverride = event.agenticModeOverride,
                    terminalSandboxOverride = event.terminalSandboxOverride,
                    cliModeOverride = event.cliModeOverride,
                    codexExecutionModeOverride = event.codexExecutionModeOverride,
                )
            }
            is WsEvent.ConversationMessages -> {
                val incoming = event.messages.map { it.toEntity(event.conversationId) }
                // An unpaged response is the complete, authoritative conversation snapshot.
                // A paged response is only one window of it (including older cursor pages), so
                // clearing first would evict every cached message outside that window. Besides
                // making back-navigation needlessly slow, it made loading an older page erase
                // the newest cached page before the UI could use it again.
                if (!event.paged) {
                    database.messages().deleteSyncedForConversation(event.conversationId)
                }
                database.messages().upsertAll(incoming)
            }
            is WsEvent.AgentList -> event.agents.forEach { mergeRemoteAgent(it) }
            is WsEvent.ProjectList -> event.projects.forEach { mergeRemoteProject(it) }
            is WsEvent.ProjectConfig -> updateRemoteProjectConfig(event.id, event.config)
            is WsEvent.MessageInserted -> {
                val current = database.messages().get(event.messageId)
                if (current?.syncStatus != SyncStatus.PENDING) database.messages().upsert(
                    MessageEntity(
                    id = event.messageId,
                    conversationId = event.conversationId,
                    role = event.role,
                    content = event.content,
                    timestamp = event.timestamp,
                    remoteVersion = 1,
                    ),
                )
            }
            is WsEvent.MessageDeleted -> database.messages().get(event.id)?.let {
                database.messages().upsert(it.copy(deleted = true, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.MessagesDeletedAfter ->
                database.messages().getForConversation(event.conversationId)
                    .filter { it.timestamp >= event.timestamp && it.syncStatus == SyncStatus.SYNCED }
                    .forEach { database.messages().upsert(it.copy(deleted = true, remoteVersion = it.remoteVersion + 1)) }
            is WsEvent.ProjectCreated -> mergeRemoteProject(event.project)
            is WsEvent.ProjectRenamed -> database.projects().get(event.id)?.let {
                database.projects().upsert(it.copy(name = event.name, color = event.color ?: it.color, updatedAt = System.currentTimeMillis(), remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.ProjectDeleted -> database.projects().get(event.id)?.let {
                database.projects().upsert(it.copy(deleted = true, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.AgentCreated -> mergeRemoteAgent(event.agent)
            is WsEvent.AgentFull -> {
                val config = event.config
                val current = database.agents().get(config.id)
                database.agents().upsert(
                    AgentEntity(
                        id = config.id,
                        name = config.name,
                        icon = config.icon,
                        backend = config.backend,
                        cliModel = config.cliModel,
                        configJson = config.toJson().toString(),
                        createdAt = current?.createdAt ?: System.currentTimeMillis(),
                        updatedAt = System.currentTimeMillis(),
                        localVersion = current?.localVersion ?: 0,
                        remoteVersion = (current?.remoteVersion ?: 0) + 1,
                        syncStatus = current?.syncStatus ?: SyncStatus.SYNCED,
                    ),
                )
            }
            is WsEvent.AgentDeleted -> database.agents().get(event.id)?.let {
                database.agents().upsert(it.copy(deleted = true, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.WikiList -> event.entries.forEach { mergeRemoteLibrary("wiki", it.id, it.projectId, it.title, it.body, it.toJson(), it.createdAt, it.updatedAt) }
            is WsEvent.WikiEntryCreated -> event.entry.let { mergeRemoteLibrary("wiki", it.id, it.projectId, it.title, it.body, it.toJson(), it.createdAt, it.updatedAt) }
            is WsEvent.WikiEntryUpdated -> event.entry.let { mergeRemoteLibrary("wiki", it.id, it.projectId, it.title, it.body, it.toJson(), it.createdAt, it.updatedAt) }
            is WsEvent.WikiEntryDeleted -> database.library().get("wiki", event.id)?.let {
                database.library().upsert(it.copy(deleted = true, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.PromptList -> event.entries.forEach { mergeRemoteLibrary("prompt", it.id, it.projectId, it.title, it.body, it.toJson(), it.createdAt, it.updatedAt) }
            is WsEvent.PromptEntryCreated -> event.entry.let { mergeRemoteLibrary("prompt", it.id, it.projectId, it.title, it.body, it.toJson(), it.createdAt, it.updatedAt) }
            is WsEvent.PromptEntryUpdated -> event.entry.let { mergeRemoteLibrary("prompt", it.id, it.projectId, it.title, it.body, it.toJson(), it.createdAt, it.updatedAt) }
            is WsEvent.PromptEntryDeleted -> database.library().get("prompt", event.id)?.let {
                database.library().upsert(it.copy(deleted = true, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.SkillList -> event.skills.forEach { mergeRemoteLibrary("skill", it.id, null, it.name, it.instructions, it.toJson(), it.createdAt ?: 0, it.updatedAt ?: 0) }
            is WsEvent.SkillCreated -> event.skill.let { mergeRemoteLibrary("skill", it.id, null, it.name, it.instructions, it.toJson(), it.createdAt ?: 0, it.updatedAt ?: 0) }
            is WsEvent.SkillUpdated -> event.skill.let { mergeRemoteLibrary("skill", it.id, null, it.name, it.instructions, it.toJson(), it.createdAt ?: 0, it.updatedAt ?: 0) }
            is WsEvent.SkillDeleted -> database.library().get("skill", event.id)?.let {
                database.library().upsert(it.copy(deleted = true, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.ProjectConfig -> database.projects().get(event.id)?.let { current ->
                database.projects().upsert(
                    current.copy(
                        rootDirectory = event.config.rootDirectory,
                        configJson = event.config.toJson().toString(),
                        updatedAt = System.currentTimeMillis(),
                        remoteVersion = current.remoteVersion + 1,
                    ),
                )
            }
            is WsEvent.DebriefConversationCompleted -> database.conversations().get(event.conversationId)?.let {
                database.conversations().upsert(it.copy(completedAt = event.completedAt, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.DebriefConversationIncompleted -> database.conversations().get(event.conversationId)?.let {
                database.conversations().upsert(it.copy(completedAt = null, remoteVersion = it.remoteVersion + 1))
            }
            is WsEvent.ConversationPinned -> database.conversations().get(event.id)?.let {
                database.conversations().upsert(
                    it.copy(pinned = event.pinned, remoteVersion = it.remoteVersion + 1),
                )
            }
            is WsEvent.ConversationForked -> {
                val current = database.conversations().get(event.conversationId)
                if (current == null) {
                    val now = System.currentTimeMillis()
                    val projectName = event.projectId?.let { id -> database.projects().get(id)?.name }
                    database.conversations().upsert(
                        ConversationEntity(
                            id = event.conversationId,
                            title = event.title,
                            createdAt = now,
                            updatedAt = now,
                            projectId = event.projectId,
                            projectName = projectName,
                            remoteVersion = 1,
                            syncStatus = SyncStatus.SYNCED,
                        ),
                    )
                }
            }
            else -> Unit
        }
    }

    private suspend fun mergeRemoteLibrary(
        kind: String,
        id: String,
        projectId: String?,
        title: String,
        body: String,
        payload: JSONObject,
        createdAt: Long,
        updatedAt: Long,
    ) {
        val current = database.library().get(kind, id)
        val remoteVersion = (current?.remoteVersion ?: 0) + 1
        val remote = LibraryItemEntity(
            kind = kind,
            id = id,
            projectId = projectId,
            title = title,
            body = body,
            payloadJson = payload.toString(),
            createdAt = createdAt,
            updatedAt = updatedAt,
            remoteVersion = remoteVersion,
        )
        if (current?.syncStatus == SyncStatus.PENDING) {
            if (current.title != remote.title || current.body != remote.body) {
                recordConflict(kind, id, "payload", current.payloadJson, remote.payloadJson, current.localVersion, remoteVersion)
                database.library().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remoteVersion))
            }
        } else {
            database.library().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
        }
    }

    private suspend fun mergeRemoteConversation(model: Conversation) {
        val current = database.conversations().get(model.id)
        val remote = model.toEntity(remoteVersion = (current?.remoteVersion ?: 0) + 1)
        if (current?.syncStatus == SyncStatus.PENDING) {
            if (current.title != remote.title && !isPlaceholderTitle(current.title)) {
                recordConflict("conversation", model.id, "title", current.title, remote.title, current.localVersion, remote.remoteVersion)
                database.conversations().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remote.remoteVersion))
            } else {
                // Placeholder title being auto-named by the desktop (or an identical title): adopt the
                // desktop title without flagging a conflict; the pending change stays queued.
                database.conversations().upsert(current.copy(title = remote.title, remoteVersion = remote.remoteVersion))
            }
        } else {
            database.conversations().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
        }
    }

    private suspend fun updateRemoteConversation(id: String, update: (ConversationEntity) -> ConversationEntity) {
        val current = database.conversations().get(id) ?: return
        if (current.syncStatus != SyncStatus.PENDING) {
            database.conversations().upsert(update(current).copy(remoteVersion = current.remoteVersion + 1))
        }
    }

    private suspend fun mergeRemoteAgent(model: Agent) {
        val current = database.agents().get(model.id)
        val remote = AgentEntity(
            id = model.id,
            name = model.name,
            icon = model.icon,
            backend = model.backend,
            cliModel = model.cliModel,
            createdAt = current?.createdAt ?: System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            remoteVersion = (current?.remoteVersion ?: 0) + 1,
        )
        if (current?.syncStatus == SyncStatus.PENDING) {
            if (current.name != remote.name || current.icon != remote.icon) {
                recordConflict("agent", model.id, "config", current.toSyncJson(), remote.toSyncJson(), current.localVersion, remote.remoteVersion)
                database.agents().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remote.remoteVersion))
            }
        } else {
            database.agents().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
        }
    }

    private suspend fun mergeRemoteProject(model: Project) {
        val current = database.projects().get(model.id)
        val config = runCatching { JSONObject(current?.configJson ?: "{}") }.getOrDefault(JSONObject())
            .put("defaultModel", model.defaultModel ?: JSONObject.NULL)
        model.defaultThinkingEffort?.let { config.put("defaultThinkingEffort", it) }
        val remote = ProjectEntity(
            id = model.id,
            name = model.name,
            color = model.color,
            chatCount = model.chatCount,
            agentIconsJson = JSONArray(model.agentIcons).toString(),
            rootDirectory = model.rootDirectory,
            configJson = config.toString(),
            createdAt = current?.createdAt ?: System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            remoteVersion = (current?.remoteVersion ?: 0) + 1,
        )
        if (current?.syncStatus == SyncStatus.PENDING) {
            if (current.name != remote.name || current.color != remote.color) {
                recordConflict("project", model.id, "config", current.toSyncJson(), remote.toSyncJson(), current.localVersion, remote.remoteVersion)
                database.projects().upsert(current.copy(syncStatus = SyncStatus.CONFLICT, remoteVersion = remote.remoteVersion))
            }
        } else {
            database.projects().upsert(remote.copy(localVersion = current?.localVersion ?: 0))
        }
    }

    private suspend fun updateRemoteProjectConfig(id: String, config: ProjectSettingsConfig) {
        val current = database.projects().get(id) ?: return
        if (current.syncStatus != SyncStatus.PENDING) {
            database.projects().upsert(
                current.copy(
                    rootDirectory = config.rootDirectory,
                    configJson = config.toJson().toString(),
                    updatedAt = System.currentTimeMillis(),
                    remoteVersion = current.remoteVersion + 1,
                ),
            )
        }
    }

    /**
     * A brand-new chat starts life as the default placeholder title, then the desktop auto-names it
     * from the first message. That rename is not a user edit, so a placeholder-vs-generated title
     * divergence must never surface as a conflict the user is asked to resolve — the desktop title
     * simply wins.
     */
    private fun isPlaceholderTitle(title: String): Boolean =
        title.isBlank() || title == DEFAULT_CONVERSATION_TITLE

    private suspend fun recordConflict(
        entityType: String,
        entityId: String,
        field: String,
        localValue: String,
        remoteValue: String,
        localVersion: Long,
        remoteVersion: Long,
    ) {
        database.sync().upsertConflict(
            ConflictEntity(
                id = UUID.randomUUID().toString(),
                entityType = entityType,
                entityId = entityId,
                field = field,
                localValueJson = JSONObject.quote(localValue),
                remoteValueJson = JSONObject.quote(remoteValue),
                localVersion = localVersion,
                remoteVersion = remoteVersion,
                createdAt = System.currentTimeMillis(),
            ),
        )
    }

    private suspend fun enqueue(
        entityType: String,
        entityId: String,
        operation: String,
        payloadJson: String,
        baseVersion: Long,
    ) {
        database.withTransaction {
            val safePayloadJson = sanitizeSyncJson(payloadJson)
            if (operation == "upsert") {
                val existing = database.sync().pendingUpsert(entityType, entityId)
                if (existing != null) {
                    database.sync().updateOutboxPayload(existing.operationId, safePayloadJson)
                    database.sync().updateChangePayload(existing.operationId, safePayloadJson)
                    return@withTransaction
                }
            }
            val next = database.sync().maxOutboxSequence(deviceId) + 1
            val operationId = UUID.randomUUID().toString()
            val createdAt = System.currentTimeMillis()
            database.sync().enqueue(
                OutboxEntity(
                    operationId = operationId,
                    deviceId = deviceId,
                    deviceSequence = next,
                    entityType = entityType,
                    entityId = entityId,
                    operation = operation,
                    payloadJson = safePayloadJson,
                    baseRemoteVersion = baseVersion,
                    createdAt = createdAt,
                ),
            )
            database.sync().appendChange(
                ChangeLogEntity(
                    changeId = operationId,
                    deviceId = deviceId,
                    sequence = next,
                    entityType = entityType,
                    entityId = entityId,
                    operation = operation,
                    payloadJson = safePayloadJson,
                    createdAt = createdAt,
                ),
            )
        }
    }

    companion object {
        /** Default title a chat is created with before the desktop auto-names it. */
        const val DEFAULT_CONVERSATION_TITLE = "New Chat"
        const val MAX_CONVERSATION_TITLE_LENGTH = 120

        @Volatile private var instance: LocalDataRepository? = null

        fun get(context: Context): LocalDataRepository =
            instance ?: synchronized(this) {
                instance ?: LocalDataRepository(context.applicationContext).also { instance = it }
            }
    }
}

private class DeviceIdentityStore(context: Context) {
    private val preferences = context.getSharedPreferences("nexy_device_identity", Context.MODE_PRIVATE)

    fun deviceId(): String {
        val current = preferences.getString("device_id", null)
        if (!current.isNullOrBlank()) return current
        return UUID.randomUUID().toString().also { preferences.edit().putString("device_id", it).apply() }
    }

    fun historyVersion(conversationId: String): String? =
        preferences.getString("history_version_$conversationId", null)

    fun saveHistoryVersion(conversationId: String, version: String) {
        preferences.edit().putString("history_version_$conversationId", version).apply()
    }

    fun bindDataset(datasetId: String): Boolean {
        val current = preferences.getString("dataset_id", null)
        if (current == null) {
            preferences.edit().putString("dataset_id", datasetId).apply()
            return true
        }
        return current == datasetId
    }
}

private fun ConversationEntity.toModel() = Conversation(
    id = id,
    title = title,
    created_at = createdAt.toString(),
    updated_at = updatedAt.toString(),
    agent_id = agentId,
    agent_name = agentName,
    agent_icon = agentIcon,
    project_id = projectId,
    project_name = projectName,
    model = model,
    conversationHermesProfile = conversationHermesProfile,
    thinking_effort_override = thinkingEffortOverride,
    full_auto_approve_override = fullAutoApproveOverride,
    agentic_mode_override = agenticModeOverride,
    terminal_sandbox_override = terminalSandboxOverride,
    cli_mode_override = cliModeOverride,
    codex_execution_mode_override = codexExecutionModeOverride,
    last_message = lastMessage,
    pinned = pinned,
    archived = archived,
    completed_at = completedAt,
    kind = kind,
)

private fun Conversation.toEntity(remoteVersion: Long) = ConversationEntity(
    id = id,
    title = title,
    createdAt = created_at.toEpochMillis(),
    updatedAt = updated_at.toEpochMillis(),
    agentId = agent_id,
    agentName = agent_name,
    agentIcon = agent_icon,
    projectId = project_id,
    projectName = project_name,
    model = model,
    conversationHermesProfile = conversationHermesProfile,
    thinkingEffortOverride = thinking_effort_override,
    fullAutoApproveOverride = full_auto_approve_override,
    agenticModeOverride = agentic_mode_override,
    terminalSandboxOverride = terminal_sandbox_override,
    cliModeOverride = cli_mode_override,
    codexExecutionModeOverride = codex_execution_mode_override,
    lastMessage = last_message,
    pinned = pinned,
    archived = archived,
    completedAt = completed_at,
    kind = kind,
    remoteVersion = remoteVersion,
)

private fun MessageEntity.toModel() = HistoryMessage(
    id = id,
    role = role,
    content = content,
    timestamp = timestamp,
    timelineOrder = timelineOrder,
    attachments = attachmentsJson.toAttachments(),
    thinkingBlocks = thinkingBlocksJson.toThinkingBlocks(),
    textSegments = textSegmentsJson.toThinkingBlocks(),
)

private fun HistoryMessage.toEntity(conversationId: String) = MessageEntity(
    id = id,
    conversationId = conversationId,
    role = role,
    content = content,
    timestamp = timestamp,
    timelineOrder = timelineOrder,
    attachmentsJson = attachments.toAttachmentsJson(),
    thinkingBlocksJson = thinkingBlocks.toThinkingBlocksJson(),
    textSegmentsJson = textSegments.toThinkingBlocksJson(),
    remoteVersion = 1,
)

private fun AgentEntity.toModel() = Agent(id, name, icon, backend, cliModel)

private fun ProjectEntity.toModel() = Project(
    id = id,
    name = name,
    color = color,
    chatCount = chatCount,
    agentIcons = agentIconsJson.toStringList(),
    rootDirectory = rootDirectory,
    defaultModel = runCatching {
        JSONObject(configJson).optString("defaultModel").takeIf { it.isNotBlank() && it != "null" }
    }.getOrNull(),
    defaultThinkingEffort = runCatching {
        JSONObject(configJson).optString("defaultThinkingEffort").takeIf {
            it in setOf("low", "medium", "high", "max", "disabled")
        }
    }.getOrNull(),
)

private fun ConversationEntity.toSyncJson(): String = JSONObject()
    .put("id", id)
    .put("title", title)
    .put("createdAt", createdAt)
    .put("updatedAt", updatedAt)
    .put("agentId", agentId)
    .put("projectId", projectId)
    .put("model", model)
    .put("conversationHermesProfile", conversationHermesProfile)
    .put("thinkingEffortOverride", thinkingEffortOverride)
    .put("fullAutoApproveOverride", fullAutoApproveOverride)
    .put("agenticModeOverride", agenticModeOverride)
    .put("terminalSandboxOverride", terminalSandboxOverride)
    .put("cliModeOverride", cliModeOverride)
    .put("codexExecutionModeOverride", codexExecutionModeOverride)
    .put("pinned", pinned)
    .put("archived", archived)
    .put("deleted", deleted)
    .put("localVersion", localVersion)
    .toString()

private fun MessageEntity.toSyncJson(): String = JSONObject()
    .put("id", id)
    .put("conversationId", conversationId)
    .put("role", role)
    .put("content", content)
    .put("model", model)
    .put("provider", provider)
    .put("finishReason", finishReason)
    .put("timestamp", timestamp)
    .put("attachments", JSONArray(attachmentsJson))
    .put("thinkingBlocks", JSONArray(thinkingBlocksJson))
    .put("inputTokens", inputTokens)
    .put("outputTokens", outputTokens)
    .put("partial", partial)
    .put("deleted", deleted)
    .put("localVersion", localVersion)
    .toString()

private fun AgentEntity.toSyncJson(): String = JSONObject()
    .put("id", id)
    .put("name", name)
    .put("icon", icon)
    .put("backend", backend)
    .put("cliModel", cliModel)
    .put("config", JSONObject(configJson))
    .put("updatedAt", updatedAt)
    .put("deleted", deleted)
    .put("localVersion", localVersion)
    .toString()

private fun ProjectEntity.toSyncJson(): String = JSONObject()
    .put("id", id)
    .put("name", name)
    .put("color", color)
    .put("rootDirectory", rootDirectory)
    .put("config", JSONObject(configJson))
    .put("updatedAt", updatedAt)
    .put("deleted", deleted)
    .put("localVersion", localVersion)
    .toString()

private fun WikiEntry.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("projectId", projectId)
    .put("title", title)
    .put("body", body)
    .put("tags", JSONArray(tags))
    .put("sourceConversationId", sourceConversationId)
    .put("createdAt", createdAt)
    .put("updatedAt", updatedAt)

private fun PromptEntry.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("title", title)
    .put("body", body)
    .put("description", description)
    .put("category", category)
    .put("tags", JSONArray(tags))
    .put("scope", scope)
    .put("projectId", projectId)
    .put("createdAt", createdAt)
    .put("updatedAt", updatedAt)

private fun SkillConfig.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("name", name)
    .put("icon", icon)
    .put("description", description)
    .put("instructions", instructions)
    .put("tags", JSONArray(tags))
    .put(
        "tools",
        JSONObject()
            .put("fileEdit", tools.fileEdit.toJson())
            .put("terminal", tools.terminal.toJson())
            .put("webFetch", tools.webFetch.toJson()),
    )
    .put("mcpServers", JSONArray(mcpServers))
    .put(
        "mcpServerTrust",
        JSONArray().also { array ->
            mcpServerTrust.forEach { array.put(JSONObject().put("serverId", it.serverId).put("trust", it.trust)) }
        },
    )
    .put(
        "mcpToolOverrides",
        JSONArray().also { array ->
            mcpToolOverrides.forEach {
                array.put(
                    JSONObject()
                        .put("serverId", it.serverId)
                        .put("toolName", it.toolName)
                        .put("enabled", it.enabled)
                        .put("approval", it.approval)
                        .put("instructions", it.instructions),
                )
            }
        },
    )
    .put(
        "knowledge",
        JSONArray().also { array ->
            knowledge.forEach { array.put(JSONObject().put("title", it.title).put("content", it.content)) }
        },
    )
    .put("created_at", createdAt)
    .put("updated_at", updatedAt)
    .put("packagePath", packagePath)
    .put("contentHash", contentHash)
    .put("scope", scope)
    .put("source", source)
    .put("validationStatus", validationStatus)
    .put(
        "packageFiles",
        JSONArray().also { array ->
            packageFiles.forEach { file ->
                array.put(
                    JSONObject()
                        .put("relativePath", file.relativePath)
                        .put("encoding", file.encoding)
                        .put("content", file.content)
                        .put("sizeBytes", file.sizeBytes),
                )
            }
        },
    )

private fun io.nexy.android.data.model.SkillToolConfig.toJson(): JSONObject = JSONObject()
    .put("enabled", enabled)
    .put("approval", approval)
    .put("instructions", instructions)

private fun AgentFullConfig.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("name", name)
    .put("icon", icon)
    .put("systemPrompt", systemPrompt)
    .put("backend", backend)
    .put("cliModel", cliModel)
    .put("temperature", temperature)
    .put("maxTokens", maxTokens)
    .put("responseFormat", responseFormat)
    .put("agenticMode", agenticMode)
    .put("fullAutoApprove", fullAutoApprove)
    .put("memory", memory)
    .put(
        "tools",
        JSONObject()
            .put("fileEdit", JSONObject().put("enabled", tools.fileEdit.enabled).put("approval", tools.fileEdit.approval).put("instructions", tools.fileEdit.instructions))
            .put("terminal", JSONObject().put("enabled", tools.terminal.enabled).put("approval", tools.terminal.approval).put("instructions", tools.terminal.instructions))
            .put("webFetch", JSONObject().put("enabled", tools.webFetch.enabled).put("approval", tools.webFetch.approval).put("instructions", tools.webFetch.instructions)),
    )
    .put("mcpServers", JSONArray(mcpServers))
    .put("thinkingEffort", thinkingEffort)
    .put("rootDirectory", rootDirectory)
    .put("contextDirectories", JSONArray(contextDirectories))
    .put("contextFiles", JSONArray(contextFiles))
    .put(
        "contextRules",
        contextRules?.let {
            JSONObject()
                .put("ignoredGlobs", JSONArray(it.ignoredGlobs))
                .put("autoInjectWorkspace", it.autoInjectWorkspace)
                .put("autoInjectGit", it.autoInjectGit)
        },
    )
    .put(
        "customCommands",
        JSONArray().also { array ->
            customCommands.forEach {
                array.put(JSONObject().put("name", it.name).put("description", it.description).put("prompt", it.prompt))
            }
        },
    )

private fun ProjectSettingsConfig.toJson(): JSONObject = JSONObject()
    .put("instructions", instructions)
    .put("rootDirectory", rootDirectory)
    .put("variables", JSONArray(variables))
    .put("instructionMode", instructionMode)
    .put("instructionsEnabled", instructionsEnabled)
    .put("orchestrationEnabled", orchestrationEnabled)
    .put("maxDelegationDepth", maxDelegationDepth)
    .put("showTeamActivity", showTeamActivity)
    .put("inScope", JSONArray(inScope))
    .put("outOfScope", JSONArray(outOfScope))
    .put("milestones", JSONArray(milestones))
    .put("defaultModel", defaultModel)
    .put("defaultThinkingEffort", defaultThinkingEffort)
    .put(
        "capabilityProfile",
        JSONObject()
            .put("version", 1)
            .put("skillIds", JSONArray(capabilityProfile.skillIds))
            .put(
                "mcp",
                JSONArray().also { array ->
                    capabilityProfile.mcp.forEach { grant ->
                        array.put(JSONObject().put("serverId", grant.serverId).put("trust", grant.trust))
                    }
                },
            ),
    )

private fun List<AttachmentMeta>.toAttachmentsJson(): String = JSONArray().also { array ->
    forEach { item ->
        array.put(
            JSONObject()
                .put("id", item.id)
                .put("name", item.name)
                .put("type", item.type)
                .put("thumbnailDataUrl", item.thumbnailDataUrl),
        )
    }
}.toString()

private fun List<ThinkingBlock>.toThinkingBlocksJson(): String = JSONArray().also { array ->
    forEach { item ->
        array.put(
            JSONObject()
                .put("blockId", item.blockId)
                .put("content", item.content)
                .put("done", item.done)
                .put("firstSeenAt", item.firstSeenAt ?: JSONObject.NULL),
        )
    }
}.toString()

private fun String.toAttachments(): List<AttachmentMeta> = runCatching {
    val array = JSONArray(this)
    (0 until array.length()).map { index ->
        array.getJSONObject(index).let {
            AttachmentMeta(
                id = it.optString("id"),
                name = it.optString("name"),
                type = it.optString("type").takeIf(String::isNotBlank),
                thumbnailDataUrl = it.optString("thumbnailDataUrl").takeIf(String::isNotBlank),
            )
        }
    }
}.getOrDefault(emptyList())

private fun String.toThinkingBlocks(): List<ThinkingBlock> = runCatching {
    val array = JSONArray(this)
    (0 until array.length()).map { index ->
        array.getJSONObject(index).let {
            ThinkingBlock(
                blockId = it.optString("blockId"),
                content = it.optString("content"),
                done = it.optBoolean("done"),
                firstSeenAt = it.nullableLong("firstSeenAt"),
            )
        }
    }
}.getOrDefault(emptyList())

private fun String.toStringList(): List<String> = runCatching {
    val array = JSONArray(this)
    (0 until array.length()).map(array::getString)
}.getOrDefault(emptyList())

private fun String.toEpochMillis(): Long =
    toLongOrNull() ?: runCatching { Instant.parse(this).toEpochMilli() }.getOrDefault(System.currentTimeMillis())

private suspend inline fun JSONArray.forEachObject(block: suspend (JSONObject) -> Unit) {
    for (index in 0 until length()) {
        optJSONObject(index)?.let { block(it) }
    }
}

/**
 * Applies [block] over the array in [chunkSize] batches, each wrapped in a single Room transaction
 * with a [yield] between batches. Collapses N per-row Flow invalidations (one recomposition of the
 * Chats list per upsert) into one invalidation per batch, which is what kills the freeze/unfreeze
 * flicker while a large sync:welcome snapshot is applied. Mirrors the message-merge loop.
 */
private suspend inline fun JSONArray.forEachObjectBatched(
    database: NexyDatabase,
    chunkSize: Int = 50,
    crossinline block: suspend (JSONObject) -> Unit,
) {
    val total = length()
    var index = 0
    while (index < total) {
        val end = minOf(index + chunkSize, total)
        database.withTransaction {
            while (index < end) {
                optJSONObject(index)?.let { block(it) }
                index += 1
            }
        }
        yield()
    }
}

private fun JSONObject.nullableString(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf(String::isNotBlank) else null

private fun JSONObject.nullableLong(key: String): Long? =
    if (has(key) && !isNull(key)) optLong(key) else null

private fun JSONObject.nullableBoolean(key: String): Boolean? =
    if (has(key) && !isNull(key)) optInt(key) != 0 else null

private fun JSONObject.jsonObjectOrString(key: String): JSONObject? {
    optJSONObject(key)?.let { return it }
    val raw = nullableString(key) ?: return null
    return runCatching { JSONObject(raw) }.getOrNull()
}

internal data class ProjectSnapshotFields(
    val name: String,
    val color: String,
    val rootDirectory: String?,
    val configJson: String,
)

/**
 * Desktop's `buildSnapshot()` (standalone-sync.ts) nests project config under a
 * "config" key — not "config_json".
 */
internal fun projectFieldsFromSnapshotRow(row: JSONObject): ProjectSnapshotFields {
    val config = row.jsonObjectOrString("config")
    return ProjectSnapshotFields(
        name = row.optString("name", "Project"),
        color = row.optString("color", "blue"),
        rootDirectory = config?.optString("rootDirectory")?.takeIf(String::isNotBlank),
        configJson = config?.toString() ?: "{}",
    )
}

internal data class AgentSnapshotFields(
    val name: String,
    val icon: String,
    val backend: String?,
    val cliModel: String?,
    val configJson: String,
)

/**
 * Desktop's `buildSnapshot()` spreads agent config fields directly onto the row root
 * (no "config_json"/"config" wrapper key) — the row itself is the config.
 */
internal fun agentFieldsFromSnapshotRow(row: JSONObject): AgentSnapshotFields {
    return AgentSnapshotFields(
        name = row.optString("name", "Agent"),
        icon = row.optString("icon"),
        backend = row.optString("backend").takeIf(String::isNotBlank),
        cliModel = row.optString("cliModel").takeIf(String::isNotBlank),
        configJson = row.toString(),
    )
}

private fun JSONObject.jsonArrayOrString(key: String): JSONArray? {
    optJSONArray(key)?.let { return it }
    val raw = nullableString(key) ?: return null
    return runCatching { JSONArray(raw) }.getOrNull()
}

private fun File.sha256(): String = inputStream().use { input ->
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
    }
    digest.digest().joinToString("") { "%02x".format(it) }
}

private val EXCLUDED_SYNC_KEYS = setOf(
    "apikey",
    "authorization",
    "contentbase64",
    "dataurl",
    "localpath",
    "pairingsecret",
    "password",
    "path",
    "rootdirectory",
    "secret",
    "thumbnaildataurl",
    "token",
    "workingdirectory",
    "workspacepath",
)

internal fun sanitizeSyncJson(value: String): String = runCatching {
    sanitizeSyncValue(JSONObject(value)).toString()
}.getOrDefault("{}")

private fun sanitizeSyncValue(value: Any?): Any? = when (value) {
    is JSONObject -> JSONObject().also { result ->
        value.keys().forEach { key ->
            val normalized = key.replace("-", "").replace("_", "").lowercase()
            if (normalized !in EXCLUDED_SYNC_KEYS) result.put(key, sanitizeSyncValue(value.opt(key)))
        }
    }
    is JSONArray -> JSONArray().also { result ->
        for (index in 0 until value.length()) result.put(sanitizeSyncValue(value.opt(index)))
    }
    else -> value
}
