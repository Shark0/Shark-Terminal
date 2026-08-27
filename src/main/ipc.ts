import { type BrowserWindow, dialog, ipcMain } from 'electron'
import type { Board } from '@shared/types'
import type { BoardStore } from './board-store'
import type { PtyManager } from './pty-manager'
import { readBranch } from './git'

export function registerIpc(
  store: BoardStore,
  ptyManager: PtyManager,
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle('board:load', async () => {
    try {
      return await store.load()
    } catch (err) {
      console.error('[ipc] board:load 失敗', { err })
      throw err
    }
  })
  ipcMain.handle('board:save', (_event, board: Board) => {
    store.save(board)
  })

  ipcMain.handle(
    'pty:spawn',
    (_event, cardId: string, cwd: string, command: string, cols: number, rows: number) => {
      try {
        ptyManager.spawn(cardId, cwd, command, cols, rows)
      } catch (err) {
        console.error('[ipc] pty:spawn 失敗', { cardId, cwd, command, err })
        throw err
      }
    },
  )
  ipcMain.on('pty:write', (_event, cardId: string, data: string) => {
    ptyManager.write(cardId, data)
  })
  ipcMain.on('pty:resize', (_event, cardId: string, cols: number, rows: number) => {
    ptyManager.resize(cardId, cols, rows)
  })
  ipcMain.on('pty:kill', (_event, cardId: string) => {
    ptyManager.kill(cardId)
  })

  ipcMain.handle('git:branch', async (_event, cwd: string) => {
    try {
      return await readBranch(cwd)
    } catch (err) {
      console.error('[ipc] git:branch 失敗', { cwd, err })
      throw err
    }
  })

  ipcMain.handle('dialog:pickDirectory', async () => {
    try {
      const win = getWindow()
      const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch (err) {
      console.error('[ipc] dialog:pickDirectory 失敗', { err })
      throw err
    }
  })

  // pty 的輸出與結束事件推給 renderer
  ptyManager.onData((cardId, data) => {
    const win = getWindow()
    // webContents 會在 'closed' 事件之前就被銷毀，只檢查 null 擋不住這段時間差
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', cardId, data)
  })
  ptyManager.onExit((cardId, exitCode) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', cardId, exitCode)
  })
}
