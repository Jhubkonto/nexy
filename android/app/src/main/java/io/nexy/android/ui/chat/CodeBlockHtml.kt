package io.nexy.android.ui.chat

/** Escapes text for safe interpolation into an HTML text node. */
private fun escapeHtml(text: String): String =
    text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

/** Escapes a Kotlin string for use as a JavaScript string literal inside the generated page. */
private fun escapeJavaScriptString(text: String): String =
    text
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")

/**
 * Builds the minimal HTML shell loaded into the code-block WebView island. References the
 * bundled `theme.css` (ported from src/renderer/styles/global.css) and `highlight.min.js`
 * (vendored highlight.js 11.11.1, matching desktop's resolved version) via relative asset
 * paths — loaded through `loadDataWithBaseURL("file:///android_asset/", ...)` so they resolve.
 */
fun buildCodeBlockHtml(
    language: String?,
    code: String,
    showFullscreenButton: Boolean = true,
    searchQuery: String? = null,
): String {
    val escapedCode = escapeHtml(code)
    val langClass = if (language != null) "language-$language" else "nohighlight"
    val langLabel = escapeHtml(language ?: "code")
    val searchTerm = escapeJavaScriptString(searchQuery?.trim().orEmpty())
    return """
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
          <link rel="stylesheet" href="theme.css">
          <script src="highlight.min.js"></script>
        </head>
        <body>
          <div class="code-wrapper">
            <div class="code-header">
              <span class="lang">$langLabel</span>
              <div class="header-actions">
                ${if (showFullscreenButton) """<button onclick="openFullscreen()" aria-label="View fullscreen">⛶</button>""" else ""}
                <button onclick="copyCode()">Copy</button>
              </div>
            </div>
            <pre><code class="$langClass">$escapedCode</code></pre>
          </div>
          <script>
            // Swallow highlight.js failures (e.g. an unrecognized language class from the
            // model's fence tag) — otherwise a thrown error here stops the script before
            // reportHeight ever runs, leaving the WebView pinned at the small loading-skeleton
            // height with the code invisible below the fold instead of falling back to
            // plain, unhighlighted text at its real height.
            try { hljs.highlightAll(); } catch (e) {}
            const searchQuery = "$searchTerm";
            if (searchQuery) {
              const walker = document.createTreeWalker(document.querySelector('code'), NodeFilter.SHOW_TEXT);
              const nodes = [];
              for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
              const needle = searchQuery.toLocaleLowerCase();
              for (const node of nodes) {
                const source = node.data;
                const lower = source.toLocaleLowerCase();
                let start = lower.indexOf(needle);
                if (start < 0) continue;
                const fragment = document.createDocumentFragment();
                let cursor = 0;
                while (start >= 0) {
                  if (start > cursor) fragment.append(source.slice(cursor, start));
                  const mark = document.createElement('mark');
                  mark.style.cssText = 'background:#facc15;color:inherit;border-radius:2px;padding:0 1px';
                  mark.textContent = source.slice(start, start + searchQuery.length);
                  fragment.append(mark);
                  cursor = start + searchQuery.length;
                  start = lower.indexOf(needle, cursor);
                }
                if (cursor < source.length) fragment.append(source.slice(cursor));
                node.replaceWith(fragment);
              }
            }
            function copyCode() {
              AndroidBridge.onCopy(document.querySelector('code').innerText);
            }
            function openFullscreen() {
              AndroidBridge.onFullscreen();
            }
            function reportSize() {
              AndroidBridge.reportHeight(document.body.scrollHeight);
            }
            // A single synchronous scrollHeight read at parse time races the WebView's own
            // native layout pass — Compose may not have handed it its final measured width
            // yet, so the initial read can lock in a height computed against a transient
            // (too-narrow/too-wide) layout, permanently clipping the code block short of its
            // real content. ResizeObserver re-reports height on every subsequent layout
            // change (final width settling, font metrics resolving, hljs's DOM mutations),
            // self-correcting instead of trusting one early snapshot.
            reportSize();
            if (window.ResizeObserver) {
              new ResizeObserver(reportSize).observe(document.body);
            } else {
              window.addEventListener('load', reportSize);
            }
          </script>
        </body>
        </html>
    """.trimIndent()
}
