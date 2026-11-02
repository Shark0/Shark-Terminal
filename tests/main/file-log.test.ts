import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFileLog } from '../../src/main/file-log'

let root: string
let file: string
let restore: (() => void) | null = null

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'shark-terminal-log-'))
  file = path.join(root, 'main.log')
  // 不讓測試輸出洗版，同時確認原本的 console 仍被呼叫
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  restore?.()
  restore = null
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('installFileLog', () => {
  it('console.log / warn / error 都同步寫進檔案，帶時間與等級', () => {
    restore = installFileLog(file, 1024 * 1024)
    console.log('啟動', { a: 1 })
    console.warn('警告')
    console.error('錯誤', new Error('boom'))
    const content = readFileSync(file, 'utf8')
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z? \[log\] 啟動 \{ a: 1 \}$/m)
    expect(content).toMatch(/\[warn\] 警告/)
    expect(content).toMatch(/\[error\] 錯誤 Error: boom/)
  })

  it('檔案超過上限時，啟動時先改名成 .1 再重新開始', () => {
    writeFileSync(file, 'x'.repeat(2000))
    restore = installFileLog(file, 1000)
    console.log('新的一行')
    expect(statSync(`${file}.1`).size).toBe(2000)
    expect(readFileSync(file, 'utf8')).toMatch(/新的一行/)
    expect(readFileSync(file, 'utf8')).not.toMatch(/xxx/)
  })

  it('目錄不存在時自動建立', () => {
    const nested = path.join(root, 'a', 'b', 'main.log')
    restore = installFileLog(nested, 1024)
    console.log('hi')
    expect(existsSync(nested)).toBe(true)
  })

  it('還原後不再寫檔', () => {
    restore = installFileLog(file, 1024 * 1024)
    restore()
    restore = null
    console.log('不該出現')
    expect(existsSync(file) ? readFileSync(file, 'utf8') : '').not.toMatch(/不該出現/)
  })
})
