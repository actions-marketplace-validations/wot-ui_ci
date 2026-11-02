import type { ReleaseGitInfo } from '../types'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function readGitValue(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 5000,
      windowsHide: true,
    })
    const value = stdout.trim()
    return value || undefined
  }
  catch {
    return undefined
  }
}

/** best-effort 读取 git 信息，失败时返回空对象 */
export async function readGitInfo(cwd: string = process.cwd()): Promise<ReleaseGitInfo> {
  const [branch, commit, tag] = await Promise.all([
    readGitValue(['branch', '--show-current'], cwd),
    readGitValue(['rev-parse', '--short', 'HEAD'], cwd),
    readGitValue(['describe', '--tags', '--always'], cwd),
  ])

  return {
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {}),
    ...(tag ? { tag } : {}),
  }
}
