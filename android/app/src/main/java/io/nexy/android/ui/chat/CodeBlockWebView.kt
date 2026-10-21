package io.nexy.android.ui.chat

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * Bridges the code block's in-page copy/fullscreen buttons and height reporting back into
 * Kotlin. `@JavascriptInterface` methods run on a non-UI thread — every callback hops to the
 * main thread before touching Compose state or Android views.
 */
private class CodeBlockBridge(
    private val context: Context,
    private val onHeightPx: (Int) -> Unit,
    private val onFullscreenRequested: () -> Unit,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onCopy(text: String) {
        mainHandler.post {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("code", text))
        }
    }

    @JavascriptInterface
    fun reportHeight(px: Int) {
        mainHandler.post { onHeightPx(px) }
    }

    @JavascriptInterface
    fun onFullscreen() {
        mainHandler.post { onFullscreenRequested() }
    }
}

@Composable
fun CodeBlockWebView(language: String?, code: String, modifier: Modifier = Modifier, searchQuery: String? = null) {
    var showFullscreen by remember(code, language, searchQuery) { mutableStateOf(false) }
    // WebViews are considerably more expensive than normal Compose nodes. A large history
    // containing code should not create Chromium surfaces just because those blocks happen to
    // be visible on entry. Keep the inline representation native and instantiate the existing
    // highlighted WebView only after the user explicitly opens a block.
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clickable { showFullscreen = true },
        color = androidx.compose.ui.graphics.Color(0xFF1E1E2E),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = language?.ifBlank { null } ?: "Code",
                    style = MaterialTheme.typography.labelSmall,
                    color = androidx.compose.ui.graphics.Color(0xFFCDD6F4),
                )
                Spacer(Modifier.weight(1f))
                Icon(
                    Icons.Default.OpenInFull,
                    contentDescription = "Open code fullscreen",
                    tint = androidx.compose.ui.graphics.Color(0xFFCDD6F4),
                    modifier = Modifier.width(18.dp),
                )
            }
            Text(
                text = androidx.compose.ui.text.AnnotatedString(code).withSearchHighlights(
                    searchQuery,
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.35f),
                ),
                modifier = Modifier.padding(top = 8.dp),
                color = androidx.compose.ui.graphics.Color(0xFFCDD6F4),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 8,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    if (showFullscreen) {
        CodeBlockFullscreenDialog(
            language = language,
            code = code,
            searchQuery = searchQuery,
            onDismiss = { showFullscreen = false },
        )
    }
}

/**
 * Full-screen viewer for a code block whose content doesn't fit within the card's height-
 * bound WebView (heightIn caps the inline card so the surrounding chat list stays scrollable;
 * long blocks need their own scrollable viewport instead). Reuses the same HTML/CSS/highlight
 * pipeline as the inline card but sized to fill the dialog — the WebView's own native scrolling
 * (vertical for overflowing body content, horizontal via `pre`'s existing overflow-x) handles
 * the rest without any extra height-measurement plumbing.
 */
@Composable
private fun CodeBlockFullscreenDialog(
    language: String?,
    code: String,
    searchQuery: String?,
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
                // Every other screen gets system-bar insets for free via Scaffold; a bare
                // Dialog does not, so without this the WebView's own header and the close
                // button both draw straight under the status bar (clock/battery icons
                // overlapping the code block's header row, close button nearly invisible
                // behind them).
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        @SuppressLint("SetJavaScriptEnabled")
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = false
                        setBackgroundColor(0x00000000)
                        webViewClient = WebViewClient()
                        val html = buildCodeBlockHtml(language, code, showFullscreenButton = false, searchQuery = searchQuery)
                        loadDataWithBaseURL("file:///android_asset/codeblock/", html, "text/html", "utf-8", null)
                        addJavascriptInterface(
                            CodeBlockBridge(
                                context = ctx,
                                onHeightPx = {},
                                onFullscreenRequested = {},
                            ),
                            "AndroidBridge",
                        )
                    }
                },
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Close fullscreen code view",
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
    }
}
