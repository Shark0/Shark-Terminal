import { create } from 'zustand'
import type { Board, PtyStatus } from '@shared/types'
import { disposeTerminal, ensureTerminal } from '../terminal/terminal-registry'
import { newCard, newColumn, pickColumnColor } from '@shared/factory'
import {
  type CardPatch,
  type ColumnPatch,
  addCard,
  addColumn,
  deleteCard,
  deleteColumn,
  moveCard,
  moveColumn,
  updateCard,
  updateColumn,
} from './board-reducer'
import { clearActivity, computeStatus } from './pty-activity'

export interface CardInput {
  title: string
  cwd: string
  command: string
  note?: string
}

interface AppState {
  board: Board
  activeCardId: string | null
  loaded: boolean
  /** 非 null 代表看板檔曾損毀，值為備份檔路徑，供橫幅提示使用 */
  recoveryNotice: string | null
  /** true 代表看板讀檔失敗、目前為唯讀模式，任何變更都不會存檔 */
  readOnlyNotice: boolean
  /** key 為 cardId；沒有鍵代表從未啟動過 */
  ptyStatus: Record<string, PtyStatus>
  /** key 為 cwd，多張卡片指向同一目錄時共用 */
  branches: Record<string, string | null>

  loadBoard: () => Promise<void>
  setActiveCard: (cardId: string | null) => void
  dismissRecoveryNotice: () => void

  addCard: (columnId: string, input: CardInput) => void
  updateCard: (cardId: string, patch: CardPatch) => void
  deleteCard: (cardId: string) => void
  moveCard: (cardId: string, toColumnId: string, toIndex: number) => void

  addColumn: (title: string) => void
  updateColumn: (columnId: string, patch: ColumnPatch) => void
  deleteColumn: (columnId: string) => void
  moveColumn: (columnId: string, toIndex: number) => void

  startPty: (cardId: string) => Promise<void>
  stopPty: (cardId: string) => void
  setPtyStatus: (cardId: string, status: PtyStatus) => void
  refreshPtyStatuses: () => void
  loadBranches: () => Promise<void>

  /** 拖拉期間更新畫面但不存檔 */
  previewBoard: (board: Board) => void
  /** 拖拉結束，把目前 board 存檔 */
  commitBoard: () => void
  /** 取消拖拉，還原成拖拉前的 snapshot */
  restoreBoard: (board: Board) => void
}

const EMPTY_BOARD: Board = { version: 1, columns: [], cards: {} }

export const useAppStore = create<AppState>((set, get) => {
  /** 唯一的寫入路徑：更新 state 後立即請 main 存檔（main 端會 debounce） */
  const persist = (board: Board): void => {
    set({ board })
    void window.gc.board.save(board)
  }

  /**
   * 進行中的載入。併發呼叫共用同一個 Promise，避免較晚 resolve 的那次
   * 用舊快照覆蓋期間的所有變更（StrictMode 會讓 effect 跑兩次）。
   */
  let loading: Promise<void> | null = null

  return {
    board: EMPTY_BOARD,
    activeCardId: null,
    loaded: false,
    recoveryNotice: null,
    readOnlyNotice: false,
    ptyStatus: {},
    branches: {},

    loadBoard: () => {
      if (loading) return loading
      loading = (async () => {
        try {
          const { board, recoveredFrom, readOnly } = await window.gc.board.load()
          set({ board, loaded: true, recoveryNotice: recoveredFrom, readOnlyNotice: readOnly })
        } catch (err) {
          console.error('[app-store] 載入看板失敗，改用空白看板', { err })
          set({ board: EMPTY_BOARD, loaded: true })
        } finally {
          loading = null
        }
      })()
      return loading
    },

    setActiveCard: (cardId) => set({ activeCardId: cardId }),

    dismissRecoveryNotice: () => set({ recoveryNotice: null }),

    addCard: (columnId, input) => {
      const card = newCard(input, crypto.randomUUID(), new Date().toISOString())
      persist(addCard(get().board, columnId, card))
    },

    updateCard: (cardId, patch) => {
      persist(updateCard(get().board, cardId, patch, new Date().toISOString()))
    },

    deleteCard: (cardId) => {
      try {
        window.gc.pty.kill(cardId)
      } catch (err) {
        // kill 失敗不該擋住卡片刪除，否則使用者會看到「按了沒反應」且無錯誤訊息
        console.warn('[app-store] 刪除卡片時關閉終端機失敗', { cardId, err })
      }
      disposeTerminal(cardId)
      clearActivity(cardId)
      const { activeCardId } = get()
      if (activeCardId === cardId) set({ activeCardId: null })
      set((state) => {
        const ptyStatus = { ...state.ptyStatus }
        delete ptyStatus[cardId]
        return { ptyStatus }
      })
      persist(deleteCard(get().board, cardId))
    },

    moveCard: (cardId, toColumnId, toIndex) => {
      persist(moveCard(get().board, cardId, toColumnId, toIndex))
    },

    addColumn: (title) => {
      const { board } = get()
      const column = newColumn(title, pickColumnColor(board.columns), crypto.randomUUID())
      persist(addColumn(board, column))
    },

    updateColumn: (columnId, patch) => {
      persist(updateColumn(get().board, columnId, patch))
    },

    deleteColumn: (columnId) => {
      const { board, activeCardId } = get()
      const result = deleteColumn(board, columnId)
      // 欄位連同卡片一起消失，對應的 pty、xterm 實例與狀態都要收掉。
      // 逐張包 try/catch 而非整個迴圈包一次：否則第一張失敗就會跳過其餘所有卡片
      for (const cardId of result.removedCardIds) {
        try {
          window.gc.pty.kill(cardId)
        } catch (err) {
          console.warn('[app-store] 刪除欄位時關閉終端機失敗', { columnId, cardId, err })
        }
        disposeTerminal(cardId)
        clearActivity(cardId)
      }
      if (activeCardId && result.removedCardIds.includes(activeCardId)) set({ activeCardId: null })
      set((state) => {
        const ptyStatus = { ...state.ptyStatus }
        for (const cardId of result.removedCardIds) delete ptyStatus[cardId]
        return { ptyStatus }
      })
      persist(result.board)
    },

    moveColumn: (columnId, toIndex) => {
      persist(moveColumn(get().board, columnId, toIndex))
    },

    setPtyStatus: (cardId, status) =>
      set((state) => {
        // 卡片已被刪除時，延遲送達的 pty:exit 不該把它的狀態寫回來——
        // TerminalHost 是用 ptyStatus 的 key 決定要掛載哪些終端機，
        // 復活的 key 會生出一個永遠看不到也永遠不會被回收的 xterm 實例
        if (!state.board.cards[cardId]) return state
        return { ptyStatus: { ...state.ptyStatus, [cardId]: status } }
      }),

    /** 每 500ms 由 App 呼叫；只在真的有變化時才 set，避免無謂重繪 */
    refreshPtyStatuses: () => {
      const { ptyStatus } = get()
      const now = Date.now()
      const next: Record<string, PtyStatus> = {}
      let changed = false

      for (const [cardId, current] of Object.entries(ptyStatus)) {
        const status = computeStatus(cardId, current !== 'stopped', now)
        next[cardId] = status
        if (status !== current) changed = true
      }

      if (changed) set({ ptyStatus: next })
    },

    loadBranches: async () => {
      const cwds = [...new Set(Object.values(get().board.cards).map((c) => c.cwd))]
      // 用 allSettled 而非 all：單一目錄讀取失敗不該讓整個看板的 branch 都消失
      const results = await Promise.allSettled(
        cwds.map(async (cwd) => [cwd, await window.gc.git.branch(cwd)] as const),
      )
      const entries: Array<readonly [string, string | null]> = []
      for (const result of results) {
        if (result.status === 'fulfilled') {
          entries.push(result.value)
        } else {
          console.warn('[app-store] 讀取單一目錄的 branch 失敗，該卡片暫不顯示 branch', {
            err: result.reason,
          })
        }
      }
      set({ branches: Object.fromEntries(entries) })
    },

    startPty: async (cardId) => {
      const card = get().board.cards[cardId]
      if (!card) {
        console.warn('[app-store] startPty 找不到卡片', { cardId })
        return
      }
      // 先確保 xterm 存在，才能拿到正確的 cols/rows 開 pty
      const { term } = ensureTerminal(cardId)
      try {
        await window.gc.pty.spawn(cardId, card.cwd, card.command, term.cols, term.rows)
        get().setPtyStatus(cardId, 'running')
      } catch (err) {
        console.error('[app-store] 啟動終端機失敗', { cardId, cwd: card.cwd, err })
        // 把失敗寫進 xterm，否則使用者只會看到一片空白且毫無線索
        const message = err instanceof Error ? err.message : String(err)
        term.write(`\r\n\x1b[31m啟動失敗：${message}\x1b[0m\r\n`)
        term.write(`\x1b[90m工作目錄：${card.cwd}\x1b[0m\r\n`)
        get().setPtyStatus(cardId, 'stopped')
      }
    },

    stopPty: (cardId) => {
      window.gc.pty.kill(cardId)
      get().setPtyStatus(cardId, 'stopped')
    },

    previewBoard: (board) => set({ board }),

    commitBoard: () => {
      void window.gc.board.save(get().board)
    },

    restoreBoard: (board) => set({ board }),
  }
})
