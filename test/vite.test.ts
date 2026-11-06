import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  previewMany: vi.fn(),
  uploadMany: vi.fn(),
}))

vi.mock('../src/batch', () => ({
  previewMany: mocks.previewMany,
  uploadMany: mocks.uploadMany,
}))

const { default: wotciPlugin } = await import('../src/vite')

const successResult = {
  dryRun: false,
  durationMs: 1,
  ok: true,
  results: [{ durationMs: 1, ok: true, platform: 'weixin', result: { message: 'ok' } }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.previewMany.mockResolvedValue(successResult)
  mocks.uploadMany.mockResolvedValue(successResult)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function createPlugin(options: Parameters<typeof wotciPlugin>[0] = {}) {
  const plugin = wotciPlugin(options)
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }

  ;(plugin.configResolved as (config: unknown) => void)({
    command: 'build',
    logger,
    root: '/repo',
  })

  return { logger, plugin }
}

async function runBundle(plugin: ReturnType<typeof wotciPlugin>) {
  await (plugin.closeBundle as () => Promise<void>)()
}

describe('wotciPlugin', () => {
  it('上传日志和结果回调保留版本回退依据', async () => {
    const versionResolution = {
      source: 'auto',
      version: '1.0.1',
      baseSource: 'package',
      baseVersion: '1.0.0',
      tentative: true,
      queries: [{ platform: 'weixin', status: 'unsupported' }],
      warnings: ['weixin：不支持版本查询。'],
    }
    mocks.uploadMany.mockResolvedValueOnce({ ...successResult, versionResolution })
    const onResult = vi.fn()
    const { plugin, logger } = createPlugin({ action: 'upload', onResult })

    await runBundle(plugin)

    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ versionResolution }))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('基础 package: 1.0.0'))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('警告：weixin：不支持版本查询'))
  })

  it('默认在构建后预览，并从 UNI_PLATFORM 推断平台', async () => {
    vi.stubEnv('UNI_PLATFORM', 'mp-weixin')
    const { plugin } = createPlugin({ configFile: 'wotci.config.ts' })

    await runBundle(plugin)

    expect(mocks.previewMany).toHaveBeenCalledWith(expect.objectContaining({
      configFile: 'wotci.config.ts',
      cwd: '/repo',
      platforms: ['weixin'],
    }))
    expect(mocks.uploadMany).not.toHaveBeenCalled()
  })

  it('action:upload 调用 uploadMany 并传递预览/并发选项', async () => {
    const { plugin } = createPlugin({
      action: 'upload',
      concurrency: 2,
      dryRun: true,
      platforms: ['alipay'],
    })

    await runBundle(plugin)

    expect(mocks.uploadMany).toHaveBeenCalledWith(expect.objectContaining({
      concurrency: 2,
      dryRun: true,
      platforms: ['alipay'],
    }))
    expect(mocks.previewMany).not.toHaveBeenCalled()
  })

  it('显式平台覆盖环境变量', async () => {
    vi.stubEnv('UNI_PLATFORM', 'mp-weixin')
    const { plugin } = createPlugin({ platforms: ['dingtalk'] })

    await runBundle(plugin)

    expect(mocks.previewMany).toHaveBeenCalledWith(expect.objectContaining({
      platforms: ['dingtalk'],
    }))
  })

  it('action:false / enabled:false / serve 命令不执行', async () => {
    const disabled = createPlugin({ action: false }).plugin
    await runBundle(disabled)

    const notEnabled = createPlugin({ enabled: false }).plugin
    await runBundle(notEnabled)

    const serve = wotciPlugin()
    ;(serve.configResolved as (config: unknown) => void)({
      command: 'serve',
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      root: '/repo',
    })
    await runBundle(serve)

    expect(mocks.previewMany).not.toHaveBeenCalled()
    expect(mocks.uploadMany).not.toHaveBeenCalled()
  })

  it('closeBundle 只执行一次', async () => {
    const { plugin } = createPlugin()

    await runBundle(plugin)
    await runBundle(plugin)

    expect(mocks.previewMany).toHaveBeenCalledTimes(1)
  })

  it('failOnError 默认让构建失败，可关闭', async () => {
    mocks.previewMany.mockResolvedValue({
      dryRun: false,
      durationMs: 1,
      ok: false,
      results: [{
        durationMs: 1,
        error: { code: 'UPLOAD_ERROR', message: 'boom' },
        ok: false,
        platform: 'weixin',
      }],
    })

    await expect(runBundle(createPlugin().plugin)).rejects.toThrow('wot-ui-ci preview 失败')

    const lenient = createPlugin({ failOnError: false }).plugin
    await expect(runBundle(lenient)).resolves.toBeUndefined()
  })

  it('onResult 接收批量结果', async () => {
    const onResult = vi.fn()
    const { plugin } = createPlugin({ onResult })

    await runBundle(plugin)

    expect(onResult).toHaveBeenCalledWith(successResult)
  })

  it('没有 UNI_PLATFORM 时不传 platforms', async () => {
    const { plugin } = createPlugin()

    await runBundle(plugin)

    expect(mocks.previewMany).toHaveBeenCalledWith(expect.objectContaining({
      platforms: undefined,
    }))
  })
})
