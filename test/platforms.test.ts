import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  WeixinProject: vi.fn(),
  weixinPreview: vi.fn(),
  weixinUpload: vi.fn(),
  alipayGetUploadedVersion: vi.fn(),
  alipayPreview: vi.fn(),
  alipayUpload: vi.fn(),
  alipayUseDefaults: vi.fn(),
  dingtalkSetConfig: vi.fn(),
  dingtalkMiniUpload: vi.fn(),
}))

vi.mock('miniprogram-ci', () => ({
  Project: mocks.WeixinProject,
  preview: mocks.weixinPreview,
  upload: mocks.weixinUpload,
  default: {
    Project: mocks.WeixinProject,
    preview: mocks.weixinPreview,
    upload: mocks.weixinUpload,
  },
}))

vi.mock('minidev', () => {
  const minidev = {
    app: {
      getUploadedVersion: mocks.alipayGetUploadedVersion,
    },
    upload: mocks.alipayUpload,
    preview: mocks.alipayPreview,
  }

  return {
    minidev,
    useDefaults: mocks.alipayUseDefaults,
    default: {
      minidev,
      useDefaults: mocks.alipayUseDefaults,
    },
  }
})

vi.mock('dingtalk-miniapp-opensdk', () => ({
  sdk: {
    miniUpload: mocks.dingtalkMiniUpload,
    setConfig: mocks.dingtalkSetConfig,
  },
}))

const {
  upload,
  uploadAlipay,
  uploadDingTalk,
  uploadPlatform,
  uploadWeixin,
  ConfigError,
  UploadError,
} = await import('../src')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.WeixinProject.mockImplementation(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    this.options = options
  })
  mocks.weixinUpload.mockResolvedValue({
    subPackageInfo: [
      { name: '__FULL__', size: 2048 },
      { name: '__APP__', size: 1024 },
    ],
  })
  mocks.weixinPreview.mockResolvedValue({
    subPackageInfo: [
      { name: '__FULL__', size: 4096 },
      { name: '__APP__', size: 2048 },
    ],
  })
  mocks.alipayGetUploadedVersion.mockResolvedValue('1.0.0')
  mocks.alipayUpload.mockResolvedValue({ version: '1.0.1' })
  mocks.dingtalkMiniUpload.mockResolvedValue({ packageVersion: '1.0.2' })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

interface Fixture {
  cwd: string
  weixinKey: string
}

async function createFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-platform-'))
  tempDirs.push(cwd)

  for (const target of ['dist/weixin', 'dist/alipay', 'dist/dingtalk', 'keys']) {
    await mkdir(path.join(cwd, target), { recursive: true })
  }

  await writeFile(path.join(cwd, 'keys/weixin.key'), 'weixin-key')
  await writeFile(path.join(cwd, 'keys/alipay.key'), 'alipay-key')

  return {
    cwd,
    weixinKey: path.join(cwd, 'keys/weixin.key'),
  }
}

function weixinConfig(overrides: Record<string, unknown> = {}) {
  return {
    weixin: {
      appid: 'wx123',
      privateKeyPath: 'keys/weixin.key',
      projectPath: 'dist/weixin',
      ...overrides,
    },
  }
}

describe('uploadWeixin', () => {
  it('组装 Project 与 upload 参数并输出包体积', async () => {
    const { cwd, weixinKey } = await createFixture()

    const result = await uploadWeixin({
      desc: 'release',
      version: '1.0.0',
      ...weixinConfig({
        ignores: ['node_modules'],
        robot: 2,
        setting: { useProjectConfig: true },
      }),
    }, { cwd })

    expect(mocks.WeixinProject).toHaveBeenCalledWith({
      appid: 'wx123',
      ignores: ['node_modules'],
      privateKeyPath: weixinKey,
      projectPath: path.join(cwd, 'dist/weixin'),
      type: 'miniProgram',
    })
    expect(mocks.weixinUpload).toHaveBeenCalledWith(expect.objectContaining({
      desc: 'release',
      project: expect.anything(),
      robot: 2,
      setting: { useProjectConfig: true },
      version: '1.0.0',
    }))
    expect(result.platform).toBe('weixin')
    expect(result.version).toBe('1.0.0')
    expect(result.message).toBe('微信小程序上传成功，版本：1.0.0，总包 2KB，主包 1KB，描述：release')
  })

  it('支持自定义项目类型', async () => {
    const { cwd } = await createFixture()

    await uploadWeixin({
      version: '1.0.0',
      ...weixinConfig({ type: 'miniGame' }),
    }, { cwd })

    expect(mocks.WeixinProject).toHaveBeenCalledWith(expect.objectContaining({ type: 'miniGame' }))
  })

  it('缺少 weixin 配置时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadWeixin({ version: '1.0.0' }, { cwd }))
      .rejects
      .toThrow('缺少微信小程序上传配置')
  })

  it('缺少 version 时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadWeixin(weixinConfig(), { cwd }))
      .rejects
      .toThrow('需要提供 version')
    expect(mocks.weixinUpload).not.toHaveBeenCalled()
  })

  it('私钥文件不存在时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadWeixin({
      version: '1.0.0',
      ...weixinConfig({ privateKeyPath: 'keys/missing.key' }),
    }, { cwd }))
      .rejects
      .toThrow(UploadError)
  })

  it('产物目录不存在时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadWeixin({
      version: '1.0.0',
      ...weixinConfig({ projectPath: 'dist/missing' }),
    }, { cwd }))
      .rejects
      .toThrow('产物目录不存在')
  })

  it('包装 SDK 错误并保留 cause', async () => {
    const { cwd } = await createFixture()
    mocks.weixinUpload.mockRejectedValueOnce(new Error('network down'))

    const error = await uploadWeixin({
      version: '1.0.0',
      ...weixinConfig(),
    }, { cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UploadError)
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(Error)
  })
})

describe('uploadAlipay', () => {
  it('读取私钥文件并校验版本号', async () => {
    const { cwd } = await createFixture()

    const result = await uploadAlipay({
      desc: 'release',
      version: '1.0.1',
      alipay: {
        appid: 'ali123',
        privateKeyPath: 'keys/alipay.key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd })

    expect(mocks.alipayUseDefaults).toHaveBeenCalledWith({
      config: {
        defaults: {
          'alipay.authentication.privateKey': 'alipay-key',
          'alipay.authentication.toolId': 'tool-id',
        },
      },
    })
    expect(mocks.alipayGetUploadedVersion).toHaveBeenCalledWith({
      appId: 'ali123',
      clientType: 'alipay',
    })
    expect(mocks.alipayUpload).toHaveBeenCalledWith({
      appId: 'ali123',
      clientType: 'alipay',
      experience: true,
      project: path.join(cwd, 'dist/alipay'),
      version: '1.0.1',
    })
    expect(result.version).toBe('1.0.1')
    expect(result.message).toContain('支付宝小程序上传成功')
  })

  it('开启自动递增时不校验线上版本并使用空版本号', async () => {
    const { cwd } = await createFixture()
    mocks.alipayUpload.mockResolvedValueOnce({ version: '1.0.2' })

    const result = await uploadAlipay({
      alipay: {
        appid: 'ali123',
        autoincrement: true,
        privateKey: 'inline-key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd })

    expect(mocks.alipayGetUploadedVersion).not.toHaveBeenCalled()
    expect(mocks.alipayUpload).toHaveBeenCalledWith(expect.objectContaining({ version: '' }))
    expect(result.version).toBe('1.0.2')
  })

  it('版本号不大于线上版本时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKey: 'inline-key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('必须大于线上最新版本')
    expect(mocks.alipayUpload).not.toHaveBeenCalled()
  })

  it('缺少私钥配置时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadAlipay({
      version: '2.0.0',
      alipay: {
        appid: 'ali123',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('需要提供 privateKey 或 privateKeyPath')
  })

  it('关闭自动递增但缺少 version 时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadAlipay({
      alipay: {
        appid: 'ali123',
        privateKey: 'inline-key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('必须提供 version')
  })
})

describe('uploadDingTalk', () => {
  it('配置 SDK 并上传', async () => {
    const { cwd } = await createFixture()

    const result = await uploadDingTalk({
      desc: 'release',
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd })

    expect(mocks.dingtalkSetConfig).toHaveBeenCalledWith({
      accessToken: 'token',
      appKey: '',
      appSecret: '',
      host: 'https://oapi.dingtalk.com',
    })
    expect(mocks.dingtalkMiniUpload).toHaveBeenCalledWith(expect.objectContaining({
      miniAppId: 'dd123',
      packageVersion: '1.0.2',
      project: path.join(cwd, 'dist/dingtalk'),
    }))
    expect(result.version).toBe('1.0.2')
  })

  it('自动递增时使用空版本号', async () => {
    const { cwd } = await createFixture()

    await uploadDingTalk({
      dingtalk: {
        appid: 'dd123',
        autoincrement: true,
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd })

    expect(mocks.dingtalkMiniUpload).toHaveBeenCalledWith(expect.objectContaining({
      packageVersion: '',
    }))
  })

  it('构建进度失败时拒绝', async () => {
    const { cwd } = await createFixture()
    mocks.dingtalkMiniUpload.mockImplementationOnce(async (options: {
      onProgressUpdate: (info: unknown) => void
    }) => {
      options.onProgressUpdate({ data: { log: 'compile error' }, status: 'failed' })
      return { packageVersion: '1.0.2' }
    })

    await expect(uploadDingTalk({
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd }))
      .rejects
      .toThrow('compile error')
  })

  it('缺少钉钉配置时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadDingTalk({ version: '1.0.2' }, { cwd }))
      .rejects
      .toThrow('缺少钉钉小程序上传配置')
  })
})

describe('uploadPlatform / upload', () => {
  it('按平台路由并支持 dd 别名', async () => {
    const { cwd } = await createFixture()

    await uploadPlatform('dd', {
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd })

    expect(mocks.dingtalkMiniUpload).toHaveBeenCalled()
  })

  it('直接调用 JS API 时兼容 dd 配置字段', async () => {
    const { cwd } = await createFixture()

    await uploadPlatform('dingtalk', {
      version: '1.0.2',
      dd: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd })

    expect(mocks.dingtalkMiniUpload).toHaveBeenCalledWith(expect.objectContaining({
      miniAppId: 'dd123',
    }))
  })

  it('拒绝未知平台', async () => {
    const { cwd } = await createFixture()

    await expect(uploadPlatform('unknown' as never, {}, { cwd }))
      .rejects
      .toThrow(ConfigError)
  })

  it('通过 JS 调用入口读取内联配置并上传', async () => {
    const { cwd } = await createFixture()

    const result = await upload('weixin', {
      config: {
        version: '7.0.0',
        ...weixinConfig(),
      },
      cwd,
    })

    expect(result.platform).toBe('weixin')
    expect(result.version).toBe('7.0.0')
  })
})

describe('上传器补充边界', () => {
  it('微信无包信息时只输出版本号', async () => {
    const { cwd } = await createFixture()
    mocks.weixinUpload.mockResolvedValueOnce({})

    const result = await uploadWeixin({
      version: '1.0.0',
      ...weixinConfig(),
    }, { cwd })

    expect(result.message).toBe('微信小程序上传成功，版本：1.0.0')
    expect(result.raw).toEqual({})
  })

  it('微信 Project 构造异常时包装为 UploadError', async () => {
    const { cwd } = await createFixture()
    // 构造器 mock 必须是 function，箭头函数无法作为构造函数
    // eslint-disable-next-line prefer-arrow-callback
    mocks.WeixinProject.mockImplementationOnce(function () {
      throw new Error('project init failed')
    })

    const error = await uploadWeixin({
      version: '1.0.0',
      ...weixinConfig(),
    }, { cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UploadError)
    expect((error as { message?: string }).message).toBe('微信小程序上传失败')
  })

  it('微信 SDK 抛出 UploadError 时原样透传', async () => {
    const { cwd } = await createFixture()
    const inner = new UploadError('inner upload error')
    mocks.weixinUpload.mockRejectedValueOnce(inner)

    const error = await uploadWeixin({
      version: '1.0.0',
      ...weixinConfig(),
    }, { cwd }).catch((caught: unknown) => caught)

    expect(error).toBe(inner)
  })

  it('支付宝缺少配置时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadAlipay({ version: '1.0.0' }, { cwd }))
      .rejects
      .toThrow('缺少支付宝小程序上传配置')
  })

  it('支付宝产物目录不存在时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/missing',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('产物目录不存在')
  })

  it('支付宝私钥文件不存在时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKeyPath: 'keys/missing.key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('支付宝私钥文件读取失败')
  })

  it('支付宝 SDK 异常时包装为 UploadError', async () => {
    const { cwd } = await createFixture()
    mocks.alipayUpload.mockRejectedValueOnce(new Error('sdk down'))

    const error = await uploadAlipay({
      version: '1.0.1',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UploadError)
    expect((error as { message?: string }).message).toBe('支付宝小程序上传失败')
  })

  it('支付宝 useDefaults 异常时包装为 UploadError', async () => {
    const { cwd } = await createFixture()
    mocks.alipayUseDefaults.mockImplementationOnce(() => {
      throw new Error('defaults failed')
    })

    await expect(uploadAlipay({
      version: '1.0.1',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('支付宝小程序上传失败')
  })

  it('支付宝自动递增且返回值无版本时使用 auto', async () => {
    const { cwd } = await createFixture()
    mocks.alipayUpload.mockResolvedValueOnce({})

    const result = await uploadAlipay({
      alipay: {
        appid: 'ali123',
        autoincrement: true,
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd })

    expect(result.version).toBe('auto')
  })

  it('支付宝非自动递增且返回值无版本时回退配置版本', async () => {
    const { cwd } = await createFixture()
    mocks.alipayUpload.mockResolvedValueOnce({})

    const result = await uploadAlipay({
      version: '1.0.1',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd })

    expect(result.version).toBe('1.0.1')
  })

  it('支付宝线上版本为空时跳过大小比较', async () => {
    const { cwd } = await createFixture()
    mocks.alipayGetUploadedVersion.mockResolvedValueOnce('')

    const result = await uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd })

    expect(result.version).toBe('1.0.1')
  })

  it('钉钉关闭自动递增但缺少 version 时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadDingTalk({
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd }))
      .rejects
      .toThrow('必须提供 version')
  })

  it('钉钉产物目录不存在时拒绝', async () => {
    const { cwd } = await createFixture()

    await expect(uploadDingTalk({
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/missing',
        token: 'token',
      },
    }, { cwd }))
      .rejects
      .toThrow('产物目录不存在')
  })

  it('钉钉从构建进度回退版本号', async () => {
    const { cwd } = await createFixture()
    mocks.dingtalkMiniUpload.mockImplementationOnce(async (options: {
      onProgressUpdate: (info: unknown) => void
    }) => {
      options.onProgressUpdate({ data: { version: '1.0.3' }, status: 'building' })
      return {}
    })

    const result = await uploadDingTalk({
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd })

    expect(result.version).toBe('1.0.3')
  })

  it('钉钉构建失败且无日志时使用默认错误', async () => {
    const { cwd } = await createFixture()
    mocks.dingtalkMiniUpload.mockImplementationOnce(async (options: {
      onProgressUpdate: (info: unknown) => void
    }) => {
      options.onProgressUpdate({ status: 'failed' })
      return {}
    })

    await expect(uploadDingTalk({
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd }))
      .rejects
      .toThrow('钉钉小程序构建失败')
  })

  it('钉钉 SDK 异常时包装为 UploadError', async () => {
    const { cwd } = await createFixture()
    mocks.dingtalkMiniUpload.mockRejectedValueOnce(new Error('sdk down'))

    const error = await uploadDingTalk({
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UploadError)
    expect((error as { message?: string }).message).toBe('钉钉小程序上传失败')
  })

  it('钉钉 SDK 无返回值时使用 auto 版本', async () => {
    const { cwd } = await createFixture()
    mocks.dingtalkMiniUpload.mockResolvedValueOnce(undefined)

    const result = await uploadDingTalk({
      alipay: undefined,
      dingtalk: {
        appid: 'dd123',
        autoincrement: true,
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd })

    expect(result.version).toBe('auto')
    expect(result.raw).toEqual({})
  })
})

describe('uploadPlatform 路由覆盖', () => {
  it('路由到支付宝上传器', async () => {
    const { cwd } = await createFixture()

    const result = await uploadPlatform('alipay', {
      version: '1.0.1',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd })

    expect(result.platform).toBe('alipay')
    expect(mocks.alipayUpload).toHaveBeenCalled()
  })

  it('路由到微信上传器', async () => {
    const { cwd } = await createFixture()

    const result = await uploadPlatform('weixin', {
      version: '1.0.0',
      ...weixinConfig(),
    }, { cwd })

    expect(result.platform).toBe('weixin')
    expect(mocks.weixinUpload).toHaveBeenCalled()
  })
})

describe('默认 cwd 与空返回值', () => {
  it('微信使用绝对路径且不传 cwd', async () => {
    const { cwd, weixinKey } = await createFixture()
    mocks.weixinUpload.mockResolvedValueOnce(null)

    const result = await uploadWeixin({
      version: '1.0.0',
      weixin: {
        appid: 'wx123',
        privateKeyPath: weixinKey,
        projectPath: path.join(cwd, 'dist/weixin'),
      },
    })

    expect(result.raw).toEqual({})
    expect(result.message).toContain('版本：1.0.0')
  })

  it('支付宝使用绝对路径且不传 cwd', async () => {
    const { cwd } = await createFixture()
    mocks.alipayUpload.mockResolvedValueOnce(null)

    const result = await uploadAlipay({
      version: '1.0.1',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: path.join(cwd, 'dist/alipay'),
        toolId: 'tool-id',
      },
    })

    expect(result.raw).toEqual({})
    expect(result.version).toBe('1.0.1')
  })

  it('钉钉使用绝对路径且不传 cwd', async () => {
    const { cwd } = await createFixture()
    mocks.dingtalkMiniUpload.mockResolvedValueOnce(null)

    const result = await uploadDingTalk({
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: path.join(cwd, 'dist/dingtalk'),
        token: 'token',
      },
    })

    expect(result.raw).toEqual({})
    expect(result.version).toBe('1.0.2')
  })
})
