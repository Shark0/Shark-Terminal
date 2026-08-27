import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions } from '../../src/main/pty-manager'
import { PtyManager } from '../../src/main/pty-manager'

class FakePty {
  written: string[] = []
  killed: string[] = []
  cols = 0
  rows = 0
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
    this.written.push(data)
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  kill(signal?: string) {
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
  it('以卡片的 cwd 開 login shell，並把 command 寫進去', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp/u19', 'claude', 120, 40)

    expect(created).toHaveLength(1)
    expect(created[0].opts.cwd).toBe('/tmp/u19')
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
  it('kill 送 SIGKILL 並自 Map 移除', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.kill('card_a')

    expect(created[0].killed).toContain('SIGKILL')
    expect(manager.has('card_a')).toBe(false)
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

  it('沒有任何 pty 時立即完成', async () => {
    const { manager } = setup()
    await expect(manager.killAll(500)).resolves.toBeUndefined()
  })
})
