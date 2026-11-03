import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  vi.doUnmock('minidev')
  vi.resetModules()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-ide-alipay-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/alipay'), { recursive: true })
  return cwd
}

function createConfig() {
  return {
    alipay: {
      appid: 'ali123',
      privateKey: 'key',
      projectPath: 'dist/alipay',
      toolId: 'tool-id',
    },
  }
}

describe('minidev 导出形态（IDE）', () => {
  it('兼容只有 default.startIde 的导出', async () => {
    const cwd = await createFixture()
    const startIde = vi.fn(async () => {})

    vi.doMock('minidev', () => ({
      minidev: undefined,
      useDefaults: undefined,
      default: { startIde },
    }))
    const { runAlipayIde } = await import('../src/ide/alipay')

    await runAlipayIde('open', createConfig(), { cwd })

    expect(startIde).toHaveBeenCalledWith({ project: path.join(cwd, 'dist/alipay') })
  })

  it('兼容 default.minidev.startIde 的导出', async () => {
    const cwd = await createFixture()
    const startIde = vi.fn(async () => {})

    vi.doMock('minidev', () => ({
      minidev: undefined,
      useDefaults: undefined,
      default: { minidev: { startIde } },
    }))
    const { runAlipayIde } = await import('../src/ide/alipay')

    await runAlipayIde('open', createConfig(), { cwd })

    expect(startIde).toHaveBeenCalled()
  })

  it('缺少 startIde 时抛出 IdeUnsupportedError', async () => {
    const cwd = await createFixture()

    vi.doMock('minidev', () => ({
      minidev: {},
      useDefaults: undefined,
      default: {},
    }))
    const { runAlipayIde } = await import('../src/ide/alipay')

    await expect(runAlipayIde('open', createConfig(), { cwd }))
      .rejects
      .toThrow('minidev 未提供 startIde 能力')
  })

  it('没有可用导出时抛出 IdeUnsupportedError', async () => {
    const cwd = await createFixture()

    vi.doMock('minidev', () => ({
      minidev: undefined,
      useDefaults: undefined,
      default: undefined,
    }))
    const { runAlipayIde } = await import('../src/ide/alipay')

    await expect(runAlipayIde('open', createConfig(), { cwd }))
      .rejects
      .toThrow('minidev 未提供 startIde 能力')
  })

  it('default 为原始值时按不可用处理', async () => {
    const cwd = await createFixture()

    vi.doMock('minidev', () => ({
      minidev: undefined,
      useDefaults: undefined,
      default: 'not-a-module',
    }))
    const { runAlipayIde } = await import('../src/ide/alipay')

    await expect(runAlipayIde('open', createConfig(), { cwd }))
      .rejects
      .toThrow('minidev 未提供 startIde 能力')
  })
})
