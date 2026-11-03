import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
}))

vi.mock('../src/release', () => ({
  release: mocks.release,
}))

vi.mock('../src/ide', () => ({
  autoIde: vi.fn(),
  closeIde: vi.fn(),
  getIdeStatus: vi.fn(),
  openIde: vi.fn(),
  previewIde: vi.fn(),
}))

vi.mock('../src/preview', () => ({
  previewPlatform: vi.fn(),
}))

vi.mock('../src/upload', () => ({
  uploadPlatform: vi.fn(),
}))

const { runCli } = await import('../src/cli')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.release.mockResolvedValue({
    build: { commands: ['npm run build'], durationMs: 10, ok: true, skipped: false },
    dryRun: false,
    durationMs: 20,
    ok: true,
    platforms: [
      { durationMs: 10, message: '微信上传成功', ok: true, platform: 'weixin', version: '1.0.0' },
      { durationMs: 10, message: '支付宝上传成功', ok: true, platform: 'alipay', version: '1.0.0' },
    ],
    version: '1.0.0',
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-release-'))
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

describe('runCli release', () => {
  it('拆分平台并传递构建/历史/评论参数', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli([
      'release',
      '-p',
      'weixin,alipay',
      '--build',
      'npm ci && npm run build',
      '--skip-build',
      '--no-history',
      '--history-file',
      'custom/history.json',
      '--pr-comment',
      '--dry-run',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({
      buildCommand: 'npm ci && npm run build',
      dryRun: true,
      history: false,
      historyFile: 'custom/history.json',
      platforms: ['weixin', 'alipay'],
      prComment: true,
      skipBuild: true,
    }))
    expect(stdout.some(line => line.includes('[成功] [weixin] 微信上传成功'))).toBe(true)
    expect(stdout.some(line => line.includes('开始构建并发布小程序'))).toBe(true)
  })

  it('--all 不传 platforms', async () => {
    const cwd = await createProject()
    const { writers } = createWriters()

    await runCli(['release', '--all'], { cwd, ...writers })

    expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({ platforms: undefined }))
  })

  it('平台失败时返回 1 并打印失败', async () => {
    const cwd = await createProject()
    const { stdout, stderr, writers } = createWriters()
    mocks.release.mockResolvedValueOnce({
      build: { commands: [], durationMs: 0, ok: true, skipped: true },
      dryRun: false,
      durationMs: 20,
      ok: false,
      platforms: [
        { durationMs: 10, message: '微信上传成功', ok: true, platform: 'weixin', version: '1.0.0' },
        {
          durationMs: 10,
          error: { code: 'UPLOAD_ERROR', message: '支付宝上传失败' },
          message: '支付宝上传失败',
          ok: false,
          platform: 'alipay',
        },
      ],
    })

    const exitCode = await runCli(['release'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('[失败] [alipay] 支付宝上传失败'))).toBe(true)
    expect(stdout).toContain('[成功] 发布失败')
  })

  it('打印构建错误、历史与评论信息', async () => {
    const cwd = await createProject()
    const { stdout, stderr, writers } = createWriters()
    mocks.release.mockResolvedValueOnce({
      build: {
        commands: ['npm run build'],
        durationMs: 1,
        error: { code: 'BUILD_ERROR', message: 'build failed' },
        ok: false,
        skipped: false,
      },
      commentError: 'comment failed',
      commentUrl: 'https://comment/1',
      dryRun: false,
      durationMs: 20,
      historyError: 'history failed',
      historyFile: '/tmp/history.json',
      ok: false,
      platforms: [],
    })

    const exitCode = await runCli(['release'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 构建失败：build failed')
    expect(stderr).toContain('[失败] 写入发布历史失败：history failed')
    expect(stderr).toContain('[失败] PR 评论失败：comment failed')
    expect(stdout.some(line => line.includes('发布历史已写入'))).toBe(true)
    expect(stdout.some(line => line.includes('PR 评论：https://comment/1'))).toBe(true)
  })

  it('dry-run 输出计划', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.release.mockResolvedValueOnce({
      build: { commands: ['npm run build'], durationMs: 0, ok: true, skipped: false },
      dryRun: true,
      durationMs: 0,
      ok: true,
      platforms: [
        { durationMs: 0, message: '待发布', ok: true, platform: 'weixin' },
      ],
    })

    await runCli(['release', '--dry-run'], { cwd, ...writers })

    expect(stdout.some(line => line.includes('dry-run：构建 npm run build，平台 weixin'))).toBe(true)
  })

  it('dry-run 跳过构建时输出“跳过”', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.release.mockResolvedValueOnce({
      build: { commands: ['npm run build'], durationMs: 0, ok: true, skipped: true },
      dryRun: true,
      durationMs: 0,
      ok: true,
      platforms: [{ durationMs: 0, message: '待发布', ok: true, platform: 'weixin' }],
    })

    await runCli(['release', '--dry-run', '--skip-build'], { cwd, ...writers })

    expect(stdout.some(line => line.includes('dry-run：构建 跳过'))).toBe(true)
  })

  it('dry-run 未配置构建命令时输出“未配置”', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.release.mockResolvedValueOnce({
      build: { commands: [], durationMs: 0, ok: true, skipped: false },
      dryRun: true,
      durationMs: 0,
      ok: true,
      platforms: [{ durationMs: 0, message: '待发布', ok: true, platform: 'weixin' }],
    })

    await runCli(['release', '--dry-run'], { cwd, ...writers })

    expect(stdout.some(line => line.includes('dry-run：构建 未配置'))).toBe(true)
  })
})

describe('release JSON 与 summary', () => {
  it('同时输出 JSON 与 summary 文件', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli([
      'release',
      '--json',
      '--summary',
      'out/release.md',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout[0])).toMatchObject({ command: 'release', ok: true, schemaVersion: 1 })
    expect(await readFile(path.join(cwd, 'out/release.md'), 'utf8')).toContain('小程序发布成功')
  })
})
