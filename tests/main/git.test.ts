import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBranch } from '../../src/main/git'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'shark-terminal-git-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 建立一般 repo：<root>/<name>/.git/HEAD */
async function makeRepo(name: string, headContent: string): Promise<string> {
  const repo = path.join(root, name)
  await fs.mkdir(path.join(repo, '.git'), { recursive: true })
  await fs.writeFile(path.join(repo, '.git', 'HEAD'), headContent)
  return repo
}

describe('readBranch', () => {
  it('一般 repo 回傳 branch 名稱', async () => {
    const repo = await makeRepo('normal', 'ref: refs/heads/main\n')
    expect(await readBranch(repo)).toBe('main')
  })

  it('branch 名稱含斜線時完整回傳', async () => {
    const repo = await makeRepo('slash', 'ref: refs/heads/feat/pbp-refactor\n')
    expect(await readBranch(repo)).toBe('feat/pbp-refactor')
  })

  it('自子目錄往上尋找 .git', async () => {
    const repo = await makeRepo('nested', 'ref: refs/heads/develop\n')
    const deep = path.join(repo, 'src', 'main', 'kotlin')
    await fs.mkdir(deep, { recursive: true })
    expect(await readBranch(deep)).toBe('develop')
  })

  it('detached HEAD 回傳 SHA 前 7 碼', async () => {
    const repo = await makeRepo('detached', '9f2c1ab8e4d5c6b7a8091a2b3c4d5e6f70819234\n')
    expect(await readBranch(repo)).toBe('9f2c1ab')
  })

  it('worktree（.git 為檔案，絕對路徑）回傳 branch', async () => {
    const main = await makeRepo('wt-main', 'ref: refs/heads/main\n')
    const gitDir = path.join(main, '.git', 'worktrees', 'family-supporter')
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/family-supporter\n')

    const wt = path.join(root, 'wt-family')
    await fs.mkdir(wt, { recursive: true })
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${gitDir}\n`)

    expect(await readBranch(wt)).toBe('family-supporter')
  })

  it('worktree 的 gitdir 為相對路徑時，相對於 .git 檔案所在目錄解析', async () => {
    const gitDir = path.join(root, 'shared-gitdir')
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/hotfix\n')

    const wt = path.join(root, 'wt-relative')
    await fs.mkdir(wt, { recursive: true })
    await fs.writeFile(path.join(wt, '.git'), 'gitdir: ../shared-gitdir\n')

    expect(await readBranch(wt)).toBe('hotfix')
  })

  it('非 git 目錄回傳 null', async () => {
    const plain = path.join(root, 'plain')
    await fs.mkdir(plain, { recursive: true })
    expect(await readBranch(plain)).toBeNull()
  })

  it('目錄不存在時回傳 null', async () => {
    expect(await readBranch(path.join(root, '不存在的目錄'))).toBeNull()
  })

  it('HEAD 內容無法辨識時回傳 null', async () => {
    const repo = await makeRepo('garbage', '這不是有效的 HEAD 內容\n')
    expect(await readBranch(repo)).toBeNull()
  })

  it('worktree 的 gitdir 指向不存在的路徑時回傳 null', async () => {
    const wt = path.join(root, 'wt-broken')
    await fs.mkdir(wt, { recursive: true })
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(root, 'nope')}\n`)
    expect(await readBranch(wt)).toBeNull()
  })

  it('目錄不存在（ENOENT）是正常的往上找路徑，不記錄 warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await readBranch(path.join(root, '不存在的目錄'))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('檢查 .git 時遇到非 ENOENT 錯誤（例如權限問題）會記錄 warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const statSpy = vi.spyOn(fs, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('許可權不足'), { code: 'EACCES' }),
    )

    const plain = path.join(root, 'plain-for-eacces')
    await fs.mkdir(plain, { recursive: true })
    await readBranch(plain)

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('非預期錯誤'),
      expect.objectContaining({ code: 'EACCES' }),
    )

    statSpy.mockRestore()
    warn.mockRestore()
  })
})
