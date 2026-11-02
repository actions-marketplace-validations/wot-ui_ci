import { access, stat } from 'node:fs/promises'
import path from 'node:path'

/** 相对路径基于 cwd 解析，绝对路径原样返回 */
export function resolveFromCwd(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  }
  catch {
    return false
  }
}
