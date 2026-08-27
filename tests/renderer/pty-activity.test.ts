import { beforeEach, describe, expect, it } from 'vitest'
import {
  IDLE_THRESHOLD_MS,
  clearActivity,
  computeStatus,
  markOutput,
} from '../../src/renderer/store/pty-activity'

beforeEach(() => {
  clearActivity('card_a')
})

describe('computeStatus', () => {
  it('pty 不存活時一律為 stopped，即使剛有輸出', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', false, 1000)).toBe('stopped')
  })

  it('存活但從未有輸出時為 idle', () => {
    expect(computeStatus('card_a', true, 1000)).toBe('idle')
  })

  it('門檻內有輸出時為 running', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', true, 1000 + IDLE_THRESHOLD_MS - 1)).toBe('running')
  })

  it('剛好達到門檻時轉為 idle', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', true, 1000 + IDLE_THRESHOLD_MS)).toBe('idle')
  })

  it('超過門檻後為 idle，再次輸出又轉回 running', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', true, 5000)).toBe('idle')
    markOutput('card_a', 5000)
    expect(computeStatus('card_a', true, 5100)).toBe('running')
  })

  it('clearActivity 後回到從未輸出的狀態', () => {
    markOutput('card_a', 1000)
    clearActivity('card_a')
    expect(computeStatus('card_a', true, 1100)).toBe('idle')
  })

  it('門檻為 spec 定義的 2000ms', () => {
    expect(IDLE_THRESHOLD_MS).toBe(2000)
  })
})
