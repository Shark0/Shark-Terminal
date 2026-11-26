import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'

const LEVELS = ['log', 'info', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]

/**
 * 把 main 程序的 console 輸出同時寫進檔案。
 * 從 Finder / Dock 啟動時 stdout/stderr 沒有去處，app 卡住後完全查不到發生過什麼。
 *
 * 刻意用同步寫入：非同步的 fs 寫入要經過 libuv threadpool，
 * 而我們要記錄的正是 threadpool 被卡死的狀況——那時非同步寫入永遠不會落地。
 * 啟動時與執行中寫超過上限都會改名成 .1（只保留一份舊檔），硬碟上最多佔 2 × maxBytes。
 * 執行中用自己累計的位元組數判斷，不必每行都 stat。
 *
 * 回傳還原函式，測試用。
 */
export function installFileLog(filePath: string, maxBytes: number): () => void {
  const original = {} as Record<Level, (...args: unknown[]) => void>
  for (const level of LEVELS) original[level] = console[level]

  /** 目前檔案的大小，超過上限就輪替 */
  let bytes = 0
  const rotate = (): void => {
    renameSync(filePath, `${filePath}.1`)
    bytes = 0
  }

  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    bytes = statSync(filePath, { throwIfNoEntry: false })?.size ?? 0
    if (bytes > maxBytes) rotate()
  } catch (err) {
    original.error('[file-log] 準備 log 檔失敗，仍會嘗試寫入', { filePath, err })
  }

  // 寫檔失敗（磁碟滿、權限）只回報一次，否則每一行 log 都會再觸發一次錯誤
  let reportedWriteError = false
  for (const level of LEVELS) {
    console[level] = (...args: unknown[]) => {
      original[level](...args)
      try {
        const line = `${new Date().toISOString()} [${level}] ${format(...args)}\n`
        const lineBytes = Buffer.byteLength(line)
        if (bytes > 0 && bytes + lineBytes > maxBytes) rotate()
        appendFileSync(filePath, line)
        bytes += lineBytes
      } catch (err) {
        if (!reportedWriteError) {
          reportedWriteError = true
          original.error('[file-log] 寫入 log 檔失敗，之後的失敗不再回報', { filePath, err })
        }
      }
    }
  }

  return () => {
    for (const level of LEVELS) console[level] = original[level]
  }
}
