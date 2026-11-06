import type {
  AnyPreviewResult,
  AnyUploadResult,
  BatchItemResult,
  BatchRequest,
  BatchResult,
  Platform,
  PlatformInput,
  PlatformPlan,
  VersionResolution,
} from './types'
import { formatBudgetReport, isBudgetFailure } from './budget'
import { loadConfig } from './config'
import { ConfigError } from './errors'
import { planPlatform } from './plan'
import { previewPlatform } from './preview'
import { uploadPlatform } from './upload'
import { serializeError } from './utils/error'
import { normalizePlatform } from './utils/platform'
import { redirectStdoutToStderr } from './utils/stdout'
import { applyVersion, resolveVersion } from './version-strategy'

const PLATFORM_ORDER: Platform[] = ['weixin', 'alipay', 'dingtalk']

/** 批量上传；dryRun 时返回校验计划 */
export async function uploadMany(
  request: BatchRequest = {},
): Promise<BatchResult<AnyUploadResult | PlatformPlan>> {
  return runBatch<AnyUploadResult>('upload', request)
}

/** 批量预览；dryRun 时返回校验计划 */
export async function previewMany(
  request: BatchRequest = {},
): Promise<BatchResult<AnyPreviewResult | PlatformPlan>> {
  return runBatch<AnyPreviewResult>('preview', request)
}

/**
 * 按选定平台执行上传或预览，逐项汇总结果；上传共享一次版本解析依据。
 * dry-run 仅做本地计划校验，JSON 模式将版本查询和执行阶段的 SDK 日志转到 stderr。
 * @throws 配置或版本解析失败时在平台执行前终止；平台执行异常记录在各项结果中。
 */
async function runBatch<TResult>(
  action: 'upload' | 'preview',
  request: BatchRequest,
): Promise<BatchResult<TResult | PlatformPlan>> {
  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })
  const cwd = loaded.cwd
  const platforms = resolvePlatforms(request.platforms, loaded.config)
  if (!platforms.length)
    throw new ConfigError('没有可执行的平台，请配置 weixin / alipay / dingtalk 或指定 platforms。')

  const resolve = (): Promise<VersionResolution> => resolveVersion(loaded.config, {
    allowNetwork: !request.dryRun,
    cwd,
    packageJson: loaded.packageJson,
    platforms,
  })
  const versionResolution = action === 'upload'
    ? await (request.redirectStdoutToStderr ? redirectStdoutToStderr(resolve) : resolve())
    : undefined
  const config = versionResolution ? applyVersion(loaded.config, versionResolution) : loaded.config

  const startedAt = Date.now()

  if (request.dryRun) {
    const results: Array<BatchItemResult<PlatformPlan>> = []

    for (const platform of platforms) {
      const itemStartedAt = Date.now()
      const plan = await planPlatform(platform, config, action, { cwd })
      results.push({
        durationMs: Date.now() - itemStartedAt,
        ok: plan.ok,
        platform,
        result: plan,
      })
    }

    return {
      ...(versionResolution ? { versionResolution } : {}),
      dryRun: true,
      durationMs: Date.now() - startedAt,
      ok: results.every(item => item.ok),
      results,
    }
  }

  const execute = async (platform: Platform): Promise<BatchItemResult<TResult>> => {
    const itemStartedAt = Date.now()

    try {
      const result = (action === 'upload'
        ? await uploadPlatform(platform, config, {
            cwd,
            ...(request.buildNpm ? { buildNpm: true } : {}),
          })
        : await previewPlatform(platform, config, request)) as TResult

      const budgetFailed = isBudgetFailure(
        (result as { budget?: Parameters<typeof isBudgetFailure>[0] }).budget,
      )

      return {
        durationMs: Date.now() - itemStartedAt,
        ...(budgetFailed
          ? {
              error: {
                code: 'BUDGET_EXCEEDED',
                message: formatBudgetReport((result as { budget: NonNullable<Parameters<typeof isBudgetFailure>[0]> }).budget),
              },
            }
          : {}),
        ok: !budgetFailed,
        platform,
        result,
      }
    }
    catch (error) {
      return {
        durationMs: Date.now() - itemStartedAt,
        error: serializeError(error),
        ok: false,
        platform,
      }
    }
  }

  const run = (): Promise<Array<BatchItemResult<TResult>>> => mapConcurrent(
    platforms,
    Math.max(1, request.concurrency ?? 1),
    execute,
  )
  const results = request.redirectStdoutToStderr
    ? await redirectStdoutToStderr(run)
    : await run()

  return {
    ...(versionResolution ? { versionResolution } : {}),
    dryRun: false,
    durationMs: Date.now() - startedAt,
    ok: results.every(item => item.ok),
    results,
  }
}

function resolvePlatforms(
  requested: PlatformInput[] | undefined,
  config: Parameters<typeof planPlatform>[1],
): Platform[] {
  const platforms = requested?.length
    ? requested.map(platform => normalizePlatform(platform))
    : PLATFORM_ORDER.filter(platform => Boolean(config[platform]))

  return [...new Set(platforms)]
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(workers)
  return results
}
