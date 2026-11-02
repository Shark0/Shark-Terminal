/**
 * 定期探測 libuv threadpool 是否還在運作。
 *
 * pty 輸入（node-pty 用 fs.write）、讀看板（board:load）、結束前存檔都要經過 threadpool；
 * 它被佔滿時這三件事會同時失效，畫面卻看不出原因。probe 傳入一個走 threadpool 的
 * 非同步操作（例如 fs.stat），探測沒在門檻內回來就記錄下來，留給事後追查。
 *
 * 同一時間只有一個探測在跑：卡住時不再疊新的探測，免得自己也去佔 threadpool。
 */
export class ThreadpoolWatchdog {
  private timer: NodeJS.Timeout | null = null
  /** 進行中探測的開始時間；null 代表目前沒有探測在跑 */
  private startedAt: number | null = null
  /** 這次探測是否已經被報過卡住，恢復時要補一筆 */
  private reportedStuck = false

  constructor(
    private readonly probe: () => Promise<unknown>,
    private readonly intervalMs: number,
    private readonly thresholdMs: number,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    // 看門狗不該讓 app 因為它而延遲結束
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    if (this.startedAt !== null) {
      const stuckMs = Date.now() - this.startedAt
      this.reportedStuck = true
      console.error('[watchdog] threadpool 探測一直沒回來，fs 操作與 pty 輸入可能全部卡住', { stuckMs })
      return
    }

    const startedAt = Date.now()
    this.startedAt = startedAt
    this.reportedStuck = false
    this.probe()
      .then(() => {
        const elapsedMs = Date.now() - startedAt
        if (this.reportedStuck) {
          console.warn('[watchdog] threadpool 已恢復', { elapsedMs })
        } else if (elapsedMs > this.thresholdMs) {
          console.warn('[watchdog] threadpool 探測偏慢', { elapsedMs })
        }
      })
      .catch((err) => {
        console.error('[watchdog] threadpool 探測失敗', { err })
      })
      .finally(() => {
        this.startedAt = null
      })
  }
}
