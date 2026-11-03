import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  previewPlatform: vi.fn(),
  uploadPlatform: vi.fn(),
}))

vi.mock('../src/upload', () => ({
  uploadPlatform: mocks.uploadPlatform,
}))

vi.mock('../src/preview', () => ({
  previewPlatform: mocks.previewPlatform,
}))

const { previewMany, uploadMany } = await import('../src/batch')
const { ConfigError, UploadError } = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.uploadPlatform.mockImplementation(async (platform: string) => ({
    message: `${platform} upload ok`,
    platform,
    raw: {},
    version: '1.0.0',
  }))
  mocks.previewPlatform.mockImplementation(async (platform: string) => ({
    message: `${platform} preview ok`,
    platform,
    qrCode: { kind: 'url', value: `https://qr/${platform}` },
    raw: {},
  }))
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-batch-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await mkdir(path.join(cwd, 'dist/alipay'), { recursive: true })
  await mkdir(path.join(cwd, 'dist/dingtalk'), { recursive: true })
  await mkdir(path.join(cwd, 'keys'), { recursive: true })
  await writeFile(path.join(cwd, 'keys/weixin.key'), 'key')
  await writeFile(path.join(cwd, 'keys/alipay.key'), 'key')
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))

  return cwd
}

function createConfig() {
  return {
    version: '1.0.0',
    weixin: { appid: 'wx', privateKeyPath: 'keys/weixin.key', projectPath: 'dist/weixin' },
    alipay: { appid: 'ali', privateKeyPath: 'keys/alipay.key', projectPath: 'dist/alipay', toolId: 'tool' },
    dingtalk: { appid: 'dd', projectPath: 'dist/dingtalk', token: 'token' },
  }
}

describe('uploadMany', () => {
  it('按配置顺序串行执行并汇总', async () => {
    const cwd = await createFixture()

    const result = await uploadMany({ config: createConfig(), cwd })

    expect(result.ok).toBe(true)
    expect(result.results.map(item => item.platform)).toEqual(['weixin', 'alipay', 'dingtalk'])
    expect(result.results.every(item => item.ok)).toBe(true)
    expect(mocks.uploadPlatform).toHaveBeenCalledTimes(3)
  })

  it('显式平台覆盖配置并去重', async () => {
    const cwd = await createFixture()

    await uploadMany({ config: createConfig(), cwd, platforms: ['alipay', 'alipay'] })

    expect(mocks.uploadPlatform).toHaveBeenCalledTimes(1)
    expect(mocks.uploadPlatform).toHaveBeenCalledWith('alipay', expect.anything(), { cwd })
  })

  it('没有平台时抛出 ConfigError', async () => {
    const cwd = await createFixture()

    await expect(uploadMany({ config: { version: '1.0.0' }, cwd }))
      .rejects
      .toThrow(ConfigError)
  })

  it('部分失败不影响其它平台', async () => {
    const cwd = await createFixture()
    mocks.uploadPlatform.mockImplementation(async (platform: string) => {
      if (platform === 'alipay')
        throw new UploadError('ali failed')
      return { message: 'ok', platform, raw: {}, version: '1.0.0' }
    })

    const result = await uploadMany({ config: createConfig(), cwd })

    expect(result.ok).toBe(false)
    expect(result.results.map(item => item.ok)).toEqual([true, false, true])
    expect(result.results[1].error).toMatchObject({ code: 'UPLOAD_ERROR', message: 'ali failed' })
  })

  it('支持并发数限制且保持结果顺序', async () => {
    const cwd = await createFixture()
    let active = 0
    let maxActive = 0

    mocks.uploadPlatform.mockImplementation(async (platform: string) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active--
      return { message: platform, platform, raw: {}, version: '1.0.0' }
    })

    const result = await uploadMany({ concurrency: 2, config: createConfig(), cwd })

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(result.results.map(item => item.platform)).toEqual(['weixin', 'alipay', 'dingtalk'])
  })

  it('dryRun 返回校验计划且不调用 SDK', async () => {
    const cwd = await createFixture()

    const result = await uploadMany({ config: createConfig(), cwd, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.results.every(item => item.result && 'checks' in item.result)).toBe(true)
    expect(mocks.uploadPlatform).not.toHaveBeenCalled()
  })

  it('dryRun 校验失败时 ok 为 false', async () => {
    const cwd = await createFixture()

    const result = await uploadMany({
      config: {
        version: '1.0.0',
        weixin: { appid: 'wx', privateKeyPath: 'keys/missing.key', projectPath: 'dist/weixin' },
      },
      cwd,
      dryRun: true,
    })

    expect(result.ok).toBe(false)
    expect(result.results[0].result).toMatchObject({
      checks: expect.arrayContaining([expect.objectContaining({ name: '私钥', ok: false })]),
    })
  })

  it('jSON 模式可把 SDK stdout 重定向到 stderr', async () => {
    const cwd = await createFixture()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    mocks.uploadPlatform.mockImplementationOnce(async (platform: string) => {
      process.stdout.write(`sdk-log-${platform}\n`)
      return { message: 'ok', platform, raw: {}, version: '1.0.0' }
    })

    try {
      await uploadMany({
        config: createConfig(),
        cwd,
        platforms: ['weixin'],
        redirectStdoutToStderr: true,
      })

      expect(stderrSpy.mock.calls.some(call => String(call[0]).includes('sdk-log-weixin'))).toBe(true)
    }
    finally {
      stderrSpy.mockRestore()
    }
  })
})

describe('previewMany', () => {
  it('传递预览选项并汇总二维码', async () => {
    const cwd = await createFixture()

    const result = await previewMany({
      config: createConfig(),
      cwd,
      pagePath: 'pages/index/index',
      platforms: ['weixin'],
      qrFormat: 'image',
      qrOutput: 'out/qr.png',
      query: 'a=1',
      scene: '1011',
    })

    expect(mocks.previewPlatform).toHaveBeenCalledWith('weixin', expect.anything(), expect.objectContaining({
      pagePath: 'pages/index/index',
      qrFormat: 'image',
      qrOutput: 'out/qr.png',
      query: 'a=1',
      scene: '1011',
    }))
    expect(result.results[0].result).toMatchObject({ platform: 'weixin' })
  })
})
