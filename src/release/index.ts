import type {
  Platform,
  PlatformInput,
  ReleaseBuildResult,
  ReleaseHistoryRecord,
  ReleasePlatformResult,
  ReleaseRequest,
  ReleaseResult,
  WotciConfig,
} from '../types'
import { randomUUID } from 'node:crypto'
import { formatBudgetReport, isBudgetFailure } from '../budget'
import { loadConfig } from '../config'
import { ConfigError } from '../errors'
import { uploadPlatform } from '../upload'
import { serializeError } from '../utils/error'
import { normalizePlatform } from '../utils/platform'
import { applyVersion, resolveVersion } from '../version-strategy'
import { runShellCommand } from './command'
import { readGitInfo } from './git'
import { detectGitHubPullRequestContext, renderReleaseComment, upsertReleaseComment } from './github'
import { appendReleaseHistory, readReleaseHistory } from './history'

const PLATFORM_ORDER: Platform[] = ['weixin', 'alipay', 'dingtalk']

/** 构建 + 多平台上传 + 历史 + PR 评论的一体化发布入口 */
export async function release(request: ReleaseRequest = {}): Promise<ReleaseResult> {
  const startedAt = Date.now()
  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })
  const cwd = loaded.cwd
  const releaseConfig = loaded.config.release ?? {}
  const platforms = resolvePlatforms(request.platforms, releaseConfig.platforms, loaded.config)
  if (!platforms.length)
    throw new ConfigError('没有可发布的平台，请配置 weixin / alipay / dingtalk 或指定 platforms。')

  const versionResolution = await resolveVersion(loaded.config, {
    allowNetwork: !request.dryRun,
    cwd,
    packageJson: loaded.packageJson,
    platforms,
  })
  const config = applyVersion(loaded.config, versionResolution)
  const commands = resolveBuildCommands(request.buildCommand ?? releaseConfig.buildCommand)
  const skipBuild = request.skipBuild ?? false
  const dryRun = request.dryRun ?? false
  const git = await readGitInfo(cwd)

  if (dryRun) {
    return {
      build: {
        commands,
        durationMs: 0,
        ok: true,
        skipped: skipBuild,
      },
      desc: config.desc,
      dryRun: true,
      durationMs: Date.now() - startedAt,
      git,
      ok: true,
      platforms: platforms.map(platform => ({
        durationMs: 0,
        message: '待发布',
        ok: true,
        platform,
      })),
      version: config.version,
      versionResolution,
    }
  }

  const build: ReleaseBuildResult = skipBuild
    ? { commands, durationMs: 0, ok: true, skipped: true }
    : await executeBuild(commands, cwd)

  const platformResults: ReleasePlatformResult[] = []

  if (build.ok) {
    for (const platform of platforms)
      platformResults.push(await uploadOne(platform, config, cwd))
  }

  const ok = build.ok && platformResults.every(item => item.ok)
  const result: ReleaseResult = {
    build,
    desc: config.desc,
    dryRun: false,
    durationMs: Date.now() - startedAt,
    git,
    ok,
    platforms: platformResults,
    version: config.version,
    versionResolution,
  }

  const historyEnabled = request.history ?? releaseConfig.history ?? true
  const historyFile = request.historyFile ?? releaseConfig.historyFile ?? '.wotci/history.json'

  if (historyEnabled) {
    try {
      const previous = await readReleaseHistory({ cwd, file: historyFile }).catch(() => [])
      attachSizeTrend(platformResults, previous)
      result.historyFile = await appendReleaseHistory(createHistoryRecord(result), {
        cwd,
        file: historyFile,
        limit: releaseConfig.historyLimit ?? 50,
      })
    }
    catch (error) {
      result.historyError = serializeError(error).message
    }
  }

  const commentSetting = request.prComment ?? releaseConfig.prComment ?? 'auto'
  if (commentSetting !== false) {
    const context = await detectGitHubPullRequestContext()

    if (!context) {
      if (commentSetting === true)
        result.commentError = '未检测到 GitHub PR 上下文，需要 GITHUB_TOKEN、GITHUB_REPOSITORY 和 PR 编号。'
    }
    else {
      try {
        const comment = await upsertReleaseComment(context, renderReleaseComment(result, context))
        result.commentUrl = comment.url
      }
      catch (error) {
        result.commentError = serializeError(error).message
      }
    }
  }

  return result
}

function resolvePlatforms(
  requested: PlatformInput[] | undefined,
  configured: Platform[] | undefined,
  config: WotciConfig,
): Platform[] {
  const input = requested?.length ? requested : configured
  const platforms = input?.length
    ? input.map(platform => normalizePlatform(platform))
    : PLATFORM_ORDER.filter(platform => Boolean(config[platform]))

  return [...new Set(platforms)]
}

function resolveBuildCommands(value: string | string[] | undefined): string[] {
  if (!value)
    return []
  return Array.isArray(value) ? value.filter(Boolean) : [value]
}

async function executeBuild(commands: string[], cwd: string): Promise<ReleaseBuildResult> {
  const startedAt = Date.now()

  try {
    for (const command of commands)
      await runShellCommand(command, { cwd })

    return {
      commands,
      durationMs: Date.now() - startedAt,
      ok: true,
      skipped: false,
    }
  }
  catch (error) {
    return {
      commands,
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
      ok: false,
      skipped: false,
    }
  }
}

async function uploadOne(
  platform: Platform,
  config: WotciConfig,
  cwd: string,
): Promise<ReleasePlatformResult> {
  const startedAt = Date.now()

  try {
    const uploaded = await uploadPlatform(platform, config, { cwd })

    const budgetFailed = isBudgetFailure(uploaded.budget)

    return {
      durationMs: Date.now() - startedAt,
      message: uploaded.message,
      ok: !budgetFailed,
      platform,
      ...(uploaded.budget ? { budget: uploaded.budget } : {}),
      ...(uploaded.sizes ? { sizes: uploaded.sizes } : {}),
      ...(budgetFailed && uploaded.budget
        ? {
            error: {
              code: 'BUDGET_EXCEEDED',
              message: formatBudgetReport(uploaded.budget),
            },
          }
        : {}),
      version: uploaded.version,
    }
  }
  catch (error) {
    const serialized = serializeError(error)

    return {
      durationMs: Date.now() - startedAt,
      error: serialized,
      message: serialized.message,
      ok: false,
      platform,
    }
  }
}

function attachSizeTrend(
  results: ReleasePlatformResult[],
  records: ReleaseHistoryRecord[],
): void {
  for (const item of results) {
    if (!item.sizes)
      continue

    let previous: ReleasePlatformResult | undefined

    for (let index = records.length - 1; index >= 0; index--) {
      const match = records[index].platforms.find(platform => platform.platform === item.platform && platform.sizes)
      if (match) {
        previous = match
        break
      }
    }

    if (!previous?.sizes)
      continue

    item.trend = {
      ...(previous.sizes.total !== undefined ? { previousTotal: previous.sizes.total } : {}),
      ...(previous.sizes.main !== undefined ? { previousMain: previous.sizes.main } : {}),
      ...(item.sizes.total !== undefined && previous.sizes.total !== undefined
        ? { deltaTotal: item.sizes.total - previous.sizes.total }
        : {}),
      ...(item.sizes.main !== undefined && previous.sizes.main !== undefined
        ? { deltaMain: item.sizes.main - previous.sizes.main }
        : {}),
    }
  }
}

/** 为发布结果生成历史标识和时间，保留构建、平台结果及版本解析依据。 */
function createHistoryRecord(result: ReleaseResult): ReleaseHistoryRecord {
  return {
    build: result.build,
    createdAt: new Date().toISOString(),
    desc: result.desc,
    durationMs: result.durationMs,
    git: result.git,
    id: randomUUID(),
    ok: result.ok,
    platforms: result.platforms,
    version: result.version,
    versionResolution: result.versionResolution,
  }
}
