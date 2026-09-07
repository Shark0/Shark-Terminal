import { describe, expect, it } from 'vitest'
import { cardBadge } from '../../src/renderer/board/badge'

describe('cardBadge', () => {
  it('有 worktree 時顯示目錄名，title 是完整路徑', () => {
    expect(cardBadge({ worktree: '/repo/.worktrees/feat-a' }, 'master')).toEqual({
      text: 'feat-a',
      title: '/repo/.worktrees/feat-a',
    })
  })

  it('沒有 worktree 時顯示 feature branch', () => {
    expect(cardBadge({}, 'feature/pbp-refactor')).toEqual({
      text: 'feature/pbp-refactor',
      title: 'feature/pbp-refactor',
    })
  })

  it.each(['master', 'main'])('branch 是預設的 %s 時不顯示——每張卡片都在上面，只是雜訊', (branch) => {
    expect(cardBadge({}, branch)).toBeNull()
  })

  it('非 git 目錄（null）或尚未查詢（undefined）都不顯示', () => {
    expect(cardBadge({}, null)).toBeNull()
    expect(cardBadge({}, undefined)).toBeNull()
  })

  it('有 worktree 時即使 branch 是 master 也照樣顯示 worktree', () => {
    expect(cardBadge({ worktree: '/repo/.worktrees/x' }, 'master')?.text).toBe('x')
  })
})
