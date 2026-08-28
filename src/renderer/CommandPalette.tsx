import { useEffect, useMemo, useState } from 'react'
import type { Card } from '@shared/types'
import StatusDot from './board/StatusDot'
import { shortenPath } from './board/CardItem'
import { clampCursor } from './cursor'
import { fuzzyMatch } from './fuzzy'
import { useAppStore } from './store/app-store'

interface Props {
  onClose: () => void
  home: string
}

// 由 App.tsx 用 {paletteOpen && <CommandPalette .../>} 條件渲染，不再接收 open prop——
// 每次開啟都是全新掛載，query/cursor 的初始值天然乾淨，不需要額外的重置 useEffect，
// 也順帶修掉「開啟瞬間有一幀顯示上次搜尋字串」的問題。關閉時整個卸載，board/ptyStatus
// 的訂閱與 rows 的 useMemo 不會在關閉期間跟著每次看板變動（拖拉、狀態輪詢）重算
export default function CommandPalette({ onClose, home }: Props): JSX.Element {
  const board = useAppStore((s) => s.board)
  const ptyStatus = useAppStore((s) => s.ptyStatus)
  const setActiveCard = useAppStore((s) => s.setActiveCard)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  /** 依看板順序列出卡片，並附上所屬欄位名稱 */
  const rows = useMemo(() => {
    const all: Array<{ card: Card; columnTitle: string }> = []
    for (const column of board.columns) {
      for (const cardId of column.cardIds) {
        const card = board.cards[cardId]
        if (card) all.push({ card, columnTitle: column.title })
        else
          console.warn('[CommandPalette] 欄位含有查無對應卡片的 id，已略過', {
            columnId: column.id,
            cardId,
          })
      }
    }
    return all.filter(
      ({ card }) => fuzzyMatch(query, card.title) || fuzzyMatch(query, card.cwd),
    )
  }, [board, query])

  useEffect(() => {
    setCursor((c) => clampCursor(c, rows.length))
  }, [rows.length])

  const choose = (cardId: string): void => {
    setActiveCard(cardId)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]" onClick={onClose}>
      <div
        className="w-[520px] overflow-hidden rounded-lg border border-line bg-column"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const row = rows[cursor]
              if (row) choose(row.card.id)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="搜尋卡片標題或路徑…"
          className="w-full border-b border-line bg-column px-4 py-3 text-[14px] text-fg outline-none"
        />

        <div className="max-h-[320px] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-fg-dim">沒有符合的卡片</div>
          ) : (
            rows.map((row, index) => (
              <button
                key={row.card.id}
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(row.card.id)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left ${
                  index === cursor ? 'bg-card' : ''
                }`}
              >
                <StatusDot status={ptyStatus[row.card.id]} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{row.card.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-dim">
                  {shortenPath(row.card.cwd, home)}
                </span>
                <span className="shrink-0 text-[11px] text-fg-dim">{row.columnTitle}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
