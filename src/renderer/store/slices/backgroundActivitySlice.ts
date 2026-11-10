import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import type { BackgroundActivity } from '../types'

type BackgroundActivityInput =
  Omit<BackgroundActivity, 'startedAt'> &
  Partial<Pick<BackgroundActivity, 'startedAt'>>

export interface BackgroundActivitySlice {
  backgroundActivities: BackgroundActivity[]
  // Internal bookkeeping for applyActivitySnapshot's reconciliation — every activity id the
  // main-process server has EVER confirmed via a snapshot. See applyActivitySnapshot for why
  // this is required: without it, a completed activity gets resurrected forever.
  confirmedActivityIds: Record<string, true>
  upsertBackgroundActivity: (activity: BackgroundActivityInput) => void
  removeBackgroundActivity: (id: string) => void
  openBackgroundActivity: (activity: BackgroundActivity) => void
  /** Report the Work history pane should open next; the pane clears it once shown. */
  workHistoryOpenRunId: string | null
  setWorkHistoryOpenRunId: (runId: string | null) => void
  applyActivitySnapshot: (snapshot: BackgroundActivity[]) => void
}

export const createBackgroundActivitySlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  BackgroundActivitySlice
> = (set, get) => ({
  backgroundActivities: [],
  confirmedActivityIds: {},
  workHistoryOpenRunId: null,

  setWorkHistoryOpenRunId: (runId) => {
    set((s) => {
      s.workHistoryOpenRunId = runId
    })
  },

  upsertBackgroundActivity: (activity) => {
    set((s) => {
      const existing = s.backgroundActivities.find((item) => item.id === activity.id)
      const next: BackgroundActivity = {
        ...activity,
        startedAt: existing?.startedAt ?? activity.startedAt ?? Date.now(),
      }
      if (existing) {
        s.backgroundActivities = s.backgroundActivities.map((item) =>
          item.id === activity.id ? { ...item, ...next } : item
        )
      } else {
        s.backgroundActivities.push(next)
      }
    })
  },

  removeBackgroundActivity: (id) => {
    set((s) => {
      s.backgroundActivities = s.backgroundActivities.filter((item) => item.id !== id)
    })
  },

  // The server snapshot is authoritative for anything it knows about (so truly-ended activity
  // is removed even if this device never saw the end event locally), but preserves any locally
  // tracked entries not yet echoed back by the server (e.g. a generator turn started a moment
  // ago, before the next snapshot round-trip confirms it).
  //
  // Critically, "not in this snapshot" is ambiguous on its own: it's true both for a brand-new
  // local-optimistic entry the server hasn't echoed back YET, and for an entry the server
  // already confirmed in an EARLIER snapshot and has since ended. Naively preserving every
  // absent id resurrects every completed activity forever, since it'll never appear in a
  // later snapshot either — this is what caused the "Activity" sidebar badge to stay stuck
  // on 'Assistant is responding…' after every chat turn. confirmedActivityIds tracks which
  // ids the server has ever vouched for, so only genuinely-still-unconfirmed local entries
  // get the grace period; anything already confirmed is strictly governed by presence in the
  // latest snapshot from here on.
  applyActivitySnapshot: (snapshot) => {
    set((s) => {
      const knownIds = new Set(snapshot.map((item) => item.id))
      const localOnly = s.backgroundActivities.filter(
        (item) => !knownIds.has(item.id) && !s.confirmedActivityIds[item.id],
      )
      s.backgroundActivities = [...snapshot, ...localOnly]
      for (const item of snapshot) {
        s.confirmedActivityIds[item.id] = true
      }
    })
  },

  openBackgroundActivity: (activity) => {
    if (activity.kind === 'project-generator') {
      get().setShowProjectGenerator(true)
      return
    }
    if (activity.kind === 'agent-generator') {
      get().setShowAgentGenerator(true)
      return
    }
    if (activity.kind === 'skill-generator') {
      get().setShowSkillGenerator(true)
      return
    }
    if (activity.kind === 'scheduler-generator') {
      get().setShowSchedulerGenerator(true)
      return
    }
    if (activity.kind === 'automated-workflow-generator') {
      set((s) => {
        s.activeSectionPane = 'projects'
      })
      if (activity.projectId) {
        get().openEditProject(activity.projectId, 'workflow')
      }
      return
    }
    if (
      activity.kind === 'chat' ||
      activity.kind === 'debrief-generation' ||
      activity.kind === 'quiz-generation' ||
      activity.kind === 'orchestration' ||
      activity.kind === 'automated-workflow-run'
    ) {
      if (activity.conversationId) {
        get().selectConversation(activity.conversationId)
      }
      return
    }
    if (activity.kind === 'work-history') {
      set((s) => {
        s.activeSectionPane = 'work-history'
        s.workHistoryOpenRunId = activity.id.slice('work-history:'.length)
      })
      return
    }
    if (activity.kind === 'build') {
      const isAndroid = activity.id.startsWith('android-build:')
      get().setSettingsInitialTab(isAndroid ? 'developer:android' : 'developer:desktop')
      get().setShowSettings(true)
      return
    }
  },
})
