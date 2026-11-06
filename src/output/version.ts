import type { VersionResolution } from '../types'

/** CLI、Step Summary 和发布评论共享的版本依据与警告文案。 */
export function formatVersionResolution(resolution?: VersionResolution): string[] {
  if (!resolution)
    return []

  const base = resolution.baseVersion ? `，基础 ${resolution.baseSource}: ${resolution.baseVersion}` : ''
  return [
    `版本：${resolution.version ?? '未指定'}（策略 ${resolution.source}${base}）${resolution.tentative ? '；暂定，未确认全部目标的线上版本' : ''}`,
    ...(resolution.queries ?? []).map(query => `版本查询 ${query.platform}: ${query.status}${query.version ? ` (${query.version})` : ''}`),
    ...(resolution.warnings ?? []).map(warning => `警告：${warning}`),
  ]
}
