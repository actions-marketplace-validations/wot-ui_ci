import type {
  BatchItemResult,
  BatchResult,
  PlatformPlan,
  WeixinBuildNpmResult,
  WeixinDiagnosticResult,
  WeixinQualityResult,
} from '../types'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { resolveFromCwd } from '../utils/path'
import { formatVersionResolution } from './version'

/** 生成 CI Step Summary 的 Markdown 表格 */
export function renderBatchSummary(
  result: BatchResult<unknown>,
  command: 'upload' | 'preview',
): string {
  const actionLabel = command === 'upload' ? '上传' : '预览'
  const dryRunLabel = result.dryRun ? '（dry-run）' : ''
  const lines = [
    `## 小程序${actionLabel}结果${dryRunLabel}`,
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

  if (result.versionResolution)
    lines.push('', ...formatVersionResolution(result.versionResolution).map(line => `- ${escapeCell(line)}`))
  return `${lines.join('\n')}\n`
}

/** 微信构建/诊断命令的 Step Summary */
export function renderDiagnosticSummary(
  command: 'build-npm' | 'sourcemap' | 'inspect' | 'quality',
  result: WeixinBuildNpmResult | WeixinDiagnosticResult | WeixinQualityResult,
): string {
  const lines = [
    `## 微信构建与诊断：${command}`,
    '',
    '| 项目 | 值 |',
    '| --- | --- |',
    `| 结果 | ${escapeCell(result.message)} |`,
  ]

  if ('warnings' in result)
    lines.push(`| 警告 | ${result.warnings.length} 条 |`)

  if ('issues' in result) {
    lines.push(`| 检查项 | ${result.checks} |`)
    lines.push(`| 未通过 | ${result.issues.length} |`)
  }

  if ('outputPath' in result && result.outputPath)
    lines.push(`| 输出 | ${escapeCell(result.outputPath)} |`)

  if ('warnings' in result && result.warnings.length) {
    lines.push('', '### npm 构建警告', '')
    for (const warning of result.warnings.slice(0, 20))
      lines.push(`- ${escapeCell(warning.msg ?? '未命名警告')}${warning.jsPath ? `（${escapeCell(warning.jsPath)}）` : ''}`)
    if (result.warnings.length > 20)
      lines.push(`- 其余 ${result.warnings.length - 20} 条已省略`)
  }

  if ('issues' in result && result.issues.length) {
    lines.push('', '### 未通过项', '')
    for (const issue of result.issues)
      lines.push(`- ${escapeCell(issue.name)}${issue.text ? `：${escapeCell(issue.text)}` : ''}`)
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
