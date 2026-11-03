import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelExperience: vi.fn(),
  deleteVersion: vi.fn(),
  getLatestVersion: vi.fn(),
  getVersionList: vi.fn(),
  setExperience: vi.fn(),
}))

vi.mock('../src/version', () => ({
  cancelExperience: mocks.cancelExperience,
  deleteVersion: mocks.deleteVersion,
  getLatestVersion: mocks.getLatestVersion,
  getVersionList: mocks.getVersionList,
  setExperience: mocks.setExperience,
}))

vi.mock('../src/batch', () => ({
  previewMany: vi.fn(),
  uploadMany: vi.fn(),
}))

vi.mock('../src/ide', () => ({
  autoIde: vi.fn(),
  closeIde: vi.fn(),
  getIdeStatus: vi.fn(),
  openIde: vi.fn(),
  previewIde: vi.fn(),
}))

vi.mock('../src/preview', () => ({ previewPlatform: vi.fn() }))
vi.mock('../src/release', () => ({ release: vi.fn() }))
vi.mock('../src/upload', () => ({ uploadPlatform: vi.fn() }))

const { runCli } = await import('../src/cli')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLatestVersion.mockResolvedValue({ latest: '1.2.3', platform: 'weixin' })
  mocks.setExperience.mockResolvedValue({
    action: 'set-experience',
    message: '已设置支付宝体验版：1.0.0',
    platform: 'alipay',
    qrCodeUrl: 'https://qr',
    version: '1.0.0',
  })
  mocks.cancelExperience.mockResolvedValue({
    action: 'cancel-experience',
    message: '已取消支付宝体验版：1.0.0',
    platform: 'alipay',
    version: '1.0.0',
  })
  mocks.deleteVersion.mockResolvedValue({
    action: 'delete',
    message: '已删除支付宝版本：1.0.0',
    platform: 'alipay',
    version: '1.0.0',
  })
  mocks.getVersionList.mockResolvedValue({
    platform: 'alipay',
    versions: [
      { createTime: '2026-01-01', description: 'release', operator: 'alice', status: 'online', version: '2.0.0' },
    ],
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-version-'))
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

describe('runCli version', () => {
  it('version latest 输出最新版本', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['version', 'latest', '-p', 'weixin'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('weixin 线上最新版本：1.2.3'))).toBe(true)
  })

  it('version latest --json 输出 JSON', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.getLatestVersion.mockResolvedValueOnce({
      grayReleaseVersion: '1.2.2',
      latest: '1.2.3',
      platform: 'weixin',
    })

    await runCli(['version', 'latest', '-p', 'weixin', '--json'], { cwd, ...writers })

    expect(JSON.parse(stdout[0])).toMatchObject({
      grayReleaseVersion: '1.2.2',
      latest: '1.2.3',
      platform: 'weixin',
      schemaVersion: 1,
    })
  })

  it('version list 输出表格行', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['version', 'list', '-p', 'alipay'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('2.0.0 | online | 2026-01-01 | release'))).toBe(true)
  })

  it('缺少平台或未知子命令时报错', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()

    expect(await runCli(['version', 'latest'], { cwd, ...writers })).toBe(1)
    expect(stderr).toContain('[失败] 缺少必填参数：--platform')

    expect(await runCli(['version', 'unknown', '-p', 'weixin'], { cwd, ...writers })).toBe(1)
    expect(stderr.some(line => line.includes('未知 version 子命令'))).toBe(true)
  })
})

describe('runCli experience / version delete', () => {
  it('experience set 输出二维码', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli([
      'experience',
      'set',
      '-p',
      'alipay',
      '--version',
      '1.0.0',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.setExperience).toHaveBeenCalledWith('alipay', expect.objectContaining({ version: '1.0.0' }))
    expect(stdout.some(line => line.includes('已设置支付宝体验版'))).toBe(true)
    expect(stdout.some(line => line.includes('体验版二维码：https://qr'))).toBe(true)
  })

  it('experience cancel', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['experience', 'cancel', '-p', 'alipay', '--version', '1.0.0'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.cancelExperience).toHaveBeenCalled()
    expect(stdout.some(line => line.includes('已取消支付宝体验版'))).toBe(true)
  })

  it('version delete 传递 --yes', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli([
      'version',
      'delete',
      '-p',
      'alipay',
      '--version',
      '1.0.0',
      '--yes',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.deleteVersion).toHaveBeenCalledWith('alipay', expect.objectContaining({ confirm: true, version: '1.0.0' }))
    expect(stdout.some(line => line.includes('已删除支付宝版本'))).toBe(true)
  })

  it('缺少 --version 时返回 1', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()

    const exitCode = await runCli(['experience', 'set', '-p', 'alipay'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 缺少必填参数：--version')
  })
})

describe('runCli experience --json', () => {
  it('输出结构化结果与二维码', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    await runCli([
      'experience',
      'set',
      '-p',
      'alipay',
      '--version',
      '1.0.0',
      '--json',
    ], { cwd, ...writers })

    expect(JSON.parse(stdout[0])).toMatchObject({
      command: 'experience-set',
      qrCodeUrl: 'https://qr',
      schemaVersion: 1,
      version: '1.0.0',
    })
  })
})
