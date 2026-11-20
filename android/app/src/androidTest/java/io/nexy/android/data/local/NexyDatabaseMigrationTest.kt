package io.nexy.android.data.local

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NexyDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        NexyDatabase::class.java,
        emptyList(),
        FrameworkSQLiteOpenHelperFactory(),
    )

    @Test
    fun migratesVersionOneToVersionTwo() {
        helper.createDatabase(DATABASE_NAME, 1).close()
        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            2,
            true,
            NexyDatabase.MIGRATION_1_2,
        ).close()
    }

    @Test
    fun migratesVersionTwoToVersionThree() {
        helper.createDatabase(DATABASE_NAME, 2).close()
        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            3,
            true,
            NexyDatabase.MIGRATION_2_3,
        ).close()
    }

    @Test
    fun migratesVersionOneToCurrent() {
        helper.createDatabase(DATABASE_NAME, 1).close()
        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            4,
            true,
            NexyDatabase.MIGRATION_1_2,
            NexyDatabase.MIGRATION_2_3,
            NexyDatabase.MIGRATION_3_4,
        ).close()
    }

    @Test
    fun migratesVersionThreeToVersionFour() {
        helper.createDatabase(DATABASE_NAME, 3).close()
        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            4,
            true,
            NexyDatabase.MIGRATION_3_4,
        ).close()
    }

    @Test
    fun migratesVersionSixToVersionSeven() {
        helper.createDatabase(DATABASE_NAME, 6).close()
        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            7,
            true,
            NexyDatabase.MIGRATION_6_7,
        ).close()
    }

    @Test
    fun migratesVersionNineToVersionTen() {
        helper.createDatabase(DATABASE_NAME, 9).close()
        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            10,
            true,
            NexyDatabase.MIGRATION_9_10,
        ).close()
    }

    @Test
    fun migratesVersionElevenToVersionTwelveWithoutLosingMessages() {
        helper.createDatabase(DATABASE_NAME, 11).apply {
            execSQL("INSERT INTO local_messages (id, conversationId, role, content, timestamp, attachmentsJson, thinkingBlocksJson, textSegmentsJson, inputTokens, outputTokens, partial, sendFailed, deleted, localVersion, remoteVersion, syncStatus) VALUES ('message', 'conversation', 'user', 'preserved', 1, '[]', '[]', '[]', 0, 0, 0, 0, 0, 0, 0, 'SYNCED')")
            close()
        }
        helper.runMigrationsAndValidate(DATABASE_NAME, 12, true, NexyDatabase.MIGRATION_11_12).apply {
            query("SELECT content, continuationJson, providerHistory FROM local_messages WHERE id = 'message'").use { cursor ->
                check(cursor.moveToFirst())
                check(cursor.getString(0) == "preserved")
                check(cursor.isNull(1) && cursor.isNull(2))
            }
            close()
        }
    }

    companion object {
        private const val DATABASE_NAME = "migration-test"
    }
}
