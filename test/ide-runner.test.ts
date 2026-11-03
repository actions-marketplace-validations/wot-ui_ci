import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { IdeCommandError } from '../src/errors'
import {
  formatInvocation,
  runCommand,
  toCommandInvocation,
} from '../src/ide/runner'

describe('toCommandInvocation', () => {
  it('普通可执行文件直接调用', () => {
    expect(toCommandInvocation('/opt/cli', ['open'], 'darwin')).toEqual({
      command: '/opt/cli',
      args: ['open'],
    })
  })

  it('windows 下 .bat / .cmd 通过 cmd.exe 调用', () => {
    expect(toCommandInvocation('C:\\tools\\cli.bat', ['open'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\tools\\cli.bat"', 'open'],
    })
    expect(toCommandInvocation('C:\\tools\\cli.CMD', [], 'win32').command).toBe('cmd.exe')
  })

  it('windows 下普通 exe 不包 cmd', () => {
    expect(toCommandInvocation('C:\\tools\\cli.exe', [], 'win32')).toEqual({
      command: 'C:\\tools\\cli.exe',
      args: [],
    })
  })
})

describe('formatInvocation', () => {
  it('包含空格的参数会加引号', () => {
    expect(formatInvocation({
      command: '/Applications/WeChat DevTools/cli',
      args: ['open', '--project', '/tmp/my project'],
    })).toBe('"/Applications/WeChat DevTools/cli" open --project "/tmp/my project"')
  })

  it('普通参数不加引号', () => {
    expect(formatInvocation({ command: 'cli', args: ['open'] })).toBe('cli open')
  })
})

describe('runCommand', () => {
  it('执行成功时返回 stdout / stderr', async () => {
    const result = await runCommand({
      command: process.execPath,
      args: ['-e', 'console.log("runner-ok")'],
    })

    expect(result.stdout).toContain('runner-ok')
    expect(result.stderr).toBe('')
  })

  it('非 0 退出码包装为 IdeCommandError', async () => {
    const error = await runCommand({
      command: process.execPath,
      args: ['-e', 'console.error("runner-fail"); process.exit(2)'],
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IdeCommandError)
    expect((error as IdeCommandError).code).toBe('IDE_COMMAND_FAILED')
    expect((error as IdeCommandError).cause).toBeInstanceOf(Error)
  })

  it('命令不存在时包装为 IdeCommandError', async () => {
    await expect(runCommand({
      command: 'wotci-not-exists-command',
      args: [],
    })).rejects.toThrow(IdeCommandError)
  })

  it('支持超时设置', async () => {
    await expect(runCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
    }, { timeout: 50 })).rejects.toThrow(IdeCommandError)
  })
})
