import { useAppStore } from './store/app-store'

/** 看板檔損毀並被回退、目前為唯讀模式、或寫入曾經失敗時顯示，讓使用者知道發生了什麼 */
export default function RecoveryNotice(): JSX.Element | null {
  const notice = useAppStore((s) => s.recoveryNotice)
  const readOnly = useAppStore((s) => s.readOnlyNotice)
  const writeFailed = useAppStore((s) => s.writeFailedNotice)
  const dismiss = useAppStore((s) => s.dismissRecoveryNotice)

  // 一旦寫入失敗過就不會自動消失——不要因為下一次寫入碰巧成功就悄悄隱藏，
  // 使用者必須確實看到才知道要處理磁碟空間或權限問題
  if (writeFailed) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-column px-3 py-2 text-[12px]">
        <span className="min-w-0 flex-1 text-fg">
          <span className="text-danger">⚠ 儲存失敗</span>
          ：看板變更無法寫入磁碟，請檢查 ~/.sharkterminal 的權限與磁碟空間。
        </span>
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-column px-3 py-2 text-[12px]">
        <span className="min-w-0 flex-1 text-fg">
          <span className="text-danger">⚠ 唯讀模式</span>
          ：看板檔案讀取失敗，目前的任何變更都不會被儲存。請檢查 ~/.sharkterminal/board.json 的權限後重新啟動。
        </span>
      </div>
    )
  }

  if (!notice) return null

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-column px-3 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-fg">
        看板檔案損毀，已回退為預設看板。原始內容備份於{' '}
        <span className="font-mono text-fg-dim">{notice}</span>
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded border border-line px-2 py-0.5 text-fg-dim transition-colors hover:text-fg"
      >
        知道了
      </button>
    </div>
  )
}
