import type { Board, Card, Column } from '@shared/types'

export type CardPatch = Partial<Pick<Card, 'title' | 'cwd' | 'command' | 'note'>>
export type ColumnPatch = Partial<Pick<Column, 'title' | 'color'>>

export function addCard(board: Board, columnId: string, card: Card): Board {
  const index = board.columns.findIndex((c) => c.id === columnId)
  if (index === -1) {
    console.warn('[board-reducer] addCard 找不到目標欄位，忽略此次新增', {
      columnId,
      cardId: card.id,
    })
    return board
  }
  const columns = board.columns.map((c, i) =>
    i === index ? { ...c, cardIds: [...c.cardIds, card.id] } : c,
  )
  return { ...board, columns, cards: { ...board.cards, [card.id]: card } }
}

export function updateCard(board: Board, cardId: string, patch: CardPatch, now: string): Board {
  const existing = board.cards[cardId]
  if (!existing) {
    console.warn('[board-reducer] updateCard 找不到卡片，忽略此次更新', { cardId })
    return board
  }
  return {
    ...board,
    cards: { ...board.cards, [cardId]: { ...existing, ...patch, updatedAt: now } },
  }
}

export function deleteCard(board: Board, cardId: string): Board {
  if (!board.cards[cardId]) {
    console.warn('[board-reducer] deleteCard 找不到卡片，忽略此次刪除', { cardId })
    return board
  }
  const cards = { ...board.cards }
  delete cards[cardId]
  const columns = board.columns.map((c) =>
    c.cardIds.includes(cardId) ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) } : c,
  )
  return { ...board, columns, cards }
}

/**
 * 移動卡片到目標欄位的指定位置。
 * toIndex 為「卡片自原位置移除之後」於目標欄位的插入索引，與 @dnd-kit 的 arrayMove 一致。
 * 同欄移動也走同一條路徑，索引語意才會一致。
 */
export function moveCard(board: Board, cardId: string, toColumnId: string, toIndex: number): Board {
  if (!board.cards[cardId]) {
    console.warn('[board-reducer] moveCard 找不到卡片，忽略此次移動', { cardId })
    return board
  }
  const toColumnIndex = board.columns.findIndex((c) => c.id === toColumnId)
  if (toColumnIndex === -1) {
    console.warn('[board-reducer] moveCard 找不到目標欄位，忽略此次移動', { cardId, toColumnId })
    return board
  }

  const columns = board.columns.map((c) => ({
    ...c,
    cardIds: c.cardIds.filter((id) => id !== cardId),
  }))
  const target = columns[toColumnIndex]
  const index = Math.max(0, Math.min(toIndex, target.cardIds.length))
  const cardIds = [...target.cardIds]
  cardIds.splice(index, 0, cardId)
  columns[toColumnIndex] = { ...target, cardIds }

  return { ...board, columns }
}

export function addColumn(board: Board, column: Column): Board {
  return { ...board, columns: [...board.columns, column] }
}

export function updateColumn(board: Board, columnId: string, patch: ColumnPatch): Board {
  const index = board.columns.findIndex((c) => c.id === columnId)
  if (index === -1) {
    console.warn('[board-reducer] updateColumn 找不到欄位，忽略此次更新', { columnId })
    return board
  }
  return {
    ...board,
    columns: board.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)),
  }
}

/**
 * 刪除欄位並連帶刪除其中所有卡片。
 * removedCardIds 供呼叫端 kill 對應的 pty 與清除 xterm 實例。
 */
export function deleteColumn(
  board: Board,
  columnId: string,
): { board: Board; removedCardIds: string[] } {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column) {
    console.warn('[board-reducer] deleteColumn 找不到欄位，忽略此次刪除', { columnId })
    return { board, removedCardIds: [] }
  }
  const cards = { ...board.cards }
  for (const id of column.cardIds) delete cards[id]
  return {
    board: { ...board, columns: board.columns.filter((c) => c.id !== columnId), cards },
    removedCardIds: [...column.cardIds],
  }
}

/** toIndex 語意同 moveCard：該欄位自原位置移除之後的插入索引 */
export function moveColumn(board: Board, columnId: string, toIndex: number): Board {
  const from = board.columns.findIndex((c) => c.id === columnId)
  if (from === -1) {
    console.warn('[board-reducer] moveColumn 找不到欄位，忽略此次移動', { columnId })
    return board
  }
  const columns = [...board.columns]
  const [moved] = columns.splice(from, 1)
  const index = Math.max(0, Math.min(toIndex, columns.length))
  columns.splice(index, 0, moved)
  return { ...board, columns }
}
