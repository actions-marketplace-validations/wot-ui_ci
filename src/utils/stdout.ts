import process from 'node:process'

/** 把 stdout 临时重定向到 stderr，避免 SDK 日志污染 JSON stdout */
export async function redirectStdoutToStderr<T>(callback: () => Promise<T>): Promise<T> {
  const originalWrite = process.stdout.write

  process.stdout.write = function (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean {
    return process.stderr.write(chunk, encoding as BufferEncoding, cb)
  } as typeof process.stdout.write

  try {
    return await callback()
  }
  finally {
    process.stdout.write = originalWrite
  }
}
