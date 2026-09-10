import { describe, expect, it } from 'vitest'
import { stripInheritedEnv } from '../../src/main/inherited-env'

describe('stripInheritedEnv', () => {
  it('剔除 Claude Code session 的身分標記——留著卡片內的 claude 會自認是子 session', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDECODE: '1',
      CLAUDE_PID: '73437',
      CLAUDE_CODE_SESSION_ID: '96e8fb09',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/73437.sock',
      CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_0122',
    }
    stripInheritedEnv(env)
    expect(env).toEqual({})
  })

  it('保留 CLAUDE_CONFIG_DIR——那是使用者自己的設定目錄，掃描器也靠它找 session 檔', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: '/tmp/my-claude', CLAUDECODE: '1' }
    stripInheritedEnv(env)
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/tmp/my-claude' })
  })

  it('剔除 Terminal.app 的身分——留著每張卡片會共用同一個 per-session 歷史檔', () => {
    const env: NodeJS.ProcessEnv = {
      TERM_PROGRAM: 'Apple_Terminal',
      TERM_PROGRAM_VERSION: '470.2',
      TERM_SESSION_ID: '3A613ADF-A510-4BD9-BE6D-0D43E10F460E',
    }
    stripInheritedEnv(env)
    expect(env).toEqual({})
  })

  it('剔除 Claude Code 為了非互動而設的 GIT_EDITOR 與 AI_AGENT——卡片是給人用的終端機', () => {
    const env: NodeJS.ProcessEnv = { GIT_EDITOR: 'true', AI_AGENT: 'claude-code_2-1-260_agent' }
    stripInheritedEnv(env)
    expect(env).toEqual({})
  })

  it('shell 要用的一般變數原封不動', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/shark',
      SHELL: '/bin/zsh',
      TERM: 'xterm-256color',
      LANG: 'zh_TW.UTF-8',
    }
    stripInheritedEnv(env)
    expect(env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/shark',
      SHELL: '/bin/zsh',
      TERM: 'xterm-256color',
      LANG: 'zh_TW.UTF-8',
    })
  })
})
