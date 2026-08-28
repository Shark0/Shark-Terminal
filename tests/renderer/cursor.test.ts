import { describe, expect, it } from 'vitest'
import { clampCursor } from '../../src/renderer/cursor'

describe('clampCursor', () => {
  it('超出上界時夾到最後一列', () => {
    expect(clampCursor(5, 3)).toBe(2)
  })

  it('負數游標夾回 0（下界，避免 Enter 靜默失效的核心案例）', () => {
    expect(clampCursor(-1, 3)).toBe(0)
  })

  it('空列表時負數游標也夾回 0', () => {
    expect(clampCursor(-1, 0)).toBe(0)
  })

  it('空列表時 0 維持 0', () => {
    expect(clampCursor(0, 0)).toBe(0)
  })

  it('游標在範圍內時不變動', () => {
    expect(clampCursor(1, 3)).toBe(1)
  })
})
