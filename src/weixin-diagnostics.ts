import type {
  PlatformInput,
  WeixinBuildNpmRequest,
  WeixinBuildNpmResult,
  WeixinCompiledResultRequest,
  WeixinDiagnosticRequest,
  WeixinDiagnosticResult,
  WeixinQualityCheck,
  WeixinQualityRequest,
  WeixinQualityResult,
  WeixinSourceMapRequest,
  WeixinWarning,
  WotciConfig,
} from './types'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from './config'
import { CapabilityError, WeixinDiagnosticError } from './errors'
import { getWeixinCI } from './platforms/weixin'
import { isDirectory, resolveFromCwd } from './utils/path'
import { normalizePlatform } from './utils/platform'

const DEFAULT_SOURCEMAP_OUTPUT = '.wotci/weixin/sourcemap.zip'
const DEFAULT_COMPILED_OUTPUT = '.wotci/weixin/compiled.zip'

interface WeixinContext {
  ci: ReturnType<typeof getWeixinCI>
  config: WotciConfig
  cwd: string
  project: InstanceType<ReturnType<typeof getWeixinCI>['Project']>
  projectPath: string
  weixin: NonNullable<WotciConfig['weixin']>
}

/** 构建 npm，对应开发者工具「构建 npm」 */
export async function buildNpm(
  platform: PlatformInput,
  request: WeixinBuildNpmRequest = {},
): Promise<WeixinBuildNpmResult> {
  const { config, cwd } = await loadWeixinRequest(platform, request)
  const context = await createWeixinContext(config, cwd)

  try {
    const warnings = await context.ci.packNpm(context.project, {
      ignores: request.ignores ?? context.weixin.ignores,
    }) as WeixinWarning[] | undefined

    return {
      message: warnings?.length ? `npm 构建完成，${warnings.length} 条警告` : 'npm 构建完成',
      platform: 'weixin',
      warnings: warnings ?? [],
    }
  }
  catch (error) {
    throw wrapDiagnosticError('微信构建 npm 失败', error)
  }
}

/** 下载最近一次上传版本的 sourceMap */
export async function downloadSourceMap(
  platform: PlatformInput,
  request: WeixinSourceMapRequest = {},
): Promise<WeixinDiagnosticResult> {
  const { config, cwd } = await loadWeixinRequest(platform, request)
  const context = await createWeixinContext(config, cwd)
  const outputPath = resolveFromCwd(cwd, request.output ?? DEFAULT_SOURCEMAP_OUTPUT)

  await mkdir(path.dirname(outputPath), { recursive: true })

  try {
    await context.ci.getDevSourceMap({
      project: context.project,
      robot: request.robot ?? context.weixin.robot ?? 1,
      sourceMapSavePath: outputPath,
      ...(request.streaming ? { streaming: true } : {}),
    })

    return {
      message: `sourceMap 已下载：${outputPath}`,
      outputPath,
      platform: 'weixin',
    }
  }
  catch (error) {
    throw wrapDiagnosticError('下载微信 sourceMap 失败', error)
  }
}

/** 导出最近一次上传的编译产物 zip，便于排查包体积 */
export async function downloadCompiledResult(
  platform: PlatformInput,
  request: WeixinCompiledResultRequest = {},
): Promise<WeixinDiagnosticResult> {
  const { config, cwd } = await loadWeixinRequest(platform, request)
  const context = await createWeixinContext(config, cwd)
  const outputPath = resolveFromCwd(cwd, request.output ?? DEFAULT_COMPILED_OUTPUT)

  await mkdir(path.dirname(outputPath), { recursive: true })

  try {
    await context.ci.getCompiledResult({
      desc: config.desc,
      project: context.project,
      robot: request.robot ?? context.weixin.robot,
      setting: context.weixin.setting,
      version: config.version ?? '0.0.0',
    }, outputPath)

    return {
      message: `编译产物已导出：${outputPath}`,
      outputPath,
      platform: 'weixin',
    }
  }
  catch (error) {
    throw wrapDiagnosticError('导出微信编译产物失败', error)
  }
}

/** 运行开发者工具「代码质量」检查 */
export async function checkCodeQuality(
  platform: PlatformInput,
  request: WeixinQualityRequest = {},
): Promise<WeixinQualityResult> {
  const { config, cwd } = await loadWeixinRequest(platform, request)
  const context = await createWeixinContext(config, cwd)

  try {
    const checks = await context.ci.checkCodeQuality(context.project) as WeixinQualityCheck[]
    const issues = checks.filter(check => check.success === false)
    let outputPath: string | undefined

    if (request.output) {
      outputPath = resolveFromCwd(cwd, request.output)
      await mkdir(path.dirname(outputPath), { recursive: true })
      await writeFile(outputPath, `${JSON.stringify(checks, null, 2)}\n`, 'utf8')
    }

    return {
      checks: checks.length,
      issues,
      message: issues.length
        ? `代码质量检查完成：${checks.length} 项检查，${issues.length} 项未通过`
        : `代码质量检查完成：${checks.length} 项检查全部通过`,
      ok: issues.length === 0,
      ...(outputPath ? { outputPath } : {}),
      platform: 'weixin',
    }
  }
  catch (error) {
    throw wrapDiagnosticError('微信代码质量检查失败', error)
  }
}

async function loadWeixinRequest(
  platform: PlatformInput,
  request: WeixinDiagnosticRequest,
): Promise<{ config: WotciConfig, cwd: string }> {
  if (normalizePlatform(platform) !== 'weixin')
    throw new CapabilityError('微信构建与诊断能力仅支持 weixin 平台')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  return { config: loaded.config, cwd: loaded.cwd }
}

async function createWeixinContext(config: WotciConfig, cwd: string): Promise<WeixinContext> {
  const weixin = config.weixin
  if (!weixin)
    throw new WeixinDiagnosticError('缺少微信小程序配置（weixin）')

  const projectPath = resolveFromCwd(cwd, weixin.projectPath)
  const privateKeyPath = resolveFromCwd(cwd, weixin.privateKeyPath)

  try {
    await access(privateKeyPath)
  }
  catch (error) {
    throw new WeixinDiagnosticError(`微信私钥文件不存在：${privateKeyPath}`, error)
  }

  if (!await isDirectory(projectPath))
    throw new WeixinDiagnosticError(`微信小程序产物目录不存在：${projectPath}`)

  let ci: WeixinContext['ci']

  try {
    ci = getWeixinCI()
  }
  catch (error) {
    throw wrapDiagnosticError('miniprogram-ci 加载失败', error)
  }

  let project: WeixinContext['project']

  try {
    project = new ci.Project({
      appid: weixin.appid,
      ignores: weixin.ignores,
      privateKeyPath,
      projectPath,
      type: weixin.type ?? 'miniProgram',
    })
  }
  catch (error) {
    throw new WeixinDiagnosticError('微信项目初始化失败，请检查 project.config.json', error)
  }

  return { ci, config, cwd, project, projectPath, weixin }
}

function wrapDiagnosticError(message: string, error: unknown): WeixinDiagnosticError {
  if (error instanceof WeixinDiagnosticError)
    return error
  return new WeixinDiagnosticError(message, error)
}
