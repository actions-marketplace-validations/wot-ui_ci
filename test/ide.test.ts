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

const { closeIde, openIde } = await import('../src/ide')
const { runAlipayIde } = await import('../src/ide/alipay')
const { getWeixinCliCandidates, runWeixinIde } = await import('../src/ide/weixin')
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
