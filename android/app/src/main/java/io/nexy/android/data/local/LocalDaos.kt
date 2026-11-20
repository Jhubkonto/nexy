package io.nexy.android.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ConversationDao {
    @Query("SELECT * FROM local_conversations WHERE deleted = 0 AND archived = 0 ORDER BY pinned DESC, updatedAt DESC")
    fun observeAll(): Flow<List<ConversationEntity>>

    @Query("SELECT * FROM local_conversations WHERE id = :id LIMIT 1")
    suspend fun get(id: String): ConversationEntity?

    @Query("SELECT * FROM local_conversations WHERE projectId = :projectId AND deleted = 0")
    suspend fun byProject(projectId: String): List<ConversationEntity>

    @Query(
        """SELECT * FROM local_conversations
           WHERE deleted = 0 AND archived = 0 AND (
             title LIKE '%' || :query || '%'
             OR lastMessage LIKE '%' || :query || '%'
             OR EXISTS (
               SELECT 1 FROM local_messages message
               WHERE message.conversationId = local_conversations.id
                 AND message.deleted = 0
                 AND message.content LIKE '%' || :query || '%'
             )
           )
           ORDER BY pinned DESC, updatedAt DESC""",
    )
    suspend fun search(query: String): List<ConversationEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ConversationEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<ConversationEntity>)

    @Query("UPDATE local_conversations SET deleted = 1, syncStatus = 'PENDING', localVersion = localVersion + 1, updatedAt = :now WHERE id = :id")
    suspend fun tombstone(id: String, now: Long)

    @Query("UPDATE local_conversations SET archived = 1, syncStatus = 'PENDING', localVersion = localVersion + 1, updatedAt = :now WHERE id = :id")
    suspend fun archive(id: String, now: Long)

    @Query("DELETE FROM local_conversations WHERE id NOT IN (:ids) AND syncStatus = 'SYNCED'")
    suspend fun deleteSyncedNotIn(ids: List<String>)

    @Query("SELECT COUNT(*) FROM local_conversations")
    suspend fun count(): Int

    // Ordered like observeAll() so a bounded prefetch targets the same top-of-list conversations
    // the user is most likely to open next.
    @Query("SELECT id FROM local_conversations WHERE deleted = 0 AND archived = 0 ORDER BY pinned DESC, updatedAt DESC LIMIT :limit")
    suspend fun topConversationIds(limit: Int): List<String>

    @Query("UPDATE local_conversations SET syncStatus = 'SYNCED' WHERE id = :id AND syncStatus = 'PENDING'")
    suspend fun markSynced(id: String)
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM local_messages WHERE conversationId = :conversationId AND deleted = 0 ORDER BY COALESCE(timelineOrder, timestamp), timestamp, id")
    fun observeForConversation(conversationId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM local_messages WHERE conversationId = :conversationId AND deleted = 0 ORDER BY COALESCE(timelineOrder, timestamp), timestamp, id")
    suspend fun getForConversation(conversationId: String): List<MessageEntity>

    @Query(
        """SELECT * FROM local_messages
           WHERE conversationId = :conversationId
             AND deleted = 0
             AND (
               :beforeTimestamp IS NULL
               OR timestamp < :beforeTimestamp
               OR (timestamp = :beforeTimestamp AND id < :beforeId)
             )
           ORDER BY timestamp DESC, id DESC
           LIMIT :limit""",
    )
    suspend fun getPageForConversation(
        conversationId: String,
        limit: Int,
        beforeTimestamp: Long?,
        beforeId: String?,
    ): List<MessageEntity>

    @Query("SELECT * FROM local_messages WHERE id = :id LIMIT 1")
    suspend fun get(id: String): MessageEntity?

    @Query("SELECT id FROM local_messages WHERE conversationId = :conversationId")
    suspend fun idsForConversation(conversationId: String): List<String>

    @Query("SELECT COUNT(*) FROM local_messages WHERE conversationId = :conversationId AND deleted = 0")
    suspend fun countForConversation(conversationId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: MessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<MessageEntity>)

    @Query("DELETE FROM local_messages WHERE conversationId = :conversationId AND syncStatus = 'SYNCED'")
    suspend fun deleteSyncedForConversation(conversationId: String)

    @Query("UPDATE local_messages SET deleted = 1, syncStatus = 'PENDING', localVersion = localVersion + 1 WHERE id = :id")
    suspend fun tombstone(id: String)

    @Query(
        """UPDATE local_messages SET deleted = 1, syncStatus = 'PENDING', localVersion = localVersion + 1
           WHERE conversationId = :conversationId AND timestamp >= :timestamp""",
    )
    suspend fun tombstoneAfter(conversationId: String, timestamp: Long)

    @Query("UPDATE local_messages SET syncStatus = 'SYNCED' WHERE id = :id AND syncStatus = 'PENDING'")
    suspend fun markSynced(id: String)

    @Query("UPDATE local_messages SET partial = 0, sendFailed = 1 WHERE partial = 1")
    suspend fun recoverInterruptedTurns()
}

@Dao
interface AgentDao {
    @Query("SELECT * FROM local_agents WHERE deleted = 0 ORDER BY name COLLATE NOCASE")
    fun observeAll(): Flow<List<AgentEntity>>

    @Query("SELECT * FROM local_agents WHERE id = :id LIMIT 1")
    suspend fun get(id: String): AgentEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: AgentEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<AgentEntity>)

    @Query("UPDATE local_agents SET deleted = 1, syncStatus = 'PENDING', localVersion = localVersion + 1, updatedAt = :now WHERE id = :id")
    suspend fun tombstone(id: String, now: Long)

    @Query("UPDATE local_agents SET syncStatus = 'SYNCED' WHERE id = :id AND syncStatus = 'PENDING'")
    suspend fun markSynced(id: String)
}

@Dao
interface ProjectDao {
    @Query("SELECT * FROM local_projects WHERE deleted = 0 ORDER BY name COLLATE NOCASE")
    fun observeAll(): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM local_projects WHERE id = :id LIMIT 1")
    suspend fun get(id: String): ProjectEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ProjectEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<ProjectEntity>)

    @Query("UPDATE local_projects SET deleted = 1, syncStatus = 'PENDING', localVersion = localVersion + 1, updatedAt = :now WHERE id = :id")
    suspend fun tombstone(id: String, now: Long)

    @Query("UPDATE local_projects SET syncStatus = 'SYNCED' WHERE id = :id AND syncStatus = 'PENDING'")
    suspend fun markSynced(id: String)
}

@Dao
interface LibraryDao {
    @Query("SELECT * FROM local_library_items WHERE kind = :kind AND deleted = 0 ORDER BY updatedAt DESC")
    fun observeKind(kind: String): Flow<List<LibraryItemEntity>>

    @Query("SELECT * FROM local_library_items WHERE kind = :kind AND id = :id LIMIT 1")
    suspend fun get(kind: String, id: String): LibraryItemEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: LibraryItemEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<LibraryItemEntity>)

    @Query("UPDATE local_library_items SET deleted = 1, syncStatus = 'PENDING', localVersion = localVersion + 1, updatedAt = :now WHERE kind = :kind AND id = :id")
    suspend fun tombstone(kind: String, id: String, now: Long)

    @Query("UPDATE local_library_items SET syncStatus = 'SYNCED' WHERE kind = :kind AND id = :id AND syncStatus = 'PENDING'")
    suspend fun markSynced(kind: String, id: String)
}

@Dao
interface DraftDao {
    @Query("SELECT * FROM local_drafts WHERE conversationId = :conversationId LIMIT 1")
    fun observe(conversationId: String): Flow<DraftEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DraftEntity)

    @Query("DELETE FROM local_drafts WHERE conversationId = :conversationId")
    suspend fun delete(conversationId: String)
}

@Dao
interface ConversationSummaryDao {
    @Query("DELETE FROM conversation_summaries WHERE conversationId = :conversationId")
    suspend fun delete(conversationId: String)

    @Query("SELECT * FROM conversation_summaries WHERE conversationId = :conversationId LIMIT 1")
    suspend fun get(conversationId: String): ConversationSummaryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ConversationSummaryEntity)
}

@Dao
interface SyncDao {
    @Query("SELECT COALESCE(MAX(deviceSequence), 0) FROM sync_outbox WHERE deviceId = :deviceId")
    suspend fun maxOutboxSequence(deviceId: String): Long

    @Query("SELECT MIN(deviceSequence) FROM sync_outbox WHERE deviceId = :deviceId")
    suspend fun minOutboxSequence(deviceId: String): Long?

    @Query("SELECT * FROM sync_outbox WHERE state IN ('pending', 'failed') AND nextAttemptAt <= :now ORDER BY deviceSequence LIMIT :limit")
    suspend fun pendingOutbox(now: Long, limit: Int): List<OutboxEntity>

    @Query("SELECT * FROM sync_outbox ORDER BY deviceSequence")
    fun observeOutbox(): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM sync_outbox WHERE operationId = :id LIMIT 1")
    suspend fun outboxOperation(id: String): OutboxEntity?

    @Query("SELECT * FROM sync_outbox WHERE entityType = :entityType AND entityId IN (:entityIds) AND state IN ('pending', 'failed')")
    suspend fun outboxForEntities(entityType: String, entityIds: List<String>): List<OutboxEntity>

    @Query("SELECT * FROM sync_outbox WHERE state = 'failed'")
    suspend fun failedOutbox(): List<OutboxEntity>

    @Query(
        """SELECT * FROM sync_outbox
           WHERE entityType = :entityType AND entityId = :entityId AND operation = 'upsert' AND state = 'pending'
           ORDER BY deviceSequence DESC LIMIT 1""",
    )
    suspend fun pendingUpsert(entityType: String, entityId: String): OutboxEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(entity: OutboxEntity): Long

    @Query("UPDATE sync_outbox SET payloadJson = :payloadJson WHERE operationId = :operationId")
    suspend fun updateOutboxPayload(operationId: String, payloadJson: String)

    @Query("UPDATE sync_change_log SET payloadJson = :payloadJson WHERE changeId = :changeId")
    suspend fun updateChangePayload(changeId: String, payloadJson: String)

    @Query("DELETE FROM sync_outbox WHERE operationId IN (:ids)")
    suspend fun acknowledge(ids: List<String>)

    @Query("DELETE FROM sync_change_log WHERE changeId = :id")
    suspend fun discardChange(id: String)

    @Query("UPDATE sync_outbox SET state = 'failed', attempts = attempts + 1, nextAttemptAt = :nextAttemptAt, lastError = :error WHERE operationId = :id")
    suspend fun markFailed(id: String, nextAttemptAt: Long, error: String)

    @Query("UPDATE sync_outbox SET state = 'pending', nextAttemptAt = 0, lastError = NULL WHERE operationId = :id")
    suspend fun retry(id: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun appendChange(entity: ChangeLogEntity): Long

    @Query("SELECT * FROM sync_change_log WHERE deviceId = :deviceId AND sequence > :after ORDER BY sequence LIMIT :limit")
    suspend fun changesAfter(deviceId: String, after: Long, limit: Int): List<ChangeLogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCursor(entity: SyncCursorEntity)

    @Query("SELECT * FROM sync_cursors WHERE peerDeviceId = :peerDeviceId LIMIT 1")
    suspend fun cursor(peerDeviceId: String): SyncCursorEntity?

    @Query("SELECT * FROM sync_conflicts WHERE resolvedAt IS NULL ORDER BY createdAt DESC")
    fun observeConflicts(): Flow<List<ConflictEntity>>

    @Query("SELECT * FROM sync_conflicts WHERE id = :id LIMIT 1")
    suspend fun conflict(id: String): ConflictEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertConflict(entity: ConflictEntity)

    @Query("UPDATE sync_conflicts SET resolvedAt = :now, resolution = :resolution WHERE id = :id")
    suspend fun resolveConflict(id: String, resolution: String, now: Long)

    @Query("DELETE FROM sync_change_log WHERE deviceId = :deviceId AND sequence <= :throughSequence")
    suspend fun compactChanges(deviceId: String, throughSequence: Long)
}

@Dao
interface DiagnosticLogDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: DiagnosticLogEntity)

    @Query("SELECT * FROM diagnostic_logs ORDER BY ts DESC LIMIT :limit")
    suspend fun recent(limit: Int): List<DiagnosticLogEntity>

    @Query("DELETE FROM diagnostic_logs WHERE ts < :cutoff")
    suspend fun pruneOlderThan(cutoff: Long): Int

    @Query("DELETE FROM diagnostic_logs")
    suspend fun clear()
}

@Dao
interface AttachmentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: AttachmentEntity)

    @Query("SELECT * FROM local_attachments WHERE contentHash = :hash LIMIT 1")
    suspend fun byHash(hash: String): AttachmentEntity?

    @Query("SELECT * FROM local_attachments WHERE messageId = :messageId")
    suspend fun forMessage(messageId: String): List<AttachmentEntity>

    @Query("SELECT * FROM local_attachments WHERE transferState = 'pending' AND localPath IS NOT NULL")
    suspend fun pendingUploads(): List<AttachmentEntity>

    @Query("UPDATE local_attachments SET transferState = :state, localPath = COALESCE(:localPath, localPath) WHERE contentHash = :hash")
    suspend fun updateTransfer(hash: String, state: String, localPath: String? = null)
}
