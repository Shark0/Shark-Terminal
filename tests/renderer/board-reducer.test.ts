import { describe, expect, it, vi } from 'vitest'
import type { Board } from '@shared/types'
import { createDefaultBoard, newCard, newColumn } from '@shared/factory'
import {
  addCard,
  addColumn,
  deleteCard,
  deleteColumn,
  moveCard,
  moveColumn,
  updateCard,
  updateColumn,
} from '../../src/renderer/store/board-reducer'

const NOW = '2026-08-27T00:00:00.000Z'
const LATER = '2026-08-27T09:30:00.000Z'

function seqId(prefix: string): () => string {
  let n = 0
  return () => `${prefix}_${n++}`
}

function card(id: string, title = id): ReturnType<typeof newCard> {
  return newCard({ title, cwd: `/tmp/${id}`, command: 'claude' }, id, NOW)
}

/** col_0 需求評估中[card_a, card_b] / col_1 開發中[card_c] / col_2 Review 中[] / col_3 等待 Merge[] */
function fixture(): Board {
  let b = createDefaultBoard(seqId('col'))
  b = addCard(b, 'col_0', card('card_a'))
  b = addCard(b, 'col_0', card('card_b'))
  b = addCard(b, 'col_1', card('card_c'))
  return b
}

function idsOf(board: Board, columnId: string): string[] {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column) throw new Error(`測試 fixture 找不到欄位 ${columnId}`)
  return column.cardIds
}

describe('addCard', () => {
  it('把卡片加到指定欄位的末端', () => {
    const b = addCard(fixture(), 'col_1', card('card_z'))
    expect(idsOf(b, 'col_1')).toEqual(['card_c', 'card_z'])
    expect(b.cards.card_z.title).toBe('card_z')
  })

  it('欄位不存在時原樣回傳並記錄警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    const after = addCard(before, 'col_nope', card('card_z'))
    expect(after).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('updateCard', () => {
  it('套用 patch 並更新 updatedAt，不動 createdAt', () => {
    const b = updateCard(fixture(), 'card_a', { title: '改過的標題' }, LATER)
    expect(b.cards.card_a.title).toBe('改過的標題')
    expect(b.cards.card_a.cwd).toBe('/tmp/card_a')
    expect(b.cards.card_a.createdAt).toBe(NOW)
    expect(b.cards.card_a.updatedAt).toBe(LATER)
  })

  it('卡片不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(updateCard(before, 'card_nope', { title: 'x' }, LATER)).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('deleteCard', () => {
  it('同時自 cards 與所屬欄位移除', () => {
    const b = deleteCard(fixture(), 'card_a')
    expect(b.cards.card_a).toBeUndefined()
    expect(idsOf(b, 'col_0')).toEqual(['card_b'])
  })

  it('卡片不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(deleteCard(before, 'card_nope')).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('moveCard', () => {
  it('跨欄移動到指定索引', () => {
    const b = moveCard(fixture(), 'card_a', 'col_1', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_b'])
    expect(idsOf(b, 'col_1')).toEqual(['card_a', 'card_c'])
  })

  it('跨欄移動到空欄', () => {
    const b = moveCard(fixture(), 'card_a', 'col_2', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_b'])
    expect(idsOf(b, 'col_2')).toEqual(['card_a'])
  })

  it('同欄往下移動：索引為移除後的位置', () => {
    const b = moveCard(fixture(), 'card_a', 'col_0', 1)
    expect(idsOf(b, 'col_0')).toEqual(['card_b', 'card_a'])
  })

  it('同欄往上移動', () => {
    const b = moveCard(fixture(), 'card_b', 'col_0', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_b', 'card_a'])
  })

  it('拖回原位時內容不變', () => {
    const b = moveCard(fixture(), 'card_a', 'col_0', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_a', 'card_b'])
  })

  it('toIndex 超出上界時 clamp 到末端', () => {
    const b = moveCard(fixture(), 'card_a', 'col_1', 99)
    expect(idsOf(b, 'col_1')).toEqual(['card_c', 'card_a'])
  })

  it('toIndex 為負數時 clamp 到開頭', () => {
    const b = moveCard(fixture(), 'card_a', 'col_1', -5)
    expect(idsOf(b, 'col_1')).toEqual(['card_a', 'card_c'])
  })

  it('卡片不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(moveCard(before, 'card_nope', 'col_1', 0)).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('目標欄位不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(moveCard(before, 'card_a', 'col_nope', 0)).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('addColumn / updateColumn', () => {
  it('新欄位加在最右側', () => {
    const b = addColumn(fixture(), newColumn('已上線', '#39c5cf', 'col_9'))
    expect(b.columns.map((c) => c.id)).toEqual(['col_0', 'col_1', 'col_2', 'col_3', 'col_9'])
  })

  it('更新欄位標題與顏色', () => {
    const b = updateColumn(fixture(), 'col_1', { title: '實作中', color: '#f778ba' })
    const column = b.columns.find((c) => c.id === 'col_1')
    expect(column?.title).toBe('實作中')
    expect(column?.color).toBe('#f778ba')
    expect(column?.cardIds).toEqual(['card_c'])
  })

  it('updateColumn：欄位不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(updateColumn(before, 'col_nope', { title: 'x' })).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('deleteColumn', () => {
  it('連帶刪除欄內卡片，並回傳被刪除的 cardIds', () => {
    const { board, removedCardIds } = deleteColumn(fixture(), 'col_0')
    expect(board.columns.map((c) => c.id)).toEqual(['col_1', 'col_2', 'col_3'])
    expect(board.cards.card_a).toBeUndefined()
    expect(board.cards.card_b).toBeUndefined()
    expect(board.cards.card_c).toBeDefined()
    expect(removedCardIds).toEqual(['card_a', 'card_b'])
  })

  it('刪除空欄時 removedCardIds 為空陣列', () => {
    const { removedCardIds } = deleteColumn(fixture(), 'col_2')
    expect(removedCardIds).toEqual([])
  })

  it('欄位不存在時原樣回傳，removedCardIds 為空陣列', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    const result = deleteColumn(before, 'col_nope')
    expect(result.board).toBe(before)
    expect(result.removedCardIds).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('moveColumn', () => {
  it('把欄位移到最前', () => {
    const b = moveColumn(fixture(), 'col_2', 0)
    expect(b.columns.map((c) => c.id)).toEqual(['col_2', 'col_0', 'col_1', 'col_3'])
  })

  it('把欄位移到最後', () => {
    const b = moveColumn(fixture(), 'col_0', 3)
    expect(b.columns.map((c) => c.id)).toEqual(['col_1', 'col_2', 'col_3', 'col_0'])
  })

  it('欄位隨身帶著自己的卡片', () => {
    const b = moveColumn(fixture(), 'col_0', 3)
    expect(idsOf(b, 'col_0')).toEqual(['card_a', 'card_b'])
  })

  it('欄位不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(moveColumn(before, 'col_nope', 0)).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('toIndex 超出上界時 clamp 到末端', () => {
    const b = moveColumn(fixture(), 'col_0', 99)
    expect(b.columns.map((c) => c.id)).toEqual(['col_1', 'col_2', 'col_3', 'col_0'])
  })

  it('toIndex 為負數時 clamp 到開頭', () => {
    const b = moveColumn(fixture(), 'col_2', -5)
    expect(b.columns.map((c) => c.id)).toEqual(['col_2', 'col_0', 'col_1', 'col_3'])
  })
})

describe('不變性', () => {
  it('所有 reducer 都不修改輸入的 board', () => {
    const board = fixture()
    const snapshot = structuredClone(board)

    addCard(board, 'col_0', card('card_z'))
    updateCard(board, 'card_a', { title: 'x' }, LATER)
    deleteCard(board, 'card_a')
    moveCard(board, 'card_a', 'col_1', 0)
    addColumn(board, newColumn('x', '#58a6ff', 'col_9'))
    updateColumn(board, 'col_0', { title: 'x' })
    deleteColumn(board, 'col_0')
    moveColumn(board, 'col_0', 2)

    expect(board).toEqual(snapshot)
  })
})
