import { COLUMN_COLORS, type Board, type Card, type Column } from './types'

/** spec 定義的四個預設工作階段 */
export const DEFAULT_COLUMN_TITLES = ['需求評估中', '開發中', 'Review 中', '等待 Merge'] as const

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

/** board.json 不存在時使用的初始看板 */
export function createDefaultBoard(genId: () => string): Board {
  const columns: Column[] = []
  for (const title of DEFAULT_COLUMN_TITLES) {
    columns.push(newColumn(title, pickColumnColor(columns), genId()))
  }
  return { version: 1, columns, cards: {} }
}
