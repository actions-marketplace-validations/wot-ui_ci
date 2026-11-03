import type { WotciConfig } from '../src/types'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  Project: vi.fn(),
  checkCodeQuality: vi.fn(),
  getCompiledResult: vi.fn(),
  getDevSourceMap: vi.fn(),
  packNpm: vi.fn(),
}))

vi.mock('miniprogram-ci', () => ({
  Project: mocks.Project,
  checkCodeQuality: mocks.checkCodeQuality,
  getCompiledResult: mocks.getCompiledResult,
  getDevSourceMap: mocks.getDevSourceMap,
  packNpm: mocks.packNpm,
}))

const { WeixinDiagnosticError } = await import('../src/errors')

const {
  buildNpm,
  checkCodeQuality,
  downloadCompiledResult,
  downloadSourceMap,
} = await import('../src/weixin-diagnostics')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.Project.mockImplementation(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    this.options = options
  })
  mocks.packNpm.mockResolvedValue([])
  mocks.getDevSourceMap.mockResolvedValue(undefined)
  mocks.getCompiledResult.mockResolvedValue({})
  mocks.checkCodeQuality.mockResolvedValue([])
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-diagnostics-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await mkdir(path.join(cwd, 'keys'), { recursive: true })
  await writeFile(path.join(cwd, 'keys/weixin.key'), 'key')
  return cwd
}

function createConfig(overrides: Partial<WotciConfig> = {}): WotciConfig {
  return {
    desc: 'diagnostic',
    version: '1.2.3',
    weixin: {
      appid: 'wx123',
      ignores: ['node_modules/**'],
      privateKeyPath: 'keys/weixin.key',
      projectPath: 'dist/weixin',
      robot: 3,
      setting: { es6: true },
    },
    ...overrides,
  }
}

describe('buildNpm', () => {
  it('调用 packNpm 并返回警告', async () => {
    const cwd = await createProject()
    const config = createConfig()
    mocks.packNpm.mockResolvedValueOnce([{ msg: 'warn', code: 'W1', jsPath: 'app.js', startLine: 1 }])

    const result = await buildNpm('weixin', { config, cwd })

    expect(mocks.packNpm).toHaveBeenCalledWith(expect.anything(), { ignores: ['node_modules/**'] })
    expect(result).toMatchObject({
      message: 'npm 构建完成，1 条警告',
      platform: 'weixin',
      warnings: [{ msg: 'warn' }],
    })
  })

  it('请求里的 ignores 覆盖配置', async () => {
    const cwd = await createProject()
    const config = createConfig()

    await buildNpm('weixin', { config, cwd, ignores: ['custom/**'] })

    expect(mocks.packNpm).toHaveBeenCalledWith(expect.anything(), { ignores: ['custom/**'] })
  })

  it('packNpm 返回 undefined 时给出空警告', async () => {
    const cwd = await createProject()
    mocks.packNpm.mockResolvedValueOnce(undefined)

    const result = await buildNpm('weixin', { config: createConfig(), cwd })

    expect(result.warnings).toEqual([])
    expect(result.message).toBe('npm 构建完成')
  })

  it('微信 SDK 已经抛出 WeixinDiagnosticError 时原样返回', async () => {
    const cwd = await createProject()
    const inner = new WeixinDiagnosticError('inner')
    mocks.packNpm.mockRejectedValueOnce(inner)

    const error = await buildNpm('weixin', { config: createConfig(), cwd })
      .catch((caught: unknown) => caught)

    expect(error).toBe(inner)
  })

  it('packNpm 失败时抛 WeixinDiagnosticError', async () => {
    const cwd = await createProject()
    mocks.packNpm.mockRejectedValueOnce(new Error('boom'))

    await expect(buildNpm('weixin', { config: createConfig(), cwd }))
      .rejects
      .toMatchObject({ code: 'WEIXIN_DIAGNOSTIC_ERROR', message: '微信构建 npm 失败' })
  })

  it('非微信平台抛 CapabilityError', async () => {
    const cwd = await createProject()

    await expect(buildNpm('alipay', { config: createConfig(), cwd }))
      .rejects
      .toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
  })

  it('缺少 weixin 配置时报错', async () => {
    const cwd = await createProject()

    await expect(buildNpm('weixin', { config: { version: '1.0.0' }, cwd }))
      .rejects
      .toThrow('缺少微信小程序配置（weixin）')
  })

  it('缺少私钥时报错', async () => {
    const cwd = await createProject()
    const config = createConfig()
    config.weixin!.privateKeyPath = 'keys/missing.key'

    await expect(buildNpm('weixin', { config, cwd }))
      .rejects
      .toThrow('微信私钥文件不存在')
  })

  it('产物目录不存在时报错', async () => {
    const cwd = await createProject()
    const config = createConfig()
    config.weixin!.projectPath = 'dist/missing'

    await expect(buildNpm('weixin', { config, cwd }))
      .rejects
      .toThrow('微信小程序产物目录不存在')
  })

  it('微信 project 初始化失败时包装错误', async () => {
    const cwd = await createProject()
    // eslint-disable-next-line prefer-arrow-callback
    mocks.Project.mockImplementationOnce(function () {
      throw new Error('bad project config')
    })

    await expect(buildNpm('weixin', { config: createConfig(), cwd }))
      .rejects
      .toThrow('微信项目初始化失败，请检查 project.config.json')
  })
})

describe('downloadSourceMap', () => {
  it('默认保存到 .wotci/weixin/sourcemap.zip 并使用配置的 robot', async () => {
    const cwd = await createProject()

    const result = await downloadSourceMap('weixin', { config: createConfig(), cwd })

    expect(mocks.getDevSourceMap).toHaveBeenCalledWith({
      project: expect.anything(),
      robot: 3,
      sourceMapSavePath: path.join(cwd, '.wotci/weixin/sourcemap.zip'),
    })
    expect(result).toEqual({
      message: `sourceMap 已下载：${path.join(cwd, '.wotci/weixin/sourcemap.zip')}`,
      outputPath: path.join(cwd, '.wotci/weixin/sourcemap.zip'),
      platform: 'weixin',
    })
  })

  it('支持自定义 output、robot 与 streaming', async () => {
    const cwd = await createProject()
    const output = path.join(cwd, 'sm.zip')

    await downloadSourceMap('weixin', {
      config: createConfig(),
      cwd,
      output,
      robot: 7,
      streaming: true,
    })

    expect(mocks.getDevSourceMap).toHaveBeenCalledWith({
      project: expect.anything(),
      robot: 7,
      sourceMapSavePath: output,
      streaming: true,
    })
  })

  it('没有配置 robot 时默认 1', async () => {
    const cwd = await createProject()
    const config = createConfig()
    delete config.weixin!.robot

    await downloadSourceMap('weixin', { config, cwd })

    expect(mocks.getDevSourceMap).toHaveBeenCalledWith(expect.objectContaining({ robot: 1 }))
  })

  it('下载失败时抛 WeixinDiagnosticError', async () => {
    const cwd = await createProject()
    mocks.getDevSourceMap.mockRejectedValueOnce(new Error('network'))

    await expect(downloadSourceMap('weixin', { config: createConfig(), cwd }))
      .rejects
      .toMatchObject({ code: 'WEIXIN_DIAGNOSTIC_ERROR', message: '下载微信 sourceMap 失败' })
  })
})

describe('downloadCompiledResult', () => {
  it('导出编译产物并传递版本/描述/设置', async () => {
    const cwd = await createProject()

    const result = await downloadCompiledResult('weixin', { config: createConfig(), cwd })

    const output = path.join(cwd, '.wotci/weixin/compiled.zip')
    expect(mocks.getCompiledResult).toHaveBeenCalledWith({
      desc: 'diagnostic',
      project: expect.anything(),
      robot: 3,
      setting: { es6: true },
      version: '1.2.3',
    }, output)
    expect(result.outputPath).toBe(output)
    expect(result.message).toContain('编译产物已导出')
  })

  it('没有版本时回退 0.0.0，支持自定义输出', async () => {
    const cwd = await createProject()
    const config = createConfig({ version: undefined })
    const output = path.join(cwd, 'compiled.zip')

    await downloadCompiledResult('weixin', { config, cwd, output, robot: 5 })

    expect(mocks.getCompiledResult).toHaveBeenCalledWith(
      expect.objectContaining({ robot: 5, version: '0.0.0' }),
      output,
    )
  })

  it('导出失败时抛 WeixinDiagnosticError', async () => {
    const cwd = await createProject()
    mocks.getCompiledResult.mockRejectedValueOnce(new Error('network'))

    await expect(downloadCompiledResult('weixin', { config: createConfig(), cwd }))
      .rejects
      .toMatchObject({ code: 'WEIXIN_DIAGNOSTIC_ERROR', message: '导出微信编译产物失败' })
  })
})

describe('checkCodeQuality', () => {
  const checks = [
    { name: 'PACKAGE_SIZE_LIMIT', success: false, text: '超出限制', docURL: 'https://example.com' },
    { name: 'JS_COMPRESS_OPEN', success: true, text: '正常' },
  ]

  it('返回未通过项并写入完整报告', async () => {
    const cwd = await createProject()
    mocks.checkCodeQuality.mockResolvedValueOnce(checks)
    const output = path.join(cwd, 'report.json')

    const result = await checkCodeQuality('weixin', { config: createConfig(), cwd, output })

    expect(result).toMatchObject({
      checks: 2,
      issues: [expect.objectContaining({ name: 'PACKAGE_SIZE_LIMIT' })],
      ok: false,
      outputPath: output,
      platform: 'weixin',
    })
    expect(result.message).toBe('代码质量检查完成：2 项检查，1 项未通过')
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(checks)
  })

  it('全部通过时不写文件', async () => {
    const cwd = await createProject()
    mocks.checkCodeQuality.mockResolvedValueOnce([checks[1]])

    const result = await checkCodeQuality('weixin', { config: createConfig(), cwd })

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.outputPath).toBeUndefined()
    expect(result.message).toBe('代码质量检查完成：1 项检查全部通过')
  })

  it('检查失败时抛 WeixinDiagnosticError', async () => {
    const cwd = await createProject()
    mocks.checkCodeQuality.mockRejectedValueOnce(new Error('compile'))

    await expect(checkCodeQuality('weixin', { config: createConfig(), cwd }))
      .rejects
      .toMatchObject({ code: 'WEIXIN_DIAGNOSTIC_ERROR', message: '微信代码质量检查失败' })
  })
})
