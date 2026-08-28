import type { PtyStatus } from '@shared/types'

const STYLE: Record<PtyStatus, { className: string; label: string; breathe: boolean }> = {
  running: { className: 'bg-running', label: '執行中', breathe: true },
  idle: { className: 'bg-idle', label: '閒置', breathe: false },
  stopped: { className: 'bg-stopped', label: '已停止', breathe: false },
}

interface Props {
  /** undefined 代表從未啟動過，視覺上與 stopped 相同 */
  status: PtyStatus | undefined
}

export default function StatusDot({ status }: Props): JSX.Element {
  const style = STYLE[status ?? 'stopped']
  return (
    <span
      title={status === undefined ? '尚未啟動' : style.label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.className} ${style.breathe ? 'animate-breathe' : ''}`}
    />
  )
}
