import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLatestVersion: vi.fn(),
  getVersionList: vi.fn(),
}))

vi.mock('../src/version', () => ({
  getLatestVersion: mocks.getLatestVersion,
  getVersionList: mocks.getVersionList,
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
