import type { Board, Column } from '@shared/types'

/** 找出卡片目前所在的欄位 id */
export function columnIdOfCard(board: Board, cardId: string): string | null {
  return board.columns.find((c) => c.cardIds.includes(cardId))?.id ?? null
}

/** dnd-kit 的 over 可能是欄位本身或欄內某張卡片，統一換算成目標欄位 id */
export function resolveTargetColumnId(board: Board, overId: string): string | null {
  if (board.columns.some((c) => c.id === overId)) return overId
  return columnIdOfCard(board, overId)
}

/**
 * 卡片跨欄進入時的插入索引（索引語意同 moveCard：自原欄移除後於目標欄的插入位置）。
 * over 是欄位本身 → 末端；over 是卡片 → 該卡片位置，拖曳中的卡片已越過它下緣時放它後面。
 * over 卡片不在該欄（版面剛變動的瞬間）時退回末端，避免 indexOf 的 -1 混進索引。
 */
export function crossColumnInsertIndex(column: Column, overId: string, isBelowOver: boolean): number {
  if (overId === column.id) return column.cardIds.length
  const overIndex = column.cardIds.indexOf(overId)
  if (overIndex === -1) return column.cardIds.length
  return overIndex + (isBelowOver ? 1 : 0)
}

export interface DropRect {
  top: number
  left: number
  width: number
  height: number
  bottom: number
  right: number
}

export interface DropTargetInput {
  board: Pick<Board, 'columns'>
  /** dnd-kit 量測到的 droppable rect（欄位與卡片），視窗座標 */
  rects: { get(id: string): DropRect | undefined }
  /** 看板捲動容器的 rect；指標離開它（例如跑到終端機面板）就沒有目標。null 代表不限制 */
  boardRect: DropRect | null
  pointer: { x: number; y: number } | null
  activeId: string
  /** 卡片剛跨欄移動、版面尚未重新量測的那一幀為 true */
  recentlyMoved: boolean
}

function within(p: { x: number; y: number }, r: DropRect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
}

/**
 * 卡片拖曳時的放置目標，純粹由指標位置決定：
 * 指標在某張卡片上 → 該卡片；在欄內其他位置 → 該欄內 y 最近的卡片（空欄則欄本身）；
 * 不在任何欄內（欄與欄的縫隙、欄位下方空白）→ 水平距離最近的欄，再套同一規則。
 *
 * 不用 dnd-kit 內建的 closestCorners / rectIntersection：那些拿拖曳中的矩形與各目標比距離，
 * 卡片一搬動、版面一變，最近的目標就換人，onDragOver 再搬一次，同一個 commit 內無限來回，
 * React 達到巢狀更新上限就把整棵樹卸載。指標位置與欄的 x 座標都不會因搬卡片而改變，
 * 所以這裡的選擇是穩定的；搬進欄內之後目標只會在同一欄內變動，onDragOver 不再動狀態。
 *
 * 跨欄移動後的同一幀 rect 還是舊的，任何依 rect 的判斷都不可信，一律回報卡片自己。
 */
export function chooseCardDropTarget(input: DropTargetInput): string | null {
  const { board, rects, boardRect, pointer, activeId, recentlyMoved } = input
  if (recentlyMoved) return activeId
  if (!pointer) return null
  if (boardRect && !within(pointer, boardRect)) return null

  let column = board.columns.find((c) => {
    const r = rects.get(c.id)
    return r !== undefined && within(pointer, r)
  })
  if (!column) {
    let best: { column: Column; distance: number } | null = null
    for (const c of board.columns) {
      const r = rects.get(c.id)
      if (!r) continue
      const distance = pointer.x < r.left ? r.left - pointer.x : pointer.x > r.right ? pointer.x - r.right : 0
      if (!best || distance < best.distance) best = { column: c, distance }
    }
    column = best?.column
  }
  if (!column) return null
  if (column.cardIds.length === 0) return column.id

  let nearest: { id: string; distance: number } | null = null
  for (const id of column.cardIds) {
    const r = rects.get(id)
    if (!r) continue
    if (within(pointer, r)) return id
    const distance = Math.abs(pointer.y - (r.top + r.height / 2))
    if (!nearest || distance < nearest.distance) nearest = { id, distance }
  }
  return nearest?.id ?? column.id
}
