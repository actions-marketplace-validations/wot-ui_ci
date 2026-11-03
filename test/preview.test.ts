import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  WeixinProject: vi.fn(),
  packNpm: vi.fn(),
  getLatestVersion: vi.fn(),
  alipayPreview: vi.fn(),
  alipayUpload: vi.fn(),
  alipayUseDefaults: vi.fn(),
  dingtalkSetConfig: vi.fn(),
  dingtalkMiniUpload: vi.fn(),
  weixinPreview: vi.fn(),
  weixinUpload: vi.fn(),
}))

vi.mock('miniprogram-ci', () => ({
  Project: mocks.WeixinProject,
  getLatestVersion: mocks.getLatestVersion,
  packNpm: mocks.packNpm,
  preview: mocks.weixinPreview,
  upload: mocks.weixinUpload,
  default: {
    Project: mocks.WeixinProject,
    getLatestVersion: mocks.getLatestVersion,
    packNpm: mocks.packNpm,
    preview: mocks.weixinPreview,
    upload: mocks.weixinUpload,
  },
}))

vi.mock('minidev', () => {
  const minidev = {
    app: { getUploadedVersion: vi.fn(async () => '1.0.0') },
    preview: mocks.alipayPreview,
    upload: mocks.alipayUpload,
  }

  return {
    minidev,
    useDefaults: mocks.alipayUseDefaults,
    default: { minidev, useDefaults: mocks.alipayUseDefaults },
  }
})

vi.mock('dingtalk-miniapp-opensdk', () => ({
  sdk: {
    miniUpload: mocks.dingtalkMiniUpload,
    setConfig: mocks.dingtalkSetConfig,
  },
}))

const {
  preview,
  previewAlipay,
  previewPlatform,
  previewWeixin,
  PreviewError,
  PreviewUnsupportedError,
} = await import('../src')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLatestVersion.mockResolvedValue({ latestVersion: '1.0.0' })
  mocks.WeixinProject.mockImplementation(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    this.options = options
  })
  mocks.packNpm.mockResolvedValue([])
  mocks.weixinPreview.mockResolvedValue({
    subPackageInfo: [
      { name: '__FULL__', size: 4096 },
      { name: '__APP__', size: 2048 },
    ],
  })
  mocks.alipayPreview.mockResolvedValue({ qrcodeUrl: 'https://qr.example/weixin', version: '1.0.0' })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

interface Fixture {
  alipayKey: string
  cwd: string
  weixinKey: string
}

async function createFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-preview-'))
  tempDirs.push(cwd)

  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await mkdir(path.join(cwd, 'dist/alipay'), { recursive: true })
  await mkdir(path.join(cwd, 'keys'), { recursive: true })
  await writeFile(path.join(cwd, 'keys/weixin.key'), 'weixin-key')
  await writeFile(path.join(cwd, 'keys/alipay.key'), 'alipay-key')
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))

  return {
    alipayKey: path.join(cwd, 'keys/alipay.key'),
    cwd,
    weixinKey: path.join(cwd, 'keys/weixin.key'),
  }
}

function createWeixinConfig(extra: Record<string, unknown> = {}) {
  return {
    desc: 'release',
    version: '1.0.0',
    weixin: {
      appid: 'wx123',
      privateKeyPath: 'keys/weixin.key',
      projectPath: 'dist/weixin',
      ...extra,
    },
  }
}

function createAlipayConfig(extra: Record<string, unknown> = {}) {
  return {
    alipay: {
      appid: 'ali123',
      privateKeyPath: 'keys/alipay.key',
      projectPath: 'dist/alipay',
      toolId: 'tool-id',
      ...extra,
    },
  }
}

describe('previewWeixin', () => {
  it('默认生成 image 二维码到 .wotci/preview', async () => {
    const { cwd } = await createFixture()

    const result = await previewWeixin(createWeixinConfig({ preview: { setting: { es6: true } } }), { cwd })

    expect(mocks.weixinPreview).toHaveBeenCalledWith(expect.objectContaining({
      desc: 'release',
      qrcodeFormat: 'image',
      qrcodeOutputDest: path.join(cwd, '.wotci/preview/weixin.png'),
      setting: { es6: true },
      version: '1.0.0',
    }))
    expect(result.platform).toBe('weixin')
    expect(result.qrCode).toEqual({
      kind: 'file',
      path: path.join(cwd, '.wotci/preview/weixin.png'),
      value: path.join(cwd, '.wotci/preview/weixin.png'),
    })
    expect(result.message).toContain('总包 4KB')
    expect(result.message).toContain('主包 2KB')
    expect(result.sizes).toEqual({ main: 2048, total: 4096 })
  })

  it('buildNpm 为 true 时先执行 packNpm 并返回警告', async () => {
    const { cwd } = await createFixture()
    mocks.packNpm.mockResolvedValueOnce([{ msg: 'preview warning' }])

    const result = await previewWeixin(createWeixinConfig(), { buildNpm: true, cwd })

    expect(mocks.packNpm).toHaveBeenCalledWith(expect.anything(), { ignores: undefined })
    expect(result.npmWarnings).toEqual([{ msg: 'preview warning' }])
  })

  it('buildNpm 失败时拒绝预览', async () => {
    const { cwd } = await createFixture()
    mocks.packNpm.mockRejectedValueOnce(new Error('npm broken'))

    await expect(previewWeixin(createWeixinConfig(), { buildNpm: true, cwd }))
      .rejects
      .toThrow('微信预览前构建 npm 失败')
    expect(mocks.weixinPreview).not.toHaveBeenCalled()
  })

  it('cLI 选项覆盖配置并传递 page / query / scene / robot', async () => {
    const { cwd } = await createFixture()
    const config = createWeixinConfig({
      preview: {
        bigPackageSizeSupport: true,
        desc: 'config-desc',
        pagePath: 'pages/config',
        qrcodeFormat: 'terminal',
        robot: 2,
        scene: 1011,
        searchQuery: 'a=1',
        setting: { es6: true },
        threads: 4,
      },
    })

    await previewWeixin(config, {
      cwd,
      desc: 'cli-desc',
      pagePath: 'pages/cli',
      qrFormat: 'image',
      qrOutput: 'out/qr.png',
      query: 'b=2',
      robot: 3,
      scene: '1020',
    })

    expect(mocks.weixinPreview).toHaveBeenCalledWith(expect.objectContaining({
      bigPackageSizeSupport: true,
      desc: 'cli-desc',
      pagePath: 'pages/cli',
      qrcodeFormat: 'image',
      qrcodeOutputDest: path.join(cwd, 'out/qr.png'),
      robot: 3,
      scene: 1020,
      searchQuery: 'b=2',
      setting: { es6: true },
      threads: 4,
    }))
  })

  it('terminal 模式不传输出路径', async () => {
    const { cwd } = await createFixture()
    mocks.weixinPreview.mockResolvedValueOnce({})

    const result = await previewWeixin(createWeixinConfig(), {
      cwd,
      qrFormat: 'terminal',
    })

    const call = mocks.weixinPreview.mock.calls[0][0] as Record<string, unknown>
    expect(call.qrcodeOutputDest).toBeUndefined()
    expect(call.qrcodeFormat).toBe('terminal')
    expect(result.qrCode).toEqual({ kind: 'terminal', value: '' })
    expect(result.message).toBe('微信小程序预览二维码已输出到终端，描述：release')
  })

  it('base64 模式读取输出文件', async () => {
    const { cwd } = await createFixture()
    mocks.weixinPreview.mockImplementationOnce(async (options: { qrcodeOutputDest: string }) => {
      await writeFile(options.qrcodeOutputDest, 'YmFzZTY0\n')
      return { subPackageInfo: [] }
    })

    const result = await previewWeixin(createWeixinConfig(), {
      cwd,
      qrFormat: 'base64',
    })

    expect(result.qrCode).toEqual({
      kind: 'base64',
      path: path.join(cwd, '.wotci/preview/weixin.txt'),
      value: 'YmFzZTY0',
    })
  })

  it('无包体积时 sizes 为空', async () => {
    const { cwd } = await createFixture()
    mocks.weixinPreview.mockResolvedValueOnce({})

    const result = await previewWeixin(createWeixinConfig(), { cwd })

    expect(result.sizes).toBeUndefined()
    expect(result.message).not.toContain('总包')
  })

  it('非法场景值拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(previewWeixin(createWeixinConfig(), { cwd, scene: 'abc' }))
      .rejects
      .toThrow('场景值必须是大于等于 0 的整数')
  })

  it('缺少配置、私钥或目录时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(previewWeixin({}, { cwd }))
      .rejects
      .toThrow('缺少微信小程序预览配置')

    await expect(previewWeixin(createWeixinConfig({ privateKeyPath: 'keys/missing.key' }), { cwd }))
      .rejects
      .toThrow('微信私钥文件不存在')

    await expect(previewWeixin(createWeixinConfig({ projectPath: 'dist/missing' }), { cwd }))
      .rejects
      .toThrow('微信小程序产物目录不存在')
  })

  it('sDK 异常包装为 PreviewError', async () => {
    const { cwd } = await createFixture()
    mocks.weixinPreview.mockRejectedValueOnce(new Error('preview failed'))

    const error = await previewWeixin(createWeixinConfig(), { cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PreviewError)
    expect((error as Error).message).toBe('微信小程序预览失败')
  })
})

describe('previewAlipay', () => {
  it('返回远程二维码 URL 与版本', async () => {
    const { cwd } = await createFixture()

    const result = await previewAlipay(createAlipayConfig(), { cwd })

    expect(mocks.alipayPreview).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'ali123',
      clientType: 'alipay',
      project: path.join(cwd, 'dist/alipay'),
    }))
    expect(result.platform).toBe('alipay')
    expect(result.version).toBe('1.0.0')
    expect(result.qrCode).toEqual({
      kind: 'url',
      url: 'https://qr.example/weixin',
      value: 'https://qr.example/weixin',
    })
    expect(result.message).toContain('支付宝小程序预览二维码')
  })

  it('cLI 选项覆盖配置', async () => {
    const { cwd } = await createFixture()
    const config = createAlipayConfig({
      preview: {
        autoPush: true,
        ignoreHttpDomainCheck: true,
        ignoreWebViewDomainCheck: true,
        page: 'pages/config',
        pageQuery: 'a=1',
        query: 'config',
        scene: '1011',
      },
    })

    await previewAlipay(config, {
      cwd,
      pagePath: 'pages/cli',
      pageQuery: 'b=2',
      query: 'cli',
      scene: 2020,
    })

    expect(mocks.alipayPreview).toHaveBeenCalledWith(expect.objectContaining({
      autoPush: true,
      ignoreHttpDomainCheck: true,
      ignoreWebViewDomainCheck: true,
      page: 'pages/cli',
      pageQuery: 'b=2',
      query: 'cli',
      scene: '2020',
    }))
  })

  it('qrOutput 下载二维码到本地', async () => {
    const { cwd } = await createFixture()
    const fetchMock = vi.fn(async () => ({
      arrayBuffer: async () => Buffer.from('image-bytes'),
      ok: true,
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await previewAlipay(createAlipayConfig(), {
      cwd,
      qrOutput: 'out/alipay.png',
    })

    const outputPath = path.join(cwd, 'out/alipay.png')
    expect(fetchMock).toHaveBeenCalledWith('https://qr.example/weixin')
    expect(await readFile(outputPath, 'utf8')).toBe('image-bytes')
    expect(result.qrCode).toEqual({
      kind: 'file',
      path: outputPath,
      url: 'https://qr.example/weixin',
      value: outputPath,
    })
    expect(result.message).toContain('已下载')
  })

  it('下载失败包装为 PreviewError', async () => {
    const { cwd } = await createFixture()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))

    await expect(previewAlipay(createAlipayConfig(), { cwd, qrOutput: 'out/fail.png' }))
      .rejects
      .toThrow('下载支付宝预览二维码失败')
  })

  it('sDK 未返回二维码地址时拒绝', async () => {
    const { cwd } = await createFixture()
    mocks.alipayPreview.mockResolvedValueOnce({})

    await expect(previewAlipay(createAlipayConfig(), { cwd }))
      .rejects
      .toThrow('支付宝预览未返回二维码地址')
  })

  it('缺少配置、私钥或目录时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(previewAlipay({}, { cwd }))
      .rejects
      .toThrow('缺少支付宝小程序预览配置')

    await expect(previewAlipay(createAlipayConfig({ privateKeyPath: 'keys/missing.key' }), { cwd }))
      .rejects
      .toThrow('支付宝小程序预览失败')

    await expect(previewAlipay(createAlipayConfig({ projectPath: 'dist/missing' }), { cwd }))
      .rejects
      .toThrow('支付宝小程序产物目录不存在')
  })

  it('sDK 异常包装为 PreviewError', async () => {
    const { cwd } = await createFixture()
    mocks.alipayPreview.mockRejectedValueOnce(new Error('preview failed'))

    const error = await previewAlipay(createAlipayConfig(), { cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PreviewError)
    expect((error as Error).message).toBe('支付宝小程序预览失败')
  })
})

describe('previewPlatform / preview', () => {
  it('buildNpm 用于非微信平台时拒绝', async () => {
    await expect(previewPlatform('alipay', {}, { buildNpm: true }))
      .rejects
      .toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
  })

  it('按平台路由', async () => {
    const { cwd } = await createFixture()

    await expect(previewPlatform('weixin', createWeixinConfig(), { cwd }))
      .resolves
      .toMatchObject({ platform: 'weixin' })
    await expect(previewPlatform('alipay', createAlipayConfig(), { cwd }))
      .resolves
      .toMatchObject({ platform: 'alipay' })
  })

  it('钉钉不支持预览', async () => {
    const { cwd } = await createFixture()

    await expect(previewPlatform('dingtalk', {}, { cwd }))
      .rejects
      .toThrow(PreviewUnsupportedError)
  })

  it('preview 入口加载内联配置', async () => {
    const { cwd } = await createFixture()

    const result = await preview('weixin', {
      config: createWeixinConfig(),
      cwd,
    })

    expect(result.platform).toBe('weixin')
  })
})

describe('预览补充错误路径', () => {
  it('base64 输出文件不存在时包装为 PreviewError', async () => {
    const { cwd } = await createFixture()

    const error = await previewWeixin(createWeixinConfig(), {
      cwd,
      qrFormat: 'base64',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PreviewError)
    expect((error as Error).message).toContain('读取微信预览二维码失败')
  })
})

describe('预览默认值与可选字段', () => {
  it('微信不传 cwd 时使用 process.cwd()', async () => {
    const fixture = await createFixture()

    const result = await previewWeixin({
      weixin: {
        appid: 'wx123',
        privateKeyPath: fixture.weixinKey,
        projectPath: path.join(fixture.cwd, 'dist/weixin'),
      },
    }, { qrFormat: 'terminal' })

    expect(result.platform).toBe('weixin')
  })

  it('微信没有 version 时内部使用 0.0.0 占位', async () => {
    const { cwd } = await createFixture()

    await previewWeixin({
      weixin: {
        appid: 'wx123',
        privateKeyPath: 'keys/weixin.key',
        projectPath: 'dist/weixin',
      },
    }, { cwd })

    expect(mocks.weixinPreview).toHaveBeenCalledWith(expect.objectContaining({ version: '0.0.0' }))
  })

  it('微信 SDK 返回 undefined 时 raw 为空对象', async () => {
    const { cwd } = await createFixture()
    mocks.weixinPreview.mockResolvedValueOnce(undefined)

    const result = await previewWeixin(createWeixinConfig(), { cwd })

    expect(result.raw).toEqual({})
    expect(result.sizes).toBeUndefined()
  })

  it('微信只有总包或主包时按可用字段返回 sizes', async () => {
    const { cwd } = await createFixture()
    mocks.weixinPreview.mockResolvedValueOnce({
      subPackageInfo: [{ name: '__FULL__', size: 4096 }],
    })

    const fullOnly = await previewWeixin(createWeixinConfig(), { cwd })
    expect(fullOnly.sizes).toEqual({ total: 4096 })

    mocks.weixinPreview.mockResolvedValueOnce({
      subPackageInfo: [{ name: '__APP__', size: 2048 }],
    })

    const appOnly = await previewWeixin(createWeixinConfig(), { cwd })
    expect(appOnly.sizes).toEqual({ main: 2048 })
  })

  it('微信场景值支持数字', async () => {
    const { cwd } = await createFixture()

    await previewWeixin(createWeixinConfig(), { cwd, scene: 1011 })

    expect(mocks.weixinPreview).toHaveBeenCalledWith(expect.objectContaining({ scene: 1011 }))
  })

  it('支付宝不传 cwd 时使用 process.cwd()', async () => {
    const fixture = await createFixture()

    const result = await previewAlipay({
      alipay: {
        appid: 'ali123',
        privateKeyPath: fixture.alipayKey,
        projectPath: path.join(fixture.cwd, 'dist/alipay'),
        toolId: 'tool-id',
      },
    })

    expect(result.platform).toBe('alipay')
  })

  it('支付宝没有版本时结果与消息都不包含版本', async () => {
    const { cwd } = await createFixture()
    mocks.alipayPreview.mockResolvedValueOnce({ qrcodeUrl: 'https://qr.example/no-version' })

    const result = await previewAlipay(createAlipayConfig(), { cwd })

    expect(result.version).toBeUndefined()
    expect(result.message).not.toContain('版本')
  })
})
