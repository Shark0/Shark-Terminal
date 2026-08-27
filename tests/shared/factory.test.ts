import { describe, expect, it } from 'vitest'
import { COLUMN_COLORS } from '@shared/types'
import {
  DEFAULT_COLUMN_TITLES,
  createDefaultBoard,
  newCard,
  newColumn,
  pickColumnColor,
} from '@shared/factory'

function seqId(prefix: string): () => string {
  let n = 0
  return () => `${prefix}_${n++}`
}

describe('createDefaultBoard', () => {
  it('建立四個預設欄位，皆為空欄', () => {
    const board = createDefaultBoard(seqId('col'))
    expect(board.version).toBe(1)
    expect(board.columns.map((c) => c.title)).toEqual([
      '需求評估中',
      '開發中',
      'Review 中',
      '等待 Merge',
    ])
    expect(board.columns.every((c) => c.cardIds.length === 0)).toBe(true)
    expect(board.cards).toEqual({})
  })

  it('每個欄位取得唯一 id', () => {
    const board = createDefaultBoard(seqId('col'))
    const ids = board.columns.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('相鄰欄位顏色不同', () => {
    const board = createDefaultBoard(seqId('col'))
    for (let i = 1; i < board.columns.length; i++) {
      expect(board.columns[i].color).not.toBe(board.columns[i - 1].color)
    }
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
      { title: 'U19 登入重構', cwd: '/tmp/u19', command: 'claude' },
      'card_1',
      '2026-08-27T00:00:00.000Z',
    )
    expect(card).toEqual({
      id: 'card_1',
      title: 'U19 登入重構',
      cwd: '/tmp/u19',
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

describe('DEFAULT_COLUMN_TITLES', () => {
  it('與 spec 定義的四個階段一致', () => {
    expect(DEFAULT_COLUMN_TITLES).toEqual(['需求評估中', '開發中', 'Review 中', '等待 Merge'])
  })
})
