/*
 * @Author: weisheng
 * @Date: 2026-04-15 13:22:39
 * @LastEditTime: 2026-04-16 09:56:24
 * @LastEditors: weisheng
 * @Description:
 * @FilePath: /ci/test/exports.test.ts
 * 记得注释
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// 只是校验公开导出面，不需要真实加载两个厂商 SDK
vi.mock('minidev', () => ({}))
vi.mock('dingtalk-miniapp-opensdk', () => ({}))
vi.mock('miniprogram-ci', () => ({}))

const packageJsonPath = path.resolve(import.meta.dirname, '../package.json')

describe('package exports', () => {
  it('declares the public package entrypoints', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      bin?: Record<string, string>
      exports?: Record<string, string>
      main?: string
      types?: string
    }

    expect(packageJson.exports).toEqual({
      '.': './dist/index.mjs',
      './bin': './dist/bin.mjs',
      './cli': './dist/cli.mjs',
      './vite': './dist/vite.mjs',
      './package.json': './package.json',
    })
    expect(packageJson.main).toBe('./dist/index.mjs')
    expect(packageJson.types).toBe('./dist/index.d.mts')
    expect(packageJson.bin?.wotci).toBe('./dist/bin.mjs')
  })

  it('exports the documented JS API as named exports', async () => {
    const api = await import('../src/index')

    for (const name of [
      'initProject',
      'resolveVersion',
      'runDoctor',
      'setExperience',
    ] as const) {
      expect(api[name], `${name} 应该在 README 的 JS API 中可用`).toBeTypeOf('function')
    }
  })
})
