package io.nexy.android.ui.chat

import android.text.SpannableStringBuilder
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableTheme
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import io.noties.markwon.syntax.Prism4jTheme
import io.noties.markwon.syntax.SyntaxHighlightPlugin
import io.noties.prism4j.Prism4j

/** The themed Markwon instance used for all chat markdown (tables, code highlighting, task lists). */
@Composable
fun rememberChatMarkwon(): Markwon {
    val context = LocalContext.current
    val colorScheme = MaterialTheme.colorScheme
    return remember(context, colorScheme) {
        val prism4j = Prism4j(io.nexy.android.GrammarLocatorDef())
        // Custom theme: subtle tinted background with readable dark text instead of Darkula black
        val codeTheme = object : Prism4jTheme {
            override fun background(): Int = 0xFF1E1F2E.toInt() // deep navy, visible in both themes
            override fun textColor(): Int = 0xFFE8EAF6.toInt() // soft lavender-white
            override fun apply(language: String, syntax: io.noties.prism4j.Prism4j.Syntax, builder: SpannableStringBuilder, start: Int, end: Int) = Unit
        }
        val dip = io.noties.markwon.utils.Dip.create(context)
        val tableTheme = TableTheme.emptyBuilder()
            .tableBorderColor(colorScheme.outlineVariant.toArgb())
            .tableBorderWidth(dip.toPx(1))
            .tableCellPadding(dip.toPx(8))
            .tableHeaderRowBackgroundColor(colorScheme.surfaceVariant.toArgb())
            .tableEvenRowBackgroundColor(colorScheme.surface.toArgb())
            .tableOddRowBackgroundColor(colorScheme.surfaceVariant.copy(alpha = 0.3f).toArgb())
            .build()
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(tableTheme))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(SyntaxHighlightPlugin.create(prism4j, codeTheme))
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(
                TaskListPlugin.create(
                    colorScheme.primary.toArgb(),
                    colorScheme.onPrimary.toArgb(),
                    colorScheme.outline.toArgb(),
                ),
            )
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder
                        .linkColor(colorScheme.primary.toArgb())
                        .codeTextColor(colorScheme.onSurfaceVariant.toArgb())
                        .codeBackgroundColor(colorScheme.surfaceVariant.toArgb())
                        .blockQuoteColor(colorScheme.outline.toArgb())
                }
            })
            .build()
    }
}
