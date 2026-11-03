import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  vi.doUnmock('miniprogram-ci')
  vi.doUnmock('minidev')
  vi.resetModules()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-shape-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await mkdir(path.join(cwd, 'dist/alipay'), { recursive: true })
  await writeFile(path.join(cwd, 'weixin.key'), 'weixin-key')
  return cwd
}

const weixinConfig = {
  appid: 'wx123',
  privateKeyPath: 'weixin.key',
  projectPath: 'dist/weixin',
}

describe('miniprogram-ci 导出形态', () => {
  it('兼容 default 导出', async () => {
    const cwd = await createFixture()
    const Project = vi.fn(function (this: Record<string, unknown>, options: Record<string, unknown>) {
      this.options = options
    })
    const upload = vi.fn(async () => ({ subPackageInfo: [] }))
    const preview = vi.fn(async () => ({ subPackageInfo: [] }))
    const getLatestVersion = vi.fn(async () => ({ latestVersion: '1.0.0' }))

    vi.doMock('miniprogram-ci', () => ({
      Project: undefined,
      getLatestVersion: undefined,
      preview: undefined,
      upload: undefined,
      default: { Project, getLatestVersion, preview, upload },
    }))
    const { uploadWeixin } = await import('../src/platforms/weixin')

    const result = await uploadWeixin({ version: '1.0.0', weixin: weixinConfig }, { cwd })

    expect(upload).toHaveBeenCalled()
    expect(result.platform).toBe('weixin')
  })

  it('导出缺少 Project / upload 时抛出 UploadError', async () => {
    const cwd = await createFixture()

    vi.doMock('miniprogram-ci', () => ({ Project: undefined, getLatestVersion: undefined, preview: undefined, upload: undefined, default: undefined }))
    const { uploadWeixin } = await import('../src/platforms/weixin')

    await expect(uploadWeixin({ version: '1.0.0', weixin: weixinConfig }, { cwd }))
      .rejects
      .toThrow('miniprogram-ci 导出格式不受支持')
  })

  it('default 也不是对象时抛出 UploadError', async () => {
    const cwd = await createFixture()

    vi.doMock('miniprogram-ci', () => ({ Project: undefined, getLatestVersion: undefined, preview: undefined, upload: undefined, default: 'not-a-module' }))
    const { uploadWeixin } = await import('../src/platforms/weixin')

    await expect(uploadWeixin({ version: '1.0.0', weixin: weixinConfig }, { cwd }))
      .rejects
      .toThrow('miniprogram-ci 导出格式不受支持')
  })
})

describe('minidev 导出形态', () => {
  it('兼容 default 导出', async () => {
    const cwd = await createFixture()
    const minidev = {
      app: { getUploadedVersion: vi.fn(async () => '0.9.0') },
      upload: vi.fn(async () => ({ version: '1.0.0' })),
    }
    const useDefaults = vi.fn()

    vi.doMock('minidev', () => ({ minidev: undefined, useDefaults: undefined, default: { minidev, useDefaults } }))
    const { uploadAlipay } = await import('../src/platforms/alipay')

    const result = await uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd })

    expect(useDefaults).toHaveBeenCalled()
    expect(minidev.upload).toHaveBeenCalled()
    expect(result.version).toBe('1.0.0')
  })

  it('缺少 minidev 对象时抛出 UploadError', async () => {
    const cwd = await createFixture()

    vi.doMock('minidev', () => ({ minidev: undefined, useDefaults: undefined, default: {} }))
    const { uploadAlipay } = await import('../src/platforms/alipay')

    await expect(uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('缺少 minidev 对象')
  })

  it('缺少 useDefaults 方法时抛出 UploadError', async () => {
    const cwd = await createFixture()

    vi.doMock('minidev', () => ({
      minidev: {
        app: { getUploadedVersion: vi.fn(async () => '0.9.0') },
        upload: vi.fn(async () => ({ version: '1.0.0' })),
      },
      useDefaults: undefined,
      default: undefined,
    }))
    const { uploadAlipay } = await import('../src/platforms/alipay')

    await expect(uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('缺少 useDefaults 方法')
  })

  it('default 为原始值时按缺少运行时处理', async () => {
    const cwd = await createFixture()

    vi.doMock('minidev', () => ({ minidev: undefined, useDefaults: undefined, default: 'not-a-module' }))
    const { uploadAlipay } = await import('../src/platforms/alipay')

    await expect(uploadAlipay({
      version: '1.0.0',
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('缺少 minidev 对象')
  })
})
