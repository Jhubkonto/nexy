import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'
import type { BackgroundActivity, BackgroundActivityKind, BuildNotification, SectionBadgeKey } from '../store/types'

interface BackgroundActivityStoreApi {
  upsertBackgroundActivity?: (activity: {
    id: string
    kind: BackgroundActivityKind
    label: string
    projectId?: string
  }) => void
  removeBackgroundActivity?: (id: string) => void
  applyActivitySnapshot?: (snapshot: BackgroundActivity[]) => void
  incrementSectionNewCount?: (key: SectionBadgeKey) => void
  addBuildNotification?: (notification: BuildNotification) => void
}

const activityLabels: Record<BackgroundActivityKind, string> = {
  'project-generator': 'Generating project…',
  'agent-generator': 'Generating agent…',
  'skill-generator': 'Generating skill…',
  'scheduler-generator': 'Generating scheduled task…',
  'automated-workflow-generator': 'Generating workflow…',
  'automated-workflow-run': 'Running workflow step…',
  'debrief-generation': 'Generating debrief…',
  'quiz-generation': 'Generating quiz…',
  'teachback-generation': 'Generating teach-back…',
  chat: 'Assistant is responding…',
  build: 'Building…',
  orchestration: 'Delegating to agent…',
  'work-history': 'Generating work history report…',
}

function startActivity(kind: BackgroundActivityKind, projectId?: string) {
  const id = kind === 'automated-workflow-generator' && projectId
    ? `${kind}:${projectId}`
    : kind
  const state = (useAppStore as unknown as { getState?: () => BackgroundActivityStoreApi }).getState?.()
  state?.upsertBackgroundActivity?.({
    id,
    kind,
    label: activityLabels[kind],
    projectId,
  })
}

function stopActivity(kind: BackgroundActivityKind, projectId?: string) {
  const id = kind === 'automated-workflow-generator' && projectId
    ? `${kind}:${projectId}`
    : kind
  const state = (useAppStore as unknown as { getState?: () => BackgroundActivityStoreApi }).getState?.()
  state?.removeBackgroundActivity?.(id)
}

// projectId is nullable — a project-less (standalone) workflow generation still needs an
// activity entry, keyed to match the main process's own id for this case exactly
// (`automated-workflow-generator:${projectId ?? 'global'}`, see automated-workflow-generator.ts)
// so the locally-optimistic entry created here reconciles cleanly against the server snapshot
// instead of momentarily showing as two separate entries.
export function trackAutomatedWorkflowGeneration(projectId: string | null) {
  startActivity('automated-workflow-generator', projectId ?? 'global')
}

export function clearAutomatedWorkflowGeneration(projectId: string | null) {
  stopActivity('automated-workflow-generator', projectId ?? 'global')
}

export function BackgroundActivityBridges() {
  // Cross-device activity feed — hydrates from the main process on mount, then stays live via
  // push. Server-authoritative for every kind it tracks (see src/main/activity-tracker.ts);
  // reconciled against local-optimistic entries in applyActivitySnapshot.
  useEffect(() => {
    const state = (useAppStore as unknown as { getState?: () => BackgroundActivityStoreApi }).getState?.()
    window.api.getActivityList().then((snapshot) => {
      state?.applyActivitySnapshot?.(snapshot)
    }).catch(() => {})
    const off = window.api.onActivityChanged((snapshot) => {
      state?.applyActivitySnapshot?.(snapshot)
    })
    return off
  }, [])

  useEffect(() => {
    const offSkillLibraryUpdated = window.api.onSkillLibraryUpdated(() => {
      void useAppStore.getState().loadSkills()
    })
    const offProjectToken = window.api.onProjectGeneratorToken(() => {
      startActivity('project-generator')
    })
    const offProjectDone = window.api.onProjectGeneratorDone(({ hasSpec }) => {
      stopActivity('project-generator')
      if (hasSpec) useAppStore.getState().incrementSectionNewCount('projects')
    })
    const offProjectError = window.api.onProjectGeneratorError?.(() => {
      stopActivity('project-generator')
    }) ?? (() => {})

    const offAgentToken = window.api.onAgentGeneratorToken(() => {
      startActivity('agent-generator')
    })
    const offAgentDone = window.api.onAgentGeneratorDone(({ hasSpec }) => {
      stopActivity('agent-generator')
      if (hasSpec) useAppStore.getState().incrementSectionNewCount('agents')
    })
    const offAgentError = window.api.onAgentGeneratorError?.(() => {
      stopActivity('agent-generator')
    }) ?? (() => {})

    const offSkillToken = window.api.onSkillGeneratorToken(() => {
      startActivity('skill-generator')
    })
    const offSkillDone = window.api.onSkillGeneratorDone(({ hasSpec }) => {
      stopActivity('skill-generator')
      if (hasSpec) useAppStore.getState().incrementSectionNewCount('skills')
    })
    const offSkillError = window.api.onSkillGeneratorError?.(() => {
      stopActivity('skill-generator')
    }) ?? (() => {})

    const offScheduleToken = window.api.onScheduleGeneratorToken(() => {
      startActivity('scheduler-generator')
    })
    const offScheduleDone = window.api.onScheduleGeneratorDone(({ hasSpec }) => {
      stopActivity('scheduler-generator')
      if (hasSpec) useAppStore.getState().incrementSectionNewCount('scheduled')
    })
    const offScheduleError = window.api.onScheduleGeneratorError?.(() => {
      stopActivity('scheduler-generator')
    }) ?? (() => {})

    const offWorkflowDone = window.api.onAutomatedWorkflowGeneratorDone(({ hasSpec }) => {
      if (hasSpec) useAppStore.getState().incrementSectionNewCount('workflows')
    })

    const offBuildDone = window.api.onBuildCommandDone(({ status }) => {
      if (status === 'running') return
      useAppStore.getState().addBuildNotification({
        id: crypto.randomUUID(),
        label: `Desktop build ${status}`,
        status,
        platform: 'desktop',
        timestamp: Date.now(),
      })
    })

    const offAndroidDone = window.api.onAndroidCommandDone(({ status }) => {
      if (status === 'running') return
      useAppStore.getState().addBuildNotification({
        id: crypto.randomUUID(),
        label: `Android build ${status}`,
        status,
        platform: 'android',
        timestamp: Date.now(),
      })
    })

    return () => {
      offSkillLibraryUpdated()
      offProjectToken()
      offProjectDone()
      offProjectError()
      offWorkflowDone()
      offBuildDone()
      offAndroidDone()
      offAgentToken()
      offAgentDone()
      offAgentError()
      offSkillToken()
      offSkillDone()
      offSkillError()
      offScheduleToken()
      offScheduleDone()
      offScheduleError()
    }
  }, [])

  return null
}
