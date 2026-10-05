import { memo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { localPathFromHref } from '../lib/link-routing'
import type { Citation } from '../../shared/citations'

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(getText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-gray-700/80 text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-600 transition-all shrink-0"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function extractLang(className?: string): string | null {
  if (!className) return null
  const match = /language-(\w+)/.exec(className)
  return match ? match[1] : null
}

function linkDestination(href: string): string {
  try {
    const url = new URL(href, window.location.href)
    return url.hostname ? `${url.hostname}${url.pathname === '/' ? '' : url.pathname}` : url.href
  } catch {
    return href
  }
}

function MarkdownLink({ href, children }: { href?: string; children: ReactNode }) {
  const localPath = localPathFromHref(href)
  const label = typeof children === 'string' ? children : 'Link'

  // The model sometimes emits a link with no real destination (e.g. `[text]()`).
  // Rendering that as a normal external link falsely implies clicking will go
  // somewhere; render it as plain text instead of dead-end "unknown destination" chrome.
  if (!href) {
    return <span title="No link destination was provided">{children}</span>
  }

  const destination = linkDestination(href)

  if (localPath) {
    return (
      <button
        type="button"
        title={`Open ${localPath}`}
        aria-label={`${label} — open local file`}
        onClick={() => void window.api.appOpenPath(localPath)}
        className="!text-blue-500 hover:!text-blue-400 !underline focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-blue-400"
      >
        {children} <ExternalLink aria-hidden="true" className="inline-block align-[-0.12em]" size={12} />
      </button>
    )
  }

  return (
    <span className="relative inline group/link">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={`Opens ${href} in your external browser`}
        aria-label={`${label} — ${href}`}
        className="!text-blue-500 hover:!text-blue-400 !underline focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-blue-400"
      >
        {children} <ExternalLink aria-hidden="true" className="inline-block align-[-0.12em]" size={12} />
      </a>
      <span role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-max max-w-[min(24rem,80vw)] rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-normal leading-snug text-gray-700 opacity-0 shadow-lg transition group-hover/link:visible group-hover/link:opacity-100 group-focus-within/link:visible group-focus-within/link:opacity-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
        <span className="block max-w-full truncate">{destination}</span>
        <span className="block text-[10px] text-gray-500 dark:text-gray-400">External browser · availability not checked</span>
      </span>
    </span>
  )
}

// Fenced code blocks are intentionally dark-only (Catppuccin Mocha), regardless of
// app light/dark theme — deliberate editor-style chrome, mirrors Android's WebView
// code island. Do not make this `dark:` aware.
function CodeBlockWrapper({ children, lang }: { children: ReactNode; lang: string | null }) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-gray-700/60" ref={wrapperRef}>
      {/* Header bar: language badge + copy button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-gray-700/60">
        <span className="text-[11px] font-mono font-medium text-gray-400 uppercase tracking-wider">
          {lang ?? 'code'}
        </span>
        <CopyButton getText={() => wrapperRef.current?.querySelector('code')?.textContent ?? ''} />
      </div>
      <pre className="code-scrollbar overflow-x-auto !p-4 !m-0 !bg-[#1e1e2e] !text-gray-100 text-sm leading-relaxed !rounded-none">
        {children}
      </pre>
    </div>
  )
}

interface MarkdownRendererProps {
  content: string
  citations?: Citation[]
  viewMode?: 'rendered' | 'raw'
  /** Draft previews must show the exact source string, without message-only citation cleanup. */
  preserveSource?: boolean
  /** Uses plain semantic DOM suitable for a contenteditable Markdown composer. */
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function citationAwareContent(content: string, citations: Citation[]): string {
  let rendered = content
  const references = citations.flatMap((citation, index) => [
    citation.id,
    ...(citation.aliases ?? []),
  ].filter(Boolean).map((reference) => ({ reference, index })))
    .sort((a, b) => b.reference.length - a.reference.length)
  for (const { reference, index } of references) {
    const citation = citations[index]
    rendered = rendered.replace(
      new RegExp(escapeRegExp(reference), 'g'),
      `[${index + 1}](<${citation.url}>)`,
    )
  }
  // Some web-capable providers put internal citation tokens in the text stream even when
  // their structured citation metadata is unavailable. Those tokens are implementation
  // details, not useful prose, and should never appear as "CiteTurn…" or boxed markers.
  return rendered
    .replace(/【[^】]*(?:cite|turn|search|view)\d+[^】]*】/gi, '')
    .replace(/\bCiteTurn\d+(?:search|view|fetch)\d+\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
}

function CitationSources({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null
  return (
    <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-2" aria-label="Sources">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Sources</div>
      <ol className="m-0 list-none space-y-1 p-0">
        {citations.map((citation, index) => (
          <li key={`${citation.id}-${citation.url}`} className="text-xs">
            <a
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="!text-blue-500 hover:!text-blue-400 !underline"
              title={`Open ${citation.url} in your external browser`}
            >
              [{index + 1}] {citation.title || citation.url}
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}

function MarkdownRendererBase({ content, citations = [], viewMode = 'rendered', preserveSource = false }: MarkdownRendererProps) {
  if (viewMode === 'raw') {
    return (
      <pre className="my-0 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-gray-900 dark:text-gray-100">
        {content}
      </pre>
    )
  }
  return (
    <div className="markdown-body prose prose-sm dark:prose-invert max-w-none break-words
      prose-blockquote:border-l-2 prose-blockquote:border-gray-300 dark:prose-blockquote:border-gray-600
      prose-blockquote:bg-gray-50 dark:prose-blockquote:bg-gray-800/40
      prose-blockquote:px-3 prose-blockquote:py-0.5 prose-blockquote:rounded-r
      prose-blockquote:not-italic prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400
      prose-p:my-2 prose-ul:my-1 prose-ol:my-1
      prose-li:my-0.5
      prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold first:prose-headings:mt-0
      prose-h1:text-base prose-h2:text-[0.95rem] prose-h3:text-sm prose-h4:text-sm
      prose-del:text-gray-500 dark:prose-del:text-gray-400
      prose-th:bg-gray-100 dark:prose-th:bg-gray-800
      prose-tr:even:bg-gray-50 dark:prose-tr:even:bg-gray-800/40"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => {
            // Extract lang from the nested <code> className
            let lang: string | null = null
            const child = Array.isArray(children) ? children[0] : children
            if (child && typeof child === 'object' && 'props' in child) {
              lang = extractLang((child as { props?: { className?: string } }).props?.className)
            }
            return <CodeBlockWrapper lang={lang}>{children}</CodeBlockWrapper>
          },
          code: ({ className, children, ...props }) => {
            // rehype-highlight defaults `detect: false` — a fenced block with no language
            // tag gets no `hljs`/`language-` class at all, so className alone misclassifies
            // it as an inline span here and applies the inline-pill background below. Since
            // that pill is on a `display: inline` element, CSS fragments its background per
            // visual line when the content wraps across multiple preserved newlines — the
            // "separate highlighted background on every line" look in unlabeled code blocks.
            // Inline code spans can never contain a literal newline (CommonMark collapses
            // them), so multi-line content is an unambiguous block-code signal independent
            // of whether highlight.js classified it.
            const hasHljsClass = className && (className.includes('hljs') || className.includes('language-'))
            const isMultiline = typeof children === 'string' && children.includes('\n')
            const isBlock = hasHljsClass || isMultiline
            if (isBlock) {
              return <code className={className} {...props}>{children}</code>
            }
            return (
              <code
                className="!px-1.5 !py-0.5 !rounded !bg-gray-200 dark:!bg-gray-700 !text-[0.8em] !font-mono !text-gray-700 dark:!text-gray-300 !font-normal"
                {...props}
              >
                {children}
              </code>
            )
          },
          // Editor DOM is serialized back to Markdown after a rich-text edit, so it
          // must not contain tooltips, icons, or other message-only presentation text.
          a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
          li: ({ className, children, ...props }) => {
            if (className?.includes('task-list-item')) {
              return (
                <li className={`${className} !list-none !pl-0 flex items-start gap-2`} {...props}>
                  {children}
                </li>
              )
            }
            return <li className={className} {...props}>{children}</li>
          },
          input: ({ type, checked, ...props }) => {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  disabled
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-blue-500 focus:ring-0 focus:ring-offset-0"
                  {...props}
                />
              )
            }
            return <input type={type} {...props} />
          },
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              className="!rounded-lg !border !border-gray-200 dark:!border-gray-700 max-w-full"
            />
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="!text-sm !my-0 w-full divide-y divide-gray-100 dark:divide-gray-800">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="!px-2.5 !py-1.5 !text-left !font-semibold !text-xs !uppercase !tracking-wide !text-gray-500 dark:!text-gray-400">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="!px-2.5 !py-1.5 !text-sm">{children}</td>
          ),
        }}
      >
        {preserveSource ? content : citationAwareContent(content, citations)}
      </ReactMarkdown>
      <CitationSources citations={citations} />
    </div>
  )
}

export const MarkdownRenderer = memo(MarkdownRendererBase)
