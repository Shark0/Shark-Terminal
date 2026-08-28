import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions } from '../../src/main/pty-manager'
import { PtyManager } from '../../src/main/pty-manager'

class FakePty {
  written: string[] = []
  killed: string[] = []
  cols = 0
  rows = 0
  /** 測試用開關：設為 true 時 write() 會拋錯，模擬底層 pty 寫入失敗 */
  failWrite = false
  /** 測試用開關：設為 true 時下一次 kill() 呼叫會拋錯（模擬送信號失敗），且用完即消 */
  failNextKill = false
  killCallCount = 0
  private dataCb: ((data: string) => void) | null = null
  private exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null

  constructor(public readonly opts: SpawnOptions) {
    this.cols = opts.cols
    this.rows = opts.rows
  }

  onData(cb: (data: string) => void) {
    this.dataCb = cb
    return { dispose: () => {} }
  }

  onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
    this.exitCb = cb
    return { dispose: () => {} }
  }

  write(data: string) {
    if (this.failWrite) throw new Error('write 失敗（模擬）')
    this.written.push(data)
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  kill(signal?: string) {
    this.killCallCount++
    if (this.failNextKill) {
      this.failNextKill = false
      throw new Error('kill 失敗（模擬）')
    }
    this.killed.push(signal ?? 'SIGHUP')
  }

  emitData(data: string) {
    this.dataCb?.(data)
  }

  emitExit(exitCode: number) {
    this.exitCb?.({ exitCode })
  }
}

function setup() {
  const created: FakePty[] = []
  const spawner = vi.fn((opts: SpawnOptions) => {
    const pty = new FakePty(opts)
    created.push(pty)
    return pty as never
  })
  return { created, manager: new PtyManager(spawner), spawner }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('spawn', () => {
  it('SHELL 環境變數為空字串時 fallback 到 /bin/zsh（?? 對空字串沒有替換效果，須用 ||）', () => {
    const original = process.env.SHELL
    process.env.SHELL = ''
    try {
      const { created, manager } = setup()
      manager.spawn('card_a', '/tmp', 'claude', 80, 24)
      expect(created[0].opts.file).toBe('/bin/zsh')
    } finally {
      if (original === undefined) delete process.env.SHELL
      else process.env.SHELL = original
    }
  })

  it('以卡片的 cwd 開 login shell，並把 command 寫進去', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp/project-a', 'claude', 120, 40)

    expect(created).toHaveLength(1)
    expect(created[0].opts.cwd).toBe('/tmp/project-a')
    expect(created[0].opts.args).toEqual(['-l'])
    expect(created[0].opts.cols).toBe(120)
    expect(created[0].opts.rows).toBe(40)
    expect(created[0].written).toEqual(['claude\n'])
  })

  it('設定 TERM 為 xterm-256color', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    expect(created[0].opts.env.TERM).toBe('xterm-256color')
  })

  it('command 為空字串時不寫入任何東西，只留一個乾淨的 shell', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', '   ', 80, 24)
    expect(created[0].written).toEqual([])
  })

  it('對已存在的 cardId 再次 spawn 會先殺掉舊的（重啟語意）', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    expect(created).toHaveLength(2)
    expect(created[0].killed).toContain('SIGKILL')
    expect(manager.has('card_a')).toBe(true)
  })

  it('重啟後，舊 pty 延遲觸發的 exit 不會影響新 pty', () => {
    const { created, manager } = setup()
    const onExit = vi.fn()
    manager.onExit(onExit)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    // 舊 pty（created[0]）延遲觸發 exit 時，Map 裡已經是新 pty（created[1]），
    // 不該被誤刪、也不該對外廣播一個假的 exit
    created[0].emitExit(0)
    expect(manager.has('card_a')).toBe(true)
    expect(onExit).not.toHaveBeenCalled()

    created[1].emitExit(0)
    expect(manager.has('card_a')).toBe(false)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledWith('card_a', 0)
  })

  it('spawn 寫入 command 失敗時不會 propagate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { created, manager, spawner } = setup()
    spawner.mockImplementationOnce((opts: SpawnOptions) => {
      const pty = new FakePty(opts)
      pty.failWrite = true
      created.push(pty)
      return pty as never
    })

    expect(() => manager.spawn('card_a', '/tmp', 'claude', 80, 24)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('write / resize', () => {
  it('write 轉發到對應的 pty', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.write('card_a', 'ls\n')
    expect(created[0].written).toEqual(['claude\n', 'ls\n'])
  })

  it('resize 轉發到對應的 pty', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.resize('card_a', 200, 50)
    expect(created[0].cols).toBe(200)
    expect(created[0].rows).toBe(50)
  })

  it('對不存在的 cardId 操作時記錄警告而非拋錯', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { manager } = setup()
    expect(() => manager.write('card_nope', 'x')).not.toThrow()
    expect(() => manager.resize('card_nope', 80, 24)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('write 底層拋出時不會 propagate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    created[0].failWrite = true

    expect(() => manager.write('card_a', 'ls\n')).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('事件廣播', () => {
  it('output 帶著 cardId 發出', () => {
    const { created, manager } = setup()
    const onData = vi.fn()
    manager.onData(onData)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    created[0].emitData('hello')
    expect(onData).toHaveBeenCalledWith('card_a', 'hello')
  })

  it('exit 帶著 cardId 與 exitCode 發出，並自 Map 移除', () => {
    const { created, manager } = setup()
    const onExit = vi.fn()
    manager.onExit(onExit)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    created[0].emitExit(0)
    expect(onExit).toHaveBeenCalledWith('card_a', 0)
    expect(manager.has('card_a')).toBe(false)
  })
})

describe('kill', () => {
  it('kill 送出 SIGKILL', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.kill('card_a')

    expect(created[0].killed).toContain('SIGKILL')
    // 程序尚未死透，刻意不在這裡從 Map 移除——移除與廣播統一交給 onExit handler
    expect(manager.has('card_a')).toBe(true)
  })

  it('kill 之後 pty 回報 exit 時，自 Map 移除並廣播', () => {
    const { created, manager } = setup()
    const onExit = vi.fn()
    manager.onExit(onExit)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    manager.kill('card_a')
    created[0].emitExit(0)

    expect(manager.has('card_a')).toBe(false)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledWith('card_a', 0)
  })

  it('對不存在的 cardId 會記錄警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { manager } = setup()
    expect(() => manager.kill('card_nope')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('killAll', () => {
  it('先全部送 SIGTERM，逾時後對仍存活者送 SIGKILL', async () => {
    vi.useFakeTimers()
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.spawn('card_b', '/tmp', 'claude', 80, 24)

    const done = manager.killAll(500)

    expect(created[0].killed).toEqual(['SIGTERM'])
    expect(created[1].killed).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(500)
    await done

    expect(created[0].killed).toEqual(['SIGTERM', 'SIGKILL'])
    expect(created[1].killed).toEqual(['SIGTERM', 'SIGKILL'])
    // killAll 不自己從 Map 移除——與 kill() 同一個契約，移除與廣播統一交給 onExit
    // handler。真實環境下 SIGKILL 保證讓子行程終止、觸發 onExit；這裡用 emitExit
    // 模擬那個回呼，藉此驗證 killAll 確實沒有搶先 delete
    expect(manager.has('card_a')).toBe(true)
    expect(manager.has('card_b')).toBe(true)
    created[0].emitExit(0)
    created[1].emitExit(0)
    expect(manager.has('card_a')).toBe(false)
    expect(manager.has('card_b')).toBe(false)
  })

  it('已自行結束的 pty 不會再被 SIGKILL', async () => {
    vi.useFakeTimers()
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    const done = manager.killAll(500)
    created[0].emitExit(0)

    await vi.advanceTimersByTimeAsync(500)
    await done

    expect(created[0].killed).toEqual(['SIGTERM'])
  })

  it('killAll 送出 SIGKILL 後 pty 觸發 exit，仍會正確廣播——這是未來重用 killAll（例如「停止全部」按鈕）時，卡片狀態能正確更新為已停止的前提', async () => {
    vi.useFakeTimers()
    const { created, manager } = setup()
    const onExit = vi.fn()
    manager.onExit(onExit)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    const done = manager.killAll(500)
    await vi.advanceTimersByTimeAsync(500)
    await done

    created[0].emitExit(0)

    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledWith('card_a', 0)
  })

  it('沒有任何 pty 時立即完成', async () => {
    const { manager } = setup()
    await expect(manager.killAll(500)).resolves.toBeUndefined()
  })

  it('spawn 覆蓋時若 kill 舊 pty 失敗，killAll 仍會再次嘗試終止它，不留孤兒', async () => {
    const { created, manager } = setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    created[0].failNextKill = true
    manager.spawn('card_a', '/tmp', 'claude', 80, 24) // 觸發覆蓋前的 kill，這次會拋錯

    expect(created).toHaveLength(2)
    // 第一次 kill 因為 failNextKill 而拋錯，沒有真的送出信號
    expect(created[0].killed).toEqual([])
    expect(created[0].killCallCount).toBe(1)

    // timeoutMs 用小值，避免真實計時器拖慢測試——孤兒重試邏輯跟計時器等待無關
    await manager.killAll(10)

    // killAll 應該再嘗試一次舊 pty 的 kill（這次不會拋錯，因為 failNextKill 已消耗）
    expect(created[0].killCallCount).toBe(2)
    expect(created[0].killed).toContain('SIGKILL')

    warn.mockRestore()
  })
})
