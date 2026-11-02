import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWithDeadline } from '../../src/main/deadline'

afterEach(() => {
  vi.useRealTimers()
})

describe('runWithDeadline', () => {
  it('工作在期限內完成時回報 done', async () => {
    await expect(runWithDeadline(Promise.resolve(), 1000)).resolves.toBe('done')
  })

  it('工作永遠不結束時，期限到就回報 timeout', async () => {
    vi.useFakeTimers()
    const result = runWithDeadline(new Promise<void>(() => {}), 3000)
    await vi.advanceTimersByTimeAsync(3000)
    await expect(result).resolves.toBe('timeout')
  })

  it('工作 reject 時照樣往外拋，讓呼叫端記錄錯誤', async () => {
    await expect(runWithDeadline(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom')
  })
})
