package io.nexy.android.data

import io.nexy.android.data.model.ModelOption
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Quick ranges offered above the custom date picker. Weeks run Monday through Sunday. */
enum class WorkHistoryPreset(val label: String) {
    TODAY("Today"),
    YESTERDAY("Yesterday"),
    THIS_WEEK("This week"),
    LAST_WEEK("Last week"),
    CUSTOM("Custom"),
}

/** Inclusive calendar dates for a preset; CUSTOM returns null because the user picks the dates. */
fun workHistoryPresetDates(preset: WorkHistoryPreset, today: LocalDate): Pair<LocalDate, LocalDate>? {
    val monday = today.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))
    return when (preset) {
        WorkHistoryPreset.TODAY -> today to today
        WorkHistoryPreset.YESTERDAY -> today.minusDays(1) to today.minusDays(1)
        WorkHistoryPreset.THIS_WEEK -> monday to monday.plusDays(6)
        WorkHistoryPreset.LAST_WEEK -> monday.minusDays(7) to monday.minusDays(1)
        WorkHistoryPreset.CUSTOM -> null
    }
}

fun workHistoryRangeLabel(first: LocalDate, last: LocalDate, locale: Locale = Locale.getDefault()): String {
    val format = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    return if (first == last) first.format(format) else "${first.format(format)} – ${last.format(format)}"
}

/** Codex and Hermes summarise through the in-chat Work history capability, not this screen. */
private val UNSUPPORTED_REPORT_BACKENDS = setOf("codex-cli", "hermes-cli")

fun workHistoryReportModels(models: List<ModelOption>): List<ModelOption> =
    models.filter { it.backend !in UNSUPPORTED_REPORT_BACKENDS }

/**
 * The value sent to the desktop for a picked model. CLI models are qualified with their backend
 * ("claude-cli:sonnet"), matching the desktop model picker, so the desktop never has to guess
 * whether a bare ID belongs to an API provider or a CLI.
 */
fun workHistoryModelValue(modelId: String?, models: List<ModelOption>): String {
    val id = modelId?.takeIf { it.isNotBlank() } ?: return "default"
    if (id == "default") return id
    val backend = models.firstOrNull { it.id == id }?.backend
    return if (backend != null && !id.startsWith("$backend:")) "$backend:$id" else id
}

/** Chat titles can contain markdown headings and several lines; show a single clean line. */
fun cleanWorkHistoryTitle(raw: String?): String {
    val line = raw.orEmpty().lineSequence()
        .map { it.trim().trimStart('#', '>', '-', '*', ' ').trim() }
        .firstOrNull { it.isNotEmpty() }
    return line ?: "Untitled chat"
}

private val SOURCE_CITATION = Regex("""\[source:([^\]\r\n]+)]""", RegexOption.IGNORE_CASE)

/** Raw `[source:ID]` citations become the cited chat's title in parentheses, for display and sharing. */
fun workHistoryReportWithTitles(report: String, titles: Map<String, String>): String =
    SOURCE_CITATION.replace(report) { match ->
        val title = titles[match.groupValues[1].trim()]?.let(::cleanWorkHistoryTitle) ?: "source"
        "($title)"
    }
