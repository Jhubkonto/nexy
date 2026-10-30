/* eslint-disable react-hooks/exhaustive-deps -- subscriptions use refs to avoid resubscribing during active streams. */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { getModelLabel } from '../../shared/models'
import { isApiError, type CatalogModel } from '../../shared/types'
import { isLegacyPortableOperationalSummary } from '../../shared/conversation-portability'
import type {
  Attachment,
  ChatMessage,
  TeamActivityStep,
  ToastType,
} from './chat-types'
import { useChatLiveTurn } from './useChatLiveTurn'
import { useStreamingQueue } from './useStreamingQueue'
import type { DelegationRunSnapshot } from '../../shared/delegation'

interface UseChatParams {
  conversationId: string | null
  activeAgentId: string | null
  activeProjectId: string | null
  effectiveModel: string
  catalogModels: CatalogModel[]
  addToast: (message: string, type?: ToastType) => void
  loadConversations: () => Promise<void>
  conversationCreated: (id: string) => void
  rateLimitSetterRef?: MutableRefObject<(seconds: number) => void>
  markConversationGenerating: (id: string) => void
  markConversationDoneGenerating: (id: string) => void
  isConversationGenerating?: boolean
  conversationGenerationStartedAt?: number | null
}

const conversationMessageCache = new Map<string, ChatMessage[]>()

export function useChat({
  conversationId,
  effectiveModel,
  catalogModels,
  addToast,
  loadConversations,
  rateLimitSetterRef,
  markConversationGenerating,
  markConversationDoneGenerating,
  isConversationGenerating,
  conversationGenerationStartedAt,
}: UseChatParams) {
  const { displayedContent, isDraining, enqueue, flush, reset: resetQueue, snap: snapQueue } = useStreamingQueue()
  const liveTurnState = useChatLiveTurn(conversationId)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const messagesOwnerRef = useRef<string | null>(conversationId)
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [loadingFailed, setLoadingFailed] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isEditingMessage, setIsEditingMessage] = useState(false)
  const [liveTeamActivity, setLiveTeamActivity] = useState<TeamActivityStep[]>([])
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null)
  // The terminal-turn effect below doesn't include isDraining in its deps (re-running
  // it on every drain tick would be wasteful/racy) — read the live value through this
  // ref instead of the closed-over state value, which would otherwise stay frozen at
  // whatever isDraining was when the effect last ran.
  const isDrainingRef = useRef(isDraining)
  isDrainingRef.current = isDraining

  // Kept in sync from liveTurnState (see the text-delta effect below) rather than
  // written directly from an IPC handler — useChatWindowActions still reads/writes
  // these refs to track partial content across a Stop click and to seed the optimistic
  // model label before the first turn_started event arrives.
  const streamingContentRef = useRef('')
  const ignoreRemoteStreamRef = useRef(false)
  const liveToolCallsRef = useRef<ChatMessage[]>([])
  const streamModelRef = useRef<string | null>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
  const loadGenerationRef = useRef(0)
  // Incremented by an explicit Stop so an active-turn snapshot requested before the
  // stop cannot arrive later and resurrect isGenerating for an already-aborted turn.
  const stopGenerationEpochRef = useRef(0)
  // Locked to the conversation that started the current stream; cleared on stream end/error.
  const streamingConversationRef = useRef<string | null>(null)
  // Set to true when the turn completes; isGenerating stays true until the drain queue also empties.
  const streamEndedRef = useRef(false)
  // How much of liveTurnState.text has already been enqueued into the reveal animation —
  // lets the text-delta effect enqueue only the new suffix on each liveTurnState update.
  const enqueuedTextLenRef = useRef(0)
  // Maps a tool call's stable key (its id, or array index for id-less BYOK calls) to the
  // ChatMessage.id already inserted for it, so later updates patch in place instead of
  // re-appending.
  const toolCallMessageIdsRef = useRef<Map<string, string>>(new Map())
  // Text-segment blockIds already promoted into `messages` mid-turn (see the tool-call/
  // text-segment promotion effect below) — promoted once, never re-promoted or rewritten.
  const promotedTextSegmentIdsRef = useRef<Set<string>>(new Set())
  // Guards the terminal-turn effect against re-running for a turn it already handled.
  const handledTurnRef = useRef<string | null>(null)
  const justCreatedConversationRef = useRef(false)
  const lastUndoneUserMessageRef = useRef<string | null>(null)
  const pendingEditedResendRef = useRef(false)
  const editCutoffTimestampRef = useRef<number | null>(null)
  const preEditMessagesRef = useRef<ChatMessage[] | null>(null)
  // Holds the previous assistant message during regeneration so it can be
  // restored to the UI if the API call fails, and deleted from the DB on success.
  const pendingDeleteMessageRef = useRef<ChatMessage | null>(null)
  // Tracks the in-flight regen-cleanup deleteMessage IPC call so reloadMessages can
  // wait for it — otherwise a reload can race ahead of the delete and briefly show
  // both the old (pre-regen) and new assistant messages until the delete lands.
  const pendingDeletePromiseRef = useRef<Promise<unknown> | null>(null)
  // Holds the work computed at stream-end (final message to commit, frozen thinking
  // blocks) so it can be applied once the reveal animation actually finishes draining,
  // instead of immediately when the backend's turn-completion event arrives — otherwise
  // the reasoning bubble and full answer text pop in ahead of the in-progress animation.
  const pendingFinalizeRef = useRef<{
    assistantMessage: ChatMessage | null
    frozenThinking: Map<string, { blockId: string; content: string; done: boolean }> | null
  } | null>(null)
  const preRegenMessagesRef = useRef<ChatMessage[] | null>(null)
  // Stable ref so stream-event closures always call the current addToast.
  const addToastRef = useRef(addToast)
  useEffect(() => { addToastRef.current = addToast }, [addToast])

  const pushSystemMessage = useCallback((content: string) => {
    const systemMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, systemMessage])
  }, [])

  const attachArtifact = useCallback(async (artifactId: string, versionId?: string) => {
    const activeId = activeConversationRef.current
    if (!activeId) return
    const content = `__artifact-ref:${JSON.stringify({ artifactId, versionId })}`
    const inserted = await window.api.insertConversationMessage(activeId, 'system', content)
    if (isApiError(inserted)) {
      addToastRef.current('Failed to attach artifact', 'error')
      return
    }
    setMessages((prev) => prev.some((m) => m.id === inserted.id) ? prev : [...prev, {
      id: inserted.id,
      role: inserted.role as ChatMessage['role'],
      content: inserted.content,
      timestamp: inserted.timestamp,
      model: inserted.model ?? null,
    }])
  }, [])

  const buildConversationMarkdown = useCallback(() => {
    const lines: string[] = ['# Conversation Export', '']
    for (const message of messages) {
      if (message.role === 'system') {
        lines.push(`_System_: ${message.content}`)
      } else if (message.role === 'user') {
        lines.push('## User', '', message.content, '')
      } else {
        lines.push('## Assistant', '', message.content, '')
      }
    }
    return lines.join('\n')
  }, [messages])

  useEffect(() => {
    activeConversationRef.current = conversationId
    // If the user navigates into a conversation that already has an in-flight
    // background stream (ignoreRemoteStreamRef=true), flip the ignore flag off so
    // the pending stream-end / error handlers clear isGenerating when the stream
    // finishes rather than bailing out via the wasBackground early-return path.
    if (conversationId && streamingConversationRef.current === conversationId && ignoreRemoteStreamRef.current) {
      ignoreRemoteStreamRef.current = false
    }
  }, [conversationId])

  useEffect(() => {
    const loadGeneration = ++loadGenerationRef.current
    const previousOwner = messagesOwnerRef.current
    if (previousOwner && previousOwner !== conversationId && messagesRef.current.length > 0) {
      conversationMessageCache.set(previousOwner, messagesRef.current)
    }
    messagesOwnerRef.current = conversationId
    if (justCreatedConversationRef.current) {
      justCreatedConversationRef.current = false
      return
    }

    if (conversationId) {
      const stopGenerationEpoch = stopGenerationEpochRef.current
      setMessages(conversationMessageCache.get(conversationId) ?? [])
      setIsLoadingMessages(true)
      void window.api.getActiveChatTurn(conversationId).then((snapshot) => {
        if (
          loadGeneration !== loadGenerationRef.current
          || stopGenerationEpoch !== stopGenerationEpochRef.current
          || !snapshot
          || snapshot.conversationId !== activeConversationRef.current
        ) return
        streamingConversationRef.current = snapshot.conversationId
        streamingContentRef.current = snapshot.assistantText
        setStreamingContent(snapshot.assistantText)
        snapQueue(snapshot.assistantText)
        if (snapshot.status === 'active') {
          setIsGenerating(true)
          markConversationGenerating(snapshot.conversationId)
        }
      })
      window.api
        .getMessages(conversationId)
        .then((dbMessages) => {
          if (loadGeneration !== loadGenerationRef.current || conversationId !== activeConversationRef.current) return
          setMessages((prev) => {
            const imageMap = new Map(
              prev.filter((message) => message.images).map((message) => [message.id, message.images!]),
            )

            return dbMessages.filter((message) => !isLegacyPortableOperationalSummary(message.role, message.content)).map((message) => {
              const parsedAttachments: Attachment[] | undefined = message.attachments ? JSON.parse(message.attachments) : undefined
              const base: ChatMessage = {
                id: message.id,
                role: message.role as ChatMessage['role'],
                content: message.content,
                timestamp: message.timestamp,
                model: message.model ?? null,
                isEdited: message.is_edited === 1,
                attachments: parsedAttachments,
                // Once persisted attachments already carry the image (server-side merge in
                // buildStoredAttachments), reusing the in-memory local-echo `images` here would
                // render the same screenshot twice.
                images: parsedAttachments?.some((a) => a.type === 'image') ? undefined : imageMap.get(message.id),
                contextSnapshot: message.context_snapshot ?? undefined,
              }
              if (message.role === 'assistant' && message.citations) {
                try { base.citations = JSON.parse(message.citations) }
                catch { /* malformed — ignore */ }
              }
              if (message.role === 'assistant' && message.thinking_blocks) {
                try {
                  const blocks = JSON.parse(message.thinking_blocks) as Array<{ blockId: string; content: string; done: boolean; firstSeenAt?: number }>
                  base.thinkingBlocks = new Map(blocks.map((b) => [b.blockId, b]))
                } catch { /* malformed — ignore */ }
              }
              if (message.role === 'assistant' && message.text_segments) {
                try {
                  const segments = JSON.parse(message.text_segments) as Array<{ blockId: string; content: string; done: boolean; firstSeenAt?: number }>
                  base.textSegments = new Map(segments.map((s) => [s.blockId, s]))
                } catch { /* malformed — ignore */ }
              }
              if (message.role === 'assistant' && message.user_inputs) {
                try { base.userInputs = JSON.parse(message.user_inputs) }
                catch { /* malformed — ignore */ }
              }
              if (message.role === 'tool-call') {
                try {
                  const parsed = JSON.parse(message.content) as Record<string, unknown>
                  if (parsed.__type === 'tool-call') {
                    return {
                      ...base,
                      content: typeof parsed.toolResult === 'string' ? parsed.toolResult : '',
                      // Without this, a live-turn tool call that just got persisted (same
                      // conversationId, liveTurnState not yet reset) can't be recognized as
                      // already-committed on the next render, so it gets rendered a second
                      // time as a stray live-tool-call block on top of this historical one.
                      toolCallId: typeof parsed.toolCallId === 'string' ? parsed.toolCallId : undefined,
                      toolName: typeof parsed.toolName === 'string' ? parsed.toolName : undefined,
                      serverName: typeof parsed.serverName === 'string' ? parsed.serverName : undefined,
                      toolArgs: (typeof parsed.toolArgs === 'object' && parsed.toolArgs !== null)
                        ? parsed.toolArgs as Record<string, unknown>
                        : undefined,
                      toolResult: typeof parsed.toolResult === 'string' ? parsed.toolResult : undefined,
                      toolSuccess: typeof parsed.toolSuccess === 'boolean' ? parsed.toolSuccess : true,
                    }
                  }
                } catch { /* malformed tool-call JSON — skip */ }
              }
              return base
            })
          })
        })
        .catch(() => {
          if (loadGeneration !== loadGenerationRef.current || conversationId !== activeConversationRef.current) return
          addToast('Failed to load messages', 'error')
          setMessages([])
        })
        .then(() => {
          if (loadGeneration !== loadGenerationRef.current || conversationId !== activeConversationRef.current) return
          // If this conversation is still generating (user navigated away and back),
          // restore the Thinking animation so the UI reflects the active state.
          if (isConversationGenerating) {
            setIsGenerating(true)
            // Use the stored start time so the elapsed counter continues from where
            // it left off rather than restarting at 0 on every re-entry.
            setGenerationStartedAt(conversationGenerationStartedAt ?? Date.now())
          }
        })
        .finally(() => {
          if (loadGeneration === loadGenerationRef.current && conversationId === activeConversationRef.current) {
            setIsLoadingMessages(false)
          }
        })
    } else {
      setMessages([])
      setIsLoadingMessages(false)
    }

    resetQueue()
    setStreamingContent('')
    streamingContentRef.current = ''
    setIsGenerating(false)
    setIsEditingMessage(false)
    preEditMessagesRef.current = null
    editCutoffTimestampRef.current = null
    pendingEditedResendRef.current = false
    setGenerationStartedAt(null)
    setLiveTeamActivity([])
    liveToolCallsRef.current = []
    enqueuedTextLenRef.current = 0
    toolCallMessageIdsRef.current.clear()
    promotedTextSegmentIdsRef.current.clear()
    handledTurnRef.current = null
    setLoadingFailed(false)
  }, [conversationId, addToast, snapQueue])

  // Re-fetch messages from DB and update state, preserving any in-memory images.
  // Called after stream end so the persisted team-activity row becomes visible without
  // requiring the user to navigate away and back.
  const reloadMessages = useCallback(() => {
    if (!conversationId) return
    // Wait for any in-flight regen cleanup delete so we don't fetch the DB mid-race
    // and briefly display both the pre-regen and newly-streamed assistant messages.
    void Promise.resolve(pendingDeletePromiseRef.current).then(() => window.api.getMessages(conversationId)).then((dbMessages) => {
      setMessages((prev) => {
        const imageMap = new Map(
          prev.filter((m) => m.images).map((m) => [m.id, m.images!]),
        )
        return dbMessages.filter((message) => !isLegacyPortableOperationalSummary(message.role, message.content)).map((message) => {
          const parsedAttachments: Attachment[] | undefined = message.attachments ? JSON.parse(message.attachments) : undefined
          const base: ChatMessage = {
            id: message.id,
            role: message.role as ChatMessage['role'],
            content: message.content,
            timestamp: message.timestamp,
            model: message.model ?? null,
            isEdited: message.is_edited === 1,
            attachments: parsedAttachments,
            images: parsedAttachments?.some((a) => a.type === 'image') ? undefined : imageMap.get(message.id),
            contextSnapshot: message.context_snapshot ?? undefined,
          }
          if (message.role === 'assistant' && message.citations) {
            try { base.citations = JSON.parse(message.citations) }
            catch { /* malformed — ignore */ }
          }
          if (message.role === 'assistant' && message.thinking_blocks) {
            try {
              const blocks = JSON.parse(message.thinking_blocks) as Array<{ blockId: string; content: string; done: boolean; firstSeenAt?: number }>
              base.thinkingBlocks = new Map(blocks.map((b) => [b.blockId, b]))
            } catch { /* malformed — ignore */ }
          }
          if (message.role === 'assistant' && message.text_segments) {
            try {
              const segments = JSON.parse(message.text_segments) as Array<{ blockId: string; content: string; done: boolean; firstSeenAt?: number }>
              base.textSegments = new Map(segments.map((s) => [s.blockId, s]))
            } catch { /* malformed — ignore */ }
          }
          if (message.role === 'assistant' && message.user_inputs) {
            try { base.userInputs = JSON.parse(message.user_inputs) }
            catch { /* malformed — ignore */ }
          }
          if (message.role === 'tool-call') {
            try {
              const parsed = JSON.parse(message.content) as Record<string, unknown>
              if (parsed.__type === 'tool-call') {
                return {
                  ...base,
                  content: typeof parsed.toolResult === 'string' ? parsed.toolResult : '',
                  // Without this, a live-turn tool call that just got persisted (same
                  // conversationId, liveTurnState not yet reset) can't be recognized as
                  // already-committed on the next render, so it gets rendered a second
                  // time as a stray live-tool-call block on top of this historical one.
                  toolCallId: typeof parsed.toolCallId === 'string' ? parsed.toolCallId : undefined,
                  toolName: typeof parsed.toolName === 'string' ? parsed.toolName : undefined,
                  serverName: typeof parsed.serverName === 'string' ? parsed.serverName : undefined,
                  toolArgs: (typeof parsed.toolArgs === 'object' && parsed.toolArgs !== null)
                    ? parsed.toolArgs as Record<string, unknown>
                    : undefined,
                  toolResult: typeof parsed.toolResult === 'string' ? parsed.toolResult : undefined,
                  toolSuccess: typeof parsed.toolSuccess === 'boolean' ? parsed.toolSuccess : true,
                }
              }
            } catch { /* malformed tool-call JSON — skip */ }
          }
          return base
        })
      })
    })
  }, [conversationId])
  const reloadMessagesRef = useRef(reloadMessages)
  reloadMessagesRef.current = reloadMessages

  // Commits the message/thinking-block work computed at stream-end, once the reveal
  // animation has actually caught up — see pendingFinalizeRef for why this is deferred.
  const applyPendingFinalize = useCallback(() => {
    const pending = pendingFinalizeRef.current
    pendingFinalizeRef.current = null
    if (!pending) return
    if (pending.assistantMessage) {
      const assistantMessage = pending.assistantMessage
      setMessages((prev) => [...prev, assistantMessage])
    } else if (pending.frozenThinking) {
      const frozenThinking = pending.frozenThinking
      setMessages((prev) => {
        const lastIdx = [...prev].map((m) => m.role).lastIndexOf('assistant')
        if (lastIdx === -1) return prev
        const updated = [...prev]
        updated[lastIdx] = { ...updated[lastIdx], thinkingBlocks: frozenThinking }
        return updated
      })
    }
  }, [])

  // A newly opened or reconnected renderer may have missed the individual team events. Hydrate
  // from the main-process registry, then keep it current through snapshots rather than guessing
  // delegated work from model prose or tool text.
  useEffect(() => {
    if (!conversationId) return
    const api = window.api
    const applyRun = (run: DelegationRunSnapshot) => {
      if (run.conversationId !== conversationId) return
      const steps: TeamActivityStep[] = run.nodes
        .filter((node) => node.parentId !== null)
        .map((node) => ({
          stepId: node.id,
          agentId: node.id,
          agentName: node.label,
          agentIcon: '🤖',
          task: node.task ?? '',
          status: node.status === 'done' ? 'done' : node.status === 'failed' ? 'error' : node.status === 'cancelled' ? 'cancelled' : 'delegating',
          result: node.detail,
          liveContent: node.tail,
          durationMs: node.finishedAt ? node.finishedAt - node.startedAt : undefined,
        }))
      if (steps.length === 0) return
      setLiveTeamActivity((previous) => {
        const byId = new Map(previous.map((step) => [step.stepId, step]))
        for (const step of steps) {
          const existing = byId.get(step.stepId)
          byId.set(step.stepId, { ...existing, ...step, liveContent: step.liveContent ?? existing?.liveContent })
        }
        return [...byId.values()]
      })
    }
    void api.getDelegationRuns?.(conversationId).then((runs) => runs.forEach(applyRun)).catch(() => undefined)
    return api.onDelegationUpdated?.(applyRun)
  }, [conversationId])

  // Defer isGenerating=false until the drain queue empties so the streaming cursor
  // stays visible until the last buffered character has actually been rendered.
  // Also the trigger point for committing the finished message (see applyPendingFinalize)
  // so the settled appearance lands in the same moment the animation finishes catching up.
  useEffect(() => {
    if (!isDraining && streamEndedRef.current) {
      streamEndedRef.current = false
      applyPendingFinalize()
      setStreamingContent('')
      setIsGenerating(false)
      setLoadingFailed(false)
      setGenerationStartedAt(null)
      setLiveTeamActivity([])
      liveToolCallsRef.current = []
      reloadMessagesRef.current()
    }
  }, [isDraining, applyPendingFinalize])

  useEffect(() => {
    const unsubscribeRemoteMessage = window.api.onRemoteMessage(({ conversationId: remoteId, content, images }) => {
      if (remoteId !== activeConversationRef.current) {
        // Stream is for a background conversation — suppress all chunks but still
        // mark the streaming conversation so the sidebar can reflect it without
        // touching the current view.
        streamingConversationRef.current = remoteId
        ignoreRemoteStreamRef.current = true
        markConversationGenerating(remoteId)
        return
      }
      ignoreRemoteStreamRef.current = false
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        images,
        timestamp: Date.now(),
      }
      streamingConversationRef.current = remoteId
      setMessages((prev) => [...prev, userMsg])
      setIsGenerating(true)
      setGenerationStartedAt(Date.now())
      markConversationGenerating(remoteId)
    })

    return () => {
      unsubscribeRemoteMessage()
    }
  }, [markConversationGenerating])

  // A message can land in this conversation from outside the current render entirely — e.g. a
  // /code-change plan finishing while the investigation ran in the background, well after the
  // slash command's own await returned. Without this, that result was only ever visible after
  // navigating away from the conversation and back (the next mount re-fetches from the DB);
  // this makes it show up live if the conversation is already open when it lands.
  useEffect(() => {
    const unsubscribeMessagesUpdated = window.api.onMessagesUpdated(({ conversationId: updatedId }) => {
      if (updatedId === activeConversationRef.current) {
        reloadMessagesRef.current()
      }
    })
    return () => {
      unsubscribeMessagesUpdated()
    }
  }, [])

  // liveTurnState is already scoped to the active conversationId (useChatLiveTurn drops
  // events for any other conversation), so a turn belonging to a background conversation
  // never reaches it. This raw, unfiltered subscription is the one place that still needs
  // to see every conversation's turns, purely to keep the sidebar's generating indicator
  // and conversation list in sync when a background (e.g. mobile-initiated) turn finishes.
  useEffect(() => {
    return window.api.onChatTurnEvent((event) => {
      if (event.type !== 'turn_completed' && event.type !== 'turn_failed') return
      if (event.conversationId === activeConversationRef.current) return
      markConversationDoneGenerating(event.conversationId)
      void loadConversations()
    })
  }, [loadConversations, markConversationDoneGenerating])

  // Resets the per-turn tracking refs whenever a new turn begins (turnId changes) —
  // declared (and therefore runs) BEFORE the text-delta effect below, which depends on
  // enqueuedTextLenRef already reflecting the right baseline for this turnId by the
  // time it reads it in the same commit.
  //
  // A turnId transition means one of two things: a genuine fresh turn (liveTurnState.text
  // is '' — the reducer resets state on turn_started), or re-entering a chat mid-generation,
  // where useChatLiveTurn's restore action seeds turnId AND text together from an
  // ActiveChatTurnSnapshot. In the restore case, treat the already-accumulated text as an
  // already-displayed baseline rather than something to animate in: prime
  // enqueuedTextLenRef to its full length (so the text-delta effect only enqueues
  // whatever arrives *after* this point) and snap the reveal queue to it directly.
  // Without this, that restored text would get diffed against enqueuedTextLenRef's stale
  // value from the previous turn/mount and re-enqueued for animation on top of the
  // separate getActiveChatTurn snapshot restore elsewhere in this hook (which already
  // snapped displayedContent to the same text), producing a doubled, replayed-from-scratch
  // sentence.
  const lastTurnIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (liveTurnState.turnId === lastTurnIdRef.current) return
    lastTurnIdRef.current = liveTurnState.turnId
    toolCallMessageIdsRef.current.clear()
    promotedTextSegmentIdsRef.current.clear()
    enqueuedTextLenRef.current = liveTurnState.text.length
    if (liveTurnState.text) {
      streamingContentRef.current = liveTurnState.text
      setStreamingContent(liveTurnState.text)
      snapQueue(liveTurnState.text)
    }
  }, [liveTurnState.turnId, liveTurnState.text, snapQueue])

  // Feeds the reveal animation from liveTurnState.text (cumulative) by enqueuing only
  // the newly-arrived suffix on each update — replaces the old per-chunk IPC channel.
  useEffect(() => {
    if (!conversationId || liveTurnState.conversationId !== conversationId) return
    if (ignoreRemoteStreamRef.current) return
    const newLen = liveTurnState.text.length
    if (newLen <= enqueuedTextLenRef.current) {
      enqueuedTextLenRef.current = newLen
      return
    }
    const delta = liveTurnState.text.slice(enqueuedTextLenRef.current)
    enqueuedTextLenRef.current = newLen
    streamingContentRef.current = liveTurnState.text
    setStreamingContent(liveTurnState.text)
    enqueue(delta)
  }, [conversationId, liveTurnState.conversationId, liveTurnState.text, enqueue])

  // Keeps streamModelRef (read by useChatWindowActions for the stopped-message model
  // label) in sync with the model reported by the active turn.
  useEffect(() => {
    if (liveTurnState.conversationId !== activeConversationRef.current) return
    if (liveTurnState.model) streamModelRef.current = liveTurnState.model
  }, [liveTurnState.conversationId, liveTurnState.model])

  // Derives tool-call messages from liveTurnState.toolCalls (appends the first time a
  // tool call appears, patches in place on later updates e.g. CLI in-progress → finished)
  // AND promotes closed text segments from liveTurnState.textBlocks the same way, the
  // moment each one closes. Both kinds of new inserts are interleaved by firstSeenSequence
  // before insertion — without this, tool calls (which used to be the only thing eagerly
  // promoted into `messages`) would always land ahead of any text segment that actually
  // preceded them, since eager-inserted tool calls jump straight into the historical
  // section while text segments sat in the live-only render area until the whole turn
  // settled. Promoted text segments are marked isFrozenMidTurn so MessageBubble doesn't
  // decorate them with final-answer chrome (model/timestamp/actions) — the turn isn't
  // done yet. The still-open (not yet closed) segment is deliberately left alone here; it
  // continues to render via the live area until it closes or the turn ends.
  useEffect(() => {
    if (liveTurnState.conversationId !== activeConversationRef.current) return
    if (liveTurnState.toolCalls.length === 0 && liveTurnState.textBlocks.size === 0) return
    const seenTools = toolCallMessageIdsRef.current
    const seenText = promotedTextSegmentIdsRef.current
    const toUpdate: { msgId: string; result: string; success: boolean; args?: Record<string, unknown>; inProgress: boolean; resultImages?: { dataUrl: string }[] }[] = []
    type PendingInsert =
      | { kind: 'tool'; seq: number; key: string; tc: (typeof liveTurnState.toolCalls)[number] }
      | { kind: 'text'; seq: number; blockId: string; content: string }
    const toInsert: PendingInsert[] = []

    liveTurnState.toolCalls.forEach((tc, index) => {
      const key = tc.id ?? `idx-${index}`
      const existingMsgId = seenTools.get(key)
      if (existingMsgId) {
        toUpdate.push({
          msgId: existingMsgId,
          result: tc.result,
          success: tc.success,
          args: tc.args,
          inProgress: tc.inProgress === true,
          resultImages: tc.resultImages,
        })
      } else {
        toInsert.push({ kind: 'tool', seq: tc.firstSeenSequence ?? 0, key, tc })
      }
    })
    // A closed segment is safe to promote as soon as something newer (another text
    // segment OR a tool call) is already known to exist — at that point it's definitely
    // not the presumptive "most recent thing said" anymore, whether or not the turn is
    // done. Comparing only against other TEXT segments (the earlier version of this
    // check) was the actual bug: buildChatRenderItems always renders every already-
    // promoted (historical) item before every still-live one, as two sequential blocks
    // rather than one true interleaved timeline — so a single lead-in segment that
    // stayed the *only* segment for a long stretch (many tool calls happening before the
    // next segment ever started) stayed un-promoted that whole time, while every one of
    // those tool calls got eagerly promoted and so jumped ahead of it. Only the segment
    // that is CURRENTLY the newest known thing overall (no tool call and no other text
    // segment has a higher sequence yet) is held back — it's either still open (the live
    // "currently being typed" trailing item) or, once the turn ends, becomes the final
    // settled bubble's content (see the finalize effect below). Promoting it early would
    // show its text twice.
    const textBlockValues = Array.from(liveTurnState.textBlocks.values())
    const newestKnownSeq = Math.max(
      -Infinity,
      ...liveTurnState.toolCalls.map((tc) => tc.firstSeenSequence ?? 0),
      ...textBlockValues.map((b) => b.firstSeenSequence ?? 0),
    )
    for (const block of textBlockValues) {
      if (!block.done || !block.content || seenText.has(block.blockId)) continue
      if ((block.firstSeenSequence ?? 0) >= newestKnownSeq) continue
      toInsert.push({ kind: 'text', seq: block.firstSeenSequence ?? 0, blockId: block.blockId, content: block.content })
    }

    if (toUpdate.length === 0 && toInsert.length === 0) return
    toInsert.sort((a, b) => a.seq - b.seq)
    if (toInsert.length > 0) {
      // Flush pending streamed text before inserting the tool block so the text
      // always appears before the tool call in the DOM (C2).
      flush()
    }
    setMessages((prev) => {
      let next = prev
      if (toUpdate.length > 0) {
        const updateMap = new Map(toUpdate.map((u) => [u.msgId, u]))
        next = next.map((m) => {
          const u = updateMap.get(m.id)
          if (!u) return m
          return {
            ...m,
            content: u.result,
            toolResult: u.result,
            toolSuccess: u.success,
            toolArgs: u.args ?? m.toolArgs,
            toolInProgress: u.inProgress,
            ...(u.resultImages?.length ? { toolResultImages: u.resultImages } : {}),
          }
        })
      }
      if (toInsert.length > 0) {
        const insertedAt = Date.now()
        const newToolCallMessages: ChatMessage[] = []
        const newMessages = toInsert.map((item, insertIndex): ChatMessage => {
          // Preserve the sorted order even when several events arrive in one React
          // batch and therefore share the same wall-clock millisecond.
          const timelineTimestamp = insertedAt + insertIndex
          if (item.kind === 'tool') {
            const { key, tc } = item
            const msg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'tool-call',
              content: tc.result,
              timestamp: timelineTimestamp,
              toolCallId: tc.id,
              toolName: tc.toolName,
              serverName: tc.serverName,
              toolArgs: tc.args,
              toolResult: tc.result,
              toolSuccess: tc.success,
              toolInProgress: tc.inProgress === true,
              ...(tc.resultImages?.length ? { toolResultImages: tc.resultImages } : {}),
            }
            seenTools.set(key, msg.id)
            newToolCallMessages.push(msg)
            return msg
          }
          const msg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: item.content,
            timestamp: timelineTimestamp,
            isFrozenMidTurn: true,
            textSegments: new Map([[item.blockId, {
              blockId: item.blockId,
              content: item.content,
              done: true,
              firstSeenAt: timelineTimestamp,
            }]]),
          }
          seenText.add(item.blockId)
          return msg
        })
        liveToolCallsRef.current = [...liveToolCallsRef.current, ...newToolCallMessages]
        next = [...next, ...newMessages]
      }
      return next
    })
  }, [liveTurnState.conversationId, liveTurnState.toolCalls, liveTurnState.textBlocks, flush])

  // Reacts to a turn reaching a terminal state (completed/failed) for the active
  // conversation — the single place that now handles stream-end bookkeeping, regen
  // rollback, and error-message insertion, replacing the old per-channel handlers.
  useEffect(() => {
    if (liveTurnState.status !== 'completed' && liveTurnState.status !== 'failed') return
    if (!liveTurnState.turnId) return
    if (handledTurnRef.current === liveTurnState.turnId) return
    handledTurnRef.current = liveTurnState.turnId

    const wasBackground = ignoreRemoteStreamRef.current
    ignoreRemoteStreamRef.current = false
    const doneConvId = liveTurnState.conversationId ?? activeConversationRef.current ?? ''
    streamingConversationRef.current = null
    markConversationDoneGenerating(doneConvId)
    void loadConversations()

    if (wasBackground) {
      streamingContentRef.current = ''
      streamModelRef.current = null
      liveToolCallsRef.current = []
      return
    }

    if (liveTurnState.status === 'failed') {
      const hadRegenRollback = preRegenMessagesRef.current !== null
      const error = liveTurnState.error
      if (preRegenMessagesRef.current) {
        setMessages(preRegenMessagesRef.current)
        preRegenMessagesRef.current = null
        pendingDeleteMessageRef.current = null
        if (error) addToastRef.current(error.message, 'error')
      } else if (error) {
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: error.message,
          timestamp: Date.now(),
          isError: true,
          errorType: error.type,
          retryable: error.retryable,
        }
        setMessages((prev) => [...prev, errorMessage])

        if (error.type === 'rate_limit') {
          const waitSeconds =
            typeof error.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0
              ? error.retryAfterSeconds
              : 15
          rateLimitSetterRef?.current(waitSeconds)
        }
      }

      flush()
      setStreamingContent('')
      streamingContentRef.current = ''
      streamModelRef.current = null
      setIsGenerating(false)
      setLoadingFailed(!hadRegenRollback)
      setGenerationStartedAt(null)
      return
    }

    // completed
    const hadToolCalls = liveTurnState.toolCalls.length > 0
    // All-but-the-tail segment has already been promoted into `messages` as its own
    // frozen fragment by the promotion effect above (as soon as each one closed) — this
    // optimistic message only needs to cover the tail, or it would repeat the earlier
    // segments' text a second time here. Not scoped down further with a `textSegments`
    // map of its own: this is a single (tail-only) segment, which needs none (mirrors the
    // same "single segment doesn't need one" rule persistAssistantMessage applies on the
    // DB side). The upcoming reloadMessages() DB refresh replaces this transient object
    // with the authoritative full-content version within the same tick regardless.
    const textBlockValues = Array.from(liveTurnState.textBlocks.values())
    const tailBlock = textBlockValues.length > 0
      ? textBlockValues.reduce((latest, b) => (b.firstSeenSequence ?? 0) >= (latest.firstSeenSequence ?? 0) ? b : latest)
      : null
    const finalContent = tailBlock ? tailBlock.content : liveTurnState.text
    const displayContent = finalContent || (!hadToolCalls ? '_(no response)_' : '')
    const frozenThinking = liveTurnState.thinkingBlocks.size > 0
      ? new Map(liveTurnState.thinkingBlocks)
      : null

    // Defer committing the finished message (and freezing thinking blocks) until the
    // reveal animation actually finishes draining, so the settled appearance never pops
    // in ahead of the in-progress animation.
    pendingFinalizeRef.current = {
      assistantMessage: displayContent
        ? {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: displayContent,
            timestamp: Date.now(),
            model: liveTurnState.model,
            ...(frozenThinking ? { thinkingBlocks: frozenThinking } : {}),
          }
        : null,
      frozenThinking: !displayContent ? frozenThinking : null,
    }

    streamingContentRef.current = ''
    streamModelRef.current = null
    // Now that the new response arrived, delete the old assistant message from DB
    // (regen cleanup) before any reload — reloadMessages awaits this promise so a
    // re-fetch can never race ahead of the delete and briefly show both messages.
    if (pendingDeleteMessageRef.current) {
      pendingDeletePromiseRef.current = window.api.deleteMessage(pendingDeleteMessageRef.current.id).catch(() => {})
      pendingDeleteMessageRef.current = null
    }
    // Signal stream end — actual isGenerating=false deferred until drain queue empties
    // so the streaming cursor stays visible until all buffered chars are rendered.
    streamEndedRef.current = true
    // If the queue is already empty (no buffered content), the isDraining effect won't
    // fire because isDraining never changes — apply the finalize immediately.
    if (!isDrainingRef.current) {
      streamEndedRef.current = false
      applyPendingFinalize()
      setStreamingContent('')
      setIsGenerating(false)
      setLoadingFailed(false)
      setGenerationStartedAt(null)
      setLiveTeamActivity([])
      liveToolCallsRef.current = []
      reloadMessagesRef.current()
    }
    preRegenMessagesRef.current = null
  }, [
    liveTurnState.status,
    liveTurnState.turnId,
    liveTurnState.conversationId,
    liveTurnState.text,
    liveTurnState.thinkingBlocks,
    liveTurnState.toolCalls,
    liveTurnState.model,
    liveTurnState.error,
    rateLimitSetterRef,
    markConversationDoneGenerating,
    loadConversations,
    applyPendingFinalize,
    flush,
  ])

  useEffect(() => {
    const unsubscribe = window.api.onTeamActivity((step) => {
      setLiveTeamActivity((prev) => {
        const existing = prev.findIndex((entry) => entry.stepId === step.stepId)
        if (existing >= 0) {
          const next = [...prev]
          // Preserve accumulated liveContent when the step transitions to done/error
          next[existing] = { ...step, liveContent: prev[existing].liveContent }
          return next
        }
        return [...prev, step]
      })
    })

    const unsubscribeStream = window.api.onTeamStepStream(({ stepId, chunk }) => {
      setLiveTeamActivity((prev) => {
        const idx = prev.findIndex((entry) => entry.stepId === stepId)
        if (idx < 0) return prev
        const next = [...prev]
        next[idx] = { ...next[idx], liveContent: (next[idx].liveContent ?? '') + chunk }
        return next
      })
    })

    return () => {
      unsubscribe()
      unsubscribeStream()
    }
  }, [])

  const handleRegenerate = useCallback(
    async (modelOverride?: string) => {
      if (!conversationId || messages.length < 2 || isGenerating) return

      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role !== 'assistant') return

      const lastUser = [...messages].reverse().find((message) => message.role === 'user')
      if (!lastUser) return

      // Save the current conversation state so it can be restored if the API
      // call fails, and defer the DB deletion until the new response arrives.
      preRegenMessagesRef.current = [...messages]
      pendingDeleteMessageRef.current = lastMessage

      setMessages((prev) => prev.slice(0, -1))

      streamingConversationRef.current = conversationId
      markConversationGenerating(conversationId)
      setIsGenerating(true)
      setGenerationStartedAt(Date.now())
      resetQueue()
      setStreamingContent('')
      streamingContentRef.current = ''

      const regenerateModel =
        modelOverride ?? (effectiveModel === 'default' ? null : effectiveModel)
      streamModelRef.current = regenerateModel

      try {
        if (modelOverride) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'system',
              content: `Regenerating with ${getModelLabel(modelOverride, catalogModels)}.`,
              timestamp: Date.now(),
            },
          ])
        }

        const options: {
          regenerate: true
          model?: string
          images?: { id: string; name: string; dataUrl: string }[]
          attachments?: { id: string; name: string; path: string; size: number }[]
        } = { regenerate: true }

        if (regenerateModel) options.model = String(regenerateModel)
        if (lastUser.images?.length) options.images = lastUser.images
        const fileAttachments = lastUser.attachments?.filter(
          (attachment): attachment is { id: string; name: string; path: string; size: number } =>
            typeof attachment.path === 'string' && attachment.path.length > 0,
        )
        if (fileAttachments?.length) options.attachments = fileAttachments

        const regenResult = await window.api.sendMessage(String(conversationId), String(lastUser.content), options) as unknown
        if (isApiError(regenResult)) throw new Error(regenResult.error)
      } catch (error) {
        console.error('Regenerate failed:', error)
        streamingConversationRef.current = null
        markConversationDoneGenerating(conversationId)
        // Restore the original conversation state on a synchronous IPC failure.
        if (preRegenMessagesRef.current) {
          setMessages(preRegenMessagesRef.current)
          preRegenMessagesRef.current = null
          pendingDeleteMessageRef.current = null
        }
        setIsGenerating(false)
        setGenerationStartedAt(null)
        streamModelRef.current = null
        addToast('Failed to regenerate response', 'error')
      }
    },
    [conversationId, messages, isGenerating, effectiveModel, catalogModels, addToast, markConversationGenerating, markConversationDoneGenerating],
  )

  const handleEdit = useCallback(
    (messageIndex: number) => {
      if (isGenerating) return

      const message = messages[messageIndex]
      if (!message) return

      preEditMessagesRef.current = [...messages]
      editCutoffTimestampRef.current = message.timestamp
      pendingEditedResendRef.current = true
      setIsEditingMessage(true)
      setMessages((prev) => prev.slice(0, messageIndex))
    },
    [messages, isGenerating],
  )

  const cancelEdit = useCallback(() => {
    if (!isEditingMessage) return
    if (preEditMessagesRef.current) {
      setMessages(preEditMessagesRef.current)
    }
    preEditMessagesRef.current = null
    editCutoffTimestampRef.current = null
    pendingEditedResendRef.current = false
    setIsEditingMessage(false)
  }, [isEditingMessage])

  const clearEditState = useCallback(() => {
    preEditMessagesRef.current = null
    editCutoffTimestampRef.current = null
    pendingEditedResendRef.current = false
    setIsEditingMessage(false)
  }, [])

  const clearStoppedGeneration = useCallback(() => {
    stopGenerationEpochRef.current += 1
    streamEndedRef.current = false
    pendingFinalizeRef.current = null
    resetQueue()
    streamingConversationRef.current = null
    streamingContentRef.current = ''
    streamModelRef.current = null
    setStreamingContent('')
    setIsGenerating(false)
    setGenerationStartedAt(null)
    setLiveTeamActivity([])
    liveToolCallsRef.current = []
  }, [resetQueue])

  return {
    messages,
    liveTurnState,
    setMessages,
    isGenerating,
    setIsGenerating,
    streamingContent,
    displayedContent,
    isDraining,
    resetQueue,
    setStreamingContent,
    loadingFailed,
    setLoadingFailed,
    isLoadingMessages,
    liveTeamActivity,
    setLiveTeamActivity,
    generationStartedAt,
    setGenerationStartedAt,
    isEditingMessage,
    streamingContentRef,
    streamModelRef,
    activeConversationRef,
    streamingConversationRef,
    justCreatedConversationRef,
    lastUndoneUserMessageRef,
    pendingEditedResendRef,
    editCutoffTimestampRef,
    cancelEdit,
    clearEditState,
    clearStoppedGeneration,
    handleRegenerate,
    handleEdit,
    pushSystemMessage,
    attachArtifact,
    buildConversationMarkdown,
  }
}
