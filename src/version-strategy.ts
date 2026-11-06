import type {
  Platform,
  VersionBump,
  VersionQueryResult,
  VersionResolution,
  VersionStrategy,
  WotciConfig,
} from './types'
import { VersionError, VersionUnsupportedError } from './errors'
import { compareVersion } from './utils/version'

const QUERY_STATUS_LABELS: Record<VersionQueryResult['status'], string> = {
  success: '查询成功',
  failed: '版本查询失败',
  unsupported: '不支持版本查询',
  empty: '未返回线上版本',
  invalid: '线上版本格式无效',
  skipped: '离线模式未查询',
}

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
    const baseSource = options.packageJson?.version !== undefined
      ? 'package'
      : version ? 'config' : 'none'
    return {
      source: 'package',
      ...(version ? { version, baseVersion: version } : {}),
      baseSource,
      warnings: baseSource === 'package' ? [] : ['package.json 未提供版本，使用配置版本（若存在）。'],
    }
  }

  return resolveAutoVersion(config, strategy, options)
}

/**
 * 查询目标平台并递增最高有效版本；无有效线上版本时回退到 package / 配置版本。
 * 返回逐平台状态和警告；任一查询未成功或目标为空时标记暂定，离线模式不查询。
 * @throws {VersionError} 联网严格模式查询不完整，或无法取得有效基础版本时抛出。
 */
async function resolveAutoVersion(
  config: WotciConfig,
  strategy: Extract<VersionStrategy, { type: 'auto' }>,
  options: ResolveVersionOptions,
): Promise<VersionResolution> {
  const platforms = [...new Set(options.platforms
    ?? (['weixin', 'alipay', 'dingtalk'] as Platform[]).filter(platform => Boolean(
      platform === 'dingtalk' ? config.dingtalk ?? config.dd : config[platform],
    )))]
  const queries: VersionQueryResult[] = []

  if (options.allowNetwork === false) {
    for (const platform of platforms)
      queries.push({ platform, status: 'skipped' })
  }
  else {
    const { getLatestVersion } = await import('./version')

    for (const platform of platforms) {
      try {
        const info = await getLatestVersion(platform, { config, cwd: options.cwd })
        if (!info.latest)
          queries.push({ platform, status: 'empty' })
        else if (!isVersion(info.latest))
          queries.push({ platform, status: 'invalid' })
        else
          queries.push({ platform, status: 'success', version: info.latest })
      }
      catch (error) {
        // 不输出 SDK 原始错误，避免 URL、请求参数或凭据进入 JSON / 历史。
        queries.push({ platform, status: error instanceof VersionUnsupportedError ? 'unsupported' : 'failed' })
      }
    }
  }

  const warnings = queries.filter(query => query.status !== 'success').map(query => (
    `${query.platform}：${QUERY_STATUS_LABELS[query.status]}。`
  ))
  if (!platforms.length)
    warnings.push('未选择版本查询平台。')

  const tentative = !queries.length || queries.some(query => query.status !== 'success')
  if (strategy.strict && options.allowNetwork !== false && tentative)
    throw new VersionError(`严格自动版本策略要求所有目标返回有效版本，已停止上传。${warnings.join('')}`)

  const latest = queries.flatMap(query => query.version ? [query.version] : []).sort(compareVersion).at(-1)
  const base = latest ?? options.packageJson?.version ?? config.version
  const baseSource = latest !== undefined ? 'platform' : options.packageJson?.version !== undefined ? 'package' : 'config'

  if (!base || !isVersion(base))
    throw new VersionError('无法解析自动版本号，请配置 version 或 package.json version')

  if (!latest)
    warnings.push(`未取得有效线上版本，回退到 ${baseSource} 基础版本。`)
  else if (tentative)
    warnings.push('仅使用查询成功的平台版本，无法确认其它目标的最新版本。')

  return {
    source: 'auto',
    version: bumpVersion(base, strategy.bump),
    baseVersion: base,
    baseSource,
    queries,
    tentative,
    warnings,
  }
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
