import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  startIde: vi.fn(),
}))

vi.mock('../src/ide/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ide/runner')>()
  return {
    ...actual,
    runCommand: mocks.runCommand,
  }
})

vi.mock('minidev', () => {
  const minidev = { startIde: mocks.startIde }

  return {
    minidev,
    useDefaults: vi.fn(),
    default: { minidev, useDefaults: vi.fn() },
  }
})

const {
  autoIde,
  closeIde,
  getIdeStatus,
  openIde,
  previewIde,
} = await import('../src/ide')
const { runAlipayIde } = await import('../src/ide/alipay')
const {
  autoWeixinIde,
  getWeixinCliCandidates,
  getWeixinIdeStatus,
  previewWeixinIde,
  runWeixinIde,
} = await import('../src/ide/weixin')
const {
  ConfigError,
  IdeError,
  IdeNotFoundError,
  IdeUnsupportedError,
} = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runCommand.mockResolvedValue({ stderr: '', stdout: '' })
  mocks.startIde.mockResolvedValue(undefined)
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

interface Fixture {
  alipayProject: string
  cliPath: string
  cwd: string
  weixinProject: string
}

async function createFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-ide-'))
  tempDirs.push(cwd)

  const weixinProject = path.join(cwd, 'dist/weixin')
  const alipayProject = path.join(cwd, 'dist/alipay')
  const cliPath = path.join(cwd, 'wechat-cli')

  await mkdir(weixinProject, { recursive: true })
  await mkdir(alipayProject, { recursive: true })
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  await writeFile(cliPath, '#!/bin/sh\n')

  return { alipayProject, cliPath, cwd, weixinProject }
}

function weixinConfig(cliPath: string) {
  return {
    weixin: {
      appid: 'wx123',
      ide: { cliPath },
      privateKeyPath: 'key',
      projectPath: 'dist/weixin',
    },
  }
}

function alipayConfig() {
  return {
    alipay: {
      appid: 'ali123',
      privateKey: 'key',
      projectPath: 'dist/alipay',
      toolId: 'tool-id',
    },
  }
}

describe('getWeixinCliCandidates', () => {
  it('显式配置优先且只返回配置路径', () => {
    expect(getWeixinCliCandidates({ configuredPath: '/custom/cli', platform: 'darwin' }))
      .toEqual(['/custom/cli'])
  })

  it('按平台返回默认路径', () => {
    expect(getWeixinCliCandidates({ platform: 'darwin' })[0])
      .toBe('/Applications/wechatwebdevtools.app/Contents/MacOS/cli')
    expect(getWeixinCliCandidates({ platform: 'win32' })).toHaveLength(2)
    expect(getWeixinCliCandidates({ platform: 'linux' })[0]).toBe('/opt/wechat-devtools/cli')
  })

  it('环境变量路径排在默认路径之前', () => {
    expect(getWeixinCliCandidates({ envPath: '/env/cli', platform: 'darwin' })[0]).toBe('/env/cli')
  })
})

describe('微信 IDE', () => {
  it('打开项目并传递 port / lang', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValueOnce({ stderr: '', stdout: 'opened\n' })

    const result = await runWeixinIde('open', weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      lang: 'zh',
      port: 9420,
    })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      command: fixture.cliPath,
      args: ['open', '--project', fixture.weixinProject, '--port', '9420', '--lang', 'zh'],
    }, { cwd: fixture.cwd })
    expect(result.executed).toBe(true)
    expect(result.stdout).toBe('opened')
    expect(result.message).toContain('已在微信开发者工具中打开')
  })

  it('dryRun 只返回命令不执行', async () => {
    const fixture = await createFixture()

    const result = await runWeixinIde('open', weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      dryRun: true,
    })

    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(result.executed).toBe(false)
    expect(result.message).toContain('将执行：')
  })

  it('关闭项目与退出 IDE 使用不同命令', async () => {
    const fixture = await createFixture()

    await runWeixinIde('close', weixinConfig(fixture.cliPath), { cwd: fixture.cwd })
    expect(mocks.runCommand).toHaveBeenLastCalledWith({
      command: fixture.cliPath,
      args: ['close', '--project', fixture.weixinProject],
    }, { cwd: fixture.cwd })

    await runWeixinIde('quit', weixinConfig(fixture.cliPath), { cwd: fixture.cwd })
    expect(mocks.runCommand).toHaveBeenLastCalledWith({
      command: fixture.cliPath,
      args: ['quit'],
    }, { cwd: fixture.cwd })
  })

  it('项目目录不存在时拒绝', async () => {
    const fixture = await createFixture()

    await expect(runWeixinIde('open', {
      weixin: {
        appid: 'wx123',
        ide: { cliPath: fixture.cliPath },
        privateKeyPath: 'key',
        projectPath: 'dist/missing',
      },
    }, { cwd: fixture.cwd }))
      .rejects
      .toThrow('微信小程序产物目录不存在')
  })

  it('缺少微信配置时拒绝', async () => {
    const fixture = await createFixture()

    await expect(runWeixinIde('open', {}, { cwd: fixture.cwd }))
      .rejects
      .toThrow(ConfigError)
  })

  it('找不到 CLI 时给出尝试过的路径', async () => {
    const fixture = await createFixture()

    const error = await runWeixinIde('open', weixinConfig(path.join(fixture.cwd, 'missing-cli')), {
      cwd: fixture.cwd,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IdeNotFoundError)
    expect((error as Error).message).toContain('missing-cli')
    expect((error as Error).message).toContain('weixin.ide.cliPath')
  })
})

describe('支付宝 IDE', () => {
  it('调用 minidev.startIde 并传递 project / appPath', async () => {
    const fixture = await createFixture()
    const config = {
      ...alipayConfig(),
      alipay: {
        ...alipayConfig().alipay,
        ide: { appPath: '/Applications/Alipay.app' },
      },
    }

    const result = await runAlipayIde('open', config, { cwd: fixture.cwd })

    expect(mocks.startIde).toHaveBeenCalledWith({
      appPath: '/Applications/Alipay.app',
      project: fixture.alipayProject,
    })
    expect(result.executed).toBe(true)
    expect(result.message).toContain('已在支付宝小程序开发者工具中打开')
  })

  it('dryRun 不调用 startIde', async () => {
    const fixture = await createFixture()

    const result = await runAlipayIde('open', alipayConfig(), {
      cwd: fixture.cwd,
      dryRun: true,
    })

    expect(mocks.startIde).not.toHaveBeenCalled()
    expect(result.executed).toBe(false)
    expect(result.message).toContain('minidev.startIde')
  })

  it('不支持关闭或退出', async () => {
    const fixture = await createFixture()

    await expect(runAlipayIde('close', alipayConfig(), { cwd: fixture.cwd }))
      .rejects
      .toThrow(IdeUnsupportedError)
  })

  it('缺少配置或目录时拒绝', async () => {
    const fixture = await createFixture()

    await expect(runAlipayIde('open', {}, { cwd: fixture.cwd }))
      .rejects
      .toThrow('缺少支付宝小程序配置')

    await expect(runAlipayIde('open', {
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/missing',
        toolId: 'tool-id',
      },
    }, { cwd: fixture.cwd }))
      .rejects
      .toThrow('支付宝小程序产物目录不存在')
  })
})

describe('openIde / closeIde 路由', () => {
  it('按平台打开 IDE', async () => {
    const fixture = await createFixture()

    const weixin = await openIde('weixin', {
      config: weixinConfig(fixture.cliPath),
      cwd: fixture.cwd,
      force: true,
    })
    expect(weixin.platform).toBe('weixin')

    const alipay = await openIde('alipay', {
      config: alipayConfig(),
      cwd: fixture.cwd,
      force: true,
    })
    expect(alipay.platform).toBe('alipay')
  })

  it('钉钉不支持打开或关闭 IDE', async () => {
    const fixture = await createFixture()

    await expect(openIde('dingtalk', { cwd: fixture.cwd, force: true }))
      .rejects
      .toThrow(IdeUnsupportedError)
    await expect(closeIde('dingtalk', { cwd: fixture.cwd }))
      .rejects
      .toThrow(IdeUnsupportedError)
  })

  it('支付宝不支持关闭', async () => {
    const fixture = await createFixture()

    await expect(closeIde('alipay', { cwd: fixture.cwd }))
      .rejects
      .toThrow(IdeUnsupportedError)
  })

  it('关闭微信项目或退出 IDE', async () => {
    const fixture = await createFixture()

    const closed = await closeIde('weixin', {
      config: weixinConfig(fixture.cliPath),
      cwd: fixture.cwd,
    })
    expect(closed.action).toBe('close')

    const quit = await closeIde('weixin', {
      config: weixinConfig(fixture.cliPath),
      cwd: fixture.cwd,
      quit: true,
    })
    expect(quit.action).toBe('quit')
  })

  it('cI 环境下默认拒绝启动 GUI，force 可覆盖', async () => {
    const fixture = await createFixture()
    const originalCi = process.env.CI

    try {
      process.env.CI = 'true'

      const error = await openIde('weixin', {
        config: weixinConfig(fixture.cliPath),
        cwd: fixture.cwd,
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(IdeError)
      expect((error as { code?: string }).code).toBe('IDE_CI_BLOCKED')

      await expect(openIde('weixin', {
        config: weixinConfig(fixture.cliPath),
        cwd: fixture.cwd,
        force: true,
      })).resolves.toMatchObject({ executed: true })

      await expect(openIde('weixin', {
        config: weixinConfig(fixture.cliPath),
        cwd: fixture.cwd,
        dryRun: true,
      })).resolves.toMatchObject({ executed: false })
    }
    finally {
      if (originalCi === undefined)
        delete process.env.CI
      else
        process.env.CI = originalCi
    }
  })

  it('cI=false 视为非 CI 环境', async () => {
    const fixture = await createFixture()
    const originalCi = process.env.CI

    try {
      process.env.CI = 'false'

      await expect(openIde('weixin', {
        config: weixinConfig(fixture.cliPath),
        cwd: fixture.cwd,
      })).resolves.toMatchObject({ executed: true })
    }
    finally {
      if (originalCi === undefined)
        delete process.env.CI
      else
        process.env.CI = originalCi
    }
  })
})

describe('微信 CLI 探测补充', () => {
  it('未传平台时使用 process.platform', () => {
    expect(getWeixinCliCandidates({}).length).toBeGreaterThan(0)
  })

  it('未配置 cliPath 时读取环境变量', async () => {
    const fixture = await createFixture()
    const original = process.env.WECHAT_DEVTOOLS_CLI
    process.env.WECHAT_DEVTOOLS_CLI = fixture.cliPath

    try {
      const result = await runWeixinIde('open', {
        weixin: {
          appid: 'wx123',
          privateKeyPath: 'key',
          projectPath: 'dist/weixin',
        },
      }, { cwd: fixture.cwd, dryRun: true })

      expect(result.executed).toBe(false)
    }
    finally {
      if (original === undefined)
        delete process.env.WECHAT_DEVTOOLS_CLI
      else
        process.env.WECHAT_DEVTOOLS_CLI = original
    }
  })

  it('不传 cwd 时使用 process.cwd()', async () => {
    const fixture = await createFixture()

    const result = await runWeixinIde('open', {
      weixin: {
        appid: 'wx123',
        ide: { cliPath: fixture.cliPath },
        privateKeyPath: 'key',
        projectPath: fixture.weixinProject,
      },
    }, { dryRun: true })

    expect(result.projectPath).toBe(fixture.weixinProject)
  })
})

describe('支付宝 IDE 补充分支', () => {
  it('不传 cwd 且 dryRun 时使用 process.cwd()', async () => {
    const fixture = await createFixture()

    const result = await runAlipayIde('open', {
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: fixture.alipayProject,
        toolId: 'tool-id',
      },
    }, { dryRun: true })

    expect(result.executed).toBe(false)
  })

  it('dryRun 且配置 appPath 时消息包含 appPath', async () => {
    const fixture = await createFixture()

    const result = await runAlipayIde('open', {
      alipay: {
        appid: 'ali123',
        ide: { appPath: '/Applications/Alipay.app' },
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd: fixture.cwd, dryRun: true })

    expect(result.message).toContain('/Applications/Alipay.app')
  })
})

describe('iDE 状态查询', () => {
  it('cLI 已安装且已登录', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValueOnce({ stderr: '', stdout: 'true\n' })

    const result = await getWeixinIdeStatus(weixinConfig(fixture.cliPath), { cwd: fixture.cwd })

    expect(result).toMatchObject({
      cliPath: fixture.cliPath,
      installed: true,
      loggedIn: true,
      platform: 'weixin',
    })
    expect(result.message).toContain('已登录')
  })

  it('cLI 已安装但未登录', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValueOnce({ stderr: '', stdout: 'false\n' })

    const result = await getWeixinIdeStatus(weixinConfig(fixture.cliPath), { cwd: fixture.cwd })

    expect(result.loggedIn).toBe(false)
    expect(result.message).toContain('未登录')
  })

  it('输出无法判断登录状态时保留未知', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValueOnce({ stderr: '', stdout: 'something\n' })

    const result = await getWeixinIdeStatus(weixinConfig(fixture.cliPath), { cwd: fixture.cwd })

    expect(result.loggedIn).toBeUndefined()
    expect(result.message).toContain('登录状态未知')
    expect(result.stdout).toBe('something')
  })

  it('cLI 不存在时返回 installed=false', async () => {
    const fixture = await createFixture()

    const result = await getWeixinIdeStatus(weixinConfig(path.join(fixture.cwd, 'missing-cli')), {
      cwd: fixture.cwd,
    })

    expect(result.installed).toBe(false)
    expect(result.message).toContain('未找到微信开发者工具 CLI')
  })

  it('命令执行失败时返回已安装但状态未知', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockRejectedValueOnce(new Error('boom'))

    const result = await getWeixinIdeStatus(weixinConfig(fixture.cliPath), { cwd: fixture.cwd })

    expect(result.installed).toBe(true)
    expect(result.message).toContain('无法获取登录状态')
  })

  it('getIdeStatus 仅支持微信', async () => {
    const fixture = await createFixture()

    await expect(getIdeStatus('alipay', { config: alipayConfig(), cwd: fixture.cwd }))
      .rejects
      .toThrow(IdeUnsupportedError)
    await expect(getIdeStatus('dingtalk', { cwd: fixture.cwd }))
      .rejects
      .toThrow(IdeUnsupportedError)
  })
})

describe('iDE 自动化', () => {
  it('组装 auto 命令并传递 trustProject / ticket / port / lang', async () => {
    const fixture = await createFixture()

    const result = await autoWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      lang: 'zh',
      port: 9420,
      ticket: 'ticket-1',
      trustProject: true,
    })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      command: fixture.cliPath,
      args: [
        'auto',
        '--project',
        fixture.weixinProject,
        '--port',
        '9420',
        '--trust-project',
        '--ticket',
        'ticket-1',
        '--lang',
        'zh',
      ],
    }, { cwd: fixture.cwd })
    expect(result).toMatchObject({ action: 'auto', executed: true, platform: 'weixin' })
    expect(result.message).toContain('已开启微信开发者工具自动化')
  })

  it('dryRun 不执行', async () => {
    const fixture = await createFixture()

    const result = await autoWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      dryRun: true,
    })

    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(result.executed).toBe(false)
    expect(result.message).toContain('将执行：')
  })

  it('项目目录不存在时拒绝', async () => {
    const fixture = await createFixture()

    await expect(autoWeixinIde({
      weixin: {
        appid: 'wx123',
        ide: { cliPath: fixture.cliPath },
        privateKeyPath: 'key',
        projectPath: 'dist/missing',
      },
    }, { cwd: fixture.cwd }))
      .rejects
      .toThrow('微信小程序产物目录不存在')
  })

  it('autoIde 仅支持微信且在 CI 下默认拒绝', async () => {
    const fixture = await createFixture()
    const originalCi = process.env.CI

    try {
      await expect(autoIde('alipay', { config: alipayConfig(), cwd: fixture.cwd, force: true }))
        .rejects
        .toThrow(IdeUnsupportedError)

      process.env.CI = 'true'
      await expect(autoIde('weixin', { config: weixinConfig(fixture.cliPath), cwd: fixture.cwd }))
        .rejects
        .toThrow('检测到 CI 环境')
    }
    finally {
      if (originalCi === undefined)
        delete process.env.CI
      else
        process.env.CI = originalCi
    }
  })
})

describe('iDE 预览', () => {
  it('默认生成 image 二维码并传递 info-output', async () => {
    const fixture = await createFixture()

    const result = await previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      infoOutput: 'out/info.json',
    })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      command: fixture.cliPath,
      args: [
        'preview',
        '--project',
        fixture.weixinProject,
        '--qr-format',
        'image',
        '--qr-output',
        path.join(fixture.cwd, '.wotci/preview/weixin-ide.png'),
        '--info-output',
        path.join(fixture.cwd, 'out/info.json'),
      ],
    }, { cwd: fixture.cwd })
    expect(result).toMatchObject({
      executed: true,
      infoPath: path.join(fixture.cwd, 'out/info.json'),
      platform: 'weixin',
    })
    expect(result.qrCode).toEqual({
      kind: 'file',
      path: path.join(fixture.cwd, '.wotci/preview/weixin-ide.png'),
      value: path.join(fixture.cwd, '.wotci/preview/weixin-ide.png'),
    })
  })

  it('terminal 模式不传 qr-output', async () => {
    const fixture = await createFixture()

    const result = await previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      qrFormat: 'terminal',
    })

    const call = mocks.runCommand.mock.calls[0][0] as { args: string[] }
    expect(call.args).not.toContain('--qr-output')
    expect(result.qrCode).toEqual({ kind: 'terminal', value: '' })
  })

  it('base64 模式读取文件内容', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockImplementationOnce(async () => {
      await writeFile(path.join(fixture.cwd, '.wotci/preview/weixin-ide.txt'), 'YmFzZTY0\n')
      return { stderr: '', stdout: '' }
    })

    const result = await previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      qrFormat: 'base64',
    })

    expect(result.qrCode).toEqual({
      kind: 'base64',
      path: path.join(fixture.cwd, '.wotci/preview/weixin-ide.txt'),
      value: 'YmFzZTY0',
    })
  })

  it('dryRun 不执行命令', async () => {
    const fixture = await createFixture()

    const result = await previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      dryRun: true,
    })

    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(result.executed).toBe(false)
    expect(result.qrCode).toBeUndefined()
    expect(result.message).toContain('将执行：')
  })

  it('base64 文件读取失败时抛出 IdeError', async () => {
    const fixture = await createFixture()

    await expect(previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      qrFormat: 'base64',
    }))
      .rejects
      .toThrow('读取 IDE 预览二维码失败')
  })

  it('previewIde 仅支持微信且在 CI 下默认拒绝', async () => {
    const fixture = await createFixture()
    const originalCi = process.env.CI

    try {
      await expect(previewIde('alipay', { config: alipayConfig(), cwd: fixture.cwd, force: true }))
        .rejects
        .toThrow(IdeUnsupportedError)

      process.env.CI = 'true'
      await expect(previewIde('weixin', { config: weixinConfig(fixture.cliPath), cwd: fixture.cwd }))
        .rejects
        .toThrow('检测到 CI 环境')
    }
    finally {
      if (originalCi === undefined)
        delete process.env.CI
      else
        process.env.CI = originalCi
    }
  })
})

describe('iDE 包装入口与端口参数', () => {
  it('getIdeStatus / autoIde / previewIde 走通微信路径', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValue({ stderr: '', stdout: 'true\n' })

    await expect(getIdeStatus('weixin', {
      config: weixinConfig(fixture.cliPath),
      cwd: fixture.cwd,
    })).resolves.toMatchObject({ installed: true, loggedIn: true })

    await expect(autoIde('weixin', {
      config: weixinConfig(fixture.cliPath),
      cwd: fixture.cwd,
      force: true,
    })).resolves.toMatchObject({ action: 'auto' })

    await expect(previewIde('weixin', {
      config: weixinConfig(fixture.cliPath),
      cwd: fixture.cwd,
      dryRun: true,
    })).resolves.toMatchObject({ executed: false })
  })

  it('status 透传 port / lang', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValueOnce({ stderr: '', stdout: 'true' })

    await getWeixinIdeStatus(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      lang: 'zh',
      port: 9420,
    })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      command: fixture.cliPath,
      args: ['islogin', '--port', '9420', '--lang', 'zh'],
    }, { cwd: fixture.cwd })
  })

  it('iDE preview 透传 port / lang', async () => {
    const fixture = await createFixture()

    await previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      dryRun: true,
      lang: 'zh',
      port: 9420,
    })

    const call = mocks.runCommand.mock.calls[0]?.[0] as { args: string[] } | undefined
    // dryRun 不执行 runCommand，从返回的 message 也看不到参数，改为非 dryRun 校验
    expect(call).toBeUndefined()

    await previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      lang: 'zh',
      port: 9420,
    })

    expect(mocks.runCommand).toHaveBeenLastCalledWith({
      command: fixture.cliPath,
      args: [
        'preview',
        '--project',
        fixture.weixinProject,
        '--qr-format',
        'image',
        '--qr-output',
        path.join(fixture.cwd, '.wotci/preview/weixin-ide.png'),
        '--port',
        '9420',
        '--lang',
        'zh',
      ],
    }, { cwd: fixture.cwd })
  })
})

describe('iDE 补充默认参数与错误', () => {
  it('auto 不传 cwd 时使用 process.cwd()', async () => {
    const fixture = await createFixture()

    const result = await autoWeixinIde({
      weixin: {
        appid: 'wx123',
        ide: { cliPath: fixture.cliPath },
        privateKeyPath: 'key',
        projectPath: fixture.weixinProject,
      },
    }, { dryRun: true })

    expect(result.executed).toBe(false)
  })

  it('status 不传 cwd 且输出为空时省略 stdout', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValueOnce({ stderr: '', stdout: '\n' })

    const result = await getWeixinIdeStatus({
      weixin: {
        appid: 'wx123',
        ide: { cliPath: fixture.cliPath },
        privateKeyPath: 'key',
        projectPath: 'dist/weixin',
      },
    })

    expect(result.stdout).toBeUndefined()
  })

  it('status 捕获非 Error 异常', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockRejectedValueOnce('string-error')

    const result = await getWeixinIdeStatus(weixinConfig(fixture.cliPath), { cwd: fixture.cwd })

    expect(result.message).toContain('string-error')
  })

  it('iDE 预览 dryRun 携带 infoOutput', async () => {
    const fixture = await createFixture()

    const result = await previewWeixinIde(weixinConfig(fixture.cliPath), {
      cwd: fixture.cwd,
      dryRun: true,
      infoOutput: 'out/info.json',
    })

    expect(result.infoPath).toBe(path.join(fixture.cwd, 'out/info.json'))
  })

  it('iDE 预览不传 cwd 时使用 process.cwd() 并透传 stdout', async () => {
    const fixture = await createFixture()
    mocks.runCommand.mockResolvedValueOnce({ stderr: '', stdout: 'preview-output\n' })

    const result = await previewWeixinIde({
      weixin: {
        appid: 'wx123',
        ide: { cliPath: fixture.cliPath },
        privateKeyPath: 'key',
        projectPath: fixture.weixinProject,
      },
    })

    expect(result.stdout).toBe('preview-output')
  })
})

describe('微信 CLI 环境变量回退', () => {
  it('没有 cliPath 且环境变量路径不存在时抛出 IdeNotFoundError', async () => {
    const fixture = await createFixture()
    const originalEnv = process.env.WECHAT_DEVTOOLS_CLI
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('freebsd' as NodeJS.Platform)
    process.env.WECHAT_DEVTOOLS_CLI = path.join(fixture.cwd, 'missing-env-cli')

    try {
      await expect(runWeixinIde('open', {
        weixin: {
          appid: 'wx123',
          privateKeyPath: 'key',
          projectPath: 'dist/weixin',
        },
      }, { cwd: fixture.cwd }))
        .rejects
        .toThrow(IdeNotFoundError)
    }
    finally {
      platformSpy.mockRestore()
      if (originalEnv === undefined)
        delete process.env.WECHAT_DEVTOOLS_CLI
      else
        process.env.WECHAT_DEVTOOLS_CLI = originalEnv
    }
  })
})
