package io.nexy.android.data

import io.nexy.android.data.model.ModelOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class WorkHistoryFormatTest {
    private val thursday = LocalDate.of(2026, 10, 29)

    @Test
    fun `presets cover today, yesterday and Monday to Sunday weeks`() {
        assertEquals(thursday to thursday, workHistoryPresetDates(WorkHistoryPreset.TODAY, thursday))
        assertEquals(thursday.minusDays(1) to thursday.minusDays(1), workHistoryPresetDates(WorkHistoryPreset.YESTERDAY, thursday))
        assertEquals(LocalDate.of(2026, 10, 26) to LocalDate.of(2026, 11, 1), workHistoryPresetDates(WorkHistoryPreset.THIS_WEEK, thursday))
        assertEquals(LocalDate.of(2026, 10, 19) to LocalDate.of(2026, 10, 25), workHistoryPresetDates(WorkHistoryPreset.LAST_WEEK, thursday))
        assertNull(workHistoryPresetDates(WorkHistoryPreset.CUSTOM, thursday))
    }

    @Test
    fun `model values qualify CLI models and keep API models and default as-is`() {
        val models = listOf(
            ModelOption("sonnet", "Sonnet", backend = "claude-cli", isCliSourced = true),
            ModelOption("gpt-4.1", "GPT-4.1", vendor = "OpenAI"),
        )
        assertEquals("default", workHistoryModelValue(null, models))
        assertEquals("default", workHistoryModelValue("default", models))
        assertEquals("claude-cli:sonnet", workHistoryModelValue("sonnet", models))
        assertEquals("gpt-4.1", workHistoryModelValue("gpt-4.1", models))
    }

    @Test
    fun `report models exclude Codex and Hermes`() {
        val models = listOf(
            ModelOption("a", "A", backend = "codex-cli"),
            ModelOption("b", "B", backend = "hermes-cli"),
            ModelOption("c", "C", backend = "claude-cli"),
            ModelOption("d", "D"),
        )
        assertEquals(listOf("c", "d"), workHistoryReportModels(models).map { it.id })
    }

    @Test
    fun `titles collapse markdown headings and extra lines`() {
        assertEquals("feature/10984-white-label-lynxcloud", cleanWorkHistoryTitle("# feature/10984-white-label-lynxcloud\n\n## Agentic Code Review"))
        assertEquals("Untitled chat", cleanWorkHistoryTitle("  \n "))
        assertEquals("Untitled chat", cleanWorkHistoryTitle(null))
    }

    @Test
    fun `citations become chat titles`() {
        assertEquals(
            "Shipped login (Auth work) and docs (source).",
            workHistoryReportWithTitles("Shipped login [source:a] and docs [source:zzz].", mapOf("a" to "## Auth work")),
        )
    }
}
