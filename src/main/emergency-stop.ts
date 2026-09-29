import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { abortActiveStream } from './provider-stream-state'
import { clearAllActiveChatTurns } from './active-chat-turns'
import { denyAllPendingApprovals } from './tools'
import { broadcastToMobile } from './ws-server'
import { safeHandle } from './safe-handle'
import { abortAllHttpsRequests } from './http-client'
import { cancelAllPendingUserInputs } from './user-input'
import { HermesAcpAdapterInstance } from './cli-adapters/hermes-acp'

export interface EmergencyStopStatus {
  active: boolean
  activatedAt: number | null
}

const SETTING_KEY = 'emergency_stop'
let status: EmergencyStopStatus | null = null

function readStatus(): EmergencyStopStatus {
  if (status) return status
  try {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as { value: string } | undefined
    const parsed = row?.value ? JSON.parse(row.value) as Partial<EmergencyStopStatus> : null
    status = { active: parsed?.active === true, activatedAt: typeof parsed?.activatedAt === 'number' ? parsed.activatedAt : null }
  } catch {
    status = { active: false, activatedAt: null }
  }
  return status
}

function publishStatus(): EmergencyStopStatus {
  const current = readStatus()
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('chat:emergency-stop-changed', current)
  })
  broadcastToMobile({ event: 'chat:emergency-stop-changed', data: current })
  return current
}

function persistStatus(next: EmergencyStopStatus): void {
  status = next
  getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING_KEY, JSON.stringify(next))
}

export function getEmergencyStopStatus(): EmergencyStopStatus {
  return { ...readStatus() }
}

export function assertConversationStartsAllowed(): void {
  if (readStatus().active) throw new Error('Emergency stop is active. Resume conversations before sending a message.')
}

export function activateEmergencyStop(): EmergencyStopStatus {
  persistStatus({ active: true, activatedAt: Date.now() })
  abortActiveStream()
  abortAllHttpsRequests()
  clearAllActiveChatTurns()
  denyAllPendingApprovals()
  cancelAllPendingUserInputs('Emergency stop activated')
  // Emergency stop is a hard execution boundary. Closing the ACP process prevents an in-flight
  // Hermes tool from surviving the UI stop action and ensures the next turn starts clean.
  HermesAcpAdapterInstance.closeAll()
  return publishStatus()
}

export function resumeConversations(): EmergencyStopStatus {
  persistStatus({ active: false, activatedAt: null })
  return publishStatus()
}

export function registerEmergencyStopHandlers(): void {
  safeHandle('chat:get-emergency-stop', () => getEmergencyStopStatus())
  safeHandle('chat:activate-emergency-stop', () => activateEmergencyStop())
  safeHandle('chat:resume-conversations', () => resumeConversations())
}

export function resetEmergencyStopForTest(): void {
  status = null
}
