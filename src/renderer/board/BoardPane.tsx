import { useRef, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCorners,
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

/** null 代表對話框關閉；有值時 columnId 為新增目標、cardId 為編輯目標 */
type DialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; cardId: string } | null

interface Props {
  home: string
}

/** 找出卡片目前所在的欄位 id */
function columnIdOfCard(board: Board, cardId: string): string | null {
  return board.columns.find((c) => c.cardIds.includes(cardId))?.id ?? null
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
  const snapshot = useRef<Board | null>(null)

  // 需要一點位移才觸發拖拉，否則單擊卡片會被誤判成拖曳
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const onDragStart = (event: DragStartEvent): void => {
    snapshot.current = useAppStore.getState().board
    if (event.active.data.current?.type === 'card') {
      setDraggingCardId(String(event.active.id))
    }
  }

  /** 拖拉過程即時預覽（不存檔），讓目標欄的卡片會讓位 */
  const onDragOver = (event: DragOverEvent): void => {
    const { active, over } = event
    if (!over || active.data.current?.type !== 'card') return

    const cardId = String(active.id)
    const overId = String(over.id)
    if (cardId === overId) return

    const current = useAppStore.getState().board
    const overColumn = current.columns.find((c) => c.id === overId)

    if (overColumn) {
      // 拖到欄位本身（空欄或欄位空白處）→ 插到末端
      if (columnIdOfCard(current, cardId) === overColumn.id) return
      previewBoard(moveCardIn(current, cardId, overColumn.id, overColumn.cardIds.length))
      return
    }

    const toColumnId = columnIdOfCard(current, overId)
    if (!toColumnId) return
    const toIndex = current.columns
      .find((c) => c.id === toColumnId)!
      .cardIds.indexOf(overId)
    previewBoard(moveCardIn(current, cardId, toColumnId, toIndex))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setDraggingCardId(null)
    snapshot.current = null

    if (!over) {
      commitBoard()
      return
    }

    if (active.data.current?.type === 'column') {
      const current = useAppStore.getState().board
      const toIndex = current.columns.findIndex((c) => c.id === String(over.id))
      if (toIndex !== -1) previewBoard(moveColumnIn(current, String(active.id), toIndex))
    }

    // 卡片位置在 onDragOver 已經預覽到位，這裡只負責落檔
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
      command: draft.command.trim(),
      note: draft.note,
    }
    if (dialog.mode === 'create') addCard(dialog.columnId, payload)
    else updateCard(dialog.cardId, payload)
    setDialog(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-3">
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

        <button
          type="button"
          onClick={() => {
            const title = window.prompt('新欄位名稱')?.trim()
            if (title) addColumn(title)
          }}
          className="h-9 w-[160px] shrink-0 rounded-lg border border-dashed border-line text-[12px] text-fg-dim transition-colors hover:border-line-hover hover:text-fg"
        >
          ＋ 新增欄位
        </button>

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
