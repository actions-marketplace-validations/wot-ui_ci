import type { BudgetConfig, BudgetReport, BudgetViolation } from './types'
import { ConfigError } from './errors'

const UNITS: Record<string, number> = {
  B: 1,
  GB: 1024 * 1024 * 1024,
  KB: 1024,
  MB: 1024 * 1024,
}

/** 解析 '3MB' / '800KB' / 字节数 */
export function parseBudgetSize(value: string | number, metric: 'total' | 'main'): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0)
      throw new ConfigError(`budgets.${metric} 必须是非负数字`)
    return value
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i)
  if (!match)
    throw new ConfigError(`budgets.${metric} 格式不正确：${value}，示例：3MB`)

  const unit = (match[2] ?? 'B').toUpperCase()
  return Number(match[1]) * UNITS[unit]
}

/** 按微信包体积计算预算报告；没有预算或没有体积数据时返回 undefined */
export function evaluateBudgets(
  sizes: { total?: number, main?: number } | undefined,
  budgets: BudgetConfig | undefined,
): BudgetReport | undefined {
  if (!sizes || !budgets)
    return undefined

  const limits: Array<{ metric: 'total' | 'main', limit: number }> = []
  if (budgets.total !== undefined)
    limits.push({ limit: parseBudgetSize(budgets.total, 'total'), metric: 'total' })
  if (budgets.main !== undefined)
    limits.push({ limit: parseBudgetSize(budgets.main, 'main'), metric: 'main' })

  if (!limits.length)
    return undefined

  const violations: BudgetViolation[] = []

  for (const { limit, metric } of limits) {
    const actual = sizes[metric]
    if (actual !== undefined && actual > limit)
      violations.push({ actual, limit, metric })
  }

  return {
    ok: violations.length === 0,
    violations,
    warnOnly: budgets.warnOnly ?? false,
  }
}

export function isBudgetFailure(report: BudgetReport | undefined): boolean {
  return Boolean(report && !report.ok && !report.warnOnly)
}

export function formatBudgetReport(report: BudgetReport): string {
  if (report.ok)
    return '包体积在预算内'

  return report.violations
    .map(item => `${item.metric === 'total' ? '总包' : '主包'} ${formatSize(item.actual)} 超出预算 ${formatSize(item.limit)}`)
    .join('；')
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024)
    return `${(size / 1024 / 1024).toFixed(2)}MB`
  return `${Math.round(size / 1024)}KB`
}
