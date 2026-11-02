import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeIde: vi.fn(),
  openIde: vi.fn(),
  uploadPlatform: vi.fn(),
}))

vi.mock('../src/ide', () => ({
  closeIde: mocks.closeIde,
  openIde: mocks.openIde,
}))

vi.mock('../src/preview', () => ({
  previewPlatform: vi.fn(),
}))

vi.mock('../src/upload', () => ({
  uploadPlatform: mocks.uploadPlatform,
}))

const { runCli } = await import('../src/cli')
const { IdeNotFoundError } = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.openIde.mockResolvedValue({ message: 'opened' })
  mocks.closeIde.mockResolvedValue({ message: 'closed' })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-ide-'))
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

describe('runCli IDE 子命令', () => {
  it('open 传递平台与选项', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli([
      'open',
      '-p',
      'weixin',
      '--port',
      '9420',
      '--lang',
      'zh',
      '--force',
      '--dry-run',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('正在打开微信小程序开发者工具'))).toBe(true)
    expect(stdout).toContain('[成功] opened')
    expect(mocks.openIde).toHaveBeenCalledWith('weixin', expect.objectContaining({
      cwd,
      dryRun: true,
      force: true,
      lang: 'zh',
      port: 9420,
    }))
  })

  it('close 支持 --quit', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['close', '-p', 'weixin', '--quit'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('正在退出微信小程序开发者工具'))).toBe(true)
    expect(mocks.closeIde).toHaveBeenCalledWith('weixin', expect.objectContaining({
      cwd,
      quit: true,
    }))
  })

  it('open 缺少 platform 时返回 1', async () => {
    const { stderr, stdout, writers } = createWriters()

    const exitCode = await runCli(['open'], writers)

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 缺少必填参数：--platform')
    expect(stdout.some(line => line.includes('wotci open'))).toBe(true)
  })

  it('iDE 错误按预期错误格式输出', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()
    mocks.openIde.mockRejectedValueOnce(new IdeNotFoundError('未找到 IDE'))

    const exitCode = await runCli(['open', '-p', 'weixin'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 未找到 IDE')
    expect(stderr.some(line => line.includes('发生未预期错误'))).toBe(false)
  })
})
