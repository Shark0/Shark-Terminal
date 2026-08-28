import { describe, expect, it } from 'vitest'
import { shortenPath } from '../../src/renderer/board/path-utils'

describe('shortenPath', () => {
  it('cwd 在家目錄底下時縮寫成 ~', () => {
    expect(shortenPath('/Users/shark/proj', '/Users/shark')).toBe('~/proj')
  })

  it('cwd 完全等於家目錄時縮寫成 ~', () => {
    expect(shortenPath('/Users/shark', '/Users/shark')).toBe('~')
  })

  it('必須檢查分隔符邊界：/Users/sharkbait 不可被誤判成家目錄底下', () => {
    // 錯誤實作會用 startsWith(home) 比對，讓 '/Users/sharkbait/proj' 被切成 '~bait/proj'。
    // 正確行為是不縮寫成 ~，但路徑本身有 4 段（超過 3），仍會走「只留最後兩層」的截斷邏輯
    const result = shortenPath('/Users/sharkbait/proj', '/Users/shark')
    expect(result).not.toBe('~bait/proj')
    expect(result).toBe('…/sharkbait/proj')
  })

  it('分隔符邊界檢查：路徑段數不多時，未被誤判的路徑會原樣回傳', () => {
    expect(shortenPath('/sharkbait', '/Users/shark')).toBe('/sharkbait')
  })

  it('不是家目錄底下、路徑也不長時原樣回傳', () => {
    expect(shortenPath('/tmp/x', '/Users/shark')).toBe('/tmp/x')
  })

  it('路徑過長時只留最後兩層，前面加…/', () => {
    expect(shortenPath('/Users/shark/a/b/c/d', '/Users/shark')).toBe('…/c/d')
  })
})
