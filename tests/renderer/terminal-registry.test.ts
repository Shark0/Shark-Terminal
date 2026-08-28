// 補上 renderer 的 window.gc 型別擴充：tsconfig.node.json 未 include src/renderer/**，
// 少了這行 window.gc 會被 @types/node 內建的 `declare var gc` 蓋掉導致 typecheck 失敗。
/// <reference path="../../src/renderer/global.d.ts" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disposeTerminal,
  ensureTerminal,
  fitAndSync,
  getTerminal,
  hasTerminal,
} from '../../src/renderer/terminal/terminal-registry'

const gc = {
  pty: { write: vi.fn(), resize: vi.fn() },
}

vi.stubGlobal('window', { gc })

beforeEach(() => {
  gc.pty.write.mockReset()
  gc.pty.resize.mockReset()
})

describe('ensureTerminal', () => {
  it('同一個 cardId 第二次呼叫回傳同一個實例（不會重複建立 xterm）', () => {
    const first = ensureTerminal('card_a')
    const second = ensureTerminal('card_a')

    expect(second).toBe(first)

    disposeTerminal('card_a')
  })

  it('不同 cardId 各自拿到獨立實例', () => {
    const a = ensureTerminal('card_x')
    const b = ensureTerminal('card_y')

    expect(a).not.toBe(b)
    expect(a.term).not.toBe(b.term)

    disposeTerminal('card_x')
    disposeTerminal('card_y')
  })
})

describe('hasTerminal / getTerminal / disposeTerminal', () => {
  it('建立後 hasTerminal 為 true，dispose 後變回 false 且 getTerminal 回傳 undefined', () => {
    ensureTerminal('card_dispose')
    expect(hasTerminal('card_dispose')).toBe(true)

    disposeTerminal('card_dispose')

    expect(hasTerminal('card_dispose')).toBe(false)
    expect(getTerminal('card_dispose')).toBeUndefined()
  })

  it('對不存在的 cardId 呼叫 disposeTerminal 不拋錯', () => {
    expect(() => disposeTerminal('card_never_existed')).not.toThrow()
  })
})

describe('fitAndSync', () => {
  it('對不存在的 cardId 呼叫時安靜返回，不呼叫 pty.resize', () => {
    fitAndSync('card_never_existed')

    expect(gc.pty.resize).not.toHaveBeenCalled()
  })

  it('fit 成功後把 cols/rows 傳給 pty.resize', () => {
    const { term } = ensureTerminal('card_fit')

    fitAndSync('card_fit')

    expect(gc.pty.resize).toHaveBeenCalledWith('card_fit', term.cols, term.rows)

    disposeTerminal('card_fit')
  })
})
