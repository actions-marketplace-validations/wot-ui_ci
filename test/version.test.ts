import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  Project: vi.fn(),
  getLatestVersion: vi.fn(),
  getUploadedVersion: vi.fn(),
  getUploadedVersionList: vi.fn(),
  preview: vi.fn(),
  upload: vi.fn(),
  useDefaults: vi.fn(),
}))

vi.mock('miniprogram-ci', () => ({
  Project: mocks.Project,
  getLatestVersion: mocks.getLatestVersion,
  preview: mocks.preview,
  upload: mocks.upload,
  default: {
    Project: mocks.Project,
    getLatestVersion: mocks.getLatestVersion,
    preview: mocks.preview,
    upload: mocks.upload,
  },
}))

vi.mock('minidev', () => {
  const minidev = {
    app: {
      getUploadedVersion: mocks.getUploadedVersion,
      getUploadedVersionList: mocks.getUploadedVersionList,
    },
    preview: mocks.preview,
    upload: mocks.upload,
  }
  return {
    minidev,
    useDefaults: mocks.useDefaults,
    default: { minidev, useDefaults: mocks.useDefaults },
  }
})

const { getLatestVersion, getVersionList } = await import('../src/version')
const { getAlipayLatestVersion, getAlipayVersionList } = await import('../src/platforms/alipay')
const { getWeixinLatestVersion } = await import('../src/platforms/weixin')
const { VersionError, VersionUnsupportedError } = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.Project.mockImplementation(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    this.options = options
  })
  mocks.getLatestVersion.mockResolvedValue({ latestVersion: '1.2.3', grayReleaseVersion: '1.2.2' })
  mocks.getUploadedVersion.mockResolvedValue('2.0.0')
  mocks.getUploadedVersionList.mockResolvedValue([
    { appVersion: '2.0.0', createTime: '2026-01-01', operateName: 'alice', versionDescription: 'release', versionStatus: 'online' },
  ])
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-version-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await mkdir(path.join(cwd, 'keys'), { recursive: true })
  await writeFile(path.join(cwd, 'keys/weixin.key'), 'key')
  await writeFile(path.join(cwd, 'keys/alipay.key'), 'key')
  return cwd
}

function weixinConfig(extra: Record<string, unknown> = {}) {
  return { weixin: { appid: 'wx', privateKeyPath: 'keys/weixin.key', projectPath: 'dist/weixin', ...extra } }
}

function alipayConfig(extra: Record<string, unknown> = {}) {
  return { alipay: { appid: 'ali', privateKeyPath: 'keys/alipay.key', projectPath: 'dist/alipay', toolId: 'tool', ...extra } }
}

describe('微信最新版本', () => {
  it('返回 latest 与灰度版本', async () => {
    const cwd = await createFixture()

    await expect(getWeixinLatestVersion(weixinConfig({ type: 'miniProgramPlugin' }), { cwd })).resolves.toEqual({
      grayReleaseVersion: '1.2.2',
      latest: '1.2.3',
    })
  })

  it('普通小程序不支持线上版本查询', async () => {
    const cwd = await createFixture()

    await expect(getWeixinLatestVersion(weixinConfig(), { cwd }))
      .rejects
      .toThrow(VersionUnsupportedError)
    expect(mocks.getLatestVersion).not.toHaveBeenCalled()
  })

  it('缺少配置/私钥/目录时抛出 VersionError', async () => {
    const cwd = await createFixture()

    await expect(getWeixinLatestVersion({}, { cwd })).rejects.toThrow(VersionError)
    await expect(getWeixinLatestVersion(weixinConfig({ type: 'miniProgramPlugin', privateKeyPath: 'keys/missing.key' }), { cwd }))
      .rejects
      .toThrow(VersionError)
    await expect(getWeixinLatestVersion(weixinConfig({ type: 'miniProgramPlugin', projectPath: 'dist/missing' }), { cwd }))
      .rejects
      .toThrow(VersionError)
  })

  it('sDK 异常包装为 VersionError', async () => {
    const cwd = await createFixture()
    mocks.getLatestVersion.mockRejectedValueOnce(new Error('network'))

    await expect(getWeixinLatestVersion(weixinConfig({ type: 'miniProgramPlugin' }), { cwd }))
      .rejects
      .toThrow('获取微信线上版本失败')
  })
})

describe('支付宝版本', () => {
  it('返回最新版本与版本列表', async () => {
    const cwd = await createFixture()

    await expect(getAlipayLatestVersion(alipayConfig(), { cwd })).resolves.toBe('2.0.0')
    await expect(getAlipayVersionList(alipayConfig(), { cwd })).resolves.toEqual([
      {
        createTime: '2026-01-01',
        description: 'release',
        operator: 'alice',
        status: 'online',
        version: '2.0.0',
      },
    ])
  })

  it('缺少配置/私钥或 SDK 异常时抛出 VersionError', async () => {
    const cwd = await createFixture()

    await expect(getAlipayLatestVersion({}, { cwd })).rejects.toThrow(VersionError)
    await expect(getAlipayLatestVersion(alipayConfig({ privateKeyPath: 'keys/missing.key' }), { cwd }))
      .rejects
      .toThrow(VersionError)

    mocks.getUploadedVersion.mockRejectedValueOnce(new Error('network'))
    await expect(getAlipayLatestVersion(alipayConfig(), { cwd }))
      .rejects
      .toThrow('获取支付宝线上版本失败')

    mocks.getUploadedVersionList.mockRejectedValueOnce(new Error('network'))
    await expect(getAlipayVersionList(alipayConfig(), { cwd }))
      .rejects
      .toThrow('获取支付宝版本列表失败')
  })
})

describe('version 路由', () => {
  it('按平台查询最新版本', async () => {
    const cwd = await createFixture()

    await expect(getLatestVersion('weixin', { config: weixinConfig({ type: 'miniProgramPlugin' }), cwd }))
      .resolves
      .toMatchObject({ latest: '1.2.3', platform: 'weixin' })
    await expect(getLatestVersion('alipay', { config: alipayConfig(), cwd }))
      .resolves
      .toMatchObject({ latest: '2.0.0', platform: 'alipay' })
  })

  it('钉钉与微信版本列表不支持', async () => {
    const cwd = await createFixture()

    await expect(getLatestVersion('dingtalk', { cwd })).rejects.toThrow(VersionUnsupportedError)
    await expect(getVersionList('weixin', { cwd })).rejects.toThrow(VersionUnsupportedError)
  })

  it('支付宝版本列表', async () => {
    const cwd = await createFixture()

    await expect(getVersionList('alipay', { config: alipayConfig(), cwd }))
      .resolves
      .toMatchObject({ platform: 'alipay' })
  })
})
