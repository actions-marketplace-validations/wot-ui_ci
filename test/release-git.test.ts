import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  fail: false,
}))

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}))

const { readGitInfo } = await import('../src/release/git')

beforeEach(() => {
  mocks.fail = false
  mocks.execFile.mockReset()
  mocks.execFile.mockImplementation((
    _command: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, result?: { stdout: string, stderr: string }) => void,
  ) => {
    if (mocks.fail) {
      callback(new Error('git failed'))
      return
    }

    const key = args.join(' ')
    const value = key.includes('branch')
      ? 'main'
      : key.includes('rev-parse')
        ? 'abc1234'
        : 'v1.0.0'

    callback(null, { stderr: '', stdout: `${value}\n` })
  })
})

describe('readGitInfo', () => {
  it('读取 branch / commit / tag', async () => {
    const info = await readGitInfo('/tmp/repo')

    expect(info).toEqual({ branch: 'main', commit: 'abc1234', tag: 'v1.0.0' })
  })

  it('git 命令失败时返回空对象', async () => {
    mocks.fail = true

    await expect(readGitInfo('/tmp/repo')).resolves.toEqual({})
  })

  it('git 输出为空时返回空对象', async () => {
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, { stderr: '', stdout: '\n' })
    })

    await expect(readGitInfo('/tmp/repo')).resolves.toEqual({})
  })

  it('不传 cwd 时使用 process.cwd()', async () => {
    await readGitInfo()

    expect(mocks.execFile).toHaveBeenCalledWith(
      'git',
      ['branch', '--show-current'],
      expect.objectContaining({ cwd: process.cwd() }),
      expect.any(Function),
    )
  })
})
