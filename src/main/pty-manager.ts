import type { IPty } from 'node-pty'

export interface SpawnOptions {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: NodeJS.ProcessEnv
}

export type PtySpawner = (opts: SpawnOptions) => IPty

const KILL_TIMEOUT_MS = 500

/** 所有 pty 的唯一擁有者。spawner 由外部注入，測試才能替換成 fake。 */
export class PtyManager {
  private readonly ptys = new Map<string, IPty>()
  private dataCb: ((cardId: string, data: string) => void) | null = null
  private exitCb: ((cardId: string, exitCode: number) => void) | null = null

  constructor(private readonly spawner: PtySpawner) {}

  /**
   * 開一個 login shell 並把卡片的 command 寫進去。
   * 不直接 spawn command 的原因：login shell 才有完整 PATH，
   * 且 Claude 結束後會回到 shell prompt，pty 不會跟著消失。
   */
  spawn(cardId: string, cwd: string, command: string, cols: number, rows: number): void {
    if (this.ptys.has(cardId)) {
      console.warn('[pty-manager] cardId 已有 pty，先關閉舊的再重建', { cardId })
      this.kill(cardId)
    }

    const shell = process.env.SHELL ?? '/bin/zsh'
    const pty = this.spawner({
      file: shell,
      args: ['-l'],
      cwd,
      cols,
      rows,
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    pty.onData((data) => this.dataCb?.(cardId, data))
    pty.onExit(({ exitCode }) => {
      // 舊 pty 被重啟取代後才回報 exit 時，Map 裡已經是新的 pty。
      // 只有仍是持有者的 pty 才能清除紀錄與對外廣播，否則會誤刪新 pty 並誤報已結束。
      if (this.ptys.get(cardId) !== pty) return
      this.ptys.delete(cardId)
      this.exitCb?.(cardId, exitCode)
    })

    this.ptys.set(cardId, pty)

    const trimmed = command.trim()
    if (trimmed) {
      try {
        pty.write(`${trimmed}\n`)
      } catch (err) {
        console.warn('[pty-manager] 寫入初始 command 失敗', { cardId, err })
      }
    }
  }

  write(cardId: string, data: string): void {
    const pty = this.ptys.get(cardId)
    if (!pty) {
      console.warn('[pty-manager] write 找不到對應的 pty，忽略此次輸入', { cardId })
      return
    }
    try {
      pty.write(data)
    } catch (err) {
      console.warn('[pty-manager] write 失敗', { cardId, err })
    }
  }

  resize(cardId: string, cols: number, rows: number): void {
    const pty = this.ptys.get(cardId)
    if (!pty) {
      console.warn('[pty-manager] resize 找不到對應的 pty，忽略此次調整', { cardId })
      return
    }
    try {
      pty.resize(cols, rows)
    } catch (err) {
      console.warn('[pty-manager] resize 失敗', { cardId, cols, rows, err })
    }
  }

  kill(cardId: string): void {
    const pty = this.ptys.get(cardId)
    if (!pty) {
      console.warn('[pty-manager] kill 找不到對應的 pty，可能已結束或 cardId 有誤', { cardId })
      return
    }
    // 不在這裡從 Map 移除：移除與 exit 廣播統一由 onExit handler 處理，
    // 否則身分比對會因為 Map 已無此 cardId 而失敗，導致主動 kill 永遠不廣播 exit
    try {
      pty.kill('SIGKILL')
    } catch (err) {
      console.warn('[pty-manager] kill 失敗', { cardId, err })
    }
  }

  /** app 結束時呼叫：全部 SIGTERM，逾時後對仍存活者 SIGKILL */
  async killAll(timeoutMs: number = KILL_TIMEOUT_MS): Promise<void> {
    const ids = [...this.ptys.keys()]
    if (ids.length === 0) return

    for (const id of ids) {
      try {
        this.ptys.get(id)?.kill('SIGTERM')
      } catch (err) {
        console.warn('[pty-manager] 送出 SIGTERM 失敗', { cardId: id, err })
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))

    for (const id of ids) {
      const pty = this.ptys.get(id)
      if (!pty) continue
      this.ptys.delete(id)
      try {
        pty.kill('SIGKILL')
      } catch (err) {
        console.warn('[pty-manager] 送出 SIGKILL 失敗', { cardId: id, err })
      }
    }
  }

  has(cardId: string): boolean {
    return this.ptys.has(cardId)
  }

  onData(cb: (cardId: string, data: string) => void): void {
    this.dataCb = cb
  }

  onExit(cb: (cardId: string, exitCode: number) => void): void {
    this.exitCb = cb
  }
}
