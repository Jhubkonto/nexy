package io.nexy.android.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DeepSeekStandaloneTest {
    @Test fun visionIsLimitedToFlashAliases() {
        assertTrue(deepSeekSupportsImages("deepseek-flash"))
        assertTrue(deepSeekSupportsImages("deepseek-v4-flash-vision-exp"))
        assertFalse(deepSeekSupportsImages("deepseek-v4-pro"))
        assertFalse(deepSeekSupportsImages("deepseek-unknown"))
    }

    @Test fun thinkingMatchesAgentEffort() {
        val disabled = JSONObject()
        applyDeepSeekThinking(disabled, "disabled")
        assertEquals("disabled", disabled.getJSONObject("thinking").getString("type"))
        assertFalse(disabled.has("reasoning_effort"))
        val enabled = JSONObject()
        applyDeepSeekThinking(enabled, "max")
        assertEquals("enabled", enabled.getJSONObject("thinking").getString("type"))
        assertEquals("max", enabled.getString("reasoning_effort"))
        val default = JSONObject()
        applyDeepSeekThinking(default, null)
        assertFalse(default.has("thinking"))
    }
}
