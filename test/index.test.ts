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

const { compareVersion, defineConfig, loadConfig, uploadAlipay, uploadDingTalk, uploadPlatform, uploadWeixin } = await import('../src')
const { parseCliArgs, runCli } = await import('../src/cli')

let tempRoot = ''

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'minici-'))
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
  it('loads JS config and resolves env-based values', async () => {
    process.env.UNI_MINI_CI_VERSION = '2.0.0'
    await writeFile(path.join(tempRoot, 'minici.config.js'), [
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
    await writeFile(path.join(tempRoot, 'minici.config.ts'), [
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
    expect(loaded.sourceFile).toBe(path.join(tempRoot, 'minici.config.ts'))
    expect(loaded.cwd).toBe(tempRoot)
  })

  it('supports explicit CommonJS config modules', async () => {
    await writeFile(path.join(tempRoot, 'minici.config.cjs'), 'module.exports = { version: "3.0.0" }\n')

    const loaded = await loadConfig({
      configFile: 'minici.config.cjs',
      cwd: tempRoot,
    })

    expect(loaded.source).toBe('js')
    expect(loaded.config.version).toBe('3.0.0')
  })

  it('falls back to package config when no config file exists', async () => {
    await writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({
      minici: {
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

  it('normalizes legacy dd config from .minicirc', async () => {
    await writeFile(path.join(tempRoot, '.minicirc'), JSON.stringify({
      dd: {
        appid: 'dd-legacy',
        projectPath: 'dist/legacy-dd',
        token: 'token',
      },
      version: '5.0.0',
    }, null, 2))

    const loaded = await loadConfig({ cwd: tempRoot })

    expect(loaded.source).toBe('minicirc')
    expect(loaded.config.dingtalk?.appid).toBe('dd-legacy')
    expect(loaded.config.dd).toBeUndefined()
  })

  it('keeps defineConfig identity', () => {
    const config = defineConfig({ version: '1.0.0' } as const)
    expect(config.version).toBe('1.0.0')
  })
})

describe('version comparison', () => {
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
})

describe('cli', () => {
  it('parses short options', () => {
    expect(parseCliArgs(['-p', 'dd', '-c', 'test.config.js', '--cwd', '/tmp/example'])).toEqual({
      configFile: 'test.config.js',
      cwd: '/tmp/example',
      platform: 'dd',
    })
  })

  it('loads legacy .minicirc and uploads via dd alias', async () => {
    const stdout: string[] = []
    const stderr: string[] = []

    await writeFile(path.join(tempRoot, '.minicirc'), JSON.stringify({
      dd: {
        appid: 'dd-legacy',
        projectPath: 'dist/legacy-dd',
        token: 'token',
      },
      version: '6.0.0',
    }, null, 2))

    const exitCode = await runCli(['--platform', 'dd', '--cwd', tempRoot], {
      stderr: message => stderr.push(message),
      stdout: message => stdout.push(message),
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toContain(`[信息] 配置加载完成，来源：.minicirc 配置文件（${path.join(tempRoot, '.minicirc')}）`)
    expect(stdout).toContain('[信息] 开始上传钉钉小程序...')
    expect(stdout.some(line => line.includes('[成功] 钉钉小程序上传成功，版本：1.0.2'))).toBe(true)
    expect(dingTalkMiniUpload).toHaveBeenCalledWith(expect.objectContaining({
      miniAppId: 'dd-legacy',
      packageVersion: '6.0.0',
      project: path.join(tempRoot, 'dist/legacy-dd'),
    }))
  })
})
