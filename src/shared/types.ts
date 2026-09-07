export interface Card {
  id: string
  title: string
  cwd: string
  note: string
  /**
   * session 內實際工作的 git worktree 根目錄（絕對路徑）。
   * 由 main 端掃描 pty 子孫程序的 cwd 偵測而得，不是使用者填的；
   * 有值時卡片顯示這個目錄名而非 cwd 的 branch。null 代表已清除（目錄被移除或 cwd 改了）
   */
  worktree?: string | null
  createdAt: string
  updatedAt: string
}

export interface Column {
  id: string
  title: string
  color: string
  cardIds: string[]
}

export interface Board {
  version: 1
  columns: Column[]
  cards: Record<string, Card>
}

/** running：2 秒內有 output；idle：pty 存活但無 output；stopped：pty 不存在或已結束 */
export type PtyStatus = 'running' | 'idle' | 'stopped'

/** 新增欄位時依序循環取色 */
export const COLUMN_COLORS = [
  '#58a6ff',
  '#3fb950',
  '#bc8cff',
  '#d29922',
  '#f778ba',
  '#39c5cf',
] as const

export interface BoardLoadResult {
  board: Board
  /** 非 null 代表原檔損毀已被備份，值為備份檔路徑，供 UI 提示使用 */
  recoveredFrom: string | null
  /** true 代表讀檔失敗、目前為唯讀模式，任何變更都不會存檔 */
  readOnly: boolean
}

/** preload 經 contextBridge 暴露到 window.gc 的完整介面 */
export interface GcApi {
  board: {
    load(): Promise<BoardLoadResult>
    /** writeFailed 為 true 代表這次寫入失敗（磁碟滿、權限變更等），供 UI 提示使用 */
    save(board: Board): Promise<{ writeFailed: boolean }>
  }
  pty: {
    /** 在 cwd 開 login shell 並自動執行 claude */
    spawn(cardId: string, cwd: string, cols: number, rows: number): Promise<void>
    /** main 端目前記得的 worktree；renderer 載入看板後呼叫，補回載入前推播過的值 */
    knownWorktrees(): Promise<Array<{ cardId: string; worktree: string }>>
    write(cardId: string, data: string): void
    resize(cardId: string, cols: number, rows: number): void
    kill(cardId: string): void
  }
  onPtyData(cb: (cardId: string, data: string) => void): () => void
  onPtyExit(cb: (cardId: string, exitCode: number) => void): () => void
  /** main 端偵測到卡片的 session 在某個 worktree 裡工作時推播（只在值變動時）；worktree 目錄被移除時帶 null */
  onPtyWorktree(cb: (cardId: string, worktree: string | null) => void): () => void
  /** 看板寫入失敗時即時推播，不必等下一次 board:save 的回應才知道 */
  onBoardWriteError(cb: (message: string) => void): () => void
  git: {
    branch(cwd: string): Promise<string | null>
  }
  dialog: {
    pickDirectory(): Promise<string | null>
  }
  /** 家目錄路徑，用於把卡片的 cwd 縮寫成 ~ */
  homeDir(): string
}
