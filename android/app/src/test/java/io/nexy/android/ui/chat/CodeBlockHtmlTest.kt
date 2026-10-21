package io.nexy.android.ui.chat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CodeBlockHtmlTest {

    @Test
    fun escapesAngleBracketsInCode() {
        val html = buildCodeBlockHtml("html", "<script>alert(1)</script>")

        assertFalse(html.contains("<script>alert(1)</script>"))
        assertTrue(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"))
    }

    @Test
    fun escapesAmpersandInCode() {
        val html = buildCodeBlockHtml("bash", "echo a && echo b")

        assertTrue(html.contains("echo a &amp;&amp; echo b"))
        assertFalse(html.contains("a && echo"))
    }

    @Test
    fun escapesQuotesInCode() {
        val html = buildCodeBlockHtml("python", "print(\"hi\")")

        assertTrue(html.contains("print(&quot;hi&quot;)"))
    }

    @Test
    fun includesLanguageClassWhenLanguageProvided() {
        val html = buildCodeBlockHtml("kotlin", "val x = 1")

        assertTrue(html.contains("class=\"language-kotlin\""))
    }

    @Test
    fun fallsBackToNohighlightWhenLanguageMissing() {
        val html = buildCodeBlockHtml(null, "some text")

        assertTrue(html.contains("class=\"nohighlight\""))
    }

    @Test
    fun includesThemeCssAndHighlightJsReferences() {
        val html = buildCodeBlockHtml("json", "{}")

        assertTrue(html.contains("href=\"theme.css\""))
        assertTrue(html.contains("src=\"highlight.min.js\""))
    }

    @Test
    fun includesLanguageLabelInHeader() {
        val html = buildCodeBlockHtml("typescript", "const x: number = 1")

        assertTrue(html.contains("<span class=\"lang\">typescript</span>"))
    }

    @Test
    fun showsCodeLabelWhenLanguageIsNull() {
        val html = buildCodeBlockHtml(null, "plain text block")

        assertTrue(html.contains("<span class=\"lang\">code</span>"))
    }

    @Test
    fun includesBridgeCallsForCopyAndHeightReporting() {
        val html = buildCodeBlockHtml("go", "package main")

        assertTrue(html.contains("AndroidBridge.onCopy"))
        assertTrue(html.contains("AndroidBridge.reportHeight"))
    }

    @Test
    fun safelyEmbedsSearchTermForCodeHighlighting() {
        val html = buildCodeBlockHtml("kotlin", "val needle = 1", searchQuery = "</script>")

        assertTrue(html.contains("const searchQuery = \"\\u003c/script\\u003e\""))
        assertTrue(html.contains("document.createTreeWalker"))
    }
}
