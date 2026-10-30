import { AlertCircle, Info, Loader2, Wrench } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useGenerationTimer } from '../../hooks/useGenerationTimer'
import { getModelLabel } from '../../../shared/models'
import { useAppStore } from '../../store/app-store'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { MessageBubble, stripInjectedBlocks } from '../MessageBubble'
import { TeamActivityBlock } from '../TeamActivityBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { CodexActionLine } from './CodexActionLine'
import { UserInputCard } from './UserInputCard'
import { ArtifactCard } from '../artifacts/ArtifactCard'
import { getSupersededPendingArtifactMessageIds, parseArtifactReference } from '../artifacts/artifactReferences'
import type { ChatMessage, CliCostSummary, TeamActivityStep } from '../../hooks/chat-types'
import { buildChatRenderItems } from '../../hooks/chat-render-items'
import { createEmptyChatTurnState, type ChatTurnState } from '../../hooks/chat-turn-reducer'
import type { MarkdownViewMode } from '../../store/types'

const TOKEN_USAGE_EXPLANATION = 'Usage for the most recently completed assistant turn. Provider-reported counts are authoritative after the request; input includes all context processed across tool calls and may exceed one context window. Counts marked estimate are local estimates of about 1 token per 4 characters.'

interface ChatMessagesProps {
  messages: ChatMessage[]
  isLoadingMessages: boolean
  isGenerating: boolean
  liveTeamActivity: TeamActivityStep[]
  streamingContent: string
  /** True while streamed text is still being revealed (useStreamingQueue) — drives a subtle
   *  fade/breathing effect on the live text so new tokens feel like they're settling in rather
   *  than popping to full opacity. */
  isDraining?: boolean
  cliCost?: CliCostSummary | null
  generationStartedAt: number | null
  loadingFailed: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  contentContainerRef?: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  onNavigateToRequest?: () => void
  onCopy: (content: string) => void
  onSaveAsPrompt?: (content: string) => void
  onSaveToWiki?: (messageId: string, content: string) => void
  onPromoteArtifact?: (messageId: string, content: string) => void
  wikiMessageIds: Set<string>
  onRegenerate: (modelOverride?: string) => void | Promise<void>
  onEdit: (index: number) => void
  onDeleteAfter?: (message: ChatMessage) => void
  onForkFromHere?: (message: ChatMessage) => void
  onRetry: () => void | Promise<void>
  onSignIn: () => void
  onPickModel: () => void
  onUseImageAsContext?: (dataUrl: string) => void
  liveTurnState?: ChatTurnState
  markdownViewMode?: MarkdownViewMode
  /** The in-chat find result currently selected by ChatWindow. */
  searchMatchMessageId?: string
  /** Phrase to mark inside the selected in-chat find result. */
  searchQuery?: string
}

interface RequestReference {
  requestId: string
  preview: string
}

interface MsgGroup {
  main: ChatMessage
  toolCalls: ChatMessage[]
  index: number
}

export function getThinkingBlockLabel(blockId: string): string {
  if (blockId.startsWith('codex-reasoning-summary')) return 'Reasoning summary'
  return 'Reasoning'
}

// Codex CLI turns render their reasoning/tool-call timeline as short bulleted lines
// (matching Codex's own CLI output) instead of the boxed ThinkingBlock/ToolCallBlock
// cards every other backend uses — both signals below already exist on the data
// without any extra backend plumbing.
function isCodexThinkingBlock(blockId: string): boolean {
  return blockId.startsWith('codex-reasoning-summary')
}
function isPlainNarrationThinkingBlock(blockId: string): boolean {
  return isCodexThinkingBlock(blockId) || blockId.startsWith('claude-reasoning-')
}
function isCodexToolCall(serverName: string | undefined): boolean {
  return serverName === 'codex-cli'
}

// A status-colored bead sitting directly on the shared timeline border, marking each
// step's position along it — mirrors the connected dot-and-line action list used for
// tool calls in Claude Code's own CLI output.
function TimelineEntry({ children, colorClass, pulse }: { children: ReactNode; colorClass: string; pulse?: boolean }) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={`absolute -left-[18px] top-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-gray-900 ${colorClass} ${pulse ? 'animate-pulse' : ''}`}
      />
      {children}
    </div>
  )
}

function toolCallDotColor(inProgress: boolean | undefined, success: boolean | undefined): string {
  if (inProgress) return 'bg-blue-500'
  return success === false ? 'bg-red-500' : 'bg-green-500'
}

function thinkingDotColor(done: boolean): string {
  return done ? 'bg-purple-500' : 'bg-purple-400'
}

export function liveActivityLabel(label: string, elapsedSec: number): string {
  if (/(~[\d,]+ tokens|context|attachments|project files|project wiki|agent knowledge|past strategies)/i.test(label)) {
    return label
  }
  return elapsedSec > 0 ? `Thinking · ${elapsedSec}s` : 'Thinking...'
}

type TextSegmentBlock = NonNullable<ChatMessage['textSegments']> extends Map<string, infer V> ? V : never

// Historical thinking blocks, text segments (both persisted on the assistant message)
// and tool-call messages (persisted as their own rows) are separate collections once
// reloaded from the DB — interleave them by when each actually happened so a tool call
// sandwiched between two reasoning bursts, or between two pieces of response text,
// doesn't get pushed below both. Ties (e.g. blocks with no firstSeenAt, from before
// that field existed) fall back to a stable sort that keeps thinking/text before tool
// calls, matching prior behavior.
type HistoricalTimelineItem =
  | { kind: 'thinking'; ts: number; block: NonNullable<ChatMessage['thinkingBlocks']> extends Map<string, infer V> ? V : never }
  | { kind: 'text'; ts: number; block: TextSegmentBlock }
  | { kind: 'tool'; ts: number; message: ChatMessage }

// The most recent text segment isn't included in the timeline — it becomes the
// content of the message's own MessageBubble below the timeline instead of an inline
// item, so the reply reads as "narration, tool calls, narration, ..., final answer
// bubble" rather than repeating the final segment's text twice.
function tailTextSegment(textSegments: ChatMessage['textSegments']): TextSegmentBlock | null {
  if (!textSegments || textSegments.size === 0) return null
  const blocks = Array.from(textSegments.values())
  return blocks.reduce((latest, block) => (block.firstSeenAt ?? 0) >= (latest.firstSeenAt ?? 0) ? block : latest)
}

function buildHistoricalTimeline(
  thinkingBlocks: ChatMessage['thinkingBlocks'],
  textSegments: ChatMessage['textSegments'],
  toolCalls: ChatMessage[],
): HistoricalTimelineItem[] {
  const items: HistoricalTimelineItem[] = []
  if (thinkingBlocks) {
    for (const block of thinkingBlocks.values()) {
      items.push({ kind: 'thinking', ts: block.firstSeenAt ?? -Infinity, block })
    }
  }
  const tail = tailTextSegment(textSegments)
  if (textSegments) {
    for (const block of textSegments.values()) {
      if (block === tail) continue
      items.push({ kind: 'text', ts: block.firstSeenAt ?? -Infinity, block })
    }
  }
  for (const message of toolCalls) {
    items.push({ kind: 'tool', ts: message.timestamp, message })
  }
  items.sort((a, b) => a.ts - b.ts)
  return items
}

function getRequestPreview(content: string): string {
  return stripInjectedBlocks(content).replace(/\s+/g, ' ').trim()
}

function truncatePreview(preview: string): string {
  return preview.length > 140 ? `${preview.slice(0, 137).trimEnd()}...` : preview
}

export function ChatMessagesBase({
  messages,
  isLoadingMessages,
  isGenerating,
  liveTeamActivity,
  streamingContent,
  isDraining: _isDraining = false,
  cliCost,
  generationStartedAt,
  loadingFailed,
  messagesEndRef,
  scrollContainerRef,
  contentContainerRef,
  onScroll,
  onNavigateToRequest,
  onCopy,
  onSaveAsPrompt,
  onSaveToWiki,
  onPromoteArtifact,
  wikiMessageIds,
  onRegenerate,
  onEdit,
  onDeleteAfter,
  onForkFromHere,
  onRetry,
  onSignIn,
  onPickModel,
  onUseImageAsContext,
  liveTurnState,
  markdownViewMode = 'rendered',
  searchMatchMessageId,
  searchQuery,
}: ChatMessagesProps) {
  const catalogModels = useAppStore((state) => state.catalogModels)
  const generationElapsedSec = useGenerationTimer(isGenerating, generationStartedAt)
  // `streamingContent` is the whole turn's cumulative text (needed elsewhere, e.g. to
  // persist the right thing on Stop) — but once a tool call has interrupted the reply,
  // any earlier segment already renders as its own live-text-segment item above, so the
  // trailing "current" text block below must show only the segment still being written,
  // not the full cumulative string (which would repeat the earlier segment here).
  const liveTrailingText = useMemo(() => {
    if (!liveTurnState || liveTurnState.textBlocks.size === 0) return streamingContent
    // The still-open segment, found via `done` — NOT "whichever is last in the map",
    // since a lead-in segment that already closed (a tool call interrupted it) can
    // still be the only entry recorded so far and must not be mistaken for the one
    // currently being typed. If every recorded segment has already closed, nothing is
    // currently being written (the model is mid-tool-call) — show nothing here.
    const open = Array.from(liveTurnState.textBlocks.values()).find((block) => !block.done)
    return open?.content ?? ''
  }, [liveTurnState, streamingContent])
  // ReactMarkdown + rehype-highlight re-parse their entire input on every render, which is
  // too expensive (and visually flickery on incomplete code fences) to run at the reveal
  // animation's ~60fps cadence — throttle what's handed to MarkdownRenderer while streaming.
  const throttledStreamingContent = liveTrailingText
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>())
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const [visibleMessageIds, setVisibleMessageIds] = useState<Set<string>>(new Set())
  const [topVisibleAssistantId, setTopVisibleAssistantId] = useState<string | null>(null)
  const [highlightedRequestId, setHighlightedRequestId] = useState<string | null>(null)
  const lastAssistantIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') return index
      if (messages[index].role === 'user') break
    }
    return -1
  })()

  const requestByAssistantId = useMemo(() => {
    const mapping = new Map<string, ChatMessage>()
    let latestUserMessage: ChatMessage | null = null
    for (const message of messages) {
      if (message.role === 'user') {
        latestUserMessage = message
      } else if (message.role === 'assistant' && latestUserMessage) {
        mapping.set(message.id, latestUserMessage)
      }
    }
    return mapping
  }, [messages])

  const effectiveLiveTurnState = liveTurnState ?? createEmptyChatTurnState(null)
  // Current-turn tool/text rows are inserted into `messages` eagerly for recovery and
  // update-in-place behavior. While generation is active, keep those optimistic rows out
  // of the historical renderer and let the normalized live timeline render them instead.
  // That keeps thoughts, text, and commands in one sequence-sorted DOM region rather than
  // forcing every historical row above every still-live thought.
  const historicalMessages = useMemo(() => {
    if (!isGenerating) return messages
    const liveToolIds = new Set(
      effectiveLiveTurnState.toolCalls.flatMap((toolCall) => toolCall.id ? [toolCall.id] : []),
    )
    return messages.filter((message) =>
      !message.isFrozenMidTurn &&
      !(message.role === 'tool-call' && !!message.toolCallId && liveToolIds.has(message.toolCallId)),
    )
  }, [messages, isGenerating, effectiveLiveTurnState.toolCalls])

  // Group consecutive tool-call messages with the assistant message that follows them.
  // This ensures one message-enter animation per turn rather than one per block.
  // Dangling tool calls with no assistant message yet (mid-turn: they're inserted into
  // `messages` immediately for progress display, before the turn commits) are further
  // merged with each other into one chained group instead of one group per call — without
  // this, each landed as its own top-level item with the generous space-y-8 gap between
  // top-level items, then visibly "condensed" down to the tighter chained-timeline spacing
  // the instant the turn committed and they got grouped with the assistant message.
  const msgGroups = useMemo<MsgGroup[]>(() => {
    const rawItems = buildChatRenderItems(historicalMessages, createEmptyChatTurnState(null), { includeLiveTurn: false })
    const groups: MsgGroup[] = []
    let pendingDanglingToolCalls: ChatMessage[] = []
    const flushDangling = () => {
      if (pendingDanglingToolCalls.length === 0) return
      const [main, ...rest] = pendingDanglingToolCalls
      groups.push({ main, toolCalls: rest, index: historicalMessages.length })
      pendingDanglingToolCalls = []
    }
    for (const item of rawItems) {
      if (item.type === 'historical-tool-group') {
        flushDangling()
        groups.push({ main: item.message, toolCalls: item.toolCalls, index: item.index })
      } else if (item.type === 'historical-message' && item.message.role === 'tool-call') {
        pendingDanglingToolCalls.push(item.message)
      } else if (item.type === 'historical-message') {
        flushDangling()
        groups.push({ main: item.message, toolCalls: [], index: item.index })
      }
    }
    flushDangling()
    return groups
  }, [historicalMessages])
  // buildChatRenderItems already de-dupes against committed historical messages and
  // interleaves thinking blocks/tool calls by firstSeenSequence — the live area below
  // renders this directly instead of maintaining separate parallel derivations.
  const liveRenderItems = useMemo(
    () => buildChatRenderItems(historicalMessages, effectiveLiveTurnState, { includeLiveTurn: true })
      .filter((item) => item.type !== 'historical-message' && item.type !== 'historical-tool-group'),
    [historicalMessages, effectiveLiveTurnState],
  )
  const effectiveCliCost = cliCost ?? liveTurnState?.cost ?? null
  // Keep normal-sized conversations unchanged. Once the transcript is long enough,
  // Chromium skips layout/paint for message subtrees outside the viewport via the
  // `.chat-message-windowed` rule below. This preserves DOM anchors and scroll-to-request
  // behavior while avoiding a full Markdown/code repaint during window resizing.
  const shouldWindowHistoricalTimeline = msgGroups.length >= 24
  const windowedMessageClass = shouldWindowHistoricalTimeline ? ' chat-message-windowed' : ''
  const supersededPendingArtifactMessageIds = useMemo(
    () => getSupersededPendingArtifactMessageIds(messages),
    [messages],
  )

  const updateVisibleMessages = useCallback(() => {
    const container = scrollContainerRef?.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    if (containerRect.height <= 0) return

    const nextVisibleIds = new Set<string>()
    let nextTopAssistant: { id: string; top: number } | null = null

    for (const message of messages) {
      const element = messageElementsRef.current.get(message.id)
      if (!element) continue

      const rect = element.getBoundingClientRect()
      const visibleTop = Math.max(rect.top, containerRect.top)
      const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
      const isVisible = visibleBottom > visibleTop
      if (!isVisible) continue

      nextVisibleIds.add(message.id)
      if (message.role === 'assistant') {
        const top = Math.max(rect.top, containerRect.top)
        if (!nextTopAssistant || top < nextTopAssistant.top) {
          nextTopAssistant = { id: message.id, top }
        }
      }
    }

    setVisibleMessageIds((prev) => {
      if (prev.size === nextVisibleIds.size && Array.from(prev).every((id) => nextVisibleIds.has(id))) {
        return prev
      }
      return nextVisibleIds
    })
    setTopVisibleAssistantId((prev) => (prev === nextTopAssistant?.id ? prev : (nextTopAssistant?.id ?? null)))
  }, [messages, scrollContainerRef])

  const registerMessageElement = useCallback((messageId: string) => {
    return (element: HTMLDivElement | null) => {
      if (element) {
        messageElementsRef.current.set(messageId, element)
      } else {
        messageElementsRef.current.delete(messageId)
      }
    }
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(updateVisibleMessages)
    return () => cancelAnimationFrame(frame)
  }, [messages, streamingContent, updateVisibleMessages])

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  const requestReference: RequestReference | null = (() => {
    if (!topVisibleAssistantId) return null
    const request = requestByAssistantId.get(topVisibleAssistantId)
    if (!request || visibleMessageIds.has(request.id)) return null
    const preview = getRequestPreview(request.content)
    if (!preview) return null
    return { requestId: request.id, preview: truncatePreview(preview) }
  })()

  const handleScrollToRequest = useCallback((requestId: string) => {
    const element = messageElementsRef.current.get(requestId)
    if (!element) return
    onNavigateToRequest?.()
    element.scrollIntoView({ behavior: 'auto', block: 'center' })
    setHighlightedRequestId(requestId)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedRequestId(null), 1600)
  }, [onNavigateToRequest])

  const handleScroll = useCallback(() => {
    onScroll?.()
    // rAF-coalesce the O(n) getBoundingClientRect sweep so a burst of scroll events within
    // one frame does the visibility recompute at most once, off the scroll event itself.
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      updateVisibleMessages()
    })
  }, [onScroll, updateVisibleMessages])

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto min-h-0 px-4 pt-0 pb-6 mr-1.5"
      role="log"
      aria-live="polite"
      aria-label="Messages"
      onScroll={handleScroll}
    >
      {requestReference && (
        <div className="sticky top-0 z-[5] -mx-4 h-0 pointer-events-none">
          <button
            type="button"
            onClick={() => handleScrollToRequest(requestReference.requestId)}
            className="pointer-events-auto flex h-9 w-full items-center border-b border-gray-100 bg-gray-100/95 px-4 text-left text-xs font-semibold text-gray-800 shadow-sm backdrop-blur transition-colors hover:bg-gray-200/95 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400 dark:border-gray-800 dark:bg-gray-800/95 dark:text-gray-100 dark:hover:bg-gray-700/95 dark:focus:ring-blue-500"
            aria-label="Scroll to related request"
            title="Scroll to related request"
          >
            <span className="mx-auto flex w-full max-w-3xl items-center gap-2">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                In reply to
              </span>
              <span className="min-w-0 flex-1 truncate font-bold">{requestReference.preview}</span>
            </span>
          </button>
        </div>
      )}
      <div ref={contentContainerRef} className="max-w-3xl mx-auto space-y-8 pt-6">
        {/* Conversation start marker — decorative top treatment */}
        {!isLoadingMessages && messages.length > 0 && (
          <div className="chat-start-divider pb-6 pt-2">
            <div className="flex flex-col gap-2">
              <div className="h-px w-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-px w-full bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        )}
        {isLoadingMessages && (
          <>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}
              >
                <div className={`max-w-[80%] rounded-lg px-4 py-3 overflow-hidden ${index % 2 === 0 ? 'w-64' : 'w-48'}`}>
                  <div className="h-3 rounded mb-2 skeleton-shimmer" />
                  <div className="h-3 rounded w-4/5 skeleton-shimmer" />
                </div>
              </div>
            ))}
          </>
        )}
        {msgGroups.map(({ main, toolCalls, index }) => {
          if (main.role === 'team-activity') {
            let steps: TeamActivityStep[] = []
            try {
              steps = (JSON.parse(main.content) as { steps: TeamActivityStep[] }).steps ?? []
            } catch {
              // ignore malformed stored team activity payloads
            }
            return (
              <div
                key={main.id}
                ref={registerMessageElement(main.id)}
                className={`max-w-3xl mx-auto message-enter${windowedMessageClass}`}
                data-message-id={main.id}
                data-message-role={main.role}
              >
                <TeamActivityBlock steps={steps} isLive={false} />
              </div>
            )
          }

          const artifactRef = parseArtifactReference(main.content)
          if (artifactRef) {
            if (supersededPendingArtifactMessageIds.has(main.id)) return null
            return (
              <div
                key={main.id}
                ref={registerMessageElement(main.id)}
                className={`max-w-3xl mx-auto px-4 pb-2 message-enter${windowedMessageClass}`}
                data-message-id={main.id}
                data-message-role={main.role}
              >
                <ArtifactCard
                  artifactId={artifactRef.artifactId}
                  versionId={artifactRef.versionId}
                  pending={artifactRef.pending === true}
                  referencedKind={artifactRef.kind}
                />
              </div>
            )
          }

          // Standalone tool-call chain (dangling calls with no assistant message yet —
          // either still mid-turn, or the edge case of a turn that ends in tool calls
          // with no trailing text). All merged into one shared-border chained group so
          // this reads the same whether the turn is still generating or already settled.
          if (main.role === 'tool-call') {
            return (
              <div
                key={main.id}
                ref={registerMessageElement(main.id)}
                className={`max-w-3xl mx-auto message-enter chat-timeline space-y-3${windowedMessageClass}`}
                data-message-id={main.id}
                data-message-role={main.role}
              >
                {[main, ...toolCalls].map((tc) => (
                  <TimelineEntry key={tc.id} colorClass={toolCallDotColor(tc.toolInProgress, tc.toolSuccess ?? true)} pulse={tc.toolInProgress}>
                    {isCodexToolCall(tc.serverName) ? (
                      <CodexActionLine
                        kind="tool"
                        toolName={tc.toolName ?? tc.content}
                        args={tc.toolArgs}
                        result={tc.toolResult}
                        success={tc.toolSuccess ?? true}
                        inProgress={tc.toolInProgress}
                      />
                    ) : (
                      <ToolCallBlock
                        toolName={tc.toolName ?? tc.content}
                        serverName={tc.serverName}
                        args={tc.toolArgs}
                        result={tc.toolResult}
                        success={tc.toolSuccess ?? true}
                        inProgress={tc.toolInProgress}
                        resultImages={tc.toolResultImages}
                        onUseImageAsContext={onUseImageAsContext}
                      />
                    )}
                  </TimelineEntry>
                ))}
              </div>
            )
          }

          // Normal message (user / assistant) — tool calls that preceded it are grouped in.
          const isAssistant = main.role === 'assistant'
          const historicalTimeline = buildHistoricalTimeline(
            isAssistant ? main.thinkingBlocks : undefined,
            isAssistant ? main.textSegments : undefined,
            toolCalls,
          )
          // The most recent text segment (if the reply was ever interrupted by a tool
          // call) becomes the bubble's displayed text instead of the full `content` —
          // the earlier segment(s) already render inline in the timeline above, and
          // showing the full text again here would repeat them. `content` (the full,
          // unsplit text) is still what's passed to onCopy/wiki-save/etc. below.
          const bubbleDisplayContent = isAssistant ? tailTextSegment(main.textSegments)?.content : undefined
          return (
            <div
              key={main.id}
              ref={registerMessageElement(main.id)}
              className={`message-enter${windowedMessageClass}`}
              data-message-id={main.id}
              data-message-role={main.role}
            >
              {historicalTimeline.length > 0 && (
                // One shared left-border thread for the whole sequence — reasoning,
                // interim response text, and tool calls read as chained steps rather
                // than separately-bordered blocks, with generous spacing between them
                // along it. Interleaved chronologically (see buildHistoricalTimeline)
                // rather than all-thinking-then-all-tools.
                <div className="chat-timeline mb-2 space-y-3">
                  {historicalTimeline.map((item) => {
                    if (item.kind === 'thinking') {
                      const block = item.block
                      return (
                        <TimelineEntry key={block.blockId} colorClass={thinkingDotColor(block.done)} pulse={!block.done}>
                          {isPlainNarrationThinkingBlock(block.blockId) ? (
                            <CodexActionLine kind="reasoning" content={block.content} />
                          ) : (
                            <ThinkingBlock
                              content={block.content}
                              done={block.done}
                              label={getThinkingBlockLabel(block.blockId)}
                            />
                          )}
                        </TimelineEntry>
                      )
                    }
                    if (item.kind === 'text') {
                      return (
                        <TimelineEntry key={item.block.blockId} colorClass="bg-gray-400 dark:bg-gray-500">
                          <div className="text-sm text-gray-900 dark:text-gray-100">
                            <MarkdownRenderer content={item.block.content} viewMode={markdownViewMode} searchQuery={main.id === searchMatchMessageId ? searchQuery : undefined} />
                          </div>
                        </TimelineEntry>
                      )
                    }
                    const tc = item.message
                    return (
                      <TimelineEntry key={tc.id} colorClass={toolCallDotColor(tc.toolInProgress, tc.toolSuccess ?? true)} pulse={tc.toolInProgress}>
                        {isCodexToolCall(tc.serverName) ? (
                          <CodexActionLine
                            kind="tool"
                            toolName={tc.toolName ?? tc.content}
                            args={tc.toolArgs}
                            result={tc.toolResult}
                            success={tc.toolSuccess ?? true}
                            inProgress={tc.toolInProgress}
                          />
                        ) : (
                          <ToolCallBlock
                            toolName={tc.toolName ?? tc.content}
                            serverName={tc.serverName}
                            args={tc.toolArgs}
                            result={tc.toolResult}
                            success={tc.toolSuccess ?? true}
                            inProgress={tc.toolInProgress}
                            resultImages={tc.toolResultImages}
                            onUseImageAsContext={onUseImageAsContext}
                          />
                        )}
                      </TimelineEntry>
                    )
                  })}
                </div>
              )}
              {main.userInputs?.map((entry) => (
                <div key={entry.request.requestId} className="mb-2 max-w-3xl mx-auto">
                  <UserInputCard userInput={{
                    request: entry.request,
                    answers: entry.answers,
                    status: 'resolved',
                    firstSeenSequence: 0,
                  }} />
                </div>
              ))}
              <MessageBubble
                id={main.id}
                role={main.role as 'user' | 'assistant' | 'system'}
                content={main.content}
                displayContent={bubbleDisplayContent}
                markdownViewMode={markdownViewMode}
                isFrozenMidTurn={main.isFrozenMidTurn}
                isEdited={main.isEdited}
                modelLabel={
                  main.role === 'assistant' && main.model
                    ? getModelLabel(main.model, catalogModels)
                    : undefined
                }
                attachments={main.attachments}
                images={main.images}
                citations={main.citations}
                contextSnapshot={main.contextSnapshot}
                isLastAssistant={index === lastAssistantIndex}
                isGenerating={isGenerating}
                isError={main.isError}
                errorType={main.errorType}
                retryable={main.retryable}
                isStopped={main.isStopped}
                messageIndex={index}
                timestamp={main.timestamp}
                isHighlighted={main.id === highlightedRequestId}
                searchQuery={main.id === searchMatchMessageId ? searchQuery : undefined}
                onCopy={onCopy}
                onSaveAsPrompt={main.role === 'system' ? undefined : onSaveAsPrompt}
                onSaveToWiki={main.role === 'assistant' ? onSaveToWiki : undefined}
                onSaveAsArtifact={main.role === 'assistant' ? onPromoteArtifact : undefined}
                hasWikiEntry={wikiMessageIds.has(main.id)}
                onRegenerate={index === lastAssistantIndex ? onRegenerate : undefined}
                onEdit={main.role === 'user' ? onEdit : undefined}
                onDeleteAfter={main.id && main.timestamp > 0 && onDeleteAfter ? () => onDeleteAfter(main) : undefined}
                onForkFromHere={main.id && main.timestamp > 0 && onForkFromHere ? () => onForkFromHere(main) : undefined}
                onRetry={main.isError && main.retryable ? onRetry : undefined}
                onSignIn={
                  main.isError && main.errorType === 'auth' ? onSignIn : undefined
                }
                onPickModel={
                  main.isError && main.errorType === 'model_not_available'
                    ? onPickModel
                    : undefined
                }
              />
            </div>
          )
        })}
        {isGenerating && liveTeamActivity.length > 0 && (
          <div className="max-w-3xl mx-auto">
            <TeamActivityBlock steps={liveTeamActivity} isLive={true} />
          </div>
        )}
        {/* Live generation area: thinking blocks, tool calls, streaming text, and the
            activity indicator, rendered in true chronological order via liveRenderItems
            (see chat-render-items.ts) — a bubble never jumps out of the sequence it
            actually happened in, and each distinct reasoning burst gets its own block.
            Thinking/tool-call items render whenever present, independent of isGenerating
            (they can legitimately outlive the turn briefly); the text/activity items are
            explicitly gated on isGenerating below since liveTurnState.text/activity stay
            populated after completion until the next turn resets them — without that gate
            the streaming cursor would linger after the committed message already replaced it. */}
        {(liveRenderItems.length > 0 || isGenerating) && (
          // One shared left-border thread for the whole live sequence, with generous
          // spacing between steps along it — reads as a chained timeline rather than a
          // stack of separately-bordered blocks.
          <div className="chat-timeline space-y-3">
            {liveRenderItems.map((item) => {
              if (item.type === 'live-thinking-block') {
                // The reducer marks blocks done the instant the backend's turn-completion
                // event arrives, ahead of the text reveal animation. Keep showing the
                // live/streaming style for as long as isGenerating is true (i.e. until the
                // reveal animation actually finishes draining) so the two don't decouple.
                const done = item.block.done && !isGenerating
                return (
                  <TimelineEntry key={item.id} colorClass={thinkingDotColor(done)} pulse={!done}>
                    {isPlainNarrationThinkingBlock(item.block.blockId) ? (
                      <CodexActionLine kind="reasoning" content={item.block.content} />
                    ) : (
                      <ThinkingBlock
                        content={item.block.content}
                        done={done}
                        label={getThinkingBlockLabel(item.block.blockId)}
                      />
                    )}
                  </TimelineEntry>
                )
              }
              if (item.type === 'live-tool-call') {
                return (
                  <TimelineEntry key={item.id} colorClass={toolCallDotColor(item.toolCall.inProgress, item.toolCall.success)} pulse={item.toolCall.inProgress}>
                    {isCodexToolCall(item.toolCall.serverName) ? (
                      <CodexActionLine
                        kind="tool"
                        toolName={item.toolCall.toolName}
                        args={item.toolCall.args}
                        result={item.toolCall.result}
                        success={item.toolCall.success}
                        inProgress={item.toolCall.inProgress}
                      />
                    ) : (
                      <ToolCallBlock
                        toolName={item.toolCall.toolName}
                        serverName={item.toolCall.serverName}
                        args={item.toolCall.args}
                        result={item.toolCall.result}
                        success={item.toolCall.success}
                        inProgress={item.toolCall.inProgress}
                        resultImages={item.toolCall.resultImages}
                        onUseImageAsContext={onUseImageAsContext}
                      />
                    )}
                  </TimelineEntry>
                )
              }
              if (item.type === 'live-user-input') {
                return (
                  <TimelineEntry key={item.id} colorClass={item.userInput.status === 'pending' ? 'bg-blue-500' : 'bg-green-500'} pulse={item.userInput.status === 'pending'}>
                    <UserInputCard userInput={item.userInput} />
                  </TimelineEntry>
                )
              }
              if (item.type === 'live-text-segment') {
                // Completed live-turn state remains populated until the next turn or
                // conversation reset. Once generation settles, the persisted assistant
                // message is authoritative; rendering this closed segment as well would
                // duplicate CLI responses until the user leaves and re-enters the chat.
                if (!isGenerating) return null
                return (
                  <div className="message-enter text-sm text-gray-900 dark:text-gray-100" key={item.id}>
                    <MarkdownRenderer content={item.text} viewMode={markdownViewMode} />
                  </div>
                )
              }
              if (item.type === 'live-assistant-text') {
                if (!isGenerating) return null
                // throttledStreamingContent is derived from liveTrailingText above, which
                // is already just this segment's own content (not the full cumulative
                // reply) — so this can't repeat text already shown via a live-text-segment
                // item earlier in the timeline.
                return (
                  <div className="text-sm text-gray-900 dark:text-gray-100" key={item.id}>
                    <MarkdownRenderer content={throttledStreamingContent} viewMode={markdownViewMode} />
                    <span className="text-gray-400">▊</span>
                  </div>
                )
              }
              if (item.type === 'live-activity') {
                if (!isGenerating) return null
                return (
                  <TimelineEntry key={item.id} colorClass={item.state === 'tool' ? 'bg-blue-500' : 'bg-gray-400'} pulse>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-2 mb-2">
                        {item.state === 'tool' ? (
                          <Wrench className="w-3.5 h-3.5 shrink-0 text-blue-500 dark:text-blue-400 animate-pulse" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                        )}
                        <span>
                          {item.state === 'tool'
                            ? <>Using <span className="font-mono text-blue-600 dark:text-blue-400">{item.toolName ?? item.label}</span>{item.serverName ? <span className="text-gray-400 dark:text-gray-500"> · {item.serverName}</span> : null}</>
                            : <>{liveActivityLabel(item.label, generationElapsedSec)}</>
                          }
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" />
                      </div>
                    </div>
                  </TimelineEntry>
                )
              }
              return null
            })}
            {/* Covers the brief window after isGenerating flips true but before the first
                turn_started/activity_changed event has arrived, so there's no dead gap. */}
            {isGenerating && liveRenderItems.length === 0 && (
              <TimelineEntry colorClass="bg-gray-400" pulse>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-2 mb-2">
                    <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                    <span>{liveActivityLabel('Thinking', generationElapsedSec)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" />
                  </div>
                </div>
              </TimelineEntry>
            )}
          </div>
        )}
        {effectiveCliCost && !isGenerating && (
          <div className="mt-2 flex items-center gap-3 border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
            <span className="font-mono">${effectiveCliCost.totalCostUsd.toFixed(4)}</span>
            <span>·</span>
            <span>{effectiveCliCost.inputTokens.toLocaleString()} in</span>
            <span>/</span>
            <span>{effectiveCliCost.outputTokens.toLocaleString()} out</span>
            {effectiveCliCost.quality && (
              <span className="text-[10px] uppercase tracking-wide">
                · {effectiveCliCost.quality}{effectiveCliCost.source ? ` · ${effectiveCliCost.source}` : ''}
              </span>
            )}
            <span className="group relative inline-flex">
              <button
                type="button"
                aria-label="How token usage is calculated"
                aria-describedby="token-usage-explanation"
                className="rounded-full text-gray-400 outline-none transition-colors hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-500 dark:hover:text-gray-300"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span
                id="token-usage-explanation"
                role="tooltip"
                className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-72 rounded-lg bg-gray-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-gray-100 dark:text-gray-900"
              >
                {TOKEN_USAGE_EXPLANATION}
              </span>
            </span>
          </div>
        )}
        {loadingFailed && !isGenerating && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Request failed — see error above</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}

export const ChatMessages = memo(ChatMessagesBase)
