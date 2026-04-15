/*
 * @Author: weisheng
 * @Date: 2026-04-15 15:49:58
 * @LastEditTime: 2026-04-15 16:07:50
 * @LastEditors: weisheng
 * @Description:
 * @FilePath: /ci/src/utils/path.ts
 * 记得注释
 */
import { access } from 'node:fs/promises'
import path from 'node:path'

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
