import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  WeixinProject: vi.fn(),
  weixinUpload: vi.fn(),
  alipayGetUploadedVersion: vi.fn(),
  alipayUpload: vi.fn(),
  alipayUseDefaults: vi.fn(),
  dingtalkSetConfig: vi.fn(),
  dingtalkMiniUpload: vi.fn(),
}))

vi.mock('miniprogram-ci', () => ({
  Project: mocks.WeixinProject,
  upload: mocks.weixinUpload,
  default: {
    Project: mocks.WeixinProject,
    upload: mocks.weixinUpload,
  },
}))

vi.mock('minidev', () => {
  const minidev = {
    app: {
      getUploadedVersion: mocks.alipayGetUploadedVersion,
    },
    upload: mocks.alipayUpload,
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
