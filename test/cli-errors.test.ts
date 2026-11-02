import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/ide', () => ({
  closeIde: vi.fn(),
  openIde: vi.fn(),
}))

vi.mock('../src/upload', () => ({
  normalizePlatform: (platform: string) => platform === 'dd' ? 'dingtalk' : platform,
  uploadPlatform: vi.fn(),
}))

const { runCli } = await import('../src/cli')
const { uploadPlatform } = await import('../src/upload')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-error-'))
  tempDirs.push(cwd)
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  return cwd
}

function createWriters() {
  const stdout: string[] = []
  const stderr: string[] = []

  return {
    stderr,
    stdout,
    writers: {
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
  }
}

describe('runCli 未预期错误', () => {
  it('错误实例会打印消息与堆栈', async () => {
    const cwd = await createProject()
    const { stderr, stdout, writers } = createWriters()
    vi.mocked(uploadPlatform).mockRejectedValueOnce(new Error('unexpected boom'))

    const exitCode = await runCli(['-p', 'weixin'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stdout.some(line => line.includes('开始上传微信小程序'))).toBe(true)
    expect(stderr).toContain('[失败] 发生未预期错误：unexpected boom')
    expect(stderr.some(line => line.startsWith('[失败] 堆栈: '))).toBe(true)
  })

  it('非错误值会转成字符串并跳过堆栈', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()
    vi.mocked(uploadPlatform).mockRejectedValueOnce('string boom')

    const exitCode = await runCli(['-p', 'weixin'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 发生未预期错误：string boom')
    expect(stderr.some(line => line.includes('堆栈:'))).toBe(false)
  })
})
