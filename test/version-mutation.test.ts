import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelExperience: vi.fn(),
  deleteVersion: vi.fn(),
  getUploadedVersion: vi.fn(),
  getUploadedVersionList: vi.fn(),
  preview: vi.fn(),
  setExperience: vi.fn(),
  upload: vi.fn(),
  useDefaults: vi.fn(),
}))

vi.mock('minidev', () => {
  const minidev = {
    app: {
      cancelExperience: mocks.cancelExperience,
      deleteVersion: mocks.deleteVersion,
      getUploadedVersion: mocks.getUploadedVersion,
      getUploadedVersionList: mocks.getUploadedVersionList,
      setExperience: mocks.setExperience,
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

const { cancelExperience, deleteVersion, setExperience } = await import('../src/version')
const { VersionError, VersionUnsupportedError } = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.setExperience.mockResolvedValue({ qrCodeUrl: 'https://qr/experience' })
  mocks.cancelExperience.mockResolvedValue(undefined)
  mocks.deleteVersion.mockResolvedValue(undefined)
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-mutation-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'keys'), { recursive: true })
  await writeFile(path.join(cwd, 'keys/alipay.key'), 'key')
  return cwd
}

function createConfig() {
  return {
    alipay: {
      appid: 'ali',
      privateKeyPath: 'keys/alipay.key',
      projectPath: 'dist/alipay',
      toolId: 'tool',
    },
  }
}

describe('支付宝体验版/版本管理', () => {
  it('设置体验版返回二维码', async () => {
    const cwd = await createFixture()

    const result = await setExperience('alipay', { config: createConfig(), cwd, version: '1.0.0' })

    expect(mocks.setExperience).toHaveBeenCalledWith({
      appId: 'ali',
      clientType: 'alipay',
      version: '1.0.0',
    })
    expect(result).toMatchObject({
      action: 'set-experience',
      platform: 'alipay',
      qrCodeUrl: 'https://qr/experience',
      version: '1.0.0',
    })
  })

  it('取消体验版', async () => {
    const cwd = await createFixture()

    const result = await cancelExperience('alipay', { config: createConfig(), cwd, version: '1.0.0' })

    expect(mocks.cancelExperience).toHaveBeenCalled()
    expect(result.action).toBe('cancel-experience')
  })

  it('删除版本需要 confirm', async () => {
    const cwd = await createFixture()

    await expect(deleteVersion('alipay', { config: createConfig(), cwd, version: '1.0.0' }))
      .rejects
      .toThrow('破坏性操作')

    const result = await deleteVersion('alipay', {
      confirm: true,
      config: createConfig(),
      cwd,
      version: '1.0.0',
    })

    expect(mocks.deleteVersion).toHaveBeenCalled()
    expect(result.action).toBe('delete')
  })

  it('缺少 version 或平台不支持时拒绝', async () => {
    const cwd = await createFixture()

    await expect(setExperience('alipay', { config: createConfig(), cwd, version: '' }))
      .rejects
      .toThrow(VersionError)
    await expect(setExperience('weixin', { config: createConfig(), cwd, version: '1.0.0' }))
      .rejects
      .toThrow(VersionUnsupportedError)
  })

  it('sDK 异常包装为 VersionError', async () => {
    const cwd = await createFixture()
    mocks.setExperience.mockRejectedValueOnce(new Error('network'))
    mocks.cancelExperience.mockRejectedValueOnce(new Error('network'))
    mocks.deleteVersion.mockRejectedValueOnce(new Error('network'))

    await expect(setExperience('alipay', { config: createConfig(), cwd, version: '1.0.0' }))
      .rejects
      .toThrow('设置支付宝体验版失败')
    await expect(cancelExperience('alipay', { config: createConfig(), cwd, version: '1.0.0' }))
      .rejects
      .toThrow('取消支付宝体验版失败')
    await expect(deleteVersion('alipay', {
      confirm: true,
      config: createConfig(),
      cwd,
      version: '1.0.0',
    })).rejects.toThrow('删除支付宝版本失败')
  })
})

describe('版本管理配置错误', () => {
  it('缺少支付宝配置或私钥时拒绝', async () => {
    const cwd = await createFixture()

    await expect(setExperience('alipay', { config: {}, cwd, version: '1.0.0' }))
      .rejects
      .toThrow(VersionError)

    await expect(setExperience('alipay', {
      config: {
        alipay: {
          appid: 'ali',
          privateKeyPath: 'keys/missing.key',
          projectPath: 'dist/alipay',
          toolId: 'tool',
        },
      },
      cwd,
      version: '1.0.0',
    })).rejects.toThrow(VersionError)
  })
})
