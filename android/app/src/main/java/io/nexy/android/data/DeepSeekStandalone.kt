package io.nexy.android.data

import org.json.JSONObject

internal fun deepSeekSupportsImages(model: String): Boolean = model.lowercase() in setOf(
    "deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
)

internal fun applyDeepSeekThinking(payload: JSONObject, effort: String?) {
    if (effort.isNullOrBlank() || effort == "default") return
    val enabled = effort != "disabled" && effort != "none"
    payload.put("thinking", JSONObject().put("type", if (enabled) "enabled" else "disabled"))
    if (enabled) {
        val mapped = when (effort) {
            "minimal", "low" -> "low"
            "max", "ultra" -> "max"
            else -> "high"
        }
        payload.put("reasoning_effort", mapped)
    }
}
