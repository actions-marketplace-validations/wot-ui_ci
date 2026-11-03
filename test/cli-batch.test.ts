import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  previewMany: vi.fn(),
  release: vi.fn(),
  uploadMany: vi.fn(),
  uploadPlatform: vi.fn(),
}))

vi.mock('../src/batch', () => ({
  previewMany: mocks.previewMany,
  uploadMany: mocks.uploadMany,
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
  uploadPlatform: mocks.uploadPlatform,
}))

const { runCli } = await import('../src/cli')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.uploadMany.mockResolvedValue({
    dryRun: false,
    durationMs: 20,
    ok: true,
    results: [
      {
        durationMs: 10,
        ok: true,
        platform: 'weixin',
        result: { message: '微信上传成功', platform: 'weixin', sizes: { main: 1024, total: 2048 }, version: '1.0.0' },
      },
      {
        durationMs: 10,
        ok: true,
        platform: 'alipay',
        result: { message: '支付宝上传成功', platform: 'alipay', version: '1.0.0' },
      },
    ],
  })
  mocks.previewMany.mockResolvedValue({
    dryRun: false,
    durationMs: 10,
    ok: true,
    results: [{
      durationMs: 10,
      ok: true,
      platform: 'weixin',
      result: { message: '预览成功', platform: 'weixin', qrCode: { kind: 'file', value: '/tmp/qr.png' } },
    }],
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-batch-'))
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

describe('runCli batch', () => {
  it('--all --json --summary --concurrency 输出 JSON 和 summary', async () => {
    const cwd = await createProject()
    const { stdout, stderr, writers } = createWriters()

    const exitCode = await runCli([
      'upload',
      '--all',
      '--json',
      '--summary',
      'out/summary.md',
      '--concurrency',
      '2',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.uploadMany).toHaveBeenCalledWith(expect.objectContaining({
      concurrency: 2,
      platforms: undefined,
      redirectStdoutToStderr: true,
    }))
    expect(stdout).toHaveLength(1)
    const payload = JSON.parse(stdout[0]) as { command: string, results: unknown[] }
    expect(payload.command).toBe('upload')
    expect(payload.results).toHaveLength(2)
    expect(stderr.some(line => line.includes('配置加载完成'))).toBe(true)
    expect(await readFile(path.join(cwd, 'out/summary.md'), 'utf8')).toContain('| weixin |')
  })

  it('逗号平台 + dry-run 走批量计划', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.uploadMany.mockResolvedValueOnce({
      dryRun: true,
      durationMs: 5,
      ok: true,
      results: [{
        durationMs: 5,
        ok: true,
        platform: 'weixin',
        result: {
          action: 'upload',
          checks: [{ name: '配置', ok: true }],
          ok: true,
          platform: 'weixin',
        },
      }],
    })

    const exitCode = await runCli([
      'upload',
      '-p',
      'weixin,alipay',
      '--dry-run',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.uploadMany).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
      platforms: ['weixin', 'alipay'],
    }))
    expect(stdout.some(line => line.includes('dry-run：共 1 个平台'))).toBe(true)
  })

  it('preview --all --json', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['preview', '--all', '--json'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.previewMany).toHaveBeenCalledWith(expect.objectContaining({
      platforms: undefined,
      redirectStdoutToStderr: true,
    }))
    expect(JSON.parse(stdout[0])).toMatchObject({ command: 'preview', ok: true })
  })

  it('批量失败返回 1 并打印失败平台', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()
    mocks.uploadMany.mockResolvedValueOnce({
      dryRun: false,
      durationMs: 20,
      ok: false,
      results: [
        { durationMs: 10, ok: true, platform: 'weixin', result: { message: 'ok', platform: 'weixin' } },
        {
          durationMs: 10,
          error: { code: 'UPLOAD_ERROR', message: '支付宝失败' },
          ok: false,
          platform: 'alipay',
        },
      ],
    })

    const exitCode = await runCli(['upload', '--all'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('[失败] [alipay] 支付宝失败'))).toBe(true)
  })
})

describe('runCli batch 补充分支', () => {
  it('preview 非 JSON 输出开始与完成日志', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['preview', '--all'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('开始批量生成预览二维码'))).toBe(true)
    expect(stdout.some(line => line.includes('预览完成'))).toBe(true)
  })

  it('jSON 模式没有注入 writer 时写 process.stdout/stderr', async () => {
    const cwd = await createProject()
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      const exitCode = await runCli(['upload', '--all', '--json'], { cwd })

      expect(exitCode).toBe(0)
      expect(stdoutSpy.mock.calls.some(call => String(call[0]).includes('"schemaVersion"'))).toBe(true)
      expect(stderrSpy).toHaveBeenCalled()
    }
    finally {
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  })

  it('jSON 模式包含 sourceFile', async () => {
    const cwd = await createProject()
    await writeFile(path.join(cwd, 'custom.config.js'), 'export default {}\n')
    const { stdout, writers } = createWriters()

    await runCli(['upload', '--all', '--json', '--config', 'custom.config.js'], { cwd, ...writers })

    expect(JSON.parse(stdout[0]).config.sourceFile).toBe(path.join(cwd, 'custom.config.js'))
  })

  it('结果无 message 时使用成功/失败占位', async () => {
    const cwd = await createProject()
    const { stdout, stderr, writers } = createWriters()
    mocks.uploadMany.mockResolvedValueOnce({
      dryRun: false,
      durationMs: 1,
      ok: false,
      results: [
        { durationMs: 1, ok: true, platform: 'weixin' },
        { durationMs: 1, ok: false, platform: 'alipay' },
      ],
    })

    await runCli(['upload', '--all'], { cwd, ...writers })

    expect(stdout.some(line => line.includes('[成功] [weixin] 成功'))).toBe(true)
    expect(stderr.some(line => line.includes('[失败] [alipay] 失败'))).toBe(true)
  })
})

describe('单平台预算失败', () => {
  it('预算超限时退出码为 1 并打印原因', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()
    mocks.uploadPlatform.mockResolvedValueOnce({
      budget: { ok: false, violations: [{ actual: 4096, limit: 1024, metric: 'total' }], warnOnly: false },
      message: '微信上传成功',
      platform: 'weixin',
      raw: {},
      sizes: { total: 4096 },
      version: '1.0.0',
    })

    const exitCode = await runCli(['upload', '-p', 'weixin'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('总包 4KB 超出预算 1KB'))).toBe(true)
  })
})
