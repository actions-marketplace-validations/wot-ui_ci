import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const weixinUpload = vi.fn(async () => ({
  subPackageInfo: [{ name: '__FULL__', size: 2048 }],
}))
const WeixinProject = vi.fn(function Project(this: Record<string, unknown>, options: Record<string, unknown>) {
  this.options = options
})
const alipayGetUploadedVersion = vi.fn(async () => '1.0.0')
const alipayUpload = vi.fn(async () => ({ version: '1.0.1' }))
const alipayUseDefaults = vi.fn()
const dingTalkMiniUpload = vi.fn(async () => ({ packageVersion: '1.0.2' }))
const dingTalkSetConfig = vi.fn()

vi.mock('miniprogram-ci', () => ({
  Project: WeixinProject,
  upload: weixinUpload,
}))

vi.mock('minidev', () => ({
  minidev: {
    app: {
      getUploadedVersion: alipayGetUploadedVersion,
    },
    upload: alipayUpload,
  },
  useDefaults: alipayUseDefaults,
}))

vi.mock('dingtalk-miniapp-opensdk', () => ({
  sdk: {
    miniUpload: dingTalkMiniUpload,
    setConfig: dingTalkSetConfig,
  },
}))

const wotciModule = await import('../src')
const { default: wotci, compareVersion, defineConfig, loadConfig, uploadAlipay, uploadDingTalk, uploadPlatform, uploadWeixin } = wotciModule
const { parseCliArgs, runCli } = await import('../src/cli')
const { formatErrorStack, UploadError, formatErrorReport } = await import('../src/errors')
const { createCliLogger } = await import('../src/logger')
const { appendDesc, createCliConfigLoadedMessage, createCliHelpText, createCliUploadStartMessage } = await import('../src/messages')

let tempRoot = ''

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wotci-'))
  await writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({
    description: 'package description',
    version: '0.0.5',
  }, null, 2))
  vi.clearAllMocks()
})

afterEach(async () => {
  delete process.env.UNI_MINI_CI_VERSION
  if (tempRoot)
    await rm(tempRoot, { force: true, recursive: true })
})

describe('config loading', () => {
  it('loads inline config factories with package defaults', async () => {
    const loaded = await loadConfig({
      config: ({ env, packageJson }) => ({
        desc: env.CI_TEST_DESC,
        version: packageJson?.version,
      }),
      cwd: tempRoot,
    })

    expect(loaded.source).toBe('inline')
    expect(loaded.config.version).toBe('0.0.5')
    expect(loaded.config.desc).toBe('package description')
  })

  it('loads JS config and resolves env-based values', async () => {
    process.env.UNI_MINI_CI_VERSION = '2.0.0'
    await writeFile(path.join(tempRoot, 'wotci.config.js'), [
      'export default ({ env }) => ({',
      '  version: env.UNI_MINI_CI_VERSION,',
      '  weixin: {',
      '    appid: "wx123",',
      '    projectPath: "dist/weixin",',
      '    privateKeyPath: "keys/private.key"',
      '  }',
      '})',
    ].join('\n'))

    const loaded = await loadConfig({ cwd: tempRoot })

    expect(loaded.source).toBe('js')
    expect(loaded.config.version).toBe('2.0.0')
    expect(loaded.config.desc).toBe('package description')
    expect(loaded.config.weixin?.appid).toBe('wx123')
  })

  it('loads TS config files discovered by default search', async () => {
    await writeFile(path.join(tempRoot, 'wotci.config.ts'), [
      'export default {',
      '  version: "2.1.0",',
      '  weixin: {',
      '    appid: "wx-ts",',
      '    projectPath: "dist/weixin",',
      '    privateKeyPath: "keys/private.key"',
      '  }',
      '}',
    ].join('\n'))

    const loaded = await loadConfig({ cwd: tempRoot })

    expect(loaded.source).toBe('js')
    expect(loaded.sourceFile).toBe(path.join(tempRoot, 'wotci.config.ts'))
    expect(loaded.cwd).toBe(tempRoot)
  })

  it('supports explicit CommonJS config modules', async () => {
    await writeFile(path.join(tempRoot, 'wotci.config.cjs'), 'module.exports = { version: "3.0.0" }\n')

    const loaded = await loadConfig({
      configFile: 'wotci.config.cjs',
      cwd: tempRoot,
    })

    expect(loaded.source).toBe('js')
    expect(loaded.config.version).toBe('3.0.0')
  })

  it('falls back to package config when no config file exists', async () => {
    await writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({
      wotci: {
        version: '4.0.0',
      },
      description: 'package description',
      version: '0.0.5',
    }, null, 2))

    const loaded = await loadConfig({ cwd: tempRoot })

    expect(loaded.source).toBe('package-json')
    expect(loaded.config.version).toBe('4.0.0')
    expect(loaded.config.desc).toBe('package description')
  })

  it('keeps defineConfig identity', () => {
    const config = defineConfig({ version: '1.0.0' } as const)
    expect(config.version).toBe('1.0.0')
  })

  it('falls back to package defaults when no config source exists', async () => {
    const loaded = await loadConfig({ cwd: tempRoot })

    expect(loaded.source).toBe('defaults')
    expect(loaded.config.version).toBe('0.0.5')
    expect(loaded.config.desc).toBe('package description')
  })
})

describe('version comparison', () => {
  it('supports default import style', () => {
    expect(wotci.loadConfig).toBe(loadConfig)
    expect(wotci.uploadPlatform).toBe(uploadPlatform)
    expect(wotci.defineConfig).toBe(defineConfig)
    expect(wotci.compareVersion).toBe(compareVersion)
  })

  it('compares dot separated versions', () => {
    expect(compareVersion('1.0.0', '1')).toBe(0)
    expect(compareVersion('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersion('1.2.0', '1.10.0')).toBe(-1)
  })
})

describe('platform uploads', () => {
  it('builds weixin upload payloads with resolved paths', async () => {
    await writeFile(path.join(tempRoot, 'private.key'), 'secret')

    const result = await uploadWeixin({
      version: '1.0.0',
      weixin: {
        appid: 'wx123',
        privateKeyPath: 'private.key',
        projectPath: 'dist/weixin',
        robot: 1,
        setting: {
          useProjectConfig: true,
        },
      },
    }, { cwd: tempRoot })

    expect(WeixinProject).toHaveBeenCalledWith(expect.objectContaining({
      appid: 'wx123',
      privateKeyPath: path.join(tempRoot, 'private.key'),
      projectPath: path.join(tempRoot, 'dist/weixin'),
      type: 'miniProgram',
    }))
    expect(weixinUpload).toHaveBeenCalledWith(expect.objectContaining({
      robot: 1,
      setting: { useProjectConfig: true },
      version: '1.0.0',
    }))
    expect(result.platform).toBe('weixin')
  })

  it('handles alipay uploads with private key file resolution', async () => {
    await writeFile(path.join(tempRoot, 'alipay.pem'), 'private-key')

    const result = await uploadAlipay({
      desc: 'release',
      version: '1.0.1',
      alipay: {
        appid: 'ali123',
        privateKeyPath: 'alipay.pem',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd: tempRoot })

    expect(alipayUseDefaults).toHaveBeenCalled()
    expect(alipayGetUploadedVersion).toHaveBeenCalledWith({
      appId: 'ali123',
      clientType: 'alipay',
    })
    expect(alipayUpload).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'ali123',
      clientType: 'alipay',
      project: path.join(tempRoot, 'dist/alipay'),
      version: '1.0.1',
    }))
    expect(result.version).toBe('1.0.1')
  })

  it('routes uploadPlatform to dingtalk', async () => {
    const result = await uploadPlatform('dingtalk', {
      version: '1.0.2',
      dingtalk: {
        appid: 'dd123',
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd: tempRoot })

    expect(dingTalkSetConfig).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
    }))
    expect(dingTalkMiniUpload).toHaveBeenCalledWith(expect.objectContaining({
      miniAppId: 'dd123',
      packageVersion: '1.0.2',
      project: path.join(tempRoot, 'dist/dingtalk'),
    }))
    expect(result.version).toBe('1.0.2')
  })

  it('exports dedicated dingtalk uploader', async () => {
    const result = await uploadDingTalk({
      dingtalk: {
        appid: 'dd123',
        autoincrement: true,
        projectPath: 'dist/dingtalk',
        token: 'token',
      },
    }, { cwd: tempRoot })

    expect(result.platform).toBe('dingtalk')
    expect(dingTalkMiniUpload).toHaveBeenCalledWith(expect.objectContaining({
      packageVersion: '',
    }))
  })

  it('rejects unsupported platform names at runtime', async () => {
    await expect(uploadPlatform('unknown' as never, {}, { cwd: tempRoot })).rejects.toThrow()
  })
})

describe('cli', () => {
  it('parses short options', () => {
    expect(parseCliArgs(['-p', 'dd', '-c', 'test.config.js', '--cwd', '/tmp/example'])).toEqual({
      configFile: 'test.config.js',
      cwd: '/tmp/example',
      platform: 'dd',
    })
  })

  it('prints help text', async () => {
    const stdout: string[] = []

    const exitCode = await runCli(['--help'], {
      stdout: message => stdout.push(message),
    })

    expect(exitCode).toBe(0)
    expect(stdout).toEqual([createCliHelpText()])
  })

  it('fails when platform is missing', async () => {
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runCli([], {
      stderr: message => stderr.push(message),
      stdout: message => stdout.push(message),
    })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 缺少必填参数：--platform')
    expect(stdout).toContain(createCliHelpText())
  })

  it('rejects unknown arguments', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow('未知参数：--unknown')
  })

  it('prints nested cause messages for expected errors', async () => {
    const stderr: string[] = []

    const exitCode = await runCli(['--platform', 'alipay'], {
      cwd: tempRoot,
      stderr: message => stderr.push(message),
      stdout: () => {},
    })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('缺少支付宝小程序上传配置'))).toBe(true)
  })
})

describe('error formatting', () => {
  it('formats cause chain in order', () => {
    const error = new UploadError('外层错误', new Error('底层错误'))

    expect(formatErrorReport(error)).toEqual([
      '外层错误',
      '原因 1: 底层错误',
    ])
  })

  it('handles circular causes and stack formatting', () => {
    const error = new Error('循环错误') as Error & { cause?: unknown }
    error.cause = error

    expect(formatErrorReport(error)).toEqual([
      '循环错误',
      '原因 1: 检测到循环错误引用',
    ])
    expect(formatErrorStack(new Error('stack error')).length).toBeGreaterThan(0)
    expect(formatErrorStack('plain error')).toEqual([])
  })
})

describe('cli utilities', () => {
  it('formats logger output with custom writers', () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const logger = createCliLogger({
      stderr: message => stderr.push(message),
      stdout: message => stdout.push(message),
    })

    logger.info('hello')
    logger.start('start')
    logger.success('ok')
    logger.error(new Error('boom'))
    logger.log('plain', 1)

    expect(stdout).toEqual([
      '[信息] hello',
      '[开始] start',
      '[成功] ok',
      'plain 1',
    ])
    expect(stderr).toEqual(['[失败] boom'])
  })

  it('formats message helpers', () => {
    expect(createCliConfigLoadedMessage('defaults')).toBe('配置加载完成，来源：默认配置')
    expect(createCliUploadStartMessage('weixin')).toBe('开始上传微信小程序...')
    expect(appendDesc('上传成功', 'release')).toBe('上传成功，描述：release')
    expect(appendDesc('上传成功')).toBe('上传成功')
  })
})
