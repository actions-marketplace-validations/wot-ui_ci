import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLatestVersion: vi.fn(),
  getWeixinCI: vi.fn(),
}))

vi.mock('../src/version', () => ({
  getLatestVersion: mocks.getLatestVersion,
}))

vi.mock('../src/platforms/weixin', () => ({
  getWeixinCI: mocks.getWeixinCI,
}))

const { runDoctor } = await import('../src/doctor')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLatestVersion.mockResolvedValue({ latest: '1.0.0', platform: 'weixin' })
  mocks.getWeixinCI.mockReturnValue({
    Project: vi.fn(),
    checkCodeQuality: vi.fn(),
    getCompiledResult: vi.fn(),
    getDevSourceMap: vi.fn(),
    packNpm: vi.fn(),
  })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-doctor-'))
  tempDirs.push(cwd)

  for (const target of ['dist/weixin', 'dist/alipay', 'dist/dingtalk', 'keys']) {
    await mkdir(path.join(cwd, target), { recursive: true })
  }

  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  await writeFile(path.join(cwd, 'dist/weixin/project.config.json'), '{}')
  await writeFile(path.join(cwd, 'dist/weixin/app.json'), '{}')
  await writeFile(path.join(cwd, 'dist/alipay/app.json'), '{}')
  await writeFile(path.join(cwd, 'keys/weixin.key'), '-----BEGIN RSA PRIVATE KEY-----\nkey')
  await writeFile(path.join(cwd, 'keys/alipay.key'), 'key')
  await writeFile(path.join(cwd, 'wechat-cli'), '#!/bin/sh\n')
  return cwd
}

function createConfig(cwd: string) {
  return {
    version: '1.0.0',
    weixin: {
      appid: 'wx',
      ide: { cliPath: path.join(cwd, 'wechat-cli') },
      privateKeyPath: 'keys/weixin.key',
      projectPath: 'dist/weixin',
    },
    alipay: {
      appid: 'ali',
      privateKeyPath: 'keys/alipay.key',
      projectPath: 'dist/alipay',
      toolId: 'tool',
    },
    dingtalk: {
      appid: 'dd',
      projectPath: 'dist/dingtalk',
      token: 'token',
    },
  }
}

describe('runDoctor', () => {
  it('合法配置返回 ok', async () => {
    const cwd = await createFixture()

    const result = await runDoctor({ config: createConfig(cwd), cwd })

    expect(result.ok).toBe(true)
    expect(result.checks.some(check => check.id === 'weixin-key' && check.status === 'ok')).toBe(true)
  })

  it('没有平台配置时错误', async () => {
    const cwd = await createFixture()

    const result = await runDoctor({ config: {}, cwd })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'platforms', status: 'error' }))
  })

  it('配置加载失败时直接返回错误', async () => {
    const cwd = await createFixture()
    await writeFile(path.join(cwd, 'wotci.config.js'), 'export default {')

    const result = await runDoctor({ cwd })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'config', status: 'error' }))
  })

  it('检测到多个配置文件时警告', async () => {
    const cwd = await createFixture()
    await writeFile(path.join(cwd, 'wotci.config.js'), `export default ${JSON.stringify(createConfig(cwd))}`)
    await writeFile(path.join(cwd, '.minicirc'), '{}')

    const result = await runDoctor({ cwd })

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'config-conflict',
      status: 'warn',
    }))
  })

  it('产物/密钥/权限/格式问题', async () => {
    const cwd = await createFixture()
    await rm(path.join(cwd, 'dist/weixin/project.config.json'))
    await chmod(path.join(cwd, 'keys/weixin.key'), 0o644)
    await writeFile(path.join(cwd, 'keys/weixin.key'), 'not-pem')

    const result = await runDoctor({
      config: {
        version: '1.0.0',
        weixin: {
          appid: 'wx',
          privateKeyPath: 'keys/weixin.key',
          projectPath: 'dist/weixin',
        },
      },
      cwd,
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-project-config', status: 'error' }))
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'weixin-key-permission',
      status: process.platform === 'win32' ? 'ok' : 'warn',
    }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-key-format', status: 'warn' }))
  })

  it('微信 IDE CLI 配置错误', async () => {
    const cwd = await createFixture()

    const result = await runDoctor({
      config: {
        weixin: {
          appid: 'wx',
          ide: { cliPath: 'missing-cli' },
          privateKeyPath: 'keys/weixin.key',
          projectPath: 'dist/weixin',
        },
      },
      cwd,
    })

    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-ide', status: 'error' }))
  })

  it('支付宝与钉钉字段缺失', async () => {
    const cwd = await createFixture()

    const result = await runDoctor({
      config: {
        alipay: { appid: '', projectPath: 'dist/alipay', toolId: '' },
        dingtalk: { appid: '', projectPath: 'dist/dingtalk', token: '' },
      },
      cwd,
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'alipay-key', status: 'error' }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'dingtalk-token', status: 'error' }))
  })

  it('网络校验成功、失败与钉钉跳过', async () => {
    const cwd = await createFixture()
    const config = createConfig(cwd)

    const ok = await runDoctor({ config, cwd, network: true })
    expect(ok.checks).toContainEqual(expect.objectContaining({ id: 'network-weixin', status: 'ok' }))
    expect(ok.checks).toContainEqual(expect.objectContaining({ id: 'network-dingtalk', status: 'warn' }))

    mocks.getLatestVersion.mockRejectedValue(new Error('network'))
    const failed = await runDoctor({ config, cwd, network: true })
    expect(failed.ok).toBe(false)
    expect(failed.checks).toContainEqual(expect.objectContaining({ id: 'network-weixin', status: 'error' }))
  })

  it('release 构建与 GitHub 环境检查', async () => {
    const cwd = await createFixture()
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    vi.stubEnv('GITHUB_TOKEN', '')
    vi.stubEnv('GITHUB_REPOSITORY', '')

    const result = await runDoctor({
      config: {
        ...createConfig(cwd),
        release: { buildCommand: ['npm run build'], prComment: 'auto' },
      },
      cwd,
    })

    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'release-build', status: 'ok' }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'release-github', status: 'warn' }))
  })
})

describe('doctor 补充检查', () => {
  it('微信字段/目录/app.json/密钥缺失', async () => {
    const cwd = await createFixture()
    await rm(path.join(cwd, 'dist/weixin/app.json'))

    const result = await runDoctor({
      config: {
        weixin: {
          appid: '',
          privateKeyPath: 'keys/missing.key',
          projectPath: 'dist/missing',
        },
      },
      cwd,
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-appid', status: 'error' }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-project', status: 'error' }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-key', status: 'error' }))
  })

  it('微信 app.json 缺失时警告', async () => {
    const cwd = await createFixture()
    await rm(path.join(cwd, 'dist/weixin/app.json'))

    const result = await runDoctor({
      config: {
        weixin: {
          appid: 'wx',
          ide: { cliPath: path.join(cwd, 'wechat-cli') },
          privateKeyPath: 'keys/weixin.key',
          projectPath: 'dist/weixin',
        },
      },
      cwd,
    })

    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-app-json', status: 'warn' }))
    expect(result.ok).toBe(true)
  })

  it('未配置微信 IDE 时给出警告', async () => {
    const cwd = await createFixture()
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('freebsd' as NodeJS.Platform)
    vi.stubEnv('WECHAT_DEVTOOLS_CLI', path.join(cwd, 'missing-cli'))

    try {
      const result = await runDoctor({
        config: {
          weixin: {
            appid: 'wx',
            privateKeyPath: 'keys/weixin.key',
            projectPath: 'dist/weixin',
          },
        },
        cwd,
      })

      expect(result.checks).toContainEqual(expect.objectContaining({ id: 'weixin-ide', status: 'warn' }))
    }
    finally {
      platformSpy.mockRestore()
    }
  })

  it('支付宝字段/目录/密钥/IDE 缺失', async () => {
    const cwd = await createFixture()
    await rm(path.join(cwd, 'dist/alipay/app.json'))

    const result = await runDoctor({
      config: {
        alipay: {
          appid: '',
          ide: { appPath: 'missing-tool' },
          projectPath: 'dist/missing',
          toolId: '',
        },
      },
      cwd,
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'alipay-project', status: 'error' }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'alipay-key', status: 'error' }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'alipay-ide', status: 'error' }))
  })

  it('支付宝 app.json 缺失与内联 key', async () => {
    const cwd = await createFixture()
    await rm(path.join(cwd, 'dist/alipay/app.json'))

    const result = await runDoctor({
      config: {
        alipay: {
          appid: 'ali',
          privateKey: 'inline',
          projectPath: 'dist/alipay',
          toolId: 'tool',
        },
      },
      cwd,
    })

    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'alipay-app-json', status: 'warn' }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'alipay-key', status: 'ok' }))
  })

  it('钉钉字段/目录缺失', async () => {
    const cwd = await createFixture()

    const result = await runDoctor({
      config: {
        dingtalk: { appid: '', projectPath: 'dist/missing', token: '' },
      },
      cwd,
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'dingtalk-project', status: 'error' }))
  })

  it('release 无构建命令且 GitHub 环境齐全', async () => {
    const cwd = await createFixture()
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    vi.stubEnv('GITHUB_TOKEN', 'token')
    vi.stubEnv('GITHUB_REPOSITORY', 'wot-ui/ci')

    const result = await runDoctor({
      config: {
        ...createConfig(cwd),
        release: { buildCommand: '', prComment: true },
      },
      cwd,
    })

    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'release-github', status: 'ok' }))
  })

  it('没有配置文件时给出提示', async () => {
    const cwd = await createFixture()

    const result = await runDoctor({ cwd })

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'config-conflict',
      message: '未发现配置文件',
      status: 'ok',
    }))
  })
})

describe('doctor 预算检查', () => {
  it('合法预算通过，非法预算报错', async () => {
    const cwd = await createFixture()

    const ok = await runDoctor({
      config: { ...createConfig(cwd), budgets: { main: '1MB', total: '2MB' } },
      cwd,
    })
    expect(ok.checks).toContainEqual(expect.objectContaining({ id: 'budgets', status: 'ok' }))

    const bad = await runDoctor({
      config: { ...createConfig(cwd), budgets: { total: 'huge' } },
      cwd,
    })
    expect(bad.checks).toContainEqual(expect.objectContaining({ id: 'budgets', status: 'error' }))
  })
})

describe('doctor 微信构建与诊断', () => {
  it('微信 SDK 支持诊断能力时返回 ok', async () => {
    const cwd = await createFixture()
    const config = createConfig(cwd)

    const result = await runDoctor({ config, cwd })

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'weixin-diagnostics',
      status: 'ok',
    }))
  })

  it('微信 SDK 缺少诊断 API 时给出 warn', async () => {
    const cwd = await createFixture()
    const config = createConfig(cwd)
    mocks.getWeixinCI.mockReturnValueOnce({ Project: vi.fn(), packNpm: vi.fn() })

    const result = await runDoctor({ config, cwd })

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'weixin-diagnostics',
      message: expect.stringContaining('checkCodeQuality'),
      status: 'warn',
    }))
  })

  it('无法加载 miniprogram-ci 时给出 warn 与详情', async () => {
    const cwd = await createFixture()
    const config = createConfig(cwd)
    mocks.getWeixinCI.mockImplementationOnce(() => {
      throw new Error('cannot load sdk')
    })

    const result = await runDoctor({ config, cwd })

    expect(result.checks).toContainEqual(expect.objectContaining({
      details: ['cannot load sdk'],
      id: 'weixin-diagnostics',
      status: 'warn',
    }))
  })
})
