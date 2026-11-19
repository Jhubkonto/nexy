package io.nexy.android.data

import io.nexy.android.data.model.HERMES_DEFAULT_PROFILE
import io.nexy.android.data.model.hermesProfileLabel
import io.nexy.android.data.model.hermesSourceKey
import io.nexy.android.data.model.parseHermesSourceKey
import io.nexy.android.data.model.resolveEffectiveHermesProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Kotlin twins of the picker helpers in `src/shared/hermes.ts`; outputs must match. */
class HermesProfileHelpersTest {
    @Test
    fun sourceKeyRoundTrips() {
        assertEquals("hermes-cli:localllm", hermesSourceKey("localllm"))
        assertEquals("localllm-iso", parseHermesSourceKey(hermesSourceKey("localllm-iso")))
        assertEquals(HERMES_DEFAULT_PROFILE, parseHermesSourceKey("hermes-cli:default"))
    }

    @Test
    fun nonProfileKeysParseToNull() {
        assertNull(parseHermesSourceKey("hermes-cli"))
        assertNull(parseHermesSourceKey("hermes-cli:"))
        assertNull(parseHermesSourceKey("codex-cli"))
        assertNull(parseHermesSourceKey("openrouter"))
        assertNull(parseHermesSourceKey(null))
    }

    @Test
    fun labelsDistinguishDefaultProfile() {
        assertEquals("Hermes · Default", hermesProfileLabel("default", isDefault = true))
        assertEquals("Hermes · localllm", hermesProfileLabel("localllm"))
    }

    @Test
    fun precedenceIsConversationThenAgentThenDefault() {
        assertEquals("conv", resolveEffectiveHermesProfile("conv", "agent"))
        assertEquals("agent", resolveEffectiveHermesProfile(null, "agent"))
        assertEquals("agent", resolveEffectiveHermesProfile("  ", "agent"))
        assertEquals(HERMES_DEFAULT_PROFILE, resolveEffectiveHermesProfile(null, null))
    }
}
