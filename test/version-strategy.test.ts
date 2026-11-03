import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLatestVersion: vi.fn(),
}))

vi.mock('../src/version', () => ({
  getLatestVersion: mocks.getLatestVersion,
}))

const { applyVersion, bumpVersion, resolveVersion } = await import('../src/version-strategy')
const { VersionError } = await import('../src/errors')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLatestVersion.mockImplementation(async (platform: string) => ({
    latest: platform === 'weixin' ? '1.2.3' : '2.0.0',
    platform,
  }))
})

const baseConfig = {
  version: '1.0.0',
  weixin: { appid: 'wx', privateKeyPath: 'key', projectPath: 'dist' },
  alipay: { appid: 'ali', privateKey: 'key', projectPath: 'dist', toolId: 'tool' },
}

describe('resolveVersion', () => {
  it('没有策略时使用配置版本', async () => {
    await expect(resolveVersion(baseConfig, { cwd: '/tmp' })).resolves.toEqual({
      source: 'fixed',
      version: '1.0.0',
    })
    await expect(resolveVersion({}, { cwd: '/tmp' })).resolves.toEqual({ source: 'fixed' })
  })

  it('fixed 策略优先使用策略版本', async () => {
    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'fixed', version: '3.0.0' },
    }, { cwd: '/tmp' })).resolves.toEqual({ source: 'fixed', version: '3.0.0' })
  })

  it('package 策略读取 package.json', async () => {
    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'package' },
    }, { cwd: '/tmp', packageJson: { version: '4.0.0' } })).resolves.toEqual({
      source: 'package',
      version: '4.0.0',
    })

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'package' },
    }, { cwd: '/tmp' })).resolves.toEqual({ source: 'package', version: '1.0.0' })
  })

  it('auto 策略取线上最高版本并递增', async () => {
    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { cwd: '/tmp' })).resolves.toEqual({ source: 'auto', version: '2.0.1' })

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'minor' },
    }, { cwd: '/tmp' })).resolves.toEqual({ source: 'auto', version: '2.1.0' })

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'major' },
    }, { cwd: '/tmp' })).resolves.toEqual({ source: 'auto', version: '3.0.0' })
  })

  it('auto 查询失败时回退 package 版本', async () => {
    mocks.getLatestVersion.mockRejectedValue(new Error('network'))

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { cwd: '/tmp', packageJson: { version: '1.5.0' } })).resolves.toEqual({
      source: 'auto',
      version: '1.5.1',
    })
  })

  it('allowNetwork:false 时不调用版本查询', async () => {
    const result = await resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { allowNetwork: false, cwd: '/tmp', packageJson: { version: '1.5.0' } })

    expect(result.version).toBe('1.5.1')
    expect(mocks.getLatestVersion).not.toHaveBeenCalled()
  })

  it('auto 没有可用基础版本时抛出 VersionError', async () => {
    await expect(resolveVersion({
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { allowNetwork: false, cwd: '/tmp' })).rejects.toThrow(VersionError)
  })
})

describe('bumpVersion / applyVersion', () => {
  it('支持 major / minor / patch 与补位', () => {
    expect(bumpVersion('1', 'patch')).toBe('1.0.1')
    expect(bumpVersion('1.2', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('非法版本号抛出 VersionError', () => {
    expect(() => bumpVersion('1.2.3-beta', 'patch')).toThrow(VersionError)
  })

  it('有版本时返回新配置，无版本时原样返回', () => {
    const config = { version: '1.0.0' }
    expect(applyVersion(config, { source: 'auto', version: '2.0.0' })).toEqual({ version: '2.0.0' })
    expect(applyVersion(config, { source: 'fixed' })).toBe(config)
  })
})
