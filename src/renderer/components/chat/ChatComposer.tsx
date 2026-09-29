import { useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react'
import { Loader2, UnfoldVertical } from 'lucide-react'
import { ContextInspector } from '../ContextInspector'
import { AttachmentBar } from './AttachmentBar'
import { AtContextMenu } from './AtContextMenu'
import { SlashCommandMenu } from './SlashCommandMenu'
import { ModelPicker } from './ModelPicker'
import { CliLockedModelBadge } from './CliLockedModelBadge'
import { ChatModePicker } from './ChatModePicker'
import { NexyIcon } from '../ui/icons/NexyIcon'
import type { AgentConfig, AvailableModelEntry, AvailableModelGroup, CliBackend, CliModeOverride, CodexExecutionModeOverride, HermesProfileInfo, SkillConfig } from '../../../shared/types'
import type { AtContextOption, ChatMessage, ContextRef, LocalAttachment, PastedImage } from '../../hooks/chat-types'
import type { SlashCommandDef } from '../../slash-commands'
import { useAppStore } from '../../store/app-store'
import { ResizableChatInput } from './ResizableChatInput'
import { ComposerActionsMenu } from './ComposerActionsMenu'
import { useEmergencyStop } from '../../hooks/useEmergencyStop'
import { CapabilityPopover } from '../CapabilityPopover'


interface ChatComposerProps {
  input: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  messages: ChatMessage[]
  activeAgent: AgentConfig | null
  authenticated: boolean
  isOnline: boolean
  isGenerating: boolean
  /** A slash command (e.g. /code-execute) is running an await that can take a while — unlike
   * isGenerating this has no in-flight stream to cancel, so it disables sending without
   * swapping to the Stop-generation button. */
  isRunningCommand?: boolean
  rateLimitRemainingSec: number
  conversationId: string | null
  effectiveModel: string
  capabilitySkills: SkillConfig[]
  capabilityProjectId?: string | null
  capabilityProjectName?: string | null
  capabilityAgentId?: string | null
  capabilityAgentName?: string | null
  onEnsureConversationForCapability?: () => Promise<string | null>
  onOpenMcp?: () => void
  onOpenSkills?: () => void
  onOpenProjectCapabilities?: () => void
  modelSourceLabel?: string
  pendingAttachments: LocalAttachment[]
  pendingImages: PastedImage[]
  showContextInspector: boolean
  contextRefs: ContextRef[]
  showSlashMenu: boolean
  slashFilter: string
  selectedSlashIndex: number
  slashCommands: SlashCommandDef[]
  showAtMenu: boolean
  atFilter: string
  selectedAtIndex: number
  atOptions: AtContextOption[]
  modelPickerRef: RefObject<HTMLButtonElement | null>
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void | Promise<void>
  onAttachFiles: () => void | Promise<void>
  onAttachFolder: () => void | Promise<void>
  onPasteClipboardImage?: () => void | Promise<void>
  onOpenPromptLibrary?: () => void
  onAttachArtifact?: () => void
  voiceState: 'idle' | 'recording' | 'transcribing'
  onToggleVoice: () => void
  onCancelVoice: () => void
  voiceDocked?: boolean
  onFloatVoice?: () => void
  onToggleContextInspector: () => void
  onCloseContextInspector: () => void
  onRemoveAttachment: (id: string) => void
  onRemoveImage: (id: string) => void
  onToggleImageMode?: (id: string) => void
  onRemoveContextToken: (token: string) => void
  onSelectSlashCommand: (command: SlashCommandDef) => void
  onSelectAtOption: (option: AtContextOption) => void
  onCloseSlashMenu: () => void
  onCloseAtMenu: () => void
  onSetConversationModel: (model: string) => void | Promise<void>
  onSetPendingModel: (model: string | null) => void
  availableGroups: AvailableModelGroup[]
  onSelectAvailableModel: (group: AvailableModelGroup, model: AvailableModelEntry) => void
  showHermesProfile?: boolean
  hermesProfile?: string | null
  hermesProfiles?: HermesProfileInfo[]
  onSetHermesProfile?: (profile: string) => void
  isEditingMessage: boolean
  onCancelEdit: () => void
  onStop: () => void | Promise<void>
  onSend: () => void | Promise<void>
  cliLockedModels?: AvailableModelEntry[]
  onSelectCliModel?: (modelId: string) => void
  lockModelToAgentBackend?: boolean
  conversationThinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  conversationFullAutoApproveOverride?: boolean | null
  conversationAgenticModeOverride?: boolean | null
  conversationTerminalSandboxOverride?: boolean | null
  activeCliBackend?: CliBackend | null
  conversationCliModeOverride?: CliModeOverride | null
  conversationCodexExecutionModeOverride?: CodexExecutionModeOverride | null
  onSetConversationMode?: (mode: {
    thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
    fullAutoApproveOverride?: boolean | null
    agenticModeOverride?: boolean | null
    terminalSandboxOverride?: boolean | null
    cliModeOverride?: CliModeOverride | null
    codexExecutionModeOverride?: CodexExecutionModeOverride | null
  }) => void
}

export function ChatComposer({
  input,
  inputRef,
  messages,
  activeAgent,
  authenticated,
  isOnline,
  isGenerating,
  isRunningCommand = false,
  rateLimitRemainingSec,
  conversationId,
  effectiveModel,
  capabilitySkills,
  capabilityProjectId,
  capabilityProjectName,
  capabilityAgentId,
  capabilityAgentName,
  onEnsureConversationForCapability,
  onOpenMcp,
  onOpenSkills,
  onOpenProjectCapabilities,
  modelSourceLabel,
  pendingAttachments,
  pendingImages,
  showContextInspector,
  contextRefs,
  showSlashMenu,
  slashFilter,
  selectedSlashIndex,
  slashCommands,
  showAtMenu,
  atFilter,
  selectedAtIndex,
  atOptions,
  modelPickerRef,
  onInputChange,
  onKeyDown,
  onPaste,
  onAttachFiles,
  onAttachFolder,
  onPasteClipboardImage,
  onOpenPromptLibrary,
  onAttachArtifact,
  voiceState,
  onToggleVoice,
  onCancelVoice,
  voiceDocked = true,
  onFloatVoice,
  onToggleContextInspector,
  onCloseContextInspector,
  onRemoveAttachment,
  onRemoveImage,
  onToggleImageMode,
  onRemoveContextToken,
  onSelectSlashCommand,
  onSelectAtOption,
  onCloseSlashMenu,
  onCloseAtMenu,
  onSetConversationModel,
  onSetPendingModel,
  availableGroups,
  onSelectAvailableModel,
  showHermesProfile = false,
  hermesProfile = null,
  hermesProfiles = [],
  onSetHermesProfile,
  isEditingMessage,
  onCancelEdit,
  onStop,
  onSend,
  cliLockedModels,
  onSelectCliModel,
  lockModelToAgentBackend = false,
  conversationThinkingEffortOverride = null,
  conversationFullAutoApproveOverride = null,
  conversationAgenticModeOverride = null,
  conversationTerminalSandboxOverride = null,
  activeCliBackend = null,
  conversationCliModeOverride = null,
  conversationCodexExecutionModeOverride = null,
  onSetConversationMode,
}: ChatComposerProps) {
  const emergencyStop = useEmergencyStop()
  const [showModePicker, setShowModePicker] = useState(false)
  const catalogModels = useAppStore((state) => state.catalogModels)
  const globalDefaultModel = useAppStore((state) => state.globalDefaultModel)
  const agentBackend = activeAgent?.backend
  const isCliLocked = lockModelToAgentBackend && (agentBackend === 'claude-cli' || agentBackend === 'codex-cli' || agentBackend === 'hermes-cli')

  return (
    <div className="border-t-2 border-nexy-border bg-nexy-surface relative">
      <div className="px-4 pb-4 pt-3">
        <div className="max-w-3xl mx-auto">
          <AttachmentBar
            attachments={pendingAttachments}
            images={pendingImages}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveImage={onRemoveImage}
            onToggleImageMode={onToggleImageMode}
          />

          {showContextInspector && (
            <ContextInspector
              systemPrompt={activeAgent?.systemPrompt ?? ''}
              contextRefs={contextRefs}
              attachments={pendingAttachments}
              images={pendingImages}
              historyMessages={messages.filter((message) => message.role !== 'system')}
              currentInput={input}
              model={effectiveModel}
              conversationId={conversationId}
              onClose={onCloseContextInspector}
            />
          )}

          {contextRefs.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {contextRefs.map((ref, index) => (
                <span
                  key={`${ref.token}-${index}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-nexy-sm border border-nexy-border bg-nexy-recessed text-xs text-nexy-text shadow-nexy"
                >
                  {ref.token}
                  <button
                    type="button"
                    onClick={() => onRemoveContextToken(ref.token)}
                    className="text-nexy-muted hover:text-nexy-text ml-0.5"
                    aria-label={`Remove ${ref.token}`}
                  >
                    <NexyIcon name="close" className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <SlashCommandMenu
            show={showSlashMenu}
            filter={slashFilter}
            selectedIndex={selectedSlashIndex}
            commands={slashCommands}
            onSelect={onSelectSlashCommand}
            onClose={onCloseSlashMenu}
          />

          <AtContextMenu
            show={showAtMenu}
            filter={atFilter}
            selectedIndex={selectedAtIndex}
            options={atOptions}
            onSelect={onSelectAtOption}
            onClose={onCloseAtMenu}
          />

          <ResizableChatInput
            inputRef={inputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={
              emergencyStop.active
                ? 'Emergency stop active — resume conversations from the sidebar'
                : !authenticated
                ? 'Sign in to start chatting'
                : isOnline
                  ? 'Type a message... (paste images with Ctrl+V)'
                  : 'Offline — reconnect to send messages'
            }
            disabled={emergencyStop.active || !isOnline || !authenticated || rateLimitRemainingSec > 0}
            aria-label="Message input"
            aria-expanded={showSlashMenu || showAtMenu || undefined}
            aria-controls={showSlashMenu ? 'slash-command-menu' : showAtMenu ? 'at-context-menu' : undefined}
            aria-activedescendant={
              showSlashMenu ? `slash-opt-${selectedSlashIndex}` :
              showAtMenu ? `at-opt-${selectedAtIndex}` :
              undefined
            }
            leftActions={
              <ComposerActionsMenu
                disabled={isGenerating}
                showContextInspector={showContextInspector}
                onAttachFiles={onAttachFiles}
                onAttachFolder={onAttachFolder}
                onPasteClipboardImage={onPasteClipboardImage}
                onOpenPromptLibrary={onOpenPromptLibrary}
                onAttachArtifact={onAttachArtifact}
                onToggleContextInspector={onToggleContextInspector}
              />
            }
            rightActions={
              <>
              {isEditingMessage && (
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="px-2 py-1 text-xs rounded-nexy-sm border border-nexy-border bg-nexy-recessed text-nexy-muted hover:bg-nexy-raised hover:text-nexy-text transition-colors"
                >
                  Cancel edit
                </button>
              )}
              <CapabilityPopover
                conversationId={conversationId}
                modelId={effectiveModel}
                skills={capabilitySkills}
                projectId={capabilityProjectId}
                projectName={capabilityProjectName}
                agentId={capabilityAgentId}
                agentName={capabilityAgentName}
                onEnsureConversation={onEnsureConversationForCapability}
                onOpenMcp={onOpenMcp}
                onOpenSkills={onOpenSkills}
                onOpenProjectCapabilities={onOpenProjectCapabilities}
              />
              <div className="relative flex items-center">
                {isCliLocked ? (
                  <CliLockedModelBadge
                    backend={agentBackend as 'claude-cli' | 'codex-cli' | 'hermes-cli'}
                    modelId={effectiveModel === 'default' ? null : effectiveModel}
                    models={cliLockedModels ?? []}
                    catalogModels={catalogModels}
                    onSelectModel={onSelectCliModel ?? (() => {})}
                  />
                ) : (
                  <ModelPicker
                    value={effectiveModel}
                    sourceLabel={modelSourceLabel}
                    availableGroups={availableGroups}
                    catalogModels={catalogModels}
                    globalDefaultModel={globalDefaultModel}
                    buttonRef={modelPickerRef}
                    onSelectDefault={() => {
                      if (conversationId) {
                        onSetPendingModel(null)
                        void onSetConversationModel('default')
                      } else {
                        onSetPendingModel(null)
                      }
                    }}
                    onSelectAvailableModel={onSelectAvailableModel}
                  />
                )}
                {showHermesProfile && !isCliLocked && (
                  <select
                    aria-label="Conversation Hermes profile"
                    value={hermesProfile ?? ''}
                    onChange={(event) => onSetHermesProfile?.(event.target.value)}
                    className="ml-1 max-w-[130px] rounded border border-nexy-border bg-nexy-recessed px-1 py-1 text-[10px] text-nexy-text"
                    title="Hermes profile for this model target"
                  >
                    <option value="">Hermes default</option>
                    {hermesProfiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
                  </select>
                )}
                {onSetConversationMode && (
                  <ChatModePicker
                    open={showModePicker}
                    onOpenChange={setShowModePicker}
                    thinkingEffortOverride={conversationThinkingEffortOverride}
                    fullAutoApproveOverride={conversationFullAutoApproveOverride}
                    agenticModeOverride={conversationAgenticModeOverride}
                    terminalSandboxOverride={conversationTerminalSandboxOverride}
                    activeCliBackend={activeCliBackend}
                    cliModeOverride={conversationCliModeOverride}
                    codexExecutionModeOverride={conversationCodexExecutionModeOverride}
                    onChange={onSetConversationMode}
                  />
                )}
              </div>
                {voiceDocked && voiceState === 'recording' && (
                  <button
                    type="button"
                    onClick={onCancelVoice}
                    className="p-1.5 rounded-nexy-sm border border-transparent text-nexy-muted transition-colors hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text"
                    title="Cancel recording"
                    aria-label="Cancel voice recording"
                  >
                    <NexyIcon name="close" className="w-4 h-4" />
                  </button>
                )}
                {voiceDocked && (
                  <>
                    <button
                      type="button"
                      onClick={onToggleVoice}
                      disabled={isGenerating || voiceState === 'transcribing'}
                      className={`p-1.5 rounded-nexy-sm border transition-colors disabled:opacity-50 ${voiceState === 'recording' ? 'border-nexy-error text-nexy-error bg-nexy-recessed' : 'border-transparent text-nexy-muted hover:border-nexy-border hover:text-nexy-text hover:bg-nexy-recessed'}`}
                      title={voiceState === 'recording' ? 'Stop recording' : voiceState === 'transcribing' ? 'Transcribing locally…' : 'Voice input'}
                      aria-label={voiceState === 'recording' ? 'Stop voice recording' : voiceState === 'transcribing' ? 'Transcribing voice input' : 'Start voice input'}
                      aria-pressed={voiceState === 'recording'}
                    >
                      {voiceState === 'transcribing'
                        ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        : <NexyIcon name="microphone" className="w-4 h-4" />}
                    </button>
                    {onFloatVoice && voiceState === 'idle' && (
                      <button
                        type="button"
                        onClick={onFloatVoice}
                        disabled={isGenerating}
                        className="p-1.5 rounded-nexy-sm border border-transparent text-nexy-muted hover:border-nexy-border hover:text-nexy-text hover:bg-nexy-recessed disabled:opacity-50"
                        title="Float microphone"
                        aria-label="Float microphone"
                      >
                        <UnfoldVertical className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
                {isGenerating ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="p-1.5 rounded-nexy-sm border-2 border-nexy-border bg-nexy-text text-nexy-surface hover:bg-nexy-muted transition-colors flex items-center justify-center shadow-nexy"
                    aria-label="Stop generating"
                  >
                    <NexyIcon name="stop" className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={
                      isRunningCommand ||
                      emergencyStop.active ||
                      ((!input.trim() && pendingImages.length === 0 && pendingAttachments.length === 0) ||
                        !isOnline ||
                        !authenticated ||
                        rateLimitRemainingSec > 0)
                    }
                    className={`p-1.5 rounded-nexy-sm border-2 flex items-center justify-center transition-colors ${
                      !isRunningCommand &&
                      !emergencyStop.active &&
                      (input.trim() || pendingImages.length > 0 || pendingAttachments.length > 0) &&
                      isOnline &&
                      authenticated &&
                      rateLimitRemainingSec === 0
                        ? 'border-nexy-border bg-nexy-accent text-nexy-on-accent hover:brightness-110 shadow-nexy'
                        : 'border-transparent bg-transparent text-nexy-muted cursor-not-allowed'
                    }`}
                    aria-label={emergencyStop.active ? 'Emergency stop active' : isRunningCommand ? 'Running command…' : 'Send message'}
                    title={emergencyStop.active ? 'Resume conversations from the sidebar to send' : isRunningCommand ? 'A command is still running…' : undefined}
                  >
                    <NexyIcon name={isRunningCommand ? 'busy' : 'send'} className="w-4 h-4" />
                  </button>
                )}
              </>
            }
          />
        </div>
      </div>
    </div>
  )
}
