import type { WotciConfig } from '../src/types'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLatestVersion: vi.fn(),
  upload: vi.fn(),
  build: vi.fn(),
}))

vi.mock('minidev', () => ({ default: {} }))
vi.mock('../src/version', () => ({ getLatestVersion: mocks.getLatestVersion }))
vi.mock('../src/platforms/alipay', () => ({ uploadAlipay: mocks.upload }))
vi.mock('../src/platforms/weixin', () => ({ uploadWeixin: mocks.upload }))
vi.mock('../src/platforms/dingtalk', () => ({ uploadDingTalk: mocks.upload }))
vi.mock('../src/release/command', () => ({ runShellCommand: mocks.build }))
vi.mock('../src/release/git', () => ({ readGitInfo: async () => ({ commit: 'test' }) }))

const { runCli } = await import('../src/cli')
const { upload } = await import('../src/upload')
const { uploadMany, previewMany } = await import('../src/batch')
const { release } = await import('../src/release')
const { renderBatchJson } = await import('../src/output/json')
const { renderBatchSummary } = await import('../src/output/summary')
const { renderReleaseComment } = await import('../src/release/github')
const { VersionUnsupportedError } = await import('../src/errors')

let cwd: string
let config: WotciConfig

beforeEach(async () => {
  vi.clearAllMocks()
  cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-version-resolution-'))
  config = {
    version: '1.0.0',
    versionStrategy: { type: 'auto', bump: 'patch' },
    release: { prComment: false, buildCommand: 'test-build' },
    weixin: { appid: 'wx', privateKeyPath: 'key', projectPath: 'dist' },
    alipay: { appid: 'ali', privateKey: 'key', projectPath: 'dist', toolId: 'tool' },
    dingtalk: { appid: 'dd', token: 'test-token', projectPath: 'dist' },
  }
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ version: '1.5.0' }))
  await writeFile(path.join(cwd, 'wotci.config.mjs'), `export default ${JSON.stringify(config)}`)
  mocks.getLatestVersion.mockImplementation(async (platform: string) => ({
    platform,
    latest: platform === 'weixin' ? '9.0.0' : '2.0.0',
  }))
  mocks.upload.mockImplementation(async (loaded: WotciConfig) => ({
    platform: 'alipay',
    version: loaded.version,
    message: 'uploaded',
    raw: {},
  }))
  mocks.build.mockResolvedValue({ stdout: '', stderr: '' })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { force: true, recursive: true })
})

describe('版本解析入口一致性', () => {
  it.each([[], ['--json'], ['--summary', 'summary.md'], ['--concurrency', '2']].map(extra => ({ extra })))('cLI 输出模式 $extra 使用同一目标版本', async ({ extra }) => {
    const stdout: string[] = []
    const stderr: string[] = []
    const code = await runCli(['upload', '-p', 'alipay', ...extra], {
      cwd,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
    })
    expect(code).toBe(0)
    expect(mocks.getLatestVersion.mock.calls.map(call => call[0])).toEqual(['alipay'])
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ version: '2.0.1' }), { cwd })
    if (extra.includes('--json')) {
      expect(stdout).toHaveLength(1)
      expect(JSON.parse(stdout[0]).versionResolution).toMatchObject({
        baseSource: 'platform',
        baseVersion: '2.0.0',
        version: '2.0.1',
        tentative: false,
      })
    }
    else {
      expect(stdout.join('\n')).toContain('基础 platform: 2.0.0')
    }
    if (extra.includes('--summary'))
      expect(await readFile(path.join(cwd, 'summary.md'), 'utf8')).toContain('版本查询 alipay: success (2.0.0)')
  })

  it('jS 单平台、批量和 release 保留相同依据，历史和摘要可追溯', async () => {
    const single = await upload('alipay', { cwd, config })
    const batch = await uploadMany({ cwd, config, platforms: ['alipay'] })
    const released = await release({ cwd, config, platforms: ['alipay'] })
    expect(mocks.getLatestVersion.mock.calls.map(call => call[0])).toEqual(['alipay', 'alipay', 'alipay'])
    expect(batch.versionResolution).toEqual(single.versionResolution)
    expect(released.versionResolution).toEqual(single.versionResolution)
    expect(JSON.parse(renderBatchJson(batch, 'upload')).versionResolution).toEqual(single.versionResolution)
    const history = JSON.parse(await readFile(released.historyFile!, 'utf8'))
    expect(history.records[0].versionResolution).toEqual(single.versionResolution)
    expect(renderReleaseComment(released)).toContain('基础 platform: 2.0.0')
  })

  it('dd 别名只查询钉钉，回退依据同时出现在结果与警告中', async () => {
    mocks.getLatestVersion.mockRejectedValue(new VersionUnsupportedError('unsupported'))
    const result = await upload('dd', { cwd, config })
    expect(mocks.getLatestVersion.mock.calls.map(call => call[0])).toEqual(['dingtalk'])
    expect(result.versionResolution).toMatchObject({
      baseSource: 'package',
      baseVersion: '1.5.0',
      version: '1.5.1',
      tentative: true,
      queries: [{ platform: 'dingtalk', status: 'unsupported' }],
      warnings: [expect.stringContaining('不支持版本查询'), expect.stringContaining('回退')],
    })
  })

  it('查询全失败时，CLI 明示回退；JSON 和历史均不包含原始错误', async () => {
    mocks.getLatestVersion.mockRejectedValue(new Error('token=secret-value'))
    const stdout: string[] = []
    const code = await runCli(['upload', '-p', 'alipay'], { cwd, stdout: line => stdout.push(line) })
    expect(code).toBe(0)
    expect(stdout.join('\n')).toContain('警告：alipay：版本查询失败')
    expect(stdout.join('\n')).toContain('回退到 package')
    const batch = await uploadMany({ cwd, config, platforms: ['alipay'] })
    const released = await release({ cwd, config, platforms: ['alipay'] })
    expect(renderBatchJson(batch, 'upload')).not.toContain('secret-value')
    expect(await readFile(released.historyFile!, 'utf8')).not.toContain('secret-value')
    expect(renderBatchSummary(batch, 'upload')).toContain('警告：alipay：版本查询失败')
  })

  it.each(['single', 'batch', 'release'] as const)('strict 在 %s 的上传及构建前失败', async (entry) => {
    config.versionStrategy = { type: 'auto', bump: 'patch', strict: true }
    mocks.getLatestVersion.mockRejectedValue(new Error('network'))
    const operation = entry === 'single'
      ? upload('alipay', { cwd, config })
      : entry === 'batch'
        ? uploadMany({ cwd, config, platforms: ['alipay'] })
        : release({ cwd, config, platforms: ['alipay'] })
    await expect(operation).rejects.toThrow('严格自动版本策略')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.build).not.toHaveBeenCalled()
    await expect(readFile(path.join(cwd, '.wotci/history.json'))).rejects.toThrow()
  })

  it('dry-run 即使 strict 也不联网，并明确标记暂定；预览不应用上传策略', async () => {
    config.versionStrategy = { type: 'auto', bump: 'patch', strict: true }
    const batch = await uploadMany({ cwd, config, platforms: ['alipay'], dryRun: true })
    const released = await release({ cwd, config, platforms: ['alipay'], dryRun: true })
    const preview = await previewMany({ cwd, config, platforms: ['alipay'], dryRun: true })
    expect(batch.versionResolution).toEqual(released.versionResolution)
    expect(batch.versionResolution).toMatchObject({
      version: '1.5.1',
      tentative: true,
      queries: [{ platform: 'alipay', status: 'skipped' }],
    })
    expect(renderBatchSummary(batch, 'upload')).toContain('暂定')
    expect(renderReleaseComment(released)).toContain('暂定')
    expect(preview.versionResolution).toBeUndefined()
    expect(mocks.getLatestVersion).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.build).not.toHaveBeenCalled()
  })

  it.each(['upload', 'release'])('%s --json 将版本查询 SDK 日志写入 stderr', async (command) => {
    mocks.getLatestVersion.mockImplementation(async () => {
      process.stdout.write('SDK version log\n')
      return { platform: 'alipay', latest: '2.0.0' }
    })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const output: string[] = []
    const code = await runCli([command, '-p', 'alipay', '--json'], {
      cwd,
      stdout: line => output.push(line),
      stderr: () => {},
    })
    expect(code).toBe(0)
    expect(output).toHaveLength(1)
    expect(JSON.parse(output[0]).versionResolution.version).toBe('2.0.1')
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(stderrSpy).toHaveBeenCalledWith('SDK version log\n', undefined, undefined)
  })
})
