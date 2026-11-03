import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildNpm: vi.fn(),
  checkCodeQuality: vi.fn(),
  downloadCompiledResult: vi.fn(),
  downloadSourceMap: vi.fn(),
  previewMany: vi.fn(),
  previewPlatform: vi.fn(),
  uploadMany: vi.fn(),
  uploadPlatform: vi.fn(),
}))

vi.mock('../src/weixin-diagnostics', () => ({
  buildNpm: mocks.buildNpm,
  checkCodeQuality: mocks.checkCodeQuality,
  downloadCompiledResult: mocks.downloadCompiledResult,
  downloadSourceMap: mocks.downloadSourceMap,
}))

vi.mock('../src/upload', () => ({ uploadPlatform: mocks.uploadPlatform }))
vi.mock('../src/preview', () => ({ previewPlatform: mocks.previewPlatform }))
vi.mock('../src/batch', () => ({ previewMany: mocks.previewMany, uploadMany: mocks.uploadMany }))
vi.mock('../src/release', () => ({ release: vi.fn() }))
vi.mock('../src/ide', () => ({
  autoIde: vi.fn(),
  closeIde: vi.fn(),
  getIdeStatus: vi.fn(),
  openIde: vi.fn(),
  previewIde: vi.fn(),
}))
vi.mock('../src/init', () => ({ initProject: vi.fn() }))
vi.mock('../src/doctor', () => ({ runDoctor: vi.fn() }))

const { runCli } = await import('../src/cli')
const { createCliHelpText } = await import('../src/messages')
const { WeixinDiagnosticError } = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buildNpm.mockResolvedValue({
    message: 'npm 构建完成',
    platform: 'weixin',
    warnings: [],
  })
  mocks.downloadSourceMap.mockResolvedValue({
    message: 'sourceMap 已下载',
    outputPath: '/tmp/sm.zip',
    platform: 'weixin',
  })
  mocks.downloadCompiledResult.mockResolvedValue({
    message: '编译产物已导出',
    outputPath: '/tmp/compiled.zip',
    platform: 'weixin',
  })
  mocks.checkCodeQuality.mockResolvedValue({
    checks: 2,
    issues: [],
    message: '代码质量检查完成：2 项检查全部通过',
    ok: true,
    platform: 'weixin',
  })
  mocks.uploadPlatform.mockResolvedValue({ message: '上传成功', platform: 'weixin' })
  mocks.previewPlatform.mockResolvedValue({ message: '预览成功', platform: 'weixin' })
  mocks.uploadMany.mockResolvedValue({ dryRun: false, durationMs: 1, ok: true, results: [] })
  mocks.previewMany.mockResolvedValue({ dryRun: false, durationMs: 1, ok: true, results: [] })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-diagnostics-'))
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

describe('runCli build-npm', () => {
  it('输出 JSON，透传 ignores', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['build-npm', '-p', 'weixin', '--ignores', 'a, b', '--json'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.buildNpm).toHaveBeenCalledWith('weixin', {
      config: expect.anything(),
      cwd,
      ignores: ['a', 'b'],
    })
    expect(JSON.parse(stdout[0])).toMatchObject({
      command: 'build-npm',
      message: 'npm 构建完成',
      platform: 'weixin',
      schemaVersion: 1,
    })
  })

  it('打印警告并写 summary', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.buildNpm.mockResolvedValueOnce({
      message: 'npm 构建完成，1 条警告',
      platform: 'weixin',
      warnings: [{ code: 'W1', jsPath: 'app.js', msg: '未使用的依赖', startLine: 2 }],
    })

    const exitCode = await runCli(['build-npm', '-p', 'weixin', '--summary', 'out/summary.md'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('未使用的依赖') && line.includes('app.js:2'))).toBe(true)
    const summary = await readFile(path.join(cwd, 'out/summary.md'), 'utf8')
    expect(summary).toContain('## 微信构建与诊断：build-npm')
    expect(summary).toContain('| 警告 | 1 条 |')
    expect(summary).toContain('未使用的依赖')
  })
})

describe('runCli sourcemap / inspect', () => {
  it('sourcemap 透传 output、robot、streaming', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli([
      'sourcemap',
      '-p',
      'weixin',
      '--output',
      'sm.zip',
      '--robot',
      '2',
      '--streaming',
      '--json',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.downloadSourceMap).toHaveBeenCalledWith('weixin', {
      config: expect.anything(),
      cwd,
      output: 'sm.zip',
      robot: 2,
      streaming: true,
    })
    expect(JSON.parse(stdout[0])).toMatchObject({ command: 'sourcemap', outputPath: '/tmp/sm.zip' })
  })

  it('sourcemap 只用默认参数', async () => {
    const cwd = await createProject()
    const { writers } = createWriters()

    await runCli(['sourcemap', '-p', 'weixin'], { cwd, ...writers })

    expect(mocks.downloadSourceMap).toHaveBeenCalledWith('weixin', {
      config: expect.anything(),
      cwd,
    })
  })

  it('inspect 支持 output 与 robot', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    await runCli([
      'inspect',
      '-p',
      'weixin',
      '--output',
      'compiled.zip',
      '--robot',
      '4',
      '--json',
    ], { cwd, ...writers })

    expect(mocks.downloadCompiledResult).toHaveBeenCalledWith('weixin', {
      config: expect.anything(),
      cwd,
      output: 'compiled.zip',
      robot: 4,
    })
    expect(JSON.parse(stdout[0])).toMatchObject({ command: 'inspect' })
  })

  it('inspect 默认参数与 JSON 输出', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli(['inspect', '-p', 'weixin', '--json'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.downloadCompiledResult).toHaveBeenCalledWith('weixin', {
      config: expect.anything(),
      cwd,
    })
    expect(JSON.parse(stdout[0])).toMatchObject({
      command: 'inspect',
      outputPath: '/tmp/compiled.zip',
      platform: 'weixin',
    })
  })
})

describe('runCli quality', () => {
  it('展示未通过项与输出路径', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.checkCodeQuality.mockResolvedValueOnce({
      checks: 2,
      issues: [{ name: 'PACKAGE_SIZE_LIMIT', success: false, text: '超出限制' }],
      message: '代码质量检查完成：2 项检查，1 项未通过',
      ok: false,
      outputPath: path.join(cwd, 'report.json'),
      platform: 'weixin',
    })

    const exitCode = await runCli(['quality', '-p', 'weixin', '--output', 'report.json'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('PACKAGE_SIZE_LIMIT') && line.includes('超出限制'))).toBe(true)
    expect(stdout.some(line => line.includes('输出：'))).toBe(true)
  })

  it('写 summary 并在 JSON 中保留 issues', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.checkCodeQuality.mockResolvedValueOnce({
      checks: 1,
      issues: [{ name: 'JS_COMPRESS_OPEN', success: false, text: '未开启' }],
      message: '代码质量检查完成：1 项检查，1 项未通过',
      ok: false,
      platform: 'weixin',
    })

    await runCli(['quality', '-p', 'weixin', '--summary', 'summary.md', '--json'], { cwd, ...writers })

    expect(JSON.parse(stdout[0])).toMatchObject({
      command: 'quality',
      issues: [expect.objectContaining({ name: 'JS_COMPRESS_OPEN' })],
      ok: false,
    })
    const summary = await readFile(path.join(cwd, 'summary.md'), 'utf8')
    expect(summary).toContain('| 未通过 | 1 |')
    expect(summary).toContain('JS_COMPRESS_OPEN')
  })

  it('--fail-on-issues 有未通过项时返回 1', async () => {
    const cwd = await createProject()
    const { writers } = createWriters()
    mocks.checkCodeQuality.mockResolvedValueOnce({
      checks: 1,
      issues: [{ name: 'JS_COMPRESS_OPEN', success: false }],
      message: '1 项未通过',
      ok: false,
      platform: 'weixin',
    })

    const exitCode = await runCli(['quality', '-p', 'weixin', '--fail-on-issues'], { cwd, ...writers })

    expect(exitCode).toBe(1)
  })

  it('诊断失败返回 1', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()
    mocks.checkCodeQuality.mockRejectedValueOnce(new WeixinDiagnosticError('微信代码质量检查失败'))

    const exitCode = await runCli(['quality', '-p', 'weixin'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('微信代码质量检查失败'))).toBe(true)
  })
})

describe('runCli --build-npm', () => {
  it('upload 透传 buildNpm', async () => {
    const cwd = await createProject()
    const { writers } = createWriters()

    const exitCode = await runCli(['upload', '-p', 'weixin', '--build-npm'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.uploadPlatform).toHaveBeenCalledWith('weixin', expect.anything(), {
      buildNpm: true,
      cwd,
    })
  })

  it('preview 透传 buildNpm', async () => {
    const cwd = await createProject()
    const { writers } = createWriters()

    await runCli(['preview', '-p', 'weixin', '--build-npm'], { cwd, ...writers })

    expect(mocks.previewPlatform).toHaveBeenCalledWith('weixin', expect.anything(), expect.objectContaining({
      buildNpm: true,
      cwd,
    }))
  })

  it('批量上传透传 buildNpm', async () => {
    const cwd = await createProject()
    const { writers } = createWriters()

    await runCli(['upload', '--all', '--build-npm', '--json'], { cwd, ...writers })

    expect(mocks.uploadMany).toHaveBeenCalledWith(expect.objectContaining({ buildNpm: true }))
  })

  it('帮助信息包含新命令', () => {
    const help = createCliHelpText()

    expect(help).toContain('wotci build-npm')
    expect(help).toContain('wotci sourcemap')
    expect(help).toContain('wotci inspect')
    expect(help).toContain('wotci quality')
    expect(help).toContain('--build-npm')
  })
})
