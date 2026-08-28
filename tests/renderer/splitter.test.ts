import { describe, expect, it } from 'vitest'
import { computeRatio } from '../../src/renderer/splitter-math'

/**
 * 驗證方式：用 computeRatio 算出的 ratio 反推分隔線中心的絕對 y 座標，
 * 與原始的 clientY 比對，誤差應在 2px 內（驗收標準見 Splitter.tsx 的推導註解）。
 */
function splitterCenterYAfter(
  clientY: number,
  containerTop: number,
  containerHeight: number,
  splitterHeight: number,
): number {
  const ratio = computeRatio(clientY, containerTop, containerHeight, splitterHeight)
  const freeSpace = containerHeight - splitterHeight
  const boardHeight = freeSpace * ratio
  return containerTop + boardHeight + splitterHeight / 2
}

describe('computeRatio', () => {
  it('視窗 900px、無橫幅、游標在中間：分隔線中心對準游標，誤差在 2px 內', () => {
    // 900px 視窗扣掉 28px 拖曳條，容器（看板區+分隔線+終端機區）就是剩下的 872px
    const containerTop = 28
    const containerHeight = 872
    const splitterHeight = 4
    const clientY = 450

    const centerY = splitterCenterYAfter(clientY, containerTop, containerHeight, splitterHeight)
    expect(Math.abs(centerY - clientY)).toBeLessThan(2)
  })

  it('游標偏上（但未觸發 clamp）時誤差同樣在 2px 內', () => {
    const containerTop = 28
    const containerHeight = 872
    const splitterHeight = 4
    const clientY = 300

    const centerY = splitterCenterYAfter(clientY, containerTop, containerHeight, splitterHeight)
    expect(Math.abs(centerY - clientY)).toBeLessThan(2)
  })

  it('RecoveryNotice 橫幅出現、容器 top 往下推移時誤差同樣在 2px 內', () => {
    // 橫幅高度隨內容變動，這裡假設 36px，重點是這個數字完全不需要寫進 Splitter 的算式
    const containerTop = 28 + 36
    const containerHeight = 900 - 28 - 36
    const splitterHeight = 4
    const clientY = 500

    const centerY = splitterCenterYAfter(clientY, containerTop, containerHeight, splitterHeight)
    expect(Math.abs(centerY - clientY)).toBeLessThan(2)
  })

  it('游標超出可視範圍時 clamp 在 [0.2, 0.8]，不會產生非法比例', () => {
    expect(computeRatio(-100, 28, 872, 4)).toBe(0.2)
    expect(computeRatio(100000, 28, 872, 4)).toBe(0.8)
  })
})
