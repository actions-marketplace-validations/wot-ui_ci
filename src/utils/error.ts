import type { SerializedError } from '../types'
import { formatErrorReport, WotCIError } from '../errors'

/** 把错误转成可序列化结构，保留 cause 链文本 */
export function serializeError(error: unknown): SerializedError {
  const report = formatErrorReport(error)

  return {
    code: error instanceof WotCIError ? error.code : 'RELEASE_ERROR',
    message: report[0],
    ...(report.length > 1 ? { cause: report.slice(1) } : {}),
  }
}
