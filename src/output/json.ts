import type { BatchItemResult, BatchResult, PlatformPlan } from '../types'

export interface JsonConfigInfo {
  source: string
  sourceFile?: string
}

/** 生成批量执行的 JSON 输出；不包含 SDK raw */
export function renderBatchJson(
  result: BatchResult<unknown>,
  command: 'upload' | 'preview',
  config?: JsonConfigInfo,
): string {
  const payload = {
    command,
    config,
    dryRun: result.dryRun,
    durationMs: result.durationMs,
    ok: result.ok,
    results: result.results.map(serializeItem),
    schemaVersion: 1,
    ...(result.versionResolution ? { versionResolution: result.versionResolution } : {}),
  }

  return `${JSON.stringify(payload, null, 2)}\n`
}

function serializeItem(item: BatchItemResult<unknown>): Record<string, unknown> {
  return {
    durationMs: item.durationMs,
    ...(item.error ? { error: item.error } : {}),
    ok: item.ok,
    platform: item.platform,
    ...(item.result ? { result: serializeValue(item.result) } : {}),
  }
}

function serializeValue(value: unknown): unknown {
  if (isPlan(value)) {
    return {
      action: value.action,
      checks: value.checks,
      ok: value.ok,
      projectPath: value.projectPath,
      version: value.version,
    }
  }

  const record = value as Record<string, unknown>

  if ('qrCode' in record) {
    return {
      budget: record.budget,
      desc: record.desc,
      message: record.message,
      npmWarnings: record.npmWarnings,
      qrCode: record.qrCode,
      sizes: record.sizes,
      version: record.version,
    }
  }

  return {
    budget: record.budget,
    desc: record.desc,
    message: record.message,
    npmWarnings: record.npmWarnings,
    sizes: record.sizes,
    version: record.version,
  }
}

function isPlan(value: unknown): value is PlatformPlan {
  return Boolean(value && typeof value === 'object' && 'checks' in value)
}
