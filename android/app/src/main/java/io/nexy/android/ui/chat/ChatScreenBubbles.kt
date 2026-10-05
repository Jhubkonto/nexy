package io.nexy.android.ui.chat

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.text.method.LinkMovementMethod
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Difference
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Summarize
import androidx.compose.animation.Crossfade
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.foundation.BorderStroke
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyInfoIcon
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.Blue100
import io.nexy.android.ui.theme.Blue400
import io.nexy.android.ui.theme.Blue500
import io.nexy.android.ui.theme.Blue900
import io.nexy.android.ui.theme.Gray100
import io.nexy.android.ui.theme.Gray400
import io.nexy.android.ui.theme.Gray500
import io.nexy.android.ui.theme.Gray900
import io.nexy.android.ui.theme.Green500
import io.nexy.android.ui.theme.Indigo50
import io.nexy.android.ui.theme.Indigo200
import io.nexy.android.ui.theme.Indigo400
import io.nexy.android.ui.theme.Indigo500
import io.nexy.android.ui.theme.Indigo900
import io.nexy.android.ui.theme.Indigo950
import io.nexy.android.ui.theme.LocalNexyColors
import io.nexy.android.ui.theme.Purple50
import io.nexy.android.ui.theme.Purple200
import io.nexy.android.ui.theme.Purple400
import io.nexy.android.ui.theme.Purple500
import io.nexy.android.ui.theme.Purple700
import io.nexy.android.ui.theme.Purple900
import io.nexy.android.ui.theme.Purple950
import io.nexy.android.ui.theme.Red500
import io.noties.markwon.Markwon
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

val LocalMarkwon = compositionLocalOf<Markwon> { error("No Markwon provided") }

// Above this source length an uncached settled row parses off the UI thread instead of
// synchronously, trading a possible one-frame raw→rich height change (the truncation risk below)
// for not stalling the frame on a pathologically large single message. Typical Claude CLI replies
// and their individual text segments are far under this, so they take the synchronous path.
private const val SYNC_PARSE_MAX_CHARS = 20_000

/**
 * Parsed Markdown for settled (non-streaming) text. Streaming callers pass their own null and
 * never reach here.
 *
 * Parsing must resolve to a non-null Spanned on the FIRST composition, not a frame later. The
 * embedded Markwon TextView lives in a per-segment LazyColumn item; if the row is first measured
 * against raw/placeholder text and the parsed rich text (headings, lists, tables — taller) arrives
 * afterwards, that later height change does not reliably re-drive the item's remeasure. Neither an
 * in-place raw→rich TextView update nor a Compose Text→AndroidView swap propagates it: LazyColumn
 * keeps the shorter committed height and the last block-level segment renders truncated until some
 * unrelated relayout (expanding a sibling tool-call bubble, or a manual refresh that runs against a
 * now-warm cache) forces the whole list to re-measure. Seeding the parse state synchronously (and
 * re-seeding it on every markdown change, see below) makes the cold-open path identical to that
 * known-good warm-cache path: the view is born at its correct rich height, so there is no late
 * height change to lose.
 *
 * Only visible per-segment lazy items compose, so this is bounded to what's on screen (the original
 * concern — parsing a whole bundled history in one frame — predates segments being separate items).
 * Cached entries are an instant map lookup; oversized uncached content still parses on Default.
 */
@Composable
private fun rememberParsedMarkdown(markwon: Markwon, markdown: String): android.text.Spanned? {
    // Key the state holder on (markwon, markdown) so a mid-life content change re-seeds
    // synchronously instead of keeping the previous Spanned. This matters because an assistant
    // message's body can grow *in place* after the row is already composed — the history load
    // delivers a short preview (e.g. 135 chars) and the full reply (e.g. 3143 chars) arrives a
    // beat later against the same LazyColumn key. produceState cannot express this: its
    // initialValue seed is evaluated only on first composition, and its producer guard
    // (`if (value == null)`) is false once the short body has parsed, so the new, longer markdown
    // never reparses. The stale Spanned then makes applyMarkdownOrFallback early-return on tag
    // identity, and the TextView keeps its short text *and short measured height* — the tail
    // renders truncated until the item is disposed and recomposed fresh (a scroll nudge, or an
    // unrelated sibling relayout recycling it). Re-seeding here on every markdown change makes the
    // in-place update identical to that known-good fresh-composition path.
    val state = remember(markwon, markdown) {
        mutableStateOf(
            MarkdownRenderCache.get(markwon, markdown)
                ?: if (markdown.length <= SYNC_PARSE_MAX_CHARS) MarkdownRenderCache.getOrParse(markwon, markdown) else null,
        )
    }
    LaunchedEffect(markwon, markdown) {
        if (state.value == null) {
            state.value = withContext(Dispatchers.Default) {
                MarkdownRenderCache.getOrParse(markwon, markdown)
            }
        }
    }
    return state.value
}

private fun applyMarkdownOrFallback(
    markwon: Markwon,
    textView: TextView,
    markdown: String,
    parsedMarkdown: android.text.Spanned?,
) {
    // A Spanned is used as the tag so a raw fallback and the final rich text are distinct even
    // though they share the same markdown source. This avoids reparsing/reapplying during
    // unrelated parent recompositions.
    if (parsedMarkdown == null) {
        if (textView.tag == markdown) return
        textView.text = markdown
        textView.tag = markdown
    } else {
        if (textView.tag === parsedMarkdown) return
        markwon.setParsedMarkdown(textView, parsedMarkdown)
        textView.tag = parsedMarkdown
    }
    // LazyColumn can compose/measure this row (e.g. during prefetch, or right as it scrolls
    // into view) before it has settled on its final width. TextView.setText() only requests a
    // layout pass if the View is already attached with a live parent; when that first pass
    // lands against a stale/near-zero width, the resulting StaticLayout wraps one character per
    // line and never self-corrects because nothing about the (unchanged) text or tag triggers
    // another measure. Forcing requestLayout() here guarantees a fresh measure against whatever
    // width Compose is actually imposing right now, instead of leaning on a lucky recycle.
    textView.requestLayout()
}

internal fun isMarkdownWidthReady(targetWidthPx: Int, viewWidthPx: Int, parentWidthPx: Int): Boolean =
    targetWidthPx > 0 && viewWidthPx >= targetWidthPx && parentWidthPx >= targetWidthPx

/**
 * Compose can update an AndroidView before its holder has completed layout. Setting TextView
 * content during that window lets TextView create a zero-width StaticLayout which can survive
 * the later 879px outer layout. Keep only the latest render request and apply it once both the
 * TextView and its Compose holder have a real width.
 */
private class WidthStableMarkdownTextView(context: Context) : TextView(context) {
    private var targetWidthPx: Int = 1
    private var pendingRender: (() -> Unit)? = null

    init {
        addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> applyPendingIfWidthReady() }
        addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {
                applyPendingIfWidthReady()
            }
            override fun onViewDetachedFromWindow(view: View) = Unit
        })
    }

    fun submitRender(widthPx: Int, render: () -> Unit): Boolean {
        targetWidthPx = widthPx.coerceAtLeast(1)
        pendingRender = render
        val applied = applyPendingIfWidthReady()
        if (!applied) requestLayout()
        return applied
    }

    private fun applyPendingIfWidthReady(): Boolean {
        val parentWidth = (parent as? View)?.width ?: 0
        if (!isMarkdownWidthReady(targetWidthPx, width, parentWidth)) return false
        val render = pendingRender ?: return true
        pendingRender = null
        render()
        return true
    }

    /**
     * Drop any queued (deferred) render without applying it. The settled path applies its markdown
     * synchronously against the already-pinned width, so a leftover streaming defer from before the
     * turn settled must be cancelled — otherwise it could fire later and overwrite the rich text
     * with the raw streaming string.
     */
    fun cancelPendingRender() {
        pendingRender = null
    }
}

/**
 * Rendering boundary for all Markwon-backed chat text.
 *
 * Settled (non-streaming) text is rendered as a Compose [Text] whenever its markdown is made up
 * only of inline styling (bold/italic/inline-code/strikethrough/links) — see
 * [spannedToInlineAnnotatedString]. A Compose Text remeasures its height on every recompose, so a
 * recycled LazyColumn row can never keep a stale/short measurement, which is what made settled
 * narration segments render "minimized" until tapped. Streaming text, and settled text that carries
 * block-level markdown (headings, lists, blockquotes, tables, task lists) that has no lossless
 * inline form, keep going through the width-safe Markwon [android.widget.TextView] path.
 */
@Composable
internal fun ChatMarkdownText(
    markdown: String,
    streaming: Boolean,
    debugKey: String,
    viewMode: MarkdownViewMode = MarkdownViewMode.Rendered,
    modifier: Modifier = Modifier,
) {
    if (viewMode == MarkdownViewMode.Raw) {
        RawMarkdownText(markdown, modifier)
        return
    }
    if (!streaming) {
        val markwon = LocalMarkwon.current
        val parsed = rememberParsedMarkdown(markwon, markdown)
        val inlineColors = InlineMarkdownColors(
            link = MaterialTheme.colorScheme.primary,
            codeBackground = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        )
        val annotated = remember(parsed, inlineColors) {
            parsed?.let { spannedToInlineAnnotatedString(it, inlineColors) }
        }
        // Only take the Compose Text fast path once parsing has *confirmed* the content is
        // inline-only (annotated != null). While parsing is still in flight (parsed == null) we must
        // NOT render a transient raw Compose Text: if the markdown turns out to be block-level, the
        // node type then swaps Compose Text → Markwon AndroidView, and LazyColumn commits the
        // shorter Compose-Text height without re-measuring the taller AndroidView — truncating the
        // last segment on a cold open until a manual refresh (warm parse cache) hides the transient.
        // Falling through to the AndroidView during parsing updates the same TextView raw→rich in
        // place (requestLayout remeasures reliably), so no height-dropping view-type swap occurs.
        if (annotated != null) {
            SelectionContainer(modifier = modifier.fillMaxWidth()) {
                Text(
                    text = annotated,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                )
            }
            return
        }
    }
    ChatMarkdownAndroidView(markdown = markdown, streaming = streaming, debugKey = debugKey, modifier = modifier)
}

/** Width-safe Android TextView boundary for streaming text and block-level Markwon content. */
@Composable
private fun ChatMarkdownAndroidView(
    markdown: String,
    streaming: Boolean,
    debugKey: String,
    modifier: Modifier = Modifier,
) {
    val textColorArgb = MaterialTheme.colorScheme.onSurface.toArgb()
    // Text-selection highlight for the native TextView path. Mirrors Compose's default
    // SelectionContainer background (primary @ 0.4 alpha) so selected block-level markdown
    // (headings/lists) shows a visible tinted band instead of an invisible highlight.
    val selectionHighlightArgb = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f).toArgb()
    val markwon = LocalMarkwon.current
    val parsedMarkdown = if (streaming) null else rememberParsedMarkdown(markwon, markdown)
    val displayedText = if (streaming) rememberRevealedText(markdown) else markdown
    val fadeAlpha = if (streaming) rememberStreamFadeAlpha(displayedText.length) else 1f
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val exactWidthPx = with(LocalDensity.current) { maxWidth.roundToPx() }.coerceAtLeast(1)
        LaunchedEffect(debugKey, exactWidthPx) {
            ChatLayoutDiagnostics.record(
                debugKey,
                "markdown-constraints",
                exactWidthPx,
                0,
                "chars=${markdown.length} streaming=$streaming",
            )
        }
        AndroidView(
            modifier = Modifier
                .width(maxWidth)
                .streamFade(fadeAlpha)
                .onGloballyPositioned { coordinates ->
                    ChatLayoutDiagnostics.record(
                        debugKey,
                        "android-view-holder",
                        coordinates.size.width,
                        coordinates.size.height,
                    )
                    // Late-growth cross-check: the Markwon view's own measured height. If this grows
                    // after settling but the hosting "row" stream does not, the row clipped the tail.
                    ChatLayoutDiagnostics.noteHeight(debugKey, "holder", coordinates.size.height)
                },
            factory = { context ->
                WidthStableMarkdownTextView(context).also { view ->
                    view.layoutParams = ViewGroup.LayoutParams(
                        exactWidthPx,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                    )
                    view.minWidth = exactWidthPx
                    view.maxWidth = exactWidthPx
                    view.textSize = 14f
                    view.setTextIsSelectable(true)
                    // Markwon produces URLSpan/LinkSpan instances, but TextView does not
                    // dispatch them unless a movement method is installed. Without this,
                    // block-level markdown links look clickable but silently do nothing.
                    view.movementMethod = LinkMovementMethod.getInstance()
                    view.linksClickable = true
                    view.highlightColor = selectionHighlightArgb
                    view.addOnLayoutChangeListener { laidOutView, left, top, right, bottom, _, _, _, _ ->
                        val textView = laidOutView as TextView
                        val textLayout = textView.layout
                        ChatLayoutDiagnostics.record(
                            debugKey,
                            "text-view-layout",
                            right - left,
                            bottom - top,
                            "layoutWidth=${textLayout?.width ?: -1} lines=${textLayout?.lineCount ?: -1} " +
                                "parentWidth=${(textView.parent as? android.view.View)?.width ?: -1}",
                        )
                    }
                }
            },
            update = { view ->
                if (view.layoutParams.width != exactWidthPx) {
                    view.layoutParams = view.layoutParams.also { it.width = exactWidthPx }
                }
                view.minWidth = exactWidthPx
                view.maxWidth = exactWidthPx
                view.setTextColor(textColorArgb)
                view.highlightColor = selectionHighlightArgb
                if (streaming) {
                    // Streaming text changes on every chunk and its width can still be settling, so
                    // keep deferring the render until the view has a real width (the original
                    // one-glyph-StaticLayout guard).
                    val appliedImmediately = view.submitRender(exactWidthPx) {
                        if (view.text.toString() != displayedText || view.tag != null) {
                            view.text = displayedText
                            view.tag = null
                        }
                        view.requestLayout()
                    }
                    if (!appliedImmediately) {
                        ChatLayoutDiagnostics.record(
                            debugKey,
                            "markdown-deferred",
                            view.width,
                            view.height,
                            "targetWidth=$exactWidthPx parentWidth=${(view.parent as? View)?.width ?: -1}",
                        )
                    }
                } else {
                    // Settled content: the width is already hard-pinned to exactWidthPx via
                    // layoutParams.width/minWidth/maxWidth (an exact px from Compose constraints,
                    // known now), so the StaticLayout cannot wrap to one glyph regardless of attach
                    // state — the width-deferral used for streaming is not just unnecessary here, it
                    // caused the "minimized response" bug: withholding the text until the TextView
                    // reported its own width meant the first layout pass measured an EMPTY view, the
                    // LazyColumn committed that near-zero height, and the row stayed collapsed until
                    // a tap forced a relayout. Cancel any leftover streaming defer and apply the
                    // markdown synchronously so the very first pass measures the true height.
                    view.cancelPendingRender()
                    applyMarkdownOrFallback(markwon, view, markdown, parsedMarkdown)
                }
                view.post {
                    val textLayout = view.layout
                    ChatLayoutDiagnostics.record(
                        debugKey,
                        "text-view",
                        view.measuredWidth,
                        view.measuredHeight,
                        "viewWidth=${view.width} layoutWidth=${textLayout?.width ?: -1} " +
                            "lines=${textLayout?.lineCount ?: -1} parentWidth=${(view.parent as? View)?.width ?: -1} " +
                            "attached=${view.isAttachedToWindow}",
                    )
                }
            },
        )
    }
}

@Composable
fun ChatStartHeader() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 24.dp, bottom = 12.dp, start = 16.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
            thickness = 0.5.dp,
        )
        Text(
            "Start of conversation",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f),
        )
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
            thickness = 0.5.dp,
        )
    }
}

/**
 * The ephemeral "awaiting response" indicator, shown before any text/reasoning has streamed in
 * for a turn. Mirrors desktop's `live-activity` render item (ChatMessages.tsx:636-661) exactly:
 * icon+label row, then a bouncing-dots row *below* it — not the raw backend activity label text
 * (e.g. a CLI-specific "Started Codex turn." string), and not purple — this is a distinct visual
 * state from the (purple) reasoning-content bubbles below, gated on `activity.state`, not on
 * whatever raw text the backend happened to send.
 */
@Composable
fun ThinkingBubble(activity: ChatTurnActivity, generationStartedAt: Long? = null) {
    // Seed from the start time so a recomposition (e.g. the activity flipping tool↔thinking, or a
    // mid-turn re-entry) resumes at the true elapsed value instead of flashing back to 0.
    fun elapsedFrom(start: Long?): Int =
        if (start == null || start == 0L) 0
        else ((System.currentTimeMillis() - start) / 1000L).toInt().coerceAtLeast(0)
    var elapsedSec by remember(generationStartedAt) { mutableIntStateOf(elapsedFrom(generationStartedAt)) }
    LaunchedEffect(generationStartedAt) {
        if (generationStartedAt == null || generationStartedAt == 0L) {
            elapsedSec = 0
            return@LaunchedEffect
        }
        while (true) {
            elapsedSec = elapsedFrom(generationStartedAt)
            delay(250L)
        }
    }
    val isTool = activity.state == "tool"
    val isDark = LocalNexyColors.current.isDark
    val blue = if (isDark) Blue400 else Blue500
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val dotColor = if (isDark) Gray500 else Gray400

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (isTool) {
                NexyIcon(
                    NexyIconName.Tool,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = blue,
                )
            } else {
                // A determinate-looking loading spinner — not the rotating arrow (Busy/Refresh),
                // which reads as "restarting/retrying" rather than "working".
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp,
                    color = textColor,
                )
            }
            if (isTool) {
                val toolLabel = activity.toolName ?: activity.label
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Using ", style = MaterialTheme.typography.bodyMedium, color = textColor)
                    Text(toolLabel, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, color = blue)
                    if (!activity.serverName.isNullOrBlank()) {
                        Text(" · ${activity.serverName}", style = MaterialTheme.typography.bodyMedium, color = dotColor)
                    }
                }
            } else {
                val contextLabel = activity.label.takeIf {
                    Regex("""~[\d,]+ tokens""", RegexOption.IGNORE_CASE).containsMatchIn(it) ||
                        it.contains("context", ignoreCase = true) ||
                        it.contains("attachments", ignoreCase = true) ||
                        it.contains("project files", ignoreCase = true) ||
                        it.contains("project wiki", ignoreCase = true) ||
                        it.contains("agent knowledge", ignoreCase = true) ||
                        it.contains("past strategies", ignoreCase = true)
                }
                Text(
                    contextLabel ?: if (elapsedSec > 0) "Thinking · ${elapsedSec}s" else "Thinking...",
                    style = MaterialTheme.typography.bodyMedium,
                    color = textColor,
                )
            }
        }
        TypingDots(dotColor)
    }
}

@Composable
fun TypingDots(dotColor: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(
                        dotColor,
                        RoundedCornerShape(1.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(dotColor, RoundedCornerShape(1.dp)),
                )
            }
        }
    }
}

// Inline card is hard-capped to this many lines (with ellipsis overflow) regardless of
// content length or streaming state; the fullscreen dialog is the only way to read past it.
private const val THINKING_INLINE_MAX_LINES = 3

/** Provider usage arrives after generation, so live reasoning uses the same deliberately
 * approximate four-characters-per-token counter as desktop. */
internal fun estimateLiveReasoningTokens(text: String): Int =
    if (text.isEmpty()) 0 else maxOf(1, (text.length + 3) / 4)

internal fun formatLiveReasoningTokens(tokens: Int): String =
    "~$tokens ${if (tokens == 1) "token" else "tokens"}"

@Composable
fun ThinkingHistoryBubble(
    blocks: List<ThinkingBlock>,
    isLive: Boolean = false,
) {
    if (blocks.isEmpty()) return
    // Saveable so a collapse/expand the user performs survives LazyColumn recycling on scroll —
    // same rationale as ToolCallBubble's `expanded`.
    var collapsed by rememberSaveable { mutableStateOf(false) }
    var showFullscreen by remember { mutableStateOf(false) }
    val totalChars = blocks.sumOf { it.content.length }
    val combinedContent = remember(blocks) { blocks.joinToString("\n\n") { it.content } }
    val tokenCount = estimateLiveReasoningTokens(combinedContent)

    // Fade in on first appearance — this bubble is often nested inline inside an
    // AssistantMessage item rather than its own lazy item, so it doesn't get the
    // LazyColumn's animateItem() fade; animate it directly instead. Gated to isLive only:
    // this composable's `remember` state lives inside the parent AssistantMessage item's
    // composition, not its own lazy item, so scrolling a tall message (many reasoning
    // blocks) off-screen and back disposes and recomposes it from scratch — alpha would
    // reset to 0 and this LaunchedEffect would refire, replaying the fade every time a
    // historical block scrolls back into view. That's the "jitter" scrolling past a long
    // reasoning-heavy turn. Only a genuinely new live/streaming block should fade in.
    val isDark = LocalNexyColors.current.isDark
    val textColor = if (isDark) Purple400 else Purple700
    val iconColor = if (isDark) Purple400 else Purple500
    val contentTextColor = if (isDark) Color(0xFFE9D5FF) else Purple900

    ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = isLive), pulse = isLive) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { collapsed = !collapsed }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                NexyIcon(
                    NexyIconName.Inspect,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = iconColor,
                )
                Text(
                    if (totalChars > 0) "Reasoning · ${formatLiveReasoningTokens(tokenCount)}" else "Reasoning…",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = textColor,
                    modifier = Modifier.weight(1f),
                )
                if (!collapsed && totalChars > 0) {
                    IconButton(onClick = { showFullscreen = true }, modifier = Modifier.size(24.dp)) {
                        NexyIcon(
                            NexyIconName.Expand,
                            contentDescription = "View full reasoning text",
                            modifier = Modifier.size(13.dp),
                            tint = iconColor,
                        )
                    }
                }
                NexyIcon(
                    if (collapsed) NexyIconName.ChevronRight else NexyIconName.ChevronDown,
                    contentDescription = if (collapsed) "Expand thinking" else "Collapse thinking",
                    modifier = Modifier.size(16.dp),
                    tint = iconColor,
                )
            }
            if (!collapsed) {
                SelectionContainer(
                    modifier = Modifier
                        .padding(vertical = 4.dp)
                        .fillMaxWidth(),
                ) {
                    Text(
                        combinedContent,
                        fontSize = 13.sp,
                        lineHeight = 20.sp,
                        color = contentTextColor,
                        maxLines = THINKING_INLINE_MAX_LINES,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }

    if (showFullscreen) {
        ThinkingFullscreenDialog(
            content = combinedContent,
            contentTextColor = contentTextColor,
            onDismiss = { showFullscreen = false },
        )
    }
}

/**
 * Full-screen reader for a reasoning block's complete text. The inline card caps at
 * [THINKING_INLINE_MAX_LINES] lines with ellipsis overflow, so this is the only way to read
 * a long block past that cap — mirrors CodeBlockWebView's fullscreen dialog for the same reason and UX.
 */
@Composable
private fun ThinkingFullscreenDialog(
    content: String,
    contentTextColor: Color,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            SelectionContainer(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            ) {
                Text(
                    content,
                    fontSize = 14.sp,
                    lineHeight = 22.sp,
                    color = contentTextColor,
                )
            }
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Close fullscreen reasoning view",
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
    }
}

/**
 * A single settled piece of the assistant's response. This is deliberately a response-only
 * component: it has no collapsed state, click handler, line cap, or ellipsis. Reasoning uses
 * ThinkingHistoryBubble/CliReasoningActionLine instead and is the only content allowed to
 * expose expand/collapse controls.
 */
@Composable
fun ExpandedResponseTextSegment(
    content: String,
    debugKey: String = "response-text-segment",
    viewMode: MarkdownViewMode = MarkdownViewMode.Rendered,
) {
    if (content.isBlank()) return
    if (viewMode == MarkdownViewMode.Raw) {
        RawMarkdownText(content)
        return
    }
    val segments = remember(content) { splitCodeBlocks(content) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        segments.forEachIndexed { index, segment ->
            key(index) {
                when (segment) {
                    is MessageSegment.Text -> {
                        if (segment.markdown.isNotBlank()) {
                            ChatMarkdownText(
                                segment.markdown,
                                streaming = false,
                                debugKey = "$debugKey:$index",
                            )
                        }
                    }
                    is MessageSegment.Code -> {
                        CodeBlockWebView(language = segment.language, code = segment.code)
                    }
                }
            }
        }
    }
}

@Composable
fun MessageBubble(
    msg: ChatMessage,
    // Overrides what's actually rendered in the bubble body while msg.text (the full
    // reply) still goes to onCopy/onShare/etc below — set when an earlier part of the
    // reply already rendered as its own TextSegmentItem above, so repeating it here
    // would duplicate it on screen. Null renders msg.text as before.
    displayText: String? = null,
    onCopy: () -> Unit,
    onEdit: (() -> Unit)?,
    onResend: (() -> Unit)?,
    onDelete: (() -> Unit)? = null,
    onDeleteAfter: (() -> Unit)? = null,
    onRetry: (() -> Unit)? = null,
    onEditAssistant: (() -> Unit)? = null,
    onBranch: (() -> Unit)? = null,
    onAddToProject: (() -> Unit)? = null,
    onSaveAsArtifact: (() -> Unit)? = null,
    onSaveAsPrompt: (() -> Unit)? = null,
    onShare: (() -> Unit)? = null,
    isHighlighted: Boolean = false,
    markdownViewMode: MarkdownViewMode = MarkdownViewMode.Rendered,
) {
    val isUser = msg.isUser
    val timeLabel = relativeTime(msg.timestamp)
    // What's actually rendered in the bubble body — msg.text (the full reply) unless a
    // tail-only override was supplied (see the `displayText` param doc above).
    val effectiveText = displayText ?: msg.text
    val effectiveRawText = displayText ?: msg.rawText ?: effectiveText
    val layoutDebugKey = "message:${msg.id.ifBlank { msg.timestamp.toString() }}"

    if (!isUser) {
        // --- Assistant: full-width, no bubble, left-border accent ---
        var menuExpanded by remember { mutableStateOf(false) }
        var overflowExpanded by remember { mutableStateOf(false) }
        val textColor = MaterialTheme.colorScheme.onSurface
        val textColorArgb = textColor.toArgb()
        val markwon = LocalMarkwon.current

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 2.dp),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .combinedClickable(onClick = {}, onLongClick = { menuExpanded = true }),
            ) {
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(text = { Text("Copy") }, onClick = { menuExpanded = false; onCopy() })
                    if (onSaveAsPrompt != null) DropdownMenuItem(text = { Text("Save as prompt") }, onClick = { menuExpanded = false; onSaveAsPrompt() })
                    if (onRetry != null) DropdownMenuItem(text = { Text("Retry") }, onClick = { menuExpanded = false; onRetry() })
                    if (onEditAssistant != null) DropdownMenuItem(text = { Text("Edit message") }, onClick = { menuExpanded = false; onEditAssistant() })
                    if (onBranch != null) DropdownMenuItem(text = { Text("Fork from here") }, onClick = { menuExpanded = false; onBranch() })
                    if (onAddToProject != null) DropdownMenuItem(text = { Text("Save to wiki") }, onClick = { menuExpanded = false; onAddToProject() })
                    if (onSaveAsArtifact != null) DropdownMenuItem(text = { Text("Save as artifact") }, onClick = { menuExpanded = false; onSaveAsArtifact() })
                    if (onDelete != null) DropdownMenuItem(text = { Text("Delete") }, onClick = { menuExpanded = false; onDelete() })
                    if (onDeleteAfter != null) DropdownMenuItem(text = { Text("Delete from here") }, onClick = { menuExpanded = false; onDeleteAfter() })
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .onGloballyPositioned { coordinates ->
                            ChatLayoutDiagnostics.record(
                                layoutDebugKey,
                                "assistant-row",
                                coordinates.size.width,
                                coordinates.size.height,
                                "chars=${effectiveText.length} streaming=${msg.isStreaming}",
                            )
                        },
                ) {
                    // left-border accent
                    Box(
                        modifier = Modifier
                            .width(2.dp)
                            .height(if (effectiveText.isBlank()) 20.dp else 36.dp)
                            .background(
                                MaterialTheme.colorScheme.outlineVariant,
                                RoundedCornerShape(1.dp),
                            )
                            .padding(end = 12.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(
                        // This is a Row child beside the accent and spacer. fillMaxWidth() is
                        // not a remaining-space contract inside Row: during LazyColumn
                        // prefetch/reuse it can be measured after the fixed children with a
                        // near-zero maximum and keep that one-glyph StaticLayout. Weight gives
                        // it an explicit, stable share of the Row on every measurement pass.
                        modifier = Modifier
                            .weight(1f)
                            .onGloballyPositioned { coordinates ->
                                ChatLayoutDiagnostics.record(
                                    layoutDebugKey,
                                    "assistant-content-column",
                                    coordinates.size.width,
                                    coordinates.size.height,
                                )
                            },
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (effectiveText.isNotBlank()) {
                            if (markdownViewMode == MarkdownViewMode.Raw) {
                                RawMarkdownText(effectiveRawText)
                            } else {
                            // Fenced code blocks are pulled out of the markdown before Markwon
                            // ever sees it and rendered by a dedicated composable (plain text
                            // while streaming, a syntax-highlighted WebView island once
                            // settled) — everything else still goes through Markwon/TextView.
                            val segments = remember(effectiveText) { splitCodeBlocks(effectiveText) }
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                segments.forEachIndexed { index, segment ->
                                    key(index) {
                                        when (segment) {
                                            is MessageSegment.Text -> {
                                                if (segment.markdown.isNotBlank()) {
                                                    // Always the same TextView instance — switching between a
                                                    // Compose Text and this AndroidView based on isStreaming
                                                    // caused a hard view-type swap (a visible pop) the instant
                                                    // streaming ended. Plain text is set directly while
                                                    // streaming to avoid re-parsing markdown on every chunk;
                                                    // Markwon only parses once the message settles.
                                                    // While streaming, revealedText trails the raw accumulated
                                                    // chunk (rememberRevealedText) instead of snapping straight
                                                    // to it, and fadeAlpha gives newly-revealed text a soft
                                                    // fade-in rather than popping to full opacity.
                                                    ChatMarkdownText(
                                                        markdown = segment.markdown,
                                                        streaming = msg.isStreaming,
                                                        debugKey = "message:${msg.id.ifBlank { msg.timestamp.toString() }}:$index",
                                                    )
                                                }
                                            }
                                            is MessageSegment.Code -> {
                                                if (msg.isStreaming) {
                                                    // No WebView while streaming — creating/tearing one
                                                    // down on every streamed chunk would be expensive and
                                                    // jank-prone. Real syntax highlighting kicks in once
                                                    // the message settles, matching the Markwon text swap.
                                                    Surface(
                                                        modifier = Modifier.fillMaxWidth(),
                                                        color = Color(0xFF1E1E2E),
                                                        shape = RoundedCornerShape(8.dp),
                                                    ) {
                                                        Text(
                                                            segment.code,
                                                            modifier = Modifier.padding(12.dp),
                                                            color = Color(0xFFCDD6F4),
                                                            fontFamily = FontFamily.Monospace,
                                                            style = MaterialTheme.typography.bodySmall,
                                                        )
                                                    }
                                                } else {
                                                    CodeBlockWebView(
                                                        language = segment.language,
                                                        code = segment.code,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            }
                        }
                        if (!msg.isStreaming && !msg.isFrozenMidTurn && (!msg.model.isNullOrBlank() || msg.inputTokens > 0 || msg.outputTokens > 0)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (!msg.model.isNullOrBlank()) {
                                    Text(
                                        "Model: ${msg.model}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
                                    )
                                }
                                if (msg.inputTokens > 0 || msg.outputTokens > 0) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                                    ) {
                                        Text(
                                            "${msg.inputTokens}↑ ${msg.outputTokens}↓",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
                                        )
                                        NexyInfoIcon(
                                            "Usage for the most recently completed assistant turn, reported by the provider or CLI. " +
                                                "Input counts all context processed across the turn's model and tool calls, so it can exceed one context window. " +
                                                "Output counts generated model tokens. Counts marked ~ elsewhere are local estimates of about 1 token per 4 characters.",
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (!msg.isStreaming && !msg.isFrozenMidTurn && msg.text.isNotBlank()) {
                Row(
                    modifier = Modifier.padding(start = 12.dp, top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onCopy, modifier = Modifier.size(32.dp)) {
                        NexyIcon(NexyIconName.Copy, contentDescription = "Copy message", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (onShare != null) {
                        IconButton(onClick = onShare, modifier = Modifier.size(32.dp)) {
                            NexyIcon(NexyIconName.Share, contentDescription = "Share message", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Box {
                        IconButton(onClick = { overflowExpanded = true }, modifier = Modifier.size(32.dp)) {
                            NexyIcon(NexyIconName.More, contentDescription = "More message actions", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        DropdownMenu(expanded = overflowExpanded, onDismissRequest = { overflowExpanded = false }) {
                            if (onSaveAsPrompt != null) DropdownMenuItem(text = { Text("Save as prompt") }, onClick = { overflowExpanded = false; onSaveAsPrompt() })
                            if (onRetry != null) DropdownMenuItem(text = { Text("Retry") }, onClick = { overflowExpanded = false; onRetry() })
                            if (onEditAssistant != null) DropdownMenuItem(text = { Text("Edit message") }, onClick = { overflowExpanded = false; onEditAssistant() })
                            if (onBranch != null) DropdownMenuItem(text = { Text("Fork from here") }, onClick = { overflowExpanded = false; onBranch() })
                            if (onAddToProject != null) DropdownMenuItem(text = { Text("Save to wiki") }, onClick = { overflowExpanded = false; onAddToProject() })
                            if (onSaveAsArtifact != null) DropdownMenuItem(text = { Text("Save as artifact") }, onClick = { overflowExpanded = false; onSaveAsArtifact() })
                            DropdownMenuItem(text = { Text("Delete") }, onClick = { overflowExpanded = false; onDelete?.invoke() }, enabled = onDelete != null)
                        }
                    }
                }
            }
            if (timeLabel != null && !msg.isStreaming && !msg.isFrozenMidTurn) {
                Text(
                    timeLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    modifier = Modifier.padding(start = 12.dp, top = 2.dp, bottom = 2.dp),
                )
            }
        }
    } else {
        // --- User: right-aligned framed Command Office record ---
        var menuExpanded by remember { mutableStateOf(false) }
        val isDark = LocalNexyColors.current.isDark
        val bubbleColor = if (isDark) Blue900.copy(alpha = 0.6f) else Blue100
        val textColor = if (isDark) Gray100 else Gray900
        val bubbleShape = RoundedCornerShape(4.dp)
        val displayText = remember(msg.text) { stripInjectedContextBlocks(msg.text) }

        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
            horizontalAlignment = Alignment.End,
        ) {
            Box(modifier = Modifier.fillMaxWidth(0.8f)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(bubbleColor, bubbleShape)
                    .border(2.dp, MaterialTheme.colorScheme.outline, bubbleShape)
                    .combinedClickable(onClick = {}, onLongClick = { menuExpanded = true })
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(text = { Text("Copy") }, onClick = { menuExpanded = false; onCopy() })
                    if (onSaveAsPrompt != null) DropdownMenuItem(text = { Text("Save as prompt") }, onClick = { menuExpanded = false; onSaveAsPrompt() })
                    if (onEdit != null) DropdownMenuItem(text = { Text("Edit") }, onClick = { menuExpanded = false; onEdit() })
                    if (onResend != null) DropdownMenuItem(text = { Text("Resend") }, onClick = { menuExpanded = false; onResend() })
                    if (onDelete != null) DropdownMenuItem(text = { Text("Delete") }, onClick = { menuExpanded = false; onDelete() })
                    if (onDeleteAfter != null) DropdownMenuItem(text = { Text("Delete from here") }, onClick = { menuExpanded = false; onDeleteAfter() })
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (displayText.isNotBlank()) {
                        Text(displayText, color = textColor, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (msg.attachments.isNotEmpty()) {
                        val thumbs = msg.attachments.filter { it.type == "image" && it.thumbnailDataUrl != null }
                        if (thumbs.isNotEmpty()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 4.dp)) {
                                thumbs.forEach { att ->
                                    val bmp = remember(att.thumbnailDataUrl) { decodeDataUrl(att.thumbnailDataUrl!!) }
                                    if (bmp != null) {
                                        PreviewableImage(
                                            bitmap = bmp.asImageBitmap(),
                                            contentDescription = att.name,
                                            contentScale = ContentScale.Crop,
                                            modifier = Modifier.height(96.dp).width(120.dp).clip(RoundedCornerShape(2.dp)),
                                        )
                                    }
                                }
                            }
                        }
                        msg.attachments.filter { it.type != "image" || it.thumbnailDataUrl == null }.forEach { att ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                NexyIcon(NexyIconName.Image, contentDescription = null, modifier = Modifier.size(12.dp), tint = textColor.copy(alpha = 0.7f))
                                Text(att.name, style = MaterialTheme.typography.labelSmall, color = textColor.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    if (msg.sendFailed) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            NexyIcon(NexyIconName.Error, contentDescription = "Send failed", modifier = Modifier.size(12.dp), tint = MaterialTheme.colorScheme.error)
                            Text("Not delivered · tap Resend", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
            } // wrapper Box
            if (timeLabel != null && !msg.isStreaming) {
                Text(
                    timeLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                )
            }
        }
    }
}

// Exact truncation thresholds mirrored from desktop's ToolCallBlock.tsx:20-22, so the
// "+N more lines" breakpoint feels identical between platforms.
internal const val RESULT_PREVIEW_LINES = 3
internal const val RESULT_PREVIEW_CHARS = 240
internal const val RESULT_MAX_CHARS = 2000

internal data class ResultPreview(val text: String, val hiddenLineCount: Int, val truncated: Boolean)

internal fun buildResultPreview(result: String, lineCap: Int = RESULT_PREVIEW_LINES): ResultPreview {
    val lines = result.split("\n")
    val previewLines = lines.take(lineCap)
    var preview = previewLines.joinToString("\n")
    var hiddenLineCount = (lines.size - lineCap).coerceAtLeast(0)
    val charTruncated = preview.length > RESULT_PREVIEW_CHARS
    if (charTruncated) preview = preview.take(RESULT_PREVIEW_CHARS)
    return ResultPreview(preview, hiddenLineCount, truncated = hiddenLineCount > 0 || charTruncated)
}

internal fun buildExpandedResult(result: String): String =
    if (result.length > RESULT_MAX_CHARS) result.take(RESULT_MAX_CHARS) + "\n…(truncated)" else result

@Composable
fun ToolCallBubble(msg: ChatMessage, inProgress: Boolean = false) {
    val hasDetails = !msg.toolArgs.isNullOrBlank() || !msg.toolResult.isNullOrBlank()
    // Pure user-toggle expand/collapse — desktop removed the timed auto-collapse entirely
    // (ToolCallBlock.tsx no longer has one), so Android must not reintroduce it either.
    // rememberSaveable (not remember): LazyColumn disposes an item's composition when it
    // scrolls off-screen, so a plain remember here loses the user's expanded state and the row
    // silently re-collapses on scroll-back. LazyColumn retains saveable state per item key, so
    // an opened tool call stays open after scrolling away and back. Keyed on msg.id so a
    // different tool call reusing this slot starts from its own default rather than inheriting.
    var expanded by rememberSaveable(msg.id) { mutableStateOf(inProgress && hasDetails) }
    LaunchedEffect(inProgress, hasDetails) {
        if (inProgress && hasDetails) expanded = true
    }
    val preview = when {
        inProgress -> "Running…"
        msg.toolResult?.isNotBlank() == true -> cleanToolResultPreview(msg.toolResult)
        msg.toolSuccess -> "Completed"
        else -> "Failed"
    }

    ChatTimelineEntry(beadColor = toolCallBeadColor(inProgress, msg.toolSuccess), pulse = inProgress) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = hasDetails) { expanded = !expanded }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (inProgress) {
                        NexyIcon(
                            NexyIconName.Busy,
                            contentDescription = "Tool running",
                            modifier = Modifier.size(14.dp),
                            tint = Blue500,
                        )
                } else {
                        NexyIcon(
                            if (msg.toolSuccess) NexyIconName.Check else NexyIconName.Error,
                            contentDescription = if (msg.toolSuccess) "Tool succeeded" else "Tool failed",
                            modifier = Modifier.size(14.dp),
                            tint = if (msg.toolSuccess) Green500 else Red500,
                        )
                    }
                Text(
                    msg.toolName ?: "Tool call",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (!msg.serverName.isNullOrBlank()) {
                    Surface(
                        shape = RoundedCornerShape(2.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Text(
                            msg.serverName,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 0.dp),
                        )
                    }
                }
                Text(
                    preview,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (hasDetails) {
                    NexyIcon(
                        if (expanded) NexyIconName.ChevronDown else NexyIconName.ChevronRight,
                        contentDescription = if (expanded) "Collapse tool details" else "Expand tool details",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (expanded) {
                Column(
                    modifier = Modifier.padding(vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (!msg.toolArgs.isNullOrBlank()) {
                        ToolDetailSection(label = "Arguments", value = msg.toolArgs)
                    }
                    if (!msg.toolResult.isNullOrBlank()) {
                        ToolResultPreviewSection(result = msg.toolResult, isError = !msg.toolSuccess)
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolResultPreviewSection(result: String, isError: Boolean) {
    // Saveable so the "Show more" expansion survives LazyColumn recycling on scroll — same
    // rationale as ToolCallBubble's `expanded`.
    var expanded by rememberSaveable { mutableStateOf(false) }
    val cleaned = remember(result) { stripAnsiEscapes(result) }
    val lineCap = if (isError) RESULT_PREVIEW_LINES + 1 else RESULT_PREVIEW_LINES
    val preview = remember(cleaned, lineCap) { buildResultPreview(cleaned, lineCap) }
    val textColor = if (isError) Red500 else MaterialTheme.colorScheme.onSurfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            "RESULT",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        SelectionContainer {
            Text(
                if (expanded) buildExpandedResult(cleaned) else preview.text,
                fontSize = 11.sp,
                lineHeight = 17.sp,
                fontFamily = FontFamily.Monospace,
                color = textColor,
            )
        }
        if (preview.truncated) {
            Text(
                if (expanded) "Show less" else if (preview.hiddenLineCount > 0) "+${preview.hiddenLineCount} more line(s)" else "Show more",
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier.clickable { expanded = !expanded },
            )
        }
    }
}

// Strips ANSI/VT100 escape sequences (SGR color codes, cursor movement, etc.) that raw CLI
// subprocess output — e.g. Codex's own PowerShell "Run Command" tool results — can embed
// directly in the string. Left unstripped these render as either invisible control-byte tofu
// boxes or, once unescapeJsonString correctly decodes \uXXXX escapes, literal "ESC[31;1m"-style
// noise, neither of which is meaningful in a chat bubble with no terminal to interpret them.
private val ANSI_ESCAPE_RE = Regex("\u001B\\[[0-9;]*[a-zA-Z]")

internal fun stripAnsiEscapes(text: String): String = text.replace(ANSI_ESCAPE_RE, "")

internal fun cleanToolResultPreview(result: String): String {
    val trimmed = stripAnsiEscapes(result.trim())
    // If it looks like JSON, extract a meaningful summary rather than raw structure
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        // Try to find a "content", "text", "message", or "result" string field
        val summaryField = listOf("content", "text", "message", "result", "output", "error")
        for (field in summaryField) {
            val pattern = """"$field"\s*:\s*"((?:\\.|[^"\\]){1,120})"""".toRegex()
            val match = pattern.find(trimmed)
            if (match != null) {
                val v = unescapeJsonString(match.groupValues[1]).trim()
                if (v.isNotBlank()) return stripAnsiEscapes(v).replace(Regex("\\s+"), " ")
            }
        }
        // Fall back to a compact single-line version of the JSON
        return trimmed.replace(Regex("\\s+"), " ").take(100)
    }
    return trimmed.replace(Regex("\\s+"), " ").take(100)
}

internal fun parseJsonKeyValuePairs(json: String): List<Pair<String, String>>? {
    val trimmed = json.trim()
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null
    val result = mutableListOf<Pair<String, String>>()
    // Match top-level string and primitive values only (skip nested objects/arrays)
    val stringVal = """"(\w+)"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex()
    val primitiveVal = """"(\w+)"\s*:\s*(-?\d+\.?\d*|true|false|null)""".toRegex()
    val allMatches = (stringVal.findAll(trimmed) + primitiveVal.findAll(trimmed))
        .sortedBy { it.range.first }
    for (m in allMatches) {
        val key = m.groupValues[1]
        val value = stripAnsiEscapes(unescapeJsonString(m.groupValues[2])).trim()
        if (value.isNotBlank()) result.add(key to value.take(120))
    }
    return if (result.isEmpty()) null else result
}

private fun relativeTime(timestampMs: Long): String? {
    if (timestampMs <= 0L) return null
    val diff = System.currentTimeMillis() - timestampMs
    return when {
        diff < 60_000L -> "just now"
        diff < 3_600_000L -> "${diff / 60_000L} min ago"
        diff < 86_400_000L -> "${diff / 3_600_000L} hr ago"
        else -> "${diff / 86_400_000L} days ago"
    }
}

@Composable
fun ToolDetailSection(label: String, value: String) {
    // Inline mono key: value lines, no card chrome — mirrors ToolCallBlock.tsx:113-118
    // rather than desktop's older raw-JSON dump in a bordered box.
    val pairs = remember(value) { parseJsonKeyValuePairs(value) }
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        if (pairs != null) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                pairs.forEach { (k, v) ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "$k:",
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
                        )
                        Text(
                            v,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        } else {
            Text(
                value,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Inline chat card for a `__artifact-ref:` sentinel message — the Android counterpart of
 * desktop's ArtifactCard.tsx/DebriefArtifactCard.tsx/QuizArtifactCard.tsx. Bordered/tinted card
 * matching desktop's color language (indigo for debrief/quiz, purple for generic artifacts) with
 * a kind badge and the artifact's real title once fetched. Still deep-links into the existing
 * Debrief/Quiz/Artifacts screens for full detail rather than rendering the content inline.
 */
@Composable
fun ArtifactRefBubble(
    ref: ArtifactRef,
    onOpenDebrief: () -> Unit,
    onOpenQuiz: () -> Unit,
    onOpenTeachback: () -> Unit,
    onOpenArtifact: () -> Unit,
) {
    var fetchedTitle by remember(ref.artifactId) { mutableStateOf<String?>(null) }
    // The __artifact-ref: chat message caches a `kind` snapshot at the time it was written,
    // which can end up stale or missing (e.g. an older ref updated by
    // pinLatestPendingArtifactRefMessage without re-deriving kind) even though the artifacts
    // table row itself has the correct kind — that mismatch is exactly what caused a real
    // quiz card to show the generic "Artifact" label/color and route to the artifact detail
    // page instead of the quiz screen on tap. The fetched artifact detail is authoritative;
    // prefer it over the message-embedded kind once it arrives, same as fetchedTitle already
    // overrides any placeholder title.
    var fetchedKind by remember(ref.artifactId) { mutableStateOf<String?>(null) }
    var isDeleted by remember(ref.artifactId) { mutableStateOf(false) }
    var isLookupPending by remember(ref.artifactId, ref.pending) {
        mutableStateOf(!ref.pending && ref.artifactId.isNotBlank())
    }
    val effectiveKind = fetchedKind ?: ref.kind

    LaunchedEffect(ref.artifactId) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.ArtifactDetail -> if (event.artifactId == ref.artifactId) {
                    val artifact = event.artifact
                    isLookupPending = false
                    isDeleted = artifact == null
                    if (artifact != null) {
                        fetchedTitle = artifact.title
                        fetchedKind = artifact.kind
                    }
                }
                is WsEvent.ArtifactDeleted -> if (event.id == ref.artifactId && event.deleted) {
                    isLookupPending = false
                    isDeleted = true
                }
                else -> Unit
            }
        }
    }
    LaunchedEffect(ref.artifactId, ref.pending) {
        if (!ref.pending && ref.artifactId.isNotBlank()) WsRepository.getArtifact(ref.artifactId)
    }

    if (isDeleted) {
        Surface(
            shape = RoundedCornerShape(4.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    deletedArtifactLabel(effectiveKind),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        return
    }

    val kindLabel = when (effectiveKind) {
        "debrief" -> "Debrief"
        "quiz" -> "Quiz"
        "teachback" -> "Teach-back"
        "plan" -> "Plan"
        else -> "Artifact"
    }
    val fallbackTitle = when {
        isLookupPending -> "Loading artifact…"
        ref.pending && effectiveKind == "debrief" -> "Generating debrief…"
        ref.pending && effectiveKind == "quiz" -> "Generating quiz…"
        ref.pending && effectiveKind == "teachback" -> "Generating teach-back…"
        ref.pending -> "Generating…"
        effectiveKind == "debrief" -> "Open debrief"
        effectiveKind == "quiz" -> "Start quiz"
        effectiveKind == "teachback" -> "Start teach-back"
        effectiveKind == "plan" -> "Open plan"
        else -> "View artifact"
    }
    val icon = when (effectiveKind) {
        "debrief" -> NexyIconName.Artifact
        "quiz" -> NexyIconName.Skill
        "teachback" -> NexyIconName.Microphone
        else -> NexyIconName.Artifact
    }
    val isIndigo = effectiveKind == "debrief" || effectiveKind == "quiz" || effectiveKind == "teachback"

    val isDark = LocalNexyColors.current.isDark
    val bubbleColor = when {
        isIndigo && isDark -> Indigo950.copy(alpha = 0.3f)
        isIndigo -> Indigo50
        isDark -> Purple950.copy(alpha = 0.3f)
        else -> Purple50
    }
    val borderColor = when {
        isIndigo && isDark -> Indigo900.copy(alpha = 0.6f)
        isIndigo -> Indigo200
        isDark -> Purple900.copy(alpha = 0.6f)
        else -> Purple200
    }
    val accentColor = when {
        isIndigo && isDark -> Indigo400
        isIndigo -> Indigo500
        isDark -> Purple400
        else -> Purple500
    }
    val titleColor = when {
        isIndigo && isDark -> Indigo400
        isIndigo -> Indigo900
        isDark -> Purple400
        else -> Purple700
    }

    Surface(
        // Dispatch on effectiveKind (fetched artifact detail), not the possibly-stale
        // ref.kind embedded in the chat message — this is the actual fix for tapping a quiz
        // card and landing on the generic artifact detail page instead of the quiz screen.
        onClick = {
            when (effectiveKind) {
                "debrief" -> onOpenDebrief()
                "quiz" -> onOpenQuiz()
                "teachback" -> onOpenTeachback()
                else -> onOpenArtifact()
            }
        },
        enabled = !ref.pending && !isLookupPending,
        shape = MaterialTheme.shapes.extraSmall,
        color = bubbleColor,
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            NexyIcon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = accentColor)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    kindLabel,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                    color = accentColor,
                )
                Text(
                    fetchedTitle ?: fallbackTitle,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                    color = titleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (ref.pending || isLookupPending) {
                NexyIcon(NexyIconName.Busy, contentDescription = null, modifier = Modifier.size(16.dp), tint = accentColor)
            } else {
                NexyIcon(NexyIconName.ChevronRight, contentDescription = null, modifier = Modifier.size(18.dp), tint = accentColor)
            }
        }
    }
}

internal fun deletedArtifactLabel(kind: String?): String {
    val kindLabel = when (kind?.trim()?.lowercase()) {
        "document" -> "Doc"
        "code" -> "Code"
        "ui" -> "UI"
        "data" -> "Data"
        "prompt" -> "Prompt"
        "agent-config" -> "Agent"
        "plan" -> "Plan"
        "bundle" -> "Bundle"
        "other" -> "Other"
        "debrief" -> "Debrief"
        "quiz" -> "Quiz"
        "teachback" -> "Teach-back"
        else -> null
    }
    return kindLabel?.let { "$it deleted" } ?: "Artifact deleted"
}

