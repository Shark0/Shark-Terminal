import { homedir } from 'node:os'
import { contextBridge, ipcRenderer } from 'electron'
import type { Board, BoardLoadResult, GcApi } from '@shared/types'

const api: GcApi = {
  board: {
    load: () => ipcRenderer.invoke('board:load') as Promise<BoardLoadResult>,
    save: (board) =>
      ipcRenderer.invoke('board:save', board) as Promise<{ writeFailed: boolean }>,
  },
  pty: {
    spawn: (cardId, cwd, command, cols, rows) =>
      ipcRenderer.invoke('pty:spawn', cardId, cwd, command, cols, rows) as Promise<void>,
    write: (cardId, data) => ipcRenderer.send('pty:write', cardId, data),
    resize: (cardId, cols, rows) => ipcRenderer.send('pty:resize', cardId, cols, rows),
    kill: (cardId) => ipcRenderer.send('pty:kill', cardId),
  },
  onPtyData: (cb) => {
    const listener = (_event: unknown, cardId: string, data: string): void => cb(cardId, data)
    ipcRenderer.on('pty:data', listener)
    return () => {
      ipcRenderer.off('pty:data', listener)
    }
  },
  onPtyExit: (cb) => {
    const listener = (_event: unknown, cardId: string, exitCode: number): void =>
      cb(cardId, exitCode)
    ipcRenderer.on('pty:exit', listener)
    return () => {
      ipcRenderer.off('pty:exit', listener)
    }
  },
  onBoardWriteError: (cb) => {
    const listener = (_event: unknown, message: string): void => cb(message)
    ipcRenderer.on('board:write-error', listener)
    return () => {
      ipcRenderer.off('board:write-error', listener)
    }
  },
  git: {
    branch: (cwd) => ipcRenderer.invoke('git:branch', cwd) as Promise<string | null>,
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory') as Promise<string | null>,
  },
  // renderer 在 contextIsolation 下沒有 process 物件，家目錄只能由 preload 帶過去
  homeDir: () => homedir(),
}

contextBridge.exposeInMainWorld('gc', api)
