import type { PtyStatus } from '@shared/types'

const STYLE: Record<PtyStatus, { className: string; label: string; pulse: boolean }> = {
  running: { className: 'bg-running', label: '執行中', pulse: true },
  idle: { className: 'bg-idle', label: '閒置', pulse: false },
  stopped: { className: 'bg-stopped', label: '已停止', pulse: false },
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
      className="relative inline-flex h-2 w-2 shrink-0"
    >
      {/* 脈衝環用絕對定位 + transform 放大，不佔版面空間，否則卡片標題會被擠掉。
          放大後最多外擴 5.6px（8px × 2.4 的一半再扣掉自身半徑），
          小於卡片 12px 的左右內距與列高的 6px 上下餘裕，不會被欄位的
          overflow-y-auto 裁掉 */}
      {style.pulse && (
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full ${style.className} animate-ping-ring`}
        />
      )}
      {/* relative 讓圓點疊在脈衝環之上，否則環淡出時會蓋掉圓點本身 */}
      <span className={`relative inline-block h-2 w-2 rounded-full ${style.className}`} />
    </span>
  )
}
