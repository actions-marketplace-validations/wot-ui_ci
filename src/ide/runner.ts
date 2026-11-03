import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { IdeCommandError } from '../errors'

const execFileAsync = promisify(execFile)

export interface CommandInvocation {
  command: string
  args: string[]
}

export interface CommandResult {
  stdout: string
  stderr: string
}

export interface RunCommandOptions {
  cwd?: string
  timeout?: number
}

/**
 * Windows 下 .bat / .cmd 不能直接交给 execFile，需要包一层 cmd.exe。
 * 抽成纯函数，方便跨平台测试。
 */
export function toCommandInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CommandInvocation {
  if (platform === 'win32' && /\.(?:bat|cmd)$/i.test(command)) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `"${command}"`, ...args],
    }
  }

  return { command, args }
}

export async function runCommand(
  invocation: CommandInvocation,
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(invocation.command, invocation.args, {
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeout ?? 120_000,
      windowsHide: true,
    })

    return {
      stderr: result.stderr,
      stdout: result.stdout,
    }
  }
  catch (error) {
    throw new IdeCommandError(`执行 IDE 命令失败：${formatInvocation(invocation)}`, error)
  }
}

export function formatInvocation(invocation: CommandInvocation): string {
  return [invocation.command, ...invocation.args].map(quoteArg).join(' ')
}

function quoteArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg
}
