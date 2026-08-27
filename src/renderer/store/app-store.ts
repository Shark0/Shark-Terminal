import { create } from 'zustand'
import type { Board } from '@shared/types'
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
}

const EMPTY_BOARD: Board = { version: 1, columns: [], cards: {} }

export const useAppStore = create<AppState>((set, get) => {
  /** 唯一的寫入路徑：更新 state 後立即請 main 存檔（main 端會 debounce） */
  const persist = (board: Board): void => {
    set({ board })
    void window.gc.board.save(board)
  }

  return {
    board: EMPTY_BOARD,
    activeCardId: null,
    loaded: false,
    recoveryNotice: null,

    loadBoard: async () => {
      try {
        const { board, recoveredFrom } = await window.gc.board.load()
        set({ board, loaded: true, recoveryNotice: recoveredFrom })
      } catch (err) {
        console.error('[app-store] 載入看板失敗，改用空白看板', { err })
        set({ board: EMPTY_BOARD, loaded: true })
      }
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
      window.gc.pty.kill(cardId)
      const { activeCardId } = get()
      if (activeCardId === cardId) set({ activeCardId: null })
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
      // 欄位連同卡片一起消失，對應的 pty 也要收掉
      for (const cardId of result.removedCardIds) window.gc.pty.kill(cardId)
      if (activeCardId && result.removedCardIds.includes(activeCardId)) set({ activeCardId: null })
      persist(result.board)
    },

    moveColumn: (columnId, toIndex) => {
      persist(moveColumn(get().board, columnId, toIndex))
    },
  }
})
