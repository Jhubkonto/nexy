package io.nexy.android.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HtmlToMarkdownTest {

    @Test
    fun `converts headings`() {
        assertEquals("## Heading", HtmlToMarkdown.convert("<h2>Heading</h2>"))
        assertEquals("# One\n\n### Three", HtmlToMarkdown.convert("<h1>One</h1><h3>Three</h3>"))
    }

    @Test
    fun `converts inline emphasis`() {
        assertEquals(
            "Some **bold** and *italic* and ~~struck~~ text.",
            HtmlToMarkdown.convert("<p>Some <strong>bold</strong> and <em>italic</em> and <del>struck</del> text.</p>"),
        )
    }

    @Test
    fun `keeps emphasis markers hugging the text`() {
        // "** bold **" is not emphasis in Markdown, so the spaces must move out.
        assertEquals("a **bold** b", HtmlToMarkdown.convert("<p>a <strong> bold </strong> b</p>"))
    }

    @Test
    fun `converts links and uses the href when there is no label`() {
        assertEquals("[docs](https://example.com)", HtmlToMarkdown.convert("""<a href="https://example.com">docs</a>"""))
        assertEquals("[https://x.dev](https://x.dev)", HtmlToMarkdown.convert("""<a href="https://x.dev"></a>"""))
        assertEquals("bare", HtmlToMarkdown.convert("<a>bare</a>"))
    }

    @Test
    fun `converts images`() {
        assertEquals("![alt](https://e.com/i.png)", HtmlToMarkdown.convert("""<img src="https://e.com/i.png" alt="alt">"""))
        assertEquals("![](https://e.com/i.png)", HtmlToMarkdown.convert("""<img src="https://e.com/i.png">"""))
    }

    @Test
    fun `converts unordered and ordered lists`() {
        assertEquals("- one\n- two", HtmlToMarkdown.convert("<ul><li>one</li><li>two</li></ul>"))
        assertEquals("1. one\n2. two", HtmlToMarkdown.convert("<ol><li>one</li><li>two</li></ol>"))
    }

    @Test
    fun `indents nested lists so the structure survives a reparse`() {
        val markdown = HtmlToMarkdown.convert("<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>")
        assertEquals("- one\n  - nested\n- two", markdown)
    }

    @Test
    fun `converts inline code and fenced code with a language`() {
        assertEquals("`npm run build`", HtmlToMarkdown.convert("<code>npm run build</code>"))
        assertEquals(
            "```ts\nconst a = 1\n```",
            HtmlToMarkdown.convert("""<pre><code class="language-ts">const a = 1</code></pre>"""),
        )
    }

    @Test
    fun `keeps code block contents literal`() {
        val markdown = HtmlToMarkdown.convert("<pre><code>&lt;b&gt;not bold&lt;/b&gt;</code></pre>")
        assertEquals("```\n<b>not bold</b>\n```", markdown)
    }

    @Test
    fun `preserves indentation inside fenced code`() {
        assertEquals(
            "```\nif (x) {\n    doThing()\n}\n```",
            HtmlToMarkdown.convert("<pre><code>if (x) {\n    doThing()\n}</code></pre>"),
        )
    }

    @Test
    fun `converts blockquotes with a marker per line`() {
        assertEquals("> quoted", HtmlToMarkdown.convert("<blockquote>quoted</blockquote>"))
        assertEquals("> one\n>\n> two", HtmlToMarkdown.convert("<blockquote><p>one</p><p>two</p></blockquote>"))
    }

    @Test
    fun `converts breaks and horizontal rules`() {
        assertEquals("a\nb", HtmlToMarkdown.convert("a<br>b"))
        assertEquals("a\n\n---\n\nb", HtmlToMarkdown.convert("<p>a</p><hr><p>b</p>"))
    }

    @Test
    fun `decodes html entities`() {
        assertEquals("a & b < c > d \"e\"", HtmlToMarkdown.convert("<p>a &amp; b &lt; c &gt; d &quot;e&quot;</p>"))
        assertEquals("non breaking space", HtmlToMarkdown.convert("<p>non&nbsp;breaking&nbsp;space</p>"))
    }

    @Test
    fun `drops script and style payloads`() {
        val markdown = HtmlToMarkdown.convert("<p>keep</p><script>alert('x')</script><style>p{color:red}</style>")
        assertEquals("keep", markdown)
    }

    @Test
    fun `ignores comments and doctype`() {
        assertEquals("keep", HtmlToMarkdown.convert("<!DOCTYPE html><!-- note --><p>keep</p>"))
    }

    @Test
    fun `tolerates unclosed markup instead of dropping the content`() {
        val markdown = HtmlToMarkdown.convert("<p>first<p>second")
        assertTrue(markdown, markdown.contains("first") && markdown.contains("second"))
    }

    @Test
    fun `collapses runs of whitespace from pretty printed html`() {
        assertEquals("one two", HtmlToMarkdown.convert("<p>one\n          two</p>"))
    }

    @Test
    fun `returns empty for blank input`() {
        assertEquals("", HtmlToMarkdown.convert(""))
        assertEquals("", HtmlToMarkdown.convert("   "))
    }

    @Test
    fun `converts a realistic rich clipboard payload`() {
        val html = """
            <meta charset="utf-8">
            <h1>Report</h1>
            <p>Summary with <b>bold</b> and a <a href="https://example.com">link</a>.</p>
            <ul><li>item one</li><li>item two</li></ul>
            <pre><code class="language-js">const a = 1</code></pre>
        """.trimIndent()

        assertEquals(
            listOf(
                "# Report",
                "",
                "Summary with **bold** and a [link](https://example.com).",
                "",
                "- item one",
                "- item two",
                "",
                "```js",
                "const a = 1",
                "```",
            ).joinToString("\n"),
            HtmlToMarkdown.convert(html),
        )
    }
}
