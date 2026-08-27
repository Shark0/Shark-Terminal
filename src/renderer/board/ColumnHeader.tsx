import { useState } from 'react'
import type { Column } from '@shared/types'
import { useAppStore } from '../store/app-store'

interface Props {
  column: Column
  onAddCard: () => void
}

export default function ColumnHeader({ column, onAddCard }: Props): JSX.Element {
  const updateColumn = useAppStore((s) => s.updateColumn)
  const deleteColumn = useAppStore((s) => s.deleteColumn)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(column.title)

  const commit = (): void => {
    const title = draft.trim()
    if (title && title !== column.title) updateColumn(column.id, { title })
    else setDraft(column.title)
    setEditing(false)
  }

  return (
    <div className="shrink-0">
      <div className="h-[3px] rounded-full" style={{ backgroundColor: column.color }} />
      <div className="flex items-center gap-2 px-1 py-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(column.title)
                setEditing(false)
              }
            }}
            className="min-w-0 flex-1 rounded border border-line bg-card px-1 text-[13px] text-fg outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-fg"
            title="雙擊可改名"
          >
            {column.title}
          </button>
        )}
        <span className="shrink-0 text-[11px] text-fg-dim">{column.cardIds.length}</span>
        <button
          type="button"
          onClick={onAddCard}
          title="新增卡片"
          className="shrink-0 px-1 text-fg-dim transition-colors hover:text-fg"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => {
            const count = column.cardIds.length
            const message =
              count === 0
                ? `確定刪除欄位「${column.title}」？`
                : `確定刪除欄位「${column.title}」？欄內 ${count} 張卡片與其終端機都會一併關閉。`
            if (window.confirm(message)) deleteColumn(column.id)
          }}
          title="刪除欄位"
          className="shrink-0 px-1 text-fg-dim opacity-0 transition-opacity hover:text-fg group-hover/column:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  )
}
