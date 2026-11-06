import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLatestVersion: vi.fn(),
}))

vi.mock('../src/version', () => ({
  getLatestVersion: mocks.getLatestVersion,
}))

const { applyVersion, bumpVersion, resolveVersion } = await import('../src/version-strategy')
const { VersionError, VersionUnsupportedError } = await import('../src/errors')

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
    }, { cwd: '/tmp', packageJson: { version: '4.0.0' } })).resolves.toMatchObject({
      source: 'package',
      version: '4.0.0',
    })

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'package' },
    }, { cwd: '/tmp' })).resolves.toMatchObject({ source: 'package', version: '1.0.0' })
  })

  it('auto 策略取线上最高版本并递增', async () => {
    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { cwd: '/tmp' })).resolves.toMatchObject({ source: 'auto', version: '2.0.1' })

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'minor' },
    }, { cwd: '/tmp' })).resolves.toMatchObject({ source: 'auto', version: '2.1.0' })

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'major' },
    }, { cwd: '/tmp' })).resolves.toMatchObject({ source: 'auto', version: '3.0.0' })
  })

  it('auto 查询失败时回退 package 版本', async () => {
    mocks.getLatestVersion.mockRejectedValue(new Error('network'))

    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { cwd: '/tmp', packageJson: { version: '1.5.0' } })).resolves.toMatchObject({
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

  it('记录所有查询状态与部分成功，并排除 SDK 错误细节', async () => {
    mocks.getLatestVersion.mockImplementation(async (platform: string) => {
      if (platform === 'weixin')
        throw new Error('private-key=secret')
      if (platform === 'dingtalk')
        throw new VersionUnsupportedError('unsupported')
      return { latest: '2.0.0', platform }
    })
    const result = await resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { cwd: '/tmp', platforms: ['weixin', 'alipay', 'dingtalk'] })

    expect(result).toMatchObject({
      baseSource: 'platform',
      baseVersion: '2.0.0',
      version: '2.0.1',
      tentative: true,
      queries: [
        { platform: 'weixin', status: 'failed' },
        { platform: 'alipay', status: 'success', version: '2.0.0' },
        { platform: 'dingtalk', status: 'unsupported' },
      ],
    })
    expect(result.warnings?.join('')).toContain('仅使用查询成功的平台版本')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('区分空值、非法版本与本地回退', async () => {
    mocks.getLatestVersion.mockResolvedValueOnce({}).mockResolvedValueOnce({ latest: 'beta' })
    const result = await resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch' },
    }, { cwd: '/tmp' })
    expect(result).toMatchObject({
      baseSource: 'config',
      baseVersion: '1.0.0',
      version: '1.0.1',
      tentative: true,
      queries: [{ platform: 'weixin', status: 'empty' }, { platform: 'alipay', status: 'invalid' }],
    })
  })

  it('显式空目标不会隐式查询配置平台，重复目标只查询一次', async () => {
    const config = { ...baseConfig, versionStrategy: { type: 'auto', bump: 'patch' } } as const
    const empty = await resolveVersion(config, { cwd: '/tmp', platforms: [] })
    expect(empty.queries).toEqual([])
    expect(empty.warnings).toContain('未选择版本查询平台。')
    expect(mocks.getLatestVersion).not.toHaveBeenCalled()
    const single = await resolveVersion(config, { cwd: '/tmp', platforms: ['weixin', 'weixin'] })
    expect(single).toMatchObject({ tentative: false, warnings: [], version: '1.2.4' })
    expect(mocks.getLatestVersion).toHaveBeenCalledTimes(1)
  })

  it.each(['failed', 'empty', 'invalid', 'unsupported'] as const)('strict 拒绝 %s 查询，即使其它目标成功', async (status) => {
    mocks.getLatestVersion.mockImplementation(async (platform: string) => {
      if (platform === 'weixin')
        return { latest: '1.0.0', platform }
      if (status === 'failed')
        throw new Error('secret')
      if (status === 'unsupported')
        throw new VersionUnsupportedError('secret')
      return { platform, latest: status === 'empty' ? undefined : 'beta' }
    })
    await expect(resolveVersion({
      ...baseConfig,
      versionStrategy: { type: 'auto', bump: 'patch', strict: true },
    }, { cwd: '/tmp' })).rejects.toThrow('严格自动版本策略')
  })

  it('strict 完整查询可成功，离线仍返回暂定计划', async () => {
    const config = { ...baseConfig, versionStrategy: { type: 'auto', bump: 'patch', strict: true } } as const
    expect(await resolveVersion(config, { cwd: '/tmp' })).toMatchObject({ tentative: false, version: '2.0.1' })
    mocks.getLatestVersion.mockClear()
    const offline = await resolveVersion(config, { cwd: '/tmp', allowNetwork: false })
    expect(offline).toMatchObject({
      tentative: true,
      baseSource: 'config',
      queries: [{ platform: 'weixin', status: 'skipped' }, { platform: 'alipay', status: 'skipped' }],
    })
    expect(mocks.getLatestVersion).not.toHaveBeenCalled()
  })

  it('package 回退保留策略名称，但显示实际来源', async () => {
    expect(await resolveVersion({ ...baseConfig, versionStrategy: { type: 'package' } }, { cwd: '/tmp' }))
      .toMatchObject({ source: 'package', baseSource: 'config', baseVersion: '1.0.0' })
    expect(await resolveVersion({ versionStrategy: { type: 'package' } }, { cwd: '/tmp' }))
      .toMatchObject({ source: 'package', baseSource: 'none', warnings: [expect.any(String)] })
  })

  it('默认查询包含钉钉及旧 dd 配置', async () => {
    for (const key of ['dd', 'dingtalk']) {
      const result = await resolveVersion({
        version: '1.0.0',
        [key]: { appid: 'dd', token: 'token', projectPath: 'dist' },
        versionStrategy: { type: 'auto', bump: 'patch' },
      }, { cwd: '/tmp' })
      expect(result.queries?.map(query => query.platform)).toEqual(['dingtalk'])
    }
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
