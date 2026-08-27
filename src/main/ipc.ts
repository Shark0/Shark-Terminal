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
  ipcMain.handle('board:load', () => store.load())
  ipcMain.handle('board:save', (_event, board: Board) => {
    store.save(board)
  })

  ipcMain.handle(
    'pty:spawn',
    (_event, cardId: string, cwd: string, command: string, cols: number, rows: number) => {
      ptyManager.spawn(cardId, cwd, command, cols, rows)
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

  ipcMain.handle('git:branch', (_event, cwd: string) => readBranch(cwd))

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = getWindow()
    const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // pty 的輸出與結束事件推給 renderer
  ptyManager.onData((cardId, data) => {
    getWindow()?.webContents.send('pty:data', cardId, data)
  })
  ptyManager.onExit((cardId, exitCode) => {
    getWindow()?.webContents.send('pty:exit', cardId, exitCode)
  })
}
