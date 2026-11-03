#!/usr/bin/env node

import process from 'node:process'
import { runCli } from './cli'

runCli()
  .then(async (exitCode) => {
    process.exitCode = exitCode

    // 上传 SDK 可能残留 forked 子进程或句柄，等待输出刷盘后显式退出
    await Promise.all([flush(process.stdout), flush(process.stderr)])
    process.exit(exitCode)
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })

function flush(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed) {
      resolve()
      return
    }

    const done = (): void => resolve()
    stream.once('error', done)

    try {
      stream.write('', done)
    }
    catch {
      done()
    }
  })
}
