import { describe, expect, it } from 'vitest'
import { BuildError } from '../src/errors'
import { runShellCommand } from '../src/release/command'

describe('runShellCommand', () => {
  it('执行成功时返回 stdout / stderr', async () => {
    const result = await runShellCommand('node -e "console.log(\'cmd-ok\')"')

    expect(result.stdout).toContain('cmd-ok')
    expect(result.stderr).toBe('')
  })

  it('非 0 退出码包装为 BuildError', async () => {
    const error = await runShellCommand('node -e "process.exit(2)"')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BuildError)
    expect((error as BuildError).code).toBe('BUILD_ERROR')
    expect((error as BuildError).cause).toBeInstanceOf(Error)
  })

  it('支持 cwd 与超时', async () => {
    await expect(runShellCommand('node -e "setTimeout(() => {}, 1000)"', { timeout: 50 }))
      .rejects
      .toThrow(BuildError)
  })
})
