import type { Card, PtyStatus } from '@shared/types'
import { shortenPath } from '../board/path-utils'
import { useAppStore } from '../store/app-store'

interface Props {
  card: Card
  status: PtyStatus | undefined
  home: string
}

export default function TerminalHeader({ card, status, home }: Props): JSX.Element {
  const startPty = useAppStore((s) => s.startPty)
  const stopPty = useAppStore((s) => s.stopPty)
  const branch = useAppStore((s) => s.branches[card.cwd])
  const alive = status === 'running' || status === 'idle'

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
      <span className="shrink-0 truncate text-[13px] text-fg">{card.title}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim">
        {shortenPath(card.cwd, home)}
      </span>
      {branch && (
        <span className="shrink-0 truncate rounded bg-base px-1 text-[10px] text-fg-dim" title={branch}>
          {branch}
        </span>
      )}
      {alive ? (
        <>
          <button
            type="button"
            onClick={() => void startPty(card.id)}
            className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors hover:text-fg"
          >
            重啟
          </button>
          <button
            type="button"
            onClick={() => stopPty(card.id)}
            className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors hover:text-fg"
          >
            停止
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void startPty(card.id)}
          className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-fg transition-colors hover:border-line-hover"
        >
          啟動
        </button>
      )}
    </div>
  )
}
