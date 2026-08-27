import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '../../src/renderer/fuzzy'

describe('fuzzyMatch', () => {
  it('空查詢符合任何目標', () => {
    expect(fuzzyMatch('', '訂單結帳重構')).toBe(true)
  })

  it('連續子字串符合', () => {
    expect(fuzzyMatch('結帳', '訂單結帳重構')).toBe(true)
  })

  it('不連續但順序正確的字元符合', () => {
    expect(fuzzyMatch('訂構', '訂單結帳重構')).toBe(true)
    expect(fuzzyMatch('pbp', 'play-by-play 重構')).toBe(true)
  })

  it('忽略大小寫', () => {
    expect(fuzzyMatch('API', 'api 端點調整')).toBe(true)
    expect(fuzzyMatch('api', 'API 端點調整')).toBe(true)
  })

  it('順序錯誤不符合', () => {
    expect(fuzzyMatch('構訂', '訂單結帳重構')).toBe(false)
  })

  it('目標不含查詢字元時不符合', () => {
    expect(fuzzyMatch('xyz', '訂單結帳重構')).toBe(false)
  })

  it('查詢比目標長時不符合', () => {
    expect(fuzzyMatch('訂單結帳重構流程', '訂單結帳')).toBe(false)
  })
})
