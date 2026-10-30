package io.nexy.android.data

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** Half-open epoch-millisecond interval based on calendar days in the initiating device's zone. */
data class WorkHistoryDateRange(val start: Long, val end: Long)

fun workHistoryDateRange(first: LocalDate, last: LocalDate, zone: ZoneId): WorkHistoryDateRange {
    require(!last.isBefore(first)) { "End date must not be before start date" }
    return WorkHistoryDateRange(
        first.atStartOfDay(zone).toInstant().toEpochMilli(),
        last.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli(),
    )
}

fun workHistoryWeek(date: LocalDate, zone: ZoneId): WorkHistoryDateRange {
    val monday = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    return workHistoryDateRange(monday, monday.plusDays(6), zone)
}
