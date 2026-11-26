import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureStuckDiagnostics, pruneDiagnostics } from '../../src/main/stuck-diagnostics'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'shark-terminal-diag-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** 假的 spawn：記錄呼叫、回傳可 unref 的 EventEmitter，不真的開子程序 */
function fakeSpawn(): ReturnType<typeof vi.fn> & typeof spawn {
  return vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() })) as unknown as ReturnType<typeof vi.fn> &
    typeof spawn
}

describe('captureStuckDiagnostics', () => {
  it('建立帶時間的資料夾，寫入 info.txt，並對自己的 pid 跑 lsof / ps / sample', () => {
    const spawnFn = fakeSpawn()
    const dir = captureStuckDiagnostics(root, { stuckMs: 60_000 }, spawnFn)

    expect(dir).not.toBeNull()
    expect(path.dirname(dir!)).toBe(root)
    const info = JSON.parse(readFileSync(path.join(dir!, 'info.txt'), 'utf8'))
    expect(info).toMatchObject({ stuckMs: 60_000, pid: process.pid })
    expect(info.activeResources).toEqual(expect.any(Object))

    const files = spawnFn.mock.calls.map((call) => call[0])
    expect(files).toEqual(['/usr/sbin/lsof', '/bin/ps', '/usr/bin/sample'])
    expect(spawnFn.mock.calls[0][1]).toContain(String(process.pid))
    expect(spawnFn.mock.calls[2][1]).toEqual(expect.arrayContaining([String(process.pid), '-file', path.join(dir!, 'sample.txt')]))
    for (const out of ['lsof.txt', 'ps.txt', 'sample.log']) expect(existsSync(path.join(dir!, out))).toBe(true)
  })

  it('某個指令 spawn 失敗時記 warn，其餘照跑', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spawnFn = fakeSpawn()
    spawnFn.mockImplementationOnce(() => {
      throw new Error('EAGAIN')
    })
    captureStuckDiagnostics(root, {}, spawnFn)
    expect(spawnFn).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lsof'), expect.objectContaining({ err: expect.any(Error) }))
  })

  it('子程序回報 error 時記 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spawnFn = fakeSpawn()
    captureStuckDiagnostics(root, {}, spawnFn)
    const child = spawnFn.mock.results[1].value as EventEmitter
    child.emit('error', new Error('ENOENT'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ps'), expect.objectContaining({ err: expect.any(Error) }))
  })

  it('資料夾建立失敗時回傳 null 並記 error，不往外丟例外', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const blocker = path.join(root, 'file')
    writeFileSync(blocker, '')
    expect(captureStuckDiagnostics(path.join(blocker, 'sub'), {}, fakeSpawn())).toBeNull()
    expect(error).toHaveBeenCalled()
  })
})

describe('pruneDiagnostics', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = Date.parse('2026-11-26T00:00:00Z')

  function makeSnapshot(name: string, ageMs: number): void {
    const dir = path.join(root, name)
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'info.txt'), '{}')
    const t = new Date(now - ageMs)
    utimesSync(dir, t, t)
  }

  it('只保留最新的 keep 份', () => {
    makeSnapshot('2026-11-20T00-00-00-000Z', DAY)
    makeSnapshot('2026-11-21T00-00-00-000Z', DAY)
    makeSnapshot('2026-11-22T00-00-00-000Z', DAY)
    pruneDiagnostics(root, 2, 30 * DAY, now)
    expect(readdirSync(root).sort()).toEqual(['2026-11-21T00-00-00-000Z', '2026-11-22T00-00-00-000Z'])
  })

  it('超過保留天數的刪掉，即使份數沒超過', () => {
    makeSnapshot('2026-10-01T00-00-00-000Z', 40 * DAY)
    makeSnapshot('2026-11-25T00-00-00-000Z', DAY)
    pruneDiagnostics(root, 5, 30 * DAY, now)
    expect(readdirSync(root)).toEqual(['2026-11-25T00-00-00-000Z'])
  })

  it('不碰不是快照的檔案與資料夾', () => {
    writeFileSync(path.join(root, 'README'), '')
    mkdirSync(path.join(root, 'manual'))
    makeSnapshot('2026-11-20T00-00-00-000Z', 40 * DAY)
    pruneDiagnostics(root, 5, 30 * DAY, now)
    expect(readdirSync(root).sort()).toEqual(['README', 'manual'])
  })

  it('目錄不存在時什麼都不做', () => {
    expect(() => pruneDiagnostics(path.join(root, 'none'), 5, 30 * DAY, now)).not.toThrow()
  })
})
