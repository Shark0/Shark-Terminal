import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadpoolWatchdog } from '../../src/main/threadpool-watchdog'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ThreadpoolWatchdog', () => {
  it('探測很快完成時不記錄任何東西', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dog = new ThreadpoolWatchdog(() => Promise.resolve(), 1000, 500)
    dog.start()
    await vi.advanceTimersByTimeAsync(3000)
    dog.stop()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('探測完成但超過門檻時記 warn，帶耗時', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const probe = () => new Promise<void>((resolve) => setTimeout(resolve, 800))
    const dog = new ThreadpoolWatchdog(probe, 1000, 500)
    dog.start()
    await vi.advanceTimersByTimeAsync(1000 + 800)
    dog.stop()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('threadpool'), expect.objectContaining({ elapsedMs: 800 }))
  })

  it('探測一直沒回來時，每輪記 error 並累計卡住時間，不重複發新的探測', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const probe = vi.fn(() => new Promise<void>(() => {}))
    const dog = new ThreadpoolWatchdog(probe, 1000, 500)
    dog.start()
    await vi.advanceTimersByTimeAsync(3000)
    dog.stop()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('threadpool'), expect.objectContaining({ stuckMs: 2000 }))
  })

  it('卡住後恢復時記一筆 warn，之後重新開始探測', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let release: () => void = () => {}
    const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const dog = new ThreadpoolWatchdog(probe, 1000, 500)
    dog.start()
    await vi.advanceTimersByTimeAsync(2500)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('恢復'), expect.objectContaining({ elapsedMs: 1500 }))
    await vi.advanceTimersByTimeAsync(500)
    dog.stop()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('探測 reject 時記 error，不讓例外外漏', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dog = new ThreadpoolWatchdog(() => Promise.reject(new Error('EIO')), 1000, 500)
    dog.start()
    await vi.advanceTimersByTimeAsync(1000)
    dog.stop()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('探測失敗'), expect.objectContaining({ err: expect.any(Error) }))
  })

  it('卡住超過通報門檻時呼叫 onStuck 一次，之後同一次卡住不再呼叫', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onStuck = vi.fn()
    const dog = new ThreadpoolWatchdog(() => new Promise<void>(() => {}), 1000, 500, { alertMs: 2000, onStuck })
    dog.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(onStuck).not.toHaveBeenCalled()
    expect(dog.isStuck).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStuck).toHaveBeenCalledTimes(1)
    expect(onStuck).toHaveBeenCalledWith(2000)
    await vi.advanceTimersByTimeAsync(5000)
    dog.stop()
    expect(onStuck).toHaveBeenCalledTimes(1)
  })

  it('恢復後 isStuck 變回 false，下一次卡住會再通報', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onStuck = vi.fn()
    let release: () => void = () => {}
    const probe = () => new Promise<void>((resolve) => { release = resolve })
    const dog = new ThreadpoolWatchdog(probe, 1000, 500, { alertMs: 1000, onStuck })
    dog.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(onStuck).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(dog.isStuck).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    dog.stop()
    expect(onStuck).toHaveBeenCalledTimes(2)
  })

  it('onStuck 丟例外時記 error，看門狗照常運作', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dog = new ThreadpoolWatchdog(() => new Promise<void>(() => {}), 1000, 500, {
      alertMs: 1000,
      onStuck: () => {
        throw new Error('boom')
      },
    })
    dog.start()
    await vi.advanceTimersByTimeAsync(3000)
    dog.stop()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('onStuck'), expect.objectContaining({ err: expect.any(Error) }))
  })
})
