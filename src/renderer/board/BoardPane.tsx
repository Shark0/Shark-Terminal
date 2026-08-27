import { useState } from 'react'
import { useAppStore } from '../store/app-store'
import CardDialog, { type CardDraft } from './CardDialog'
import Column from './Column'

/** null 代表對話框關閉；有值時 columnId 為新增目標、cardId 為編輯目標 */
type DialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; cardId: string } | null

interface Props {
  home: string
}

export default function BoardPane({ home }: Props): JSX.Element {
  const columns = useAppStore((s) => s.board.columns)
  const cards = useAppStore((s) => s.board.cards)
  const addCard = useAppStore((s) => s.addCard)
  const updateCard = useAppStore((s) => s.updateCard)
  const deleteCard = useAppStore((s) => s.deleteCard)
  const addColumn = useAppStore((s) => s.addColumn)
  const [dialog, setDialog] = useState<DialogState>(null)

  const submit = (draft: CardDraft): void => {
    if (!dialog) return
    if (dialog.mode === 'create') {
      addCard(dialog.columnId, {
        title: draft.title.trim(),
        cwd: draft.cwd.trim(),
        command: draft.command.trim(),
        note: draft.note,
      })
    } else {
      updateCard(dialog.cardId, {
        title: draft.title.trim(),
        cwd: draft.cwd.trim(),
        command: draft.command.trim(),
        note: draft.note,
      })
    }
    setDialog(null)
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {columns.map((column) => (
        <Column
          key={column.id}
          column={column}
          home={home}
          onAddCard={(columnId) => setDialog({ mode: 'create', columnId })}
          onEditCard={(cardId) => setDialog({ mode: 'edit', cardId })}
        />
      ))}

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
          card={dialog.mode === 'edit' ? (cards[dialog.cardId] ?? null) : null}
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
  )
}
