package io.nexy.android.ui.chat

import android.graphics.Typeface
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.URLSpan
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp
import io.noties.markwon.core.spans.CodeSpan
import io.noties.markwon.core.spans.EmphasisSpan
import io.noties.markwon.core.spans.LinkSpan
import io.noties.markwon.core.spans.StrongEmphasisSpan
import android.text.style.StrikethroughSpan as AndroidStrikethroughSpan

/** The two theme colours an inline markdown render needs from the active colour scheme. */
data class InlineMarkdownColors(
    val link: Color,
    val codeBackground: Color,
)

/**
 * Converts a Markwon-parsed [Spanned] into a Compose [AnnotatedString], but only when every span
 * it carries is an inline style this renderer can reproduce faithfully: bold, italic, inline code,
 * strikethrough, and links. Block-level Markwon spans — headings, bullet/ordered lists,
 * blockquotes, tables, and task-list checkboxes — have no lossless single-[AnnotatedString] form
 * (they rely on leading margins, sizing, or multi-column table layout the platform TextView draws),
 * so encountering even one of them returns null and the caller keeps rendering that segment through
 * the Markwon [android.widget.TextView].
 *
 * This is what lets the common case — the settled narration prose between tool calls — render as a
 * Compose Text, whose height is remeasured on every recompose. That avoids the LazyColumn recycle
 * race in which a reused AndroidView-hosted TextView cached a stale/short measurement and showed the
 * segment "minimized" until it was tapped.
 */
fun spannedToInlineAnnotatedString(spanned: Spanned, colors: InlineMarkdownColors): AnnotatedString? {
    val spans = spanned.getSpans(0, spanned.length, Any::class.java)
    val builder = AnnotatedString.Builder(spanned.toString())
    for (span in spans) {
        val start = spanned.getSpanStart(span)
        val end = spanned.getSpanEnd(span)
        if (start < 0 || end <= start || end > spanned.length) continue
        when (span) {
            is StrongEmphasisSpan ->
                builder.addStyle(SpanStyle(fontWeight = FontWeight.Bold), start, end)
            is EmphasisSpan ->
                builder.addStyle(SpanStyle(fontStyle = FontStyle.Italic), start, end)
            is StyleSpan -> when (span.style) {
                Typeface.BOLD ->
                    builder.addStyle(SpanStyle(fontWeight = FontWeight.Bold), start, end)
                Typeface.ITALIC ->
                    builder.addStyle(SpanStyle(fontStyle = FontStyle.Italic), start, end)
                Typeface.BOLD_ITALIC ->
                    builder.addStyle(
                        SpanStyle(fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic),
                        start,
                        end,
                    )
                // NORMAL or any other bespoke typeface style has no clean inline mapping.
                else -> return null
            }
            is CodeSpan ->
                builder.addStyle(
                    SpanStyle(fontFamily = FontFamily.Monospace, background = colors.codeBackground),
                    start,
                    end,
                )
            is AndroidStrikethroughSpan ->
                builder.addStyle(SpanStyle(textDecoration = TextDecoration.LineThrough), start, end)
            is LinkSpan ->
                builder.addLink(linkAnnotation(span.link, colors.link), start, end)
            is URLSpan ->
                builder.addLink(linkAnnotation(span.url, colors.link), start, end)
            // Markwon's strikethrough extension applies its own span type; match it by name so we
            // do not have to compile against ext-strikethrough's internal class directly.
            else -> {
                if (span.javaClass.simpleName == "StrikethroughSpan") {
                    builder.addStyle(SpanStyle(textDecoration = TextDecoration.LineThrough), start, end)
                } else {
                    // Any span we don't recognise (headings, lists, blockquotes, tables, task
                    // lists, …) means this segment isn't losslessly inline — fall back to Markwon.
                    return null
                }
            }
        }
    }
    return builder.toAnnotatedString()
}

/** Adds a case-insensitive find-in-chat marker without disturbing existing markdown styles. */
fun AnnotatedString.withSearchHighlights(query: String?, background: Color): AnnotatedString {
    val needle = query?.trim().orEmpty()
    if (needle.isEmpty()) return this
    val source = text
    return AnnotatedString.Builder().apply {
        append(this@withSearchHighlights)
        var start = source.indexOf(needle, ignoreCase = true)
        while (start >= 0) {
            addStyle(SpanStyle(background = background), start, start + needle.length)
            start = source.indexOf(needle, start + needle.length, ignoreCase = true)
        }
    }.toAnnotatedString()
}

private fun linkAnnotation(url: String, color: Color) = LinkAnnotation.Url(
    url,
    TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline)),
)

/** Literal Markdown source used by the chat's raw view. Selection is retained, while Compose
 * preserves fences, markers, indentation, and line breaks without invoking Markwon. */
@Composable
fun RawMarkdownText(markdown: String, modifier: Modifier = Modifier, searchQuery: String? = null) {
    SelectionContainer(modifier = modifier.fillMaxWidth()) {
        Text(
            text = AnnotatedString(markdown).withSearchHighlights(
                searchQuery,
                MaterialTheme.colorScheme.primary.copy(alpha = 0.35f),
            ),
            color = MaterialTheme.colorScheme.onSurface,
            fontFamily = FontFamily.Monospace,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            softWrap = true,
        )
    }
}
