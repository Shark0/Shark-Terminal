import { describe, expect, it } from 'vitest'
import { COLUMN_COLORS, type Board } from '@shared/types'
import { newCard, newColumn } from '@shared/factory'
import { addCard } from '../../src/renderer/store/board-reducer'
import {
  chooseCardDropTarget,
  columnIdOfCard,
  crossColumnInsertIndex,
  resolveTargetColumnId,
} from '../../src/renderer/board/drag-utils'

const NOW = '2026-09-07T00:00:00.000Z'

/** col_a[card_1, card_2] / col_b[card_3] / col_empty[] */
function fixture(): Board {
  const columns = ['col_a', 'col_b', 'col_empty'].map((id, i) =>
    newColumn(id, COLUMN_COLORS[i], id),
  )
  let b: Board = { version: 1, columns, cards: {} }
  b = addCard(b, 'col_a', newCard({ title: 'card_1', cwd: '/tmp/1' }, 'card_1', NOW))
  b = addCard(b, 'col_a', newCard({ title: 'card_2', cwd: '/tmp/2' }, 'card_2', NOW))
  b = addCard(b, 'col_b', newCard({ title: 'card_3', cwd: '/tmp/3' }, 'card_3', NOW))
  return b
}

describe('columnIdOfCard', () => {
  it('回傳卡片所在欄位', () => {
    expect(columnIdOfCard(fixture(), 'card_3')).toBe('col_b')
  })

  it('卡片不存在時回傳 null', () => {
    expect(columnIdOfCard(fixture(), 'card_nope')).toBeNull()
  })
})

describe('resolveTargetColumnId', () => {
  it('over 是欄位本身時回傳該欄位', () => {
    expect(resolveTargetColumnId(fixture(), 'col_empty')).toBe('col_empty')
  })

  it('over 是卡片時回傳卡片所在欄位', () => {
    expect(resolveTargetColumnId(fixture(), 'card_3')).toBe('col_b')
  })

  it('over 既不是欄位也不是卡片時回傳 null', () => {
    expect(resolveTargetColumnId(fixture(), 'ghost')).toBeNull()
  })
})

describe('crossColumnInsertIndex', () => {
  const colA = () => fixture().columns[0]

  it('over 是欄位本身（空欄或欄位空白處）時插到末端', () => {
    expect(crossColumnInsertIndex(colA(), 'col_a', false)).toBe(2)
  })

  it('拖曳中的卡片在 over 卡片上方時，插在 over 卡片之前', () => {
    expect(crossColumnInsertIndex(colA(), 'card_2', false)).toBe(1)
  })

  it('拖曳中的卡片已越過 over 卡片下緣時，插在 over 卡片之後', () => {
    expect(crossColumnInsertIndex(colA(), 'card_2', true)).toBe(2)
  })

  it('over 卡片不在該欄（版面剛變動的瞬間）時退回末端，不會產生 -1 的索引', () => {
    expect(crossColumnInsertIndex(colA(), 'card_3', false)).toBe(2)
  })
})

describe('chooseCardDropTarget', () => {
  type Rect = { top: number; left: number; width: number; height: number; bottom: number; right: number }
  const rect = (left: number, top: number, width: number, height: number): Rect => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  })
  /** col_a x 0–260（兩張卡 y 60–116、124–180）、col_b x 272–532（一張卡）、col_empty x 544–804（空欄高 120） */
  const rects = new Map<string, Rect>([
    ['col_a', rect(0, 0, 260, 200)],
    ['card_1', rect(8, 60, 244, 56)],
    ['card_2', rect(8, 124, 244, 56)],
    ['col_b', rect(272, 0, 260, 140)],
    ['card_3', rect(280, 60, 244, 56)],
    ['col_empty', rect(544, 0, 260, 120)],
  ])
  const boardRect = rect(0, 0, 900, 500)
  const base = { board: fixture(), rects, boardRect, activeId: 'card_3', recentlyMoved: false }
  const choose = (pointer: { x: number; y: number }, overrides: Partial<typeof base> = {}) =>
    chooseCardDropTarget({ ...base, ...overrides, pointer })

  it('指標在某張卡片上 → 該卡片', () => {
    expect(choose({ x: 100, y: 150 })).toBe('card_2')
  })

  it('指標在欄內但不在任何卡片上（標題、卡片間隙）→ 該欄內 y 最近的卡片', () => {
    expect(choose({ x: 100, y: 20 })).toBe('card_1')
    expect(choose({ x: 100, y: 121 })).toBe('card_2')
  })

  it('指標在空欄內 → 該欄本身', () => {
    expect(choose({ x: 600, y: 50 })).toBe('col_empty')
  })

  it('指標在兩欄縫隙 → 水平距離最近的欄（欄的 x 不會因搬卡片而變，不會翻轉）', () => {
    expect(choose({ x: 264, y: 100 })).toBe('card_1')
    expect(choose({ x: 540, y: 100 })).toBe('col_empty')
  })

  it('指標在欄位下方的空白處 → 正上方那欄內 y 最近的卡片', () => {
    expect(choose({ x: 100, y: 400 })).toBe('card_2')
  })

  it('指標超出看板區（例如終端機面板）→ 無目標', () => {
    expect(choose({ x: 100, y: 600 })).toBeNull()
  })

  it('剛跨欄移動、版面尚未重新量測的那一幀 → 一律回報拖曳中的卡片自己', () => {
    expect(choose({ x: 100, y: 150 }, { recentlyMoved: true })).toBe('card_3')
  })

  it('沒有指標座標（鍵盤感應器）→ 無目標', () => {
    expect(chooseCardDropTarget({ ...base, pointer: null })).toBeNull()
  })

  it('欄位還沒被量測到 rect 時略過該欄', () => {
    const partial = new Map(rects)
    partial.delete('col_a')
    expect(choose({ x: 100, y: 150 }, { rects: partial })).toBe('card_3')
  })
})
