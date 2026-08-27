import { describe, expect, it } from 'vitest'
import { COLUMN_COLORS } from '@shared/types'
import { createDefaultBoard, newCard, newColumn, pickColumnColor } from '@shared/factory'

describe('createDefaultBoard', () => {
  it('回傳空白看板，讓使用者自己建立需要的階段', () => {
    expect(createDefaultBoard()).toEqual({ version: 1, columns: [], cards: {} })
  })
})

describe('pickColumnColor', () => {
  it('依既有欄位數量取色', () => {
    expect(pickColumnColor([])).toBe(COLUMN_COLORS[0])
    expect(pickColumnColor([newColumn('a', COLUMN_COLORS[0], 'c0')])).toBe(COLUMN_COLORS[1])
  })

  it('超過色盤長度後循環', () => {
    const full = COLUMN_COLORS.map((color, i) => newColumn(`c${i}`, color, `id${i}`))
    expect(pickColumnColor(full)).toBe(COLUMN_COLORS[0])
  })
})

describe('newCard', () => {
  it('note 未提供時為空字串，兩個時間戳相同', () => {
    const card = newCard(
      { title: '訂單結帳重構', cwd: '/tmp/project-a', command: 'claude' },
      'card_1',
      '2026-08-27T00:00:00.000Z',
    )
    expect(card).toEqual({
      id: 'card_1',
      title: '訂單結帳重構',
      cwd: '/tmp/project-a',
      command: 'claude',
      note: '',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    })
  })

  it('note 有提供時保留', () => {
    const card = newCard(
      { title: 'T', cwd: '/tmp', command: 'claude', note: '記得跑 migration' },
      'card_2',
      '2026-08-27T00:00:00.000Z',
    )
    expect(card.note).toBe('記得跑 migration')
  })
})

describe('newColumn', () => {
  it('新欄位不含任何卡片', () => {
    expect(newColumn('開發中', '#3fb950', 'col_9')).toEqual({
      id: 'col_9',
      title: '開發中',
      color: '#3fb950',
      cardIds: [],
    })
  })
})
