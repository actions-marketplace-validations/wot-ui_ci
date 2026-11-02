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
    app: { getUploadedVersion: mocks.alipayGetUploadedVersion },
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

const { parseCliArgs, runCli } = await import('../src/cli')
const { createCliHelpText } = await import('../src/messages')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.WeixinProject.mockImplementation(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    this.options = options
  })
  mocks.weixinUpload.mockResolvedValue({
    subPackageInfo: [{ name: '__FULL__', size: 2048 }],
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createCliProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-'))
  tempDirs.push(cwd)

  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({
    description: 'fixture description',
    name: 'fixture',
    type: 'module',
    version: '1.0.0',
  }, null, 2))
  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await mkdir(path.join(cwd, 'keys'), { recursive: true })
  await writeFile(path.join(cwd, 'keys/weixin.key'), 'key')
  await writeFile(path.join(cwd, 'wotci.config.js'), [
    'export default {',
    '  weixin: {',
    '    appid: "wx123",',
    '    projectPath: "dist/weixin",',
    '    privateKeyPath: "keys/weixin.key",',
    '  },',
    '}',
  ].join('\n'))

  return cwd
}

describe('parseCliArgs', () => {
  it('解析长短参数', () => {
    expect(parseCliArgs(['-p', 'dd', '-c', 'test.config.js', '--cwd', '/tmp/example'])).toEqual({
      configFile: 'test.config.js',
      cwd: '/tmp/example',
      platform: 'dd',
    })
  })

  it('解析 help', () => {
    expect(parseCliArgs(['--help'])).toEqual({ help: true })
    expect(parseCliArgs(['-h'])).toEqual({ help: true })
  })

  it('未知参数抛出错误', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow('未知参数：--unknown')
  })

  it('参数缺少值时抛出错误', () => {
    expect(() => parseCliArgs(['-p'])).toThrow('参数缺少值：-p')
  })
})

describe('runCli', () => {
  it('打印帮助信息', async () => {
    const stdout: string[] = []

    const exitCode = await runCli(['--help'], {
      stdout: message => stdout.push(message),
    })

    expect(exitCode).toBe(0)
    expect(stdout).toEqual([createCliHelpText()])
  })

  it('缺少 platform 时返回 1 并打印帮助', async () => {
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

  it('加载配置并上传成功', async () => {
    const cwd = await createCliProject()
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runCli(['-p', 'weixin'], {
      cwd,
      stderr: message => stderr.push(message),
      stdout: message => stdout.push(message),
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.some(line => line.includes('配置加载完成'))).toBe(true)
    expect(stdout.some(line => line.includes('开始上传微信小程序'))).toBe(true)
    expect(stdout.some(line => line.includes('[成功]') && line.includes('版本：1.0.0'))).toBe(true)
    expect(mocks.weixinUpload).toHaveBeenCalledWith(expect.objectContaining({ version: '1.0.0' }))
  })

  it('配置缺少平台信息时返回 1', async () => {
    const cwd = await createCliProject()
    await writeFile(path.join(cwd, 'wotci.config.js'), 'export default { version: "1.0.0" }\n')
    const stderr: string[] = []

    const exitCode = await runCli(['-p', 'weixin'], {
      cwd,
      stderr: message => stderr.push(message),
      stdout: () => {},
    })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('缺少微信小程序上传配置'))).toBe(true)
  })

  it('上传失败时返回 1 并打印 cause', async () => {
    const cwd = await createCliProject()
    mocks.weixinUpload.mockRejectedValueOnce(new Error('sdk failed'))
    const stderr: string[] = []

    const exitCode = await runCli(['-p', 'weixin'], {
      cwd,
      stderr: message => stderr.push(message),
      stdout: () => {},
    })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('微信小程序上传失败'))).toBe(true)
    expect(stderr.some(line => line.includes('原因 1: sdk failed'))).toBe(true)
  })

  it('未知平台时返回 1', async () => {
    const cwd = await createCliProject()
    const stderr: string[] = []

    const exitCode = await runCli(['-p', 'unknown'], {
      cwd,
      stderr: message => stderr.push(message),
      stdout: () => {},
    })

    expect(exitCode).toBe(1)
    expect(stderr.some(line => line.includes('不支持的平台：unknown'))).toBe(true)
  })
})

describe('长参数形式', () => {
  it('支持 --platform / --config / --cwd', async () => {
    const cwd = await createCliProject()
    const stdout: string[] = []

    const exitCode = await runCli([
      '--platform',
      'weixin',
      '--config',
      'wotci.config.js',
      '--cwd',
      cwd,
    ], {
      stderr: () => {},
      stdout: message => stdout.push(message),
    })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('[成功]'))).toBe(true)
  })
})

describe('iDE 子命令参数', () => {
  it('解析 open 子命令与 IDE 选项', () => {
    expect(parseCliArgs([
      'open',
      '-p',
      'weixin',
      '--port',
      '9420',
      '--lang',
      'zh',
      '--force',
      '--dry-run',
    ])).toEqual({
      command: 'open',
      dryRun: true,
      force: true,
      lang: 'zh',
      platform: 'weixin',
      port: 9420,
    })
  })

  it('解析 close 子命令与 --quit', () => {
    expect(parseCliArgs(['close', '-p', 'weixin', '--quit'])).toEqual({
      command: 'close',
      platform: 'weixin',
      quit: true,
    })
  })

  it('未知命令抛出错误', () => {
    expect(() => parseCliArgs(['nope'])).toThrow('未知命令：nope')
  })

  it('非法 port / lang 抛出错误', () => {
    expect(() => parseCliArgs(['open', '--port', '0'])).toThrow('必须是 1-65535 的整数')
    expect(() => parseCliArgs(['open', '--lang', 'fr'])).toThrow('必须是 zh 或 en')
  })

  it('帮助信息包含 IDE 子命令', () => {
    expect(createCliHelpText()).toContain('wotci open')
    expect(createCliHelpText()).toContain('--quit')
  })
})
