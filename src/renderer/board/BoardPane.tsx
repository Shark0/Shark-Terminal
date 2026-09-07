import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import type { Board } from '@shared/types'
import { moveCard as moveCardIn, moveColumn as moveColumnIn } from '../store/board-reducer'
import { useAppStore } from '../store/app-store'
import CardDialog, { type CardDraft } from './CardDialog'
import Column from './Column'
import DragCardPreview from './DragCardPreview'
import {
  chooseCardDropTarget,
  columnIdOfCard,
  crossColumnInsertIndex,
  resolveTargetColumnId,
} from './drag-utils'

/** null 代表對話框關閉；有值時 columnId 為新增目標、cardId 為編輯目標 */
type DialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; cardId: string } | null

interface Props {
  home: string
}

export default function BoardPane({ home }: Props): JSX.Element {
  const board = useAppStore((s) => s.board)
  const addCard = useAppStore((s) => s.addCard)
  const updateCard = useAppStore((s) => s.updateCard)
  const deleteCard = useAppStore((s) => s.deleteCard)
  const addColumn = useAppStore((s) => s.addColumn)
  const previewBoard = useAppStore((s) => s.previewBoard)
  const commitBoard = useAppStore((s) => s.commitBoard)
  const restoreBoard = useAppStore((s) => s.restoreBoard)

  const [dialog, setDialog] = useState<DialogState>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const snapshot = useRef<Board | null>(null)
  /** 看板捲動容器；指標離開它就視為沒有放置目標（放開＝取消） */
  const boardRef = useRef<HTMLDivElement>(null)
  /**
   * 卡片剛跨欄移動的那一幀，版面還沒重新量測，任何依 rect 的判斷都會算錯；
   * 這段期間一律回報「卡片自己」讓它穩定下來，下一幀（board 更新後的 rAF）再解除
   */
  const recentlyMovedToNewColumn = useRef(false)

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedToNewColumn.current = false
    })
  }, [board])

  // 需要一點位移才觸發拖拉，否則單擊卡片會被誤判成拖曳
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  /**
   * 碰撞偵測不用預設的 closestCorners：它拿拖曳中的矩形與各目標比距離，
   * 欄位（大矩形）與欄內卡片（小矩形）互相競爭，卡片一搬進新欄版面就變，
   * over 在「欄位本身 → 移到末端」與「欄內卡片 → 插到它前面」之間來回翻轉，
   * 同一個 commit 內無限循環，React 達到巢狀更新上限後整棵樹卸載，視窗只剩黑底。
   * 卡片改用純指標位置決定目標（見 chooseCardDropTarget），欄位拖曳則只跟其他欄位比。
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      if (args.active.data.current?.type === 'column') {
        // 只跟欄位比，卡片不參與，onDragEnd 就不必再把卡片換算回欄位
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (c) => c.data.current?.type === 'column',
          ),
        })
      }
      const target = chooseCardDropTarget({
        board,
        rects: args.droppableRects,
        boardRect: boardRef.current?.getBoundingClientRect() ?? null,
        pointer: args.pointerCoordinates,
        activeId: String(args.active.id),
        recentlyMoved: recentlyMovedToNewColumn.current,
      })
      return target !== null ? [{ id: target }] : []
    },
    [board],
  )

  const onDragStart = (event: DragStartEvent): void => {
    snapshot.current = useAppStore.getState().board
    if (event.active.data.current?.type === 'card') {
      setDraggingCardId(String(event.active.id))
    }
  }

  /**
   * 拖拉過程只處理「跨欄」：把卡片搬進目標欄（不存檔），讓目標欄的卡片讓位。
   * 同欄重排交給 SortableContext 的讓位動畫與 onDragEnd，拖曳中不改順序——
   * 若在這裡也改順序，卡片高度不一時同樣會與碰撞偵測互相追逐
   */
  const onDragOver = (event: DragOverEvent): void => {
    const { active, over } = event
    if (!over || active.data.current?.type !== 'card') return

    const cardId = String(active.id)
    const overId = String(over.id)
    if (cardId === overId) return

    const current = useAppStore.getState().board
    const fromColumnId = columnIdOfCard(current, cardId)
    const toColumnId = resolveTargetColumnId(current, overId)
    if (!fromColumnId || !toColumnId || fromColumnId === toColumnId) return

    const toColumn = current.columns.find((c) => c.id === toColumnId)
    if (!toColumn) {
      console.warn('[BoardPane] onDragOver 找不到目標欄位，忽略這次移動', { cardId, overId, toColumnId })
      return
    }
    // 拖曳中的卡片（位移後的矩形）已越過 over 卡片下緣 → 放它後面，否則放前面
    const translated = active.rect.current.translated
    const isBelowOver = translated !== null && translated.top > over.rect.top + over.rect.height
    recentlyMovedToNewColumn.current = true
    previewBoard(moveCardIn(current, cardId, toColumnId, crossColumnInsertIndex(toColumn, overId, isBelowOver)))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setDraggingCardId(null)

    if (!over) {
      // 放開時沒有任何有效放置目標，與 Esc 取消同一類意圖：還原而非把預覽轉正
      if (snapshot.current) restoreBoard(snapshot.current)
      snapshot.current = null
      return
    }
    snapshot.current = null

    const current = useAppStore.getState().board
    const activeId = String(active.id)
    const overId = String(over.id)

    if (active.data.current?.type === 'column') {
      // 碰撞偵測只回報欄位，over 一定是欄位本身
      const toIndex = current.columns.findIndex((c) => c.id === overId)
      if (toIndex !== -1) previewBoard(moveColumnIn(current, activeId, toIndex))
    } else if (activeId !== overId) {
      // 跨欄已在 onDragOver 搬到目標欄；這裡處理同欄內的最終順序（索引語意同 arrayMove）
      const columnId = columnIdOfCard(current, activeId)
      const column = current.columns.find((c) => c.id === columnId)
      const overIndex = column?.cardIds.indexOf(overId) ?? -1
      if (column && overIndex !== -1) previewBoard(moveCardIn(current, activeId, column.id, overIndex))
    }

    commitBoard()
  }

  const onDragCancel = (): void => {
    setDraggingCardId(null)
    if (snapshot.current) restoreBoard(snapshot.current)
    snapshot.current = null
  }

  const submit = (draft: CardDraft): void => {
    if (!dialog) return
    const payload = {
      title: draft.title.trim(),
      cwd: draft.cwd.trim(),
      note: draft.note,
    }
    if (dialog.mode === 'create') {
      addCard(dialog.columnId, payload)
    } else {
      // worktree 是相對於舊 cwd 偵測到的，cwd 換了它就沒意義；不清會永遠蓋住新目錄的 branch
      const cwdChanged = board.cards[dialog.cardId]?.cwd !== payload.cwd
      updateCard(dialog.cardId, cwdChanged ? { ...payload, worktree: null } : payload)
    }
    setDialog(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {/* items-start：欄位依內容決定高度，不被 stretch 拉滿；
          overflow-auto：欄位變高超出可視範圍時能垂直捲動 */}
      <div ref={boardRef} className="flex h-full items-start gap-3 overflow-auto p-3">
        <SortableContext
          items={board.columns.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {board.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              home={home}
              onAddCard={(columnId) => setDialog({ mode: 'create', columnId })}
              onEditCard={(cardId) => setDialog({ mode: 'edit', cardId })}
            />
          ))}
        </SortableContext>

        {/* Electron 不支援 window.prompt()，改用 inline input；
            onBlur 是取消而非確認——新增沒有既有值可回退，誤觸 blur 送出空欄位會很煩 */}
        {addingColumn ? (
          <input
            autoFocus
            value={newColumnTitle}
            onChange={(e) => setNewColumnTitle(e.target.value)}
            onBlur={() => {
              setAddingColumn(false)
              setNewColumnTitle('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const title = newColumnTitle.trim()
                if (title) addColumn(title)
                setAddingColumn(false)
                setNewColumnTitle('')
              }
              if (e.key === 'Escape') {
                setAddingColumn(false)
                setNewColumnTitle('')
              }
            }}
            placeholder="新欄位名稱"
            className="h-9 w-[160px] shrink-0 rounded-lg border border-line bg-card px-2 text-[12px] text-fg outline-none focus:border-line-hover"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingColumn(true)}
            className="h-9 w-[160px] shrink-0 rounded-lg border border-dashed border-line text-[12px] text-fg-dim transition-colors hover:border-line-hover hover:text-fg"
          >
            ＋ 新增欄位
          </button>
        )}

        {dialog && (
          <CardDialog
            card={dialog.mode === 'edit' ? (board.cards[dialog.cardId] ?? null) : null}
            onCancel={() => setDialog(null)}
            onSubmit={submit}
            onDelete={
              dialog.mode === 'edit'
                ? () => {
                    deleteCard(dialog.cardId)
                    setDialog(null)
                  }
                : undefined
            }
          />
        )}
      </div>

      <DragOverlay>
        {draggingCardId && board.cards[draggingCardId] ? (
          <DragCardPreview card={board.cards[draggingCardId]} home={home} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
