package io.nexy.android.data

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkHistoryDatesTest {
    @Test
    fun calendarDayRespectsDaylightSavingChange() {
        val date = LocalDate.of(2026, 3, 29)
        val range = workHistoryDateRange(date, date, ZoneId.of("Europe/Berlin"))
        assertEquals(23L * 60 * 60 * 1000, range.end - range.start)
    }

    @Test
    fun weekStartsMondayAndEndsAfterSunday() {
        val zone = ZoneId.of("Europe/Berlin")
        val range = workHistoryWeek(LocalDate.of(2026, 10, 30), zone)
        assertEquals(workHistoryDateRange(LocalDate.of(2026, 10, 26), LocalDate.of(2026, 11, 1), zone), range)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsReversedRange() {
        workHistoryDateRange(LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 1), ZoneId.of("UTC"))
    }
}
