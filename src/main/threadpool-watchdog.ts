/**
 * 定期探測 libuv threadpool 是否還在運作。
 *
 * pty 輸入（node-pty 用 fs.write）、讀看板（board:load）、結束前存檔都要經過 threadpool；
 * 它被佔滿時這三件事會同時失效，畫面卻看不出原因。probe 傳入一個走 threadpool 的
 * 非同步操作（例如 fs.stat），探測沒在門檻內回來就記錄下來，留給事後追查。
 *
 * 同一時間只有一個探測在跑：卡住時不再疊新的探測，免得自己也去佔 threadpool。
 */
export interface StuckAlert {
  /** 卡住多久才通報；每次卡住只通報一次，恢復後再卡住會重新計算 */
  alertMs: number
  /** 收到通報時 threadpool 仍卡著：callback 裡不可依賴非同步 fs，要用同步 I/O 或子程序 */
  onStuck: (stuckMs: number) => void
}

export class ThreadpoolWatchdog {
  private timer: NodeJS.Timeout | null = null
  /** 進行中探測的開始時間；null 代表目前沒有探測在跑 */
  private startedAt: number | null = null
  /** 這次探測是否已經被報過卡住，恢復時要補一筆 */
  private reportedStuck = false
  /** 這次卡住是否已經呼叫過 onStuck */
  private alerted = false

  constructor(
    private readonly probe: () => Promise<unknown>,
    private readonly intervalMs: number,
    private readonly thresholdMs: number,
    private readonly stuckAlert: StuckAlert | null = null,
  ) {}

  /** 目前的探測是否已被判定卡住（至少一輪沒回來）；恢復後變回 false */
  get isStuck(): boolean {
    return this.startedAt !== null && this.reportedStuck
  }

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
      if (this.stuckAlert && !this.alerted && stuckMs >= this.stuckAlert.alertMs) {
        this.alerted = true
        try {
          this.stuckAlert.onStuck(stuckMs)
        } catch (err) {
          console.error('[watchdog] onStuck 處理失敗', { stuckMs, err })
        }
      }
      return
    }

    const startedAt = Date.now()
    this.startedAt = startedAt
    this.reportedStuck = false
    this.alerted = false
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
