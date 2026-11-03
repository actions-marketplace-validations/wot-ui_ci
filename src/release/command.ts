import { exec } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { BuildError } from '../errors'

const execAsync = promisify(exec)

export interface ShellCommandOptions {
  cwd?: string
  timeout?: number
}

export interface ShellCommandResult {
  stdout: string
  stderr: string
}

/** 执行 release 的构建命令，失败时抛出 BuildError */
export async function runShellCommand(
  command: string,
  options: ShellCommandOptions = {},
): Promise<ShellCommandResult> {
  try {
    const result = await execAsync(command, {
      cwd: options.cwd,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
      timeout: options.timeout ?? 10 * 60_000,
      windowsHide: true,
    })

    return {
      stderr: result.stderr,
      stdout: result.stdout,
    }
  }
  catch (error) {
    throw new BuildError(`构建命令执行失败：${command}`, error)
  }
}
