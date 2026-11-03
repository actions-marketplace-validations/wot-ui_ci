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
import { loadConfig } from '../config'
import { ConfigError } from '../errors'
import { uploadPlatform } from '../upload'
import { serializeError } from '../utils/error'
import { normalizePlatform } from '../utils/platform'
import { runShellCommand } from './command'
import { readGitInfo } from './git'
import { detectGitHubPullRequestContext, renderReleaseComment, upsertReleaseComment } from './github'
import { appendReleaseHistory } from './history'

const PLATFORM_ORDER: Platform[] = ['weixin', 'alipay', 'dingtalk']

/** 构建 + 多平台上传 + 历史 + PR 评论的一体化发布入口 */
export async function release(request: ReleaseRequest = {}): Promise<ReleaseResult> {
  const startedAt = Date.now()
  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })
  const config = loaded.config
  const cwd = loaded.cwd
  const releaseConfig = config.release ?? {}
  const platforms = resolvePlatforms(request.platforms, releaseConfig.platforms, config)
  const commands = resolveBuildCommands(request.buildCommand ?? releaseConfig.buildCommand)
  const skipBuild = request.skipBuild ?? false
  const dryRun = request.dryRun ?? false
  const git = await readGitInfo(cwd)

  if (!platforms.length)
    throw new ConfigError('没有可发布的平台，请配置 weixin / alipay / dingtalk 或指定 platforms。')

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
  }

  const historyEnabled = request.history ?? releaseConfig.history ?? true
  if (historyEnabled) {
    try {
      result.historyFile = await appendReleaseHistory(createHistoryRecord(result), {
        cwd,
        file: request.historyFile ?? releaseConfig.historyFile ?? '.wotci/history.json',
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

    return {
      durationMs: Date.now() - startedAt,
      message: uploaded.message,
      ok: true,
      platform,
      ...(uploaded.sizes ? { sizes: uploaded.sizes } : {}),
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
  }
}
