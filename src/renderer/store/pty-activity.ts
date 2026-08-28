import type { PtyStatus } from '@shared/types'

/** 最近一次輸出距今超過這個時間即視為 idle */
export const IDLE_THRESHOLD_MS = 2000

/**
 * 最後輸出時間存在 module-level Map 而非 zustand。
 * pty 的 data 事件一秒可能上百次，逐次 set state 會讓整個看板狂重繪。
 */
const lastOutputAt = new Map<string, number>()

export function markOutput(cardId: string, now: number): void {
  lastOutputAt.set(cardId, now)
}

export function clearActivity(cardId: string): void {
  lastOutputAt.delete(cardId)
}

export function computeStatus(cardId: string, alive: boolean, now: number): PtyStatus {
  if (!alive) return 'stopped'
  const last = lastOutputAt.get(cardId)
  if (last === undefined) return 'idle'
  return now - last < IDLE_THRESHOLD_MS ? 'running' : 'idle'
}
