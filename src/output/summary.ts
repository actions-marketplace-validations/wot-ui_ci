import type { BatchItemResult, BatchResult, PlatformPlan } from '../types'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { resolveFromCwd } from '../utils/path'

/** 生成 CI Step Summary 的 Markdown 表格 */
export function renderBatchSummary(
  result: BatchResult<unknown>,
  command: 'upload' | 'preview',
): string {
  const lines = [
    `## 小程序${command === 'upload' ? '上传' : '预览'}结果`,
    '',
  ]

  if (result.dryRun) {
    lines.push('| 平台 | 结果 | 校验 | 耗时 |', '| --- | --- | --- | --- |')
    for (const item of result.results) {
      const plan = item.result as PlatformPlan | undefined
      const checks = plan?.checks
        ?.filter(check => !check.ok)
        .map(check => check.message ?? check.name)
        .join('；') || '通过'
      lines.push(`| ${escapeCell(item.platform)} | ${item.ok ? '✅' : '❌'} | ${escapeCell(checks)} | ${formatDuration(item.durationMs)} |`)
    }
  }
  else if (command === 'upload') {
    lines.push('| 平台 | 结果 | 版本 | 总包 | 主包 | 耗时 | 说明 |', '| --- | --- | --- | --- | --- | --- | --- |')
    for (const item of result.results) {
      const value = item.result as { version?: string, sizes?: { total?: number, main?: number }, message?: string } | undefined
      lines.push([
        escapeCell(item.platform),
        item.ok ? '✅' : '❌',
        escapeCell(value?.version ?? '-'),
        value?.sizes?.total ? formatSize(value.sizes.total) : '-',
        value?.sizes?.main ? formatSize(value.sizes.main) : '-',
        formatDuration(item.durationMs),
        escapeCell(item.error?.message ?? value?.message ?? ''),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
    }
  }
  else {
    lines.push('| 平台 | 结果 | 二维码 | 耗时 | 说明 |', '| --- | --- | --- | --- | --- |')
    for (const item of result.results) {
      const value = item.result as { qrCode?: { kind: string, value: string }, message?: string } | undefined
      const qr = value?.qrCode ? `${value.qrCode.kind}: ${value.qrCode.value}` : '-'
      lines.push([
        escapeCell(item.platform),
        item.ok ? '✅' : '❌',
        escapeCell(qr),
        formatDuration(item.durationMs),
        escapeCell(item.error?.message ?? value?.message ?? ''),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
    }
  }

  return `${lines.join('\n')}\n`
}

/** 写入 summary 文件，返回绝对路径 */
export async function writeBatchSummary(
  file: string,
  content: string,
  cwd: string = process.cwd(),
): Promise<string> {
  const filePath = resolveFromCwd(cwd, file)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return filePath
}

function formatSize(size: number): string {
  return `${(size / 1024 / 1024).toFixed(2)}MB`
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}
