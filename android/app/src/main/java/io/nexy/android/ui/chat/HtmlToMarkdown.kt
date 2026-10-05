package io.nexy.android.ui.chat

/**
 * Converts the subset of HTML that rich clipboard sources actually produce into
 * Markdown. Markdown is the composer's only draft format, so a formatted paste
 * has to become Markdown rather than losing its structure to plain text.
 *
 * Mirrors the node coverage of the desktop composer's Markdown serialiser.
 * Deliberately dependency-free so it is unit-testable without Android or a
 * full HTML parser.
 */
object HtmlToMarkdown {

    private val VOID_TAGS = setOf("br", "img", "hr", "meta", "link", "input", "source", "col", "area", "base", "wbr")
    private val DROPPED_TAGS = setOf("script", "style", "head", "title", "noscript")

    private sealed interface Node
    private data class TextNode(val text: String) : Node
    private data class ElementNode(
        val tag: String,
        val attributes: Map<String, String>,
        val children: MutableList<Node> = mutableListOf(),
    ) : Node

    fun convert(html: String): String {
        if (html.isBlank()) return ""
        val root = parse(html)
        return collapseInteriorSpaces(render(root.children))
            .replace(Regex("[ \t]+\n"), "\n")
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }

    /**
     * Moving emphasis markers off surrounding whitespace can leave a double
     * space where the source had padding both inside and outside the tag.
     * Leading indentation (nested list structure) and fenced code are left
     * exactly as produced.
     */
    private fun collapseInteriorSpaces(markdown: String): String {
        var inFence = false
        return markdown.lines().joinToString("\n") { line ->
            if (line.trimStart().startsWith("```")) {
                inFence = !inFence
                line
            } else if (inFence) {
                line
            } else {
                val indent = line.takeWhile { it == ' ' }
                indent + line.substring(indent.length).replace(Regex(" {2,}"), " ")
            }
        }
    }

    // -- parsing ------------------------------------------------------------

    private val TAG_PATTERN = Regex("""<(/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*?)(/?)>""")

    private fun parse(html: String): ElementNode {
        val cleaned = html
            .replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")
            .replace(Regex("""<!\[CDATA\[.*?]]>""", RegexOption.DOT_MATCHES_ALL), "")
            .replace(Regex("""<![^>]*>"""), "")

        val root = ElementNode("#root", emptyMap())
        val stack = ArrayDeque<ElementNode>().apply { addLast(root) }
        var cursor = 0

        for (match in TAG_PATTERN.findAll(cleaned)) {
            if (match.range.first > cursor) {
                appendText(stack.last(), cleaned.substring(cursor, match.range.first))
            }
            cursor = match.range.last + 1

            val closing = match.groupValues[1] == "/"
            val tag = match.groupValues[2].lowercase()
            val selfClosing = match.groupValues[4] == "/" || tag in VOID_TAGS

            if (tag in DROPPED_TAGS) {
                // Skip the element's entire contents.
                val end = Regex("""</\s*$tag\s*>""", RegexOption.IGNORE_CASE).find(cleaned, cursor)
                if (end != null) cursor = end.range.last + 1
                continue
            }

            if (closing) {
                // Unwind to the matching open tag, tolerating unclosed markup.
                val depth = stack.indexOfLast { it.tag == tag }
                if (depth > 0) repeat(stack.size - depth) { stack.removeLast() }
                continue
            }

            val element = ElementNode(tag, parseAttributes(match.groupValues[3]))
            stack.last().children.add(element)
            if (!selfClosing) stack.addLast(element)
        }

        if (cursor < cleaned.length) appendText(stack.last(), cleaned.substring(cursor))
        return root
    }

    private fun appendText(parent: ElementNode, raw: String) {
        if (raw.isEmpty()) return
        parent.children.add(TextNode(decodeEntities(raw)))
    }

    private val ATTRIBUTE_PATTERN = Regex("""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))""")

    private fun parseAttributes(raw: String): Map<String, String> =
        ATTRIBUTE_PATTERN.findAll(raw).associate { match ->
            val value = match.groupValues[3].ifEmpty { match.groupValues[4].ifEmpty { match.groupValues[5] } }
            match.groupValues[1].lowercase() to decodeEntities(value)
        }

    private fun decodeEntities(value: String): String = value
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
        .replace(' ', ' ')

    // -- rendering ----------------------------------------------------------

    private fun render(nodes: List<Node>): String = nodes.joinToString("") { render(it) }

    private fun render(node: Node): String = when (node) {
        is TextNode -> node.text.replace(Regex("\\s+"), " ")
        is ElementNode -> renderElement(node)
    }

    private fun renderElement(element: ElementNode): String {
        val children = { render(element.children) }
        val block = { value: String -> "\n${value.trim()}\n" }

        return when (element.tag) {
            "br" -> "\n"
            "p", "div", "section", "article", "header", "footer", "main", "tr" -> block(children())
            "h1", "h2", "h3", "h4", "h5", "h6" ->
                block("${"#".repeat(element.tag[1].digitToInt())} ${children().trim()}")
            "strong", "b" -> wrapInline(children(), "**")
            "em", "i" -> wrapInline(children(), "*")
            "del", "s", "strike" -> wrapInline(children(), "~~")
            "a" -> {
                val href = element.attributes["href"]
                val label = children().trim()
                if (href.isNullOrBlank()) label else "[${label.ifEmpty { href }}]($href)"
            }
            "img" -> {
                val src = element.attributes["src"]
                if (src.isNullOrBlank()) "" else "![${element.attributes["alt"].orEmpty()}]($src)"
            }
            // A <code> inside <pre> never reaches here: the pre branch renders
            // its subtree as literal text instead of recursing.
            "code" -> "`${plainText(element).trim()}`"
            "pre" -> {
                val language = findCodeLanguage(element)
                block("```$language\n${plainText(element).trimEnd()}\n```")
            }
            "blockquote" -> block(children().trim().lines().joinToString("\n") { "> $it".trimEnd() })
            "ul" -> block(renderList(element, ordered = false))
            "ol" -> block(renderList(element, ordered = true))
            "li" -> children()
            "hr" -> "\n---\n"
            "table", "tbody", "thead" -> block(children())
            "td", "th" -> "${children().trim()} "
            else -> children()
        }
    }

    /** Emphasis markers must hug the text or Markdown will not apply them. */
    private fun wrapInline(value: String, marker: String): String {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return value
        val leading = if (value.startsWith(" ")) " " else ""
        val trailing = if (value.endsWith(" ")) " " else ""
        return "$leading$marker$trimmed$marker$trailing"
    }

    private fun renderList(element: ElementNode, ordered: Boolean): String {
        val items = element.children.filterIsInstance<ElementNode>().filter { it.tag == "li" }
        return items.mapIndexed { index, item ->
            val marker = if (ordered) "${index + 1}. " else "- "
            val body = render(item.children).trim()
            // Nested lists are indented to the parent marker's width so the
            // structure survives a re-parse.
            val indented = body.lines().mapIndexed { line, text ->
                if (line == 0) text else " ".repeat(marker.length) + text
            }.joinToString("\n")
            "$marker$indented"
        }.joinToString("\n")
    }

    private fun findCodeLanguage(element: ElementNode): String {
        val code = element.children.filterIsInstance<ElementNode>().firstOrNull { it.tag == "code" }
        val classes = code?.attributes?.get("class").orEmpty()
        return Regex("""(?:^|\s)language-(\S+)""").find(classes)?.groupValues?.get(1).orEmpty()
    }

    private fun plainText(node: Node): String = when (node) {
        is TextNode -> node.text
        is ElementNode -> if (node.tag == "br") "\n" else node.children.joinToString("") { plainText(it) }
    }
}
