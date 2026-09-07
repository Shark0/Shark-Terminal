import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodeScanDeps, probeClaudeConfigDir } from '../../src/main/scan-deps'
import { parseLsofCwd, parsePs } from '../../src/main/session-scan'

/** 一個絕對不存在的 pid（macOS pid 上限遠小於此） */
const GHOST_PID = 2147483646

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'shark-terminal-scan-deps-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('ps', () => {
  it('輸出可被 parsePs 解析，且包含目前程序與其父程序', async () => {
    const table = parsePs(await createNodeScanDeps(() => root).ps())
    expect(table.children.get(process.ppid)).toContain(process.pid)
  })

  it('啟動時間固定用 C 語系與 UTC 輸出，格式與 Claude 寫的 procStart 相同', async () => {
    const table = parsePs(await createNodeScanDeps(() => root).ps())
    expect(table.info.get(process.pid)?.started).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d\d:\d\d:\d\d \d{4}$/)
  })
})

describe('lsofCwd', () => {
  it('回傳目前程序的 cwd', async () => {
    const cwds = parseLsofCwd(await createNodeScanDeps(() => root).lsofCwd([process.pid]))
    expect(cwds.get(process.pid)).toBe(await fs.realpath(process.cwd()))
  })

  it('pid 清單混有已結束的程序時（ps 與 lsof 之間的競態）仍回傳存活者的 cwd，不拋錯', async () => {
    const cwds = parseLsofCwd(await createNodeScanDeps(() => root).lsofCwd([process.pid, GHOST_PID]))
    expect(cwds.has(process.pid)).toBe(true)
  })

  it('全部 pid 都已結束時回傳空字串而非拋錯——lsof 找不到任何符合項目會以 1 結束', async () => {
    await expect(createNodeScanDeps(() => root).lsofCwd([GHOST_PID])).resolves.toBe('')
  })
})

describe('readClaudeSession', () => {
  async function writeSession(pid: number, content: string): Promise<void> {
    await fs.mkdir(path.join(root, 'sessions'), { recursive: true })
    await fs.writeFile(path.join(root, 'sessions', `${pid}.json`), content)
  }

  it('讀出 <configDir>/sessions/<pid>.json 的 status 與 procStart', async () => {
    await writeSession(123, JSON.stringify({ pid: 123, status: 'busy', procStart: 'Wed Sep  2 01:42:20 2026' }))
    expect(await createNodeScanDeps(() => root).readClaudeSession(123)).toEqual({
      status: 'busy',
      procStart: 'Wed Sep  2 01:42:20 2026',
    })
  })

  it('沒有 procStart 欄位時為 null，讓掃描端略過啟動時間比對', async () => {
    await writeSession(124, JSON.stringify({ status: 'idle' }))
    expect(await createNodeScanDeps(() => root).readClaudeSession(124)).toEqual({ status: 'idle', procStart: null })
  })

  it('沒有 session 檔（不是 claude 的程序）回 null 且不記錄 warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await createNodeScanDeps(() => root).readClaudeSession(456)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('檔案內容不是合法 JSON（Claude 正在改寫）回 unreadable，讓掃描端保留上一輪記憶', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await writeSession(789, '{"status":"bu')
    expect(await createNodeScanDeps(() => root).readClaudeSession(789)).toBe('unreadable')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('status 不是字串時視為沒有 session', async () => {
    await writeSession(321, JSON.stringify({ status: 5 }))
    expect(await createNodeScanDeps(() => root).readClaudeSession(321)).toBeNull()
  })
})

describe('isWorktreeRoot', () => {
  async function makeGitFile(name: string, content: string): Promise<string> {
    const dir = path.join(root, name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, '.git'), content)
    return dir
  }

  it('.git 檔案的 gitdir 指向 <repo>/.git/worktrees/<name> 時為 true（絕對路徑）', async () => {
    const dir = await makeGitFile('wt', `gitdir: ${path.join(root, 'main', '.git', 'worktrees', 'wt')}\n`)
    expect(await createNodeScanDeps(() => root).isWorktreeRoot(dir)).toBe(true)
  })

  it('gitdir 為相對路徑時相對於 .git 檔案所在目錄解析', async () => {
    const dir = await makeGitFile('.worktrees/wt', 'gitdir: ../../.git/worktrees/wt\n')
    expect(await createNodeScanDeps(() => root).isWorktreeRoot(dir)).toBe(true)
  })

  it('git submodule 的 .git 也是檔案，但 gitdir 指向 .git/modules/<name>，不算 worktree', async () => {
    const dir = await makeGitFile('vendor/lib', 'gitdir: ../../.git/modules/vendor/lib\n')
    expect(await createNodeScanDeps(() => root).isWorktreeRoot(dir)).toBe(false)
  })

  it('.git 檔案內容不含 gitdir 時為 false', async () => {
    const dir = await makeGitFile('garbage', '這不是 gitdir\n')
    expect(await createNodeScanDeps(() => root).isWorktreeRoot(dir)).toBe(false)
  })

  it('.git 是目錄（一般 repo）時為 false', async () => {
    const dir = path.join(root, 'repo')
    await fs.mkdir(path.join(dir, '.git'), { recursive: true })
    expect(await createNodeScanDeps(() => root).isWorktreeRoot(dir)).toBe(false)
  })

  it('沒有 .git 時為 false，且不記錄 warning（往上找的正常路徑）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dir = path.join(root, 'plain')
    await fs.mkdir(dir)
    expect(await createNodeScanDeps(() => root).isWorktreeRoot(dir)).toBe(false)
    expect(warn.mock.calls).toEqual([])
    warn.mockRestore()
  })

  it('stat 遇到權限錯誤（EACCES）時回 false 並記錄 warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const statSpy = vi
      .spyOn(fs, 'stat')
      .mockRejectedValueOnce(Object.assign(new Error('許可權不足'), { code: 'EACCES' }))
    expect(await createNodeScanDeps(() => root).isWorktreeRoot(path.join(root, 'nope'))).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'EACCES' }))
    statSpy.mockRestore()
    warn.mockRestore()
  })
})

describe('realpath', () => {
  it('解析 symlink 成實際路徑', async () => {
    const target = path.join(root, 'target')
    await fs.mkdir(target)
    const link = path.join(root, 'link')
    await fs.symlink(target, link)
    expect(await createNodeScanDeps(() => root).realpath(link)).toBe(await fs.realpath(target))
  })
})

describe('probeClaudeConfigDir', () => {
  it('login shell 有 export CLAUDE_CONFIG_DIR 時回傳該路徑', async () => {
    const dir = await probeClaudeConfigDir('/bin/sh', { ...process.env, CLAUDE_CONFIG_DIR: '/tmp/claude-cfg' }, '/fallback')
    expect(dir).toBe('/tmp/claude-cfg')
  })

  it('沒有設定時回傳 fallback', async () => {
    const env = { ...process.env }
    delete env.CLAUDE_CONFIG_DIR
    expect(await probeClaudeConfigDir('/bin/sh', env, '/fallback')).toBe('/fallback')
  })

  it('shell 執行失敗時回傳 fallback 並記錄 warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await probeClaudeConfigDir('/nonexistent/shell', process.env, '/fallback')).toBe('/fallback')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
