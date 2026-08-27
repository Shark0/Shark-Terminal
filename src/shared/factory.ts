import { COLUMN_COLORS, type Board, type Card, type Column } from './types'

export function newCard(
  input: { title: string; cwd: string; command: string; note?: string },
  id: string,
  now: string,
): Card {
  return {
    id,
    title: input.title,
    cwd: input.cwd,
    command: input.command,
    note: input.note ?? '',
    createdAt: now,
    updatedAt: now,
  }
}

export function newColumn(title: string, color: string, id: string): Column {
  return { id, title, color, cardIds: [] }
}

/** 依既有欄位數量從色盤循環取色，確保相鄰欄位不同色 */
export function pickColumnColor(existing: Column[]): string {
  return COLUMN_COLORS[existing.length % COLUMN_COLORS.length]
}

/** board.json 不存在時使用的初始看板：空白，讓使用者自己建立需要的階段 */
export function createDefaultBoard(): Board {
  return { version: 1, columns: [], cards: {} }
}
