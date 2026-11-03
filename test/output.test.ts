import type { BatchResult, PlatformPlan } from '../src/types'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderBatchJson } from '../src/output/json'
import { renderBatchSummary, renderDiagnosticSummary, writeBatchSummary } from '../src/output/summary'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

function createUploadResult(): BatchResult<unknown> {
  return {
    dryRun: false,
    durationMs: 3000,
    ok: false,
    results: [
      {
        durationMs: 1000,
        ok: true,
        platform: 'weixin',
        result: {
          message: '微信上传成功',
          platform: 'weixin',
          raw: { huge: 'should-not-appear' },
          sizes: { main: 1024 * 1024, total: 2 * 1024 * 1024 },
          version: '1.0.0',
        },
      },
      {
        durationMs: 2000,
        error: { cause: ['原因 1: sdk down'], code: 'UPLOAD_ERROR', message: '支付宝|上传失败' },
        ok: false,
        platform: 'alipay',
      },
    ],
  }
}

function createPlan(): PlatformPlan {
  return {
    action: 'upload',
    checks: [
      { message: '/tmp/dist', name: '产物目录', ok: true },
      { message: '缺少私钥', name: '私钥', ok: false },
    ],
    ok: false,
    platform: 'weixin',
    projectPath: '/tmp/dist',
    version: '1.0.0',
  }
}

describe('renderBatchJson', () => {
  it('输出 upload schema 且排除 raw', () => {
    const json = renderBatchJson(createUploadResult(), 'upload', {
      source: 'file',
      sourceFile: '/tmp/wotci.config.ts',
    })
    const parsed = JSON.parse(json) as Record<string, any>

    expect(parsed).toMatchObject({
      command: 'upload',
      dryRun: false,
      ok: false,
      schemaVersion: 1,
    })
    expect(parsed.results[0].result).toMatchObject({
      message: '微信上传成功',
      sizes: { main: 1024 * 1024, total: 2 * 1024 * 1024 },
      version: '1.0.0',
    })
    expect(parsed.results[0].result.raw).toBeUndefined()
    expect(parsed.results[1].error).toMatchObject({ code: 'UPLOAD_ERROR' })
  })

  it('输出 preview 与 dry-run plan', () => {
    const preview: BatchResult<unknown> = {
      dryRun: false,
      durationMs: 100,
      ok: true,
      results: [{
        durationMs: 100,
        ok: true,
        platform: 'alipay',
        result: {
          message: '预览成功',
          platform: 'alipay',
          qrCode: { kind: 'url', value: 'https://qr' },
          raw: { secret: true },
        },
      }],
    }
    const previewJson = JSON.parse(renderBatchJson(preview, 'preview')) as Record<string, any>
    expect(previewJson.results[0].result.qrCode).toEqual({ kind: 'url', value: 'https://qr' })
    expect(previewJson.results[0].result.raw).toBeUndefined()

    const plan: BatchResult<unknown> = {
      dryRun: true,
      durationMs: 10,
      ok: false,
      results: [{ durationMs: 10, ok: false, platform: 'weixin', result: createPlan() }],
    }
    const planJson = JSON.parse(renderBatchJson(plan, 'upload')) as Record<string, any>
    expect(planJson.results[0].result).toMatchObject({
      checks: expect.arrayContaining([expect.objectContaining({ name: '私钥', ok: false })]),
    })
  })
})

describe('renderBatchSummary', () => {
  it('upload 表格包含版本/体积/转义', () => {
    const summary = renderBatchSummary(createUploadResult(), 'upload')

    expect(summary).toContain('## 小程序上传结果')
    expect(summary).toContain('| weixin | ✅ | 1.0.0 | 2.00MB | 1.00MB | 1.0s | 微信上传成功 |')
    expect(summary).toContain('支付宝\\|上传失败')
  })

  it('preview 与 dry-run 表格', () => {
    const preview: BatchResult<unknown> = {
      dryRun: false,
      durationMs: 100,
      ok: true,
      results: [{
        durationMs: 100,
        ok: true,
        platform: 'weixin',
        result: {
          message: '预览成功',
          platform: 'weixin',
          qrCode: { kind: 'file', value: '/tmp/qr.png' },
        },
      }],
    }
    expect(renderBatchSummary(preview, 'preview')).toContain('file: /tmp/qr.png')

    const dry: BatchResult<unknown> = {
      dryRun: true,
      durationMs: 10,
      ok: false,
      results: [{ durationMs: 10, ok: false, platform: 'weixin', result: createPlan() }],
    }
    const summary = renderBatchSummary(dry, 'upload')
    expect(summary).toContain('缺少私钥')
    expect(summary).toContain('❌')
  })
})

describe('writeBatchSummary', () => {
  it('创建目录并写入文件', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-summary-'))
    tempDirs.push(cwd)

    const file = await writeBatchSummary('out/summary.md', '# summary\n', cwd)

    expect(file).toBe(path.join(cwd, 'out/summary.md'))
    expect(await readFile(file, 'utf8')).toBe('# summary\n')
  })
})

describe('renderBatchSummary 边界', () => {
  it('dry-run 全部通过或无 plan 时显示通过', () => {
    const dry: BatchResult<unknown> = {
      dryRun: true,
      durationMs: 1,
      ok: true,
      results: [
        { durationMs: 1, ok: true, platform: 'weixin', result: { action: 'upload', checks: [{ name: '配置', ok: true }], ok: true, platform: 'weixin' } },
        { durationMs: 1, ok: true, platform: 'alipay' },
      ],
    }
    const withNamelessCheck: BatchResult<unknown> = {
      dryRun: true,
      durationMs: 1,
      ok: false,
      results: [{
        durationMs: 1,
        ok: false,
        platform: 'weixin',
        result: { action: 'upload', checks: [{ name: '私钥', ok: false }], ok: false, platform: 'weixin' },
      }],
    }

    const summary = renderBatchSummary(dry, 'upload')
    expect(summary).toContain('| weixin | ✅ | 通过 | 0.0s |')
    expect(summary).toContain('| alipay | ✅ | 通过 | 0.0s |')
    expect(renderBatchSummary(withNamelessCheck, 'upload')).toContain('私钥')
  })

  it('upload 缺少结果与错误时使用占位', () => {
    const result: BatchResult<unknown> = {
      dryRun: false,
      durationMs: 1,
      ok: false,
      results: [{ durationMs: 1, ok: false, platform: 'weixin' }],
    }

    expect(renderBatchSummary(result, 'upload')).toContain('| weixin | ❌ | - | - | - | 0.0s |  |')
  })

  it('preview 缺少二维码与错误时使用占位', () => {
    const result: BatchResult<unknown> = {
      dryRun: false,
      durationMs: 1,
      ok: false,
      results: [{ durationMs: 1, ok: false, platform: 'alipay' }],
    }

    expect(renderBatchSummary(result, 'preview')).toContain('| alipay | ❌ | - | 0.0s |  |')
  })
})

describe('renderDiagnosticSummary', () => {
  it('build-npm 列出警告并在超过 20 条时省略', () => {
    const warnings = Array.from({ length: 21 }, (_, index) => ({
      ...(index === 0 ? {} : { jsPath: `pages/${index}.js` }),
      ...(index === 0 ? {} : { msg: `warning-${index}` }),
    }))

    const summary = renderDiagnosticSummary('build-npm', {
      message: 'npm 构建完成，21 条警告',
      platform: 'weixin',
      warnings,
    })

    expect(summary).toContain('## 微信构建与诊断：build-npm')
    expect(summary).toContain('| 警告 | 21 条 |')
    expect(summary).toContain('未命名警告')
    expect(summary).toContain('warning-19')
    expect(summary).not.toContain('warning-20')
    expect(summary).toContain('其余 1 条已省略')
  })

  it('sourcemap 输出路径与转义', () => {
    const summary = renderDiagnosticSummary('sourcemap', {
      message: 'sourceMap 已下载',
      outputPath: '/tmp/a|b.zip',
      platform: 'weixin',
    })

    expect(summary).toContain('| 输出 | /tmp/a\\|b.zip |')
  })

  it('quality 未通过项没有说明时不加冒号', () => {
    const summary = renderDiagnosticSummary('quality', {
      checks: 2,
      issues: [{ name: 'JS_COMPRESS_OPEN', success: false }],
      message: '1 项未通过',
      ok: false,
      platform: 'weixin',
    })

    expect(summary).toContain('| 检查项 | 2 |')
    expect(summary).toContain('| 未通过 | 1 |')
    expect(summary).toContain('- JS_COMPRESS_OPEN\n')
  })
})
