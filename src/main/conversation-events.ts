import { BrowserWindow } from 'electron'
import { broadcastToMobile } from './ws-server'

export function broadcastConversationRenamed(id: string, title: string, updatedAt = Date.now()): void {
  const data = { id, title, updatedAt }
  broadcastToMobile({ event: 'conversation:renamed', data })
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('conversation:renamed', data)
  })
}
