import type {
  Platform,
  VersionBump,
  VersionResolution,
  VersionStrategy,
  WotciConfig,
} from './types'
import { VersionError } from './errors'
import { compareVersion } from './utils/version'

export interface ResolveVersionOptions {
  cwd: string
  packageJson?: {
    version?: string
  }
  platforms?: Platform[]
  /** dry-run 时禁止网络查询 */
  allowNetwork?: boolean
}

/** 解析本次上传使用的版本号，不会修改 package.json */
export async function resolveVersion(
  config: WotciConfig,
  options: ResolveVersionOptions,
): Promise<VersionResolution> {
  const strategy = config.versionStrategy

  if (!strategy)
    return { source: 'fixed', ...(config.version ? { version: config.version } : {}) }

  if (strategy.type === 'fixed')
    return { source: 'fixed', ...(strategy.version ?? config.version ? { version: strategy.version ?? config.version } : {}) }

  if (strategy.type === 'package') {
    const version = options.packageJson?.version ?? config.version
    return { source: 'package', ...(version ? { version } : {}) }
  }

  return resolveAutoVersion(config, strategy, options)
}

async function resolveAutoVersion(
  config: WotciConfig,
  strategy: Extract<VersionStrategy, { type: 'auto' }>,
  options: ResolveVersionOptions,
): Promise<VersionResolution> {
  const platforms = options.platforms?.length
    ? options.platforms
    : (['weixin', 'alipay'] as Platform[]).filter(platform => Boolean(config[platform]))
  const latestVersions: string[] = []

  if (options.allowNetwork !== false) {
    const { getLatestVersion } = await import('./version')

    for (const platform of platforms) {
      try {
        const info = await getLatestVersion(platform, { config, cwd: options.cwd })
        if (info.latest && isVersion(info.latest))
          latestVersions.push(info.latest)
      }
      catch {
        // 单个平台查询失败时继续使用其它平台
      }
    }
  }

  const latest = latestVersions.sort(compareVersion).at(-1)
  const base = latest ?? options.packageJson?.version ?? config.version

  if (!base || !isVersion(base))
    throw new VersionError('无法解析自动版本号，请配置 version 或 package.json version')

  return { source: 'auto', version: bumpVersion(base, strategy.bump) }
}

export function bumpVersion(version: string, bump: VersionBump): string {
  if (!isVersion(version))
    throw new VersionError(`版本号格式不正确：${version}`)

  const parts = version.split('.').map(Number)
  while (parts.length < 3)
    parts.push(0)

  if (bump === 'major') {
    parts[0] += 1
    parts[1] = 0
    parts[2] = 0
  }
  else if (bump === 'minor') {
    parts[1] += 1
    parts[2] = 0
  }
  else {
    parts[2] += 1
  }

  return parts.join('.')
}

export function applyVersion(config: WotciConfig, resolution: VersionResolution): WotciConfig {
  return resolution.version
    ? { ...config, version: resolution.version }
    : config
}

function isVersion(value: string): boolean {
  return /^\d+(?:\.\d+)*$/.test(value)
}
