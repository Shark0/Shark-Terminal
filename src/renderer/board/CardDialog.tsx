import { useEffect, useState } from 'react'
import type { Card } from '@shared/types'

export interface CardDraft {
  title: string
  cwd: string
  command: string
  note: string
}

interface Props {
  /** 有值代表編輯既有卡片，null 代表新增 */
  card: Card | null
  onCancel: () => void
  onSubmit: (draft: CardDraft) => void
  onDelete?: () => void
}

export default function CardDialog({ card, onCancel, onSubmit, onDelete }: Props): JSX.Element {
  const [draft, setDraft] = useState<CardDraft>({
    title: card?.title ?? '',
    cwd: card?.cwd ?? '',
    command: card?.command ?? 'claude',
    note: card?.note ?? '',
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const pickDirectory = async (): Promise<void> => {
    try {
      const picked = await window.gc.dialog.pickDirectory()
      if (picked) setDraft((d) => ({ ...d, cwd: picked }))
    } catch (err) {
      console.warn('[CardDialog] 選擇目錄失敗', { err })
    }
  }

  const canSubmit = draft.title.trim() !== '' && draft.cwd.trim() !== ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="w-[440px] rounded-lg border border-line bg-column p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[15px] text-fg">{card ? '編輯卡片' : '新增卡片'}</h2>

        <label className="mb-1 block text-[11px] text-fg-dim">標題（必填）</label>
        <input
          autoFocus
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="some feature"
          className="mb-3 w-full rounded border border-line bg-card px-2 py-1.5 text-[13px] text-fg outline-none focus:border-line-hover"
        />

        <label className="mb-1 block text-[11px] text-fg-dim">工作目錄（必填）</label>
        <div className="mb-3 flex gap-2">
          <input
            value={draft.cwd}
            onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
            placeholder="/Users/…"
            className="min-w-0 flex-1 rounded border border-line bg-card px-2 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-line-hover"
          />
          <button
            type="button"
            onClick={() => void pickDirectory()}
            className="shrink-0 rounded border border-line px-3 text-[12px] text-fg-dim transition-colors hover:text-fg"
          >
            選擇…
          </button>
        </div>

        <label className="mb-1 block text-[11px] text-fg-dim">啟動指令</label>
        <input
          value={draft.command}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
          placeholder="claude"
          className="w-full rounded border border-line bg-card px-2 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-line-hover"
        />
        <p className="mb-3 text-[11px] leading-4 text-fg-dim">
          留空則只開啟 shell，不自動執行任何指令
        </p>

        <label className="mb-1 block text-[11px] text-fg-dim">備註</label>
        <textarea
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          rows={3}
          className="mb-4 w-full resize-none rounded border border-line bg-card px-2 py-1.5 text-[12px] text-fg outline-none focus:border-line-hover"
        />

        {!canSubmit && (
          <p className="mb-2 text-[11px] leading-4 text-fg-dim">標題與工作目錄為必填</p>
        )}

        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('確定刪除這張卡片？終端機也會一併關閉。')) onDelete()
              }}
              className="mr-auto rounded px-2 py-1.5 text-[12px] text-fg-dim transition-colors hover:text-fg"
            >
              刪除
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:text-fg"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(draft)}
            className="rounded bg-card px-3 py-1.5 text-[12px] text-fg transition-opacity disabled:opacity-40"
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  )
}
