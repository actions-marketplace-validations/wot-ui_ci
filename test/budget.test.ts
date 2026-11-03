import { describe, expect, it } from 'vitest'
import {
  evaluateBudgets,
  formatBudgetReport,
  isBudgetFailure,
  parseBudgetSize,
} from '../src/budget'
import { ConfigError } from '../src/errors'

describe('parseBudgetSize', () => {
  it('支持字节数与单位', () => {
    expect(parseBudgetSize(1024, 'total')).toBe(1024)
    expect(parseBudgetSize('1024B', 'total')).toBe(1024)
    expect(parseBudgetSize('1.5KB', 'total')).toBe(1536)
    expect(parseBudgetSize('2MB', 'total')).toBe(2 * 1024 * 1024)
    expect(parseBudgetSize('1GB', 'total')).toBe(1024 * 1024 * 1024)
  })

  it('非法值抛出 ConfigError', () => {
    expect(() => parseBudgetSize(-1, 'total')).toThrow(ConfigError)
    expect(() => parseBudgetSize('abc', 'main')).toThrow(ConfigError)
  })
})

describe('evaluateBudgets', () => {
  it('没有预算或体积时返回 undefined', () => {
    expect(evaluateBudgets(undefined, { total: '1MB' })).toBeUndefined()
    expect(evaluateBudgets({ total: 100 }, undefined)).toBeUndefined()
    expect(evaluateBudgets({ total: 100 }, {})).toBeUndefined()
  })

  it('预算内返回 ok', () => {
    expect(evaluateBudgets({ main: 100, total: 200 }, {
      main: '1KB',
      total: '1KB',
    })).toEqual({ ok: true, violations: [], warnOnly: false })
  })

  it('超限返回 violations 与 warnOnly', () => {
    const report = evaluateBudgets({ main: 2048, total: 4096 }, {
      main: '1KB',
      total: '2KB',
      warnOnly: true,
    })

    expect(report).toEqual({
      ok: false,
      violations: [
        { actual: 4096, limit: 2048, metric: 'total' },
        { actual: 2048, limit: 1024, metric: 'main' },
      ],
      warnOnly: true,
    })
    expect(isBudgetFailure(report)).toBe(false)
  })

  it('非 warnOnly 超限视为失败', () => {
    const report = evaluateBudgets({ total: 4096 }, { total: '1KB' })

    expect(isBudgetFailure(report)).toBe(true)
    expect(formatBudgetReport(report!)).toContain('总包 4KB 超出预算 1KB')
  })

  it('预算内格式化为提示', () => {
    expect(formatBudgetReport({ ok: true, violations: [], warnOnly: false })).toBe('包体积在预算内')
  })
})

describe('budget 补充', () => {
  it('无单位按字节处理，缺少实际体积时跳过', () => {
    expect(parseBudgetSize('1024', 'total')).toBe(1024)
    expect(evaluateBudgets({ main: 100 }, { total: '1MB' })).toEqual({
      ok: true,
      violations: [],
      warnOnly: false,
    })
  })
})

describe('budget 主包与 MB 格式', () => {
  it('格式化主包超限和 MB 单位', () => {
    const text = formatBudgetReport({
      ok: false,
      violations: [{ actual: 2 * 1024 * 1024, limit: 1024 * 1024, metric: 'main' }],
      warnOnly: false,
    })

    expect(text).toBe('主包 2.00MB 超出预算 1.00MB')
  })
})
