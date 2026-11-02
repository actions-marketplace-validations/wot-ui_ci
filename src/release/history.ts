import type { ReleaseHistoryRecord } from '../types'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { ReleaseError } from '../errors'

export interface ReleaseHistoryFile {
  version: 1
  records: ReleaseHistoryRecord[]
}

export interface AppendHistoryOptions {
  cwd: string
  file: string
  limit?: number
}

/** 追加一条发布历史，返回历史文件绝对路径 */
export async function appendReleaseHistory(
  record: ReleaseHistoryRecord,
  options: AppendHistoryOptions,
): Promise<string> {
  const filePath = path.resolve(options.cwd, options.file)
  const records = await readHistory(filePath)
  const limit = Math.max(1, options.limit ?? 50)
  const next: ReleaseHistoryFile = {
    records: [...records, record].slice(-limit),
    version: 1,
  }

  await mkdir(path.dirname(filePath), { recursive: true })

  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)

  return filePath
}

async function readHistory(filePath: string): Promise<ReleaseHistoryRecord[]> {
  let source: string

  try {
    source = await readFile(filePath, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return []
    throw new ReleaseError(`读取发布历史失败：${filePath}`, error)
  }

  try {
    const parsed = JSON.parse(source) as unknown

    if (Array.isArray(parsed))
      return parsed as ReleaseHistoryRecord[]

    const history = parsed as Partial<ReleaseHistoryFile>
    if (history && Array.isArray(history.records))
      return history.records

    throw new TypeError('历史文件格式不正确')
  }
  catch (error) {
    throw new ReleaseError(`解析发布历史失败：${filePath}`, error)
  }
}
