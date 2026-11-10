package io.nexy.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerActivityRouteTest {
    @Test
    fun workHistoryActivityOpensItsReport() {
        assertEquals(
            "work-history?runId=d2f68d06-a422-43b2-a815-9e3e6d2ef038",
            routeForServerActivity("work-history:d2f68d06-a422-43b2-a815-9e3e6d2ef038", "work-history", null, null),
        )
    }

    @Test
    fun malformedWorkHistoryIdFallsBackToTheReportList() {
        assertEquals("work-history", routeForServerActivity("work-history:../x?y", "work-history", null, null))
    }

    @Test
    fun conversationActivitiesStillOpenTheirChat() {
        assertEquals("chat/c1", routeForServerActivity("debrief-generation:c1", "debrief-generation", "c1", null))
    }
}
