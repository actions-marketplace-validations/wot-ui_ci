import type {
  PreviewOptions,
  PreviewQrCode,
  PreviewResult,
  UploadOptions,
  UploadResult,
  WeixinPreviewRawResult,
  WeixinSubPackageInfo,
  WeixinUploadRawResult,
  WotciConfig,
} from '../types'
import { access, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as weixinCIModule from 'miniprogram-ci'
import { PreviewError, UploadError, VersionError } from '../errors'
import { appendDesc } from '../messages'
import { isDirectory, resolveFromCwd } from '../utils/path'

type WeixinCI = typeof import('miniprogram-ci')

/** Node 对 CJS 包同时提供命名导出与 default 导出，两种形态都兼容 */
function resolveWeixinCI(): Pick<WeixinCI, 'Project' | 'getLatestVersion' | 'preview' | 'upload'> {
  const candidates: unknown[] = [
    weixinCIModule,
    (weixinCIModule as { default?: unknown }).default,
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object')
      continue

    const value = candidate as Partial<WeixinCI>
    if (
      typeof value.Project === 'function'
      && typeof value.getLatestVersion === 'function'
      && typeof value.preview === 'function'
      && typeof value.upload === 'function'
    ) {
      return {
        Project: value.Project,
        getLatestVersion: value.getLatestVersion,
        preview: value.preview,
        upload: value.upload,
      }
    }
  }

  throw new UploadError('miniprogram-ci 导出格式不受支持')
}

export async function getWeixinLatestVersion(
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<{ latest?: string, grayReleaseVersion?: string }> {
  const weixin = config.weixin
  if (!weixin)
    throw new VersionError('缺少微信小程序配置（weixin）')

  const cwd = options.cwd ?? process.cwd()
  const projectPath = resolveFromCwd(cwd, weixin.projectPath)
  const privateKeyPath = resolveFromCwd(cwd, weixin.privateKeyPath)

  try {
    await access(privateKeyPath)
  }
  catch (error) {
    throw new VersionError(`微信私钥文件不存在：${privateKeyPath}`, error)
  }

  if (!await isDirectory(projectPath))
    throw new VersionError(`微信小程序产物目录不存在：${projectPath}`)

  try {
    const ci = resolveWeixinCI()
    const project = new ci.Project({
      appid: weixin.appid,
      ignores: weixin.ignores,
      privateKeyPath,
      projectPath,
      type: weixin.type ?? 'miniProgram',
    })
    const raw = await ci.getLatestVersion({ project })

    return {
      ...(raw.latestVersion ? { latest: raw.latestVersion } : {}),
      ...(raw.grayReleaseVersion ? { grayReleaseVersion: raw.grayReleaseVersion } : {}),
    }
  }
  catch (error) {
    if (error instanceof VersionError)
      throw error
    throw new VersionError('获取微信线上版本失败', error)
  }
}

export async function uploadWeixin(
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<UploadResult<'weixin', WeixinUploadRawResult>> {
  const weixin = config.weixin
  if (!weixin)
    throw new UploadError('缺少微信小程序上传配置（weixin）')
  if (!config.version)
    throw new UploadError('微信小程序上传需要提供 version')

  const cwd = options.cwd ?? process.cwd()
  const projectPath = resolveFromCwd(cwd, weixin.projectPath)
  const privateKeyPath = resolveFromCwd(cwd, weixin.privateKeyPath)

  try {
    await access(privateKeyPath)
  }
  catch (error) {
    throw new UploadError(`微信私钥文件不存在：${privateKeyPath}`, error)
  }

  if (!await isDirectory(projectPath))
    throw new UploadError(`微信小程序产物目录不存在：${projectPath}`)

  const ci = resolveWeixinCI()

  try {
    const project = new ci.Project({
      appid: weixin.appid,
      ignores: weixin.ignores,
      privateKeyPath,
      projectPath,
      type: weixin.type ?? 'miniProgram',
    })

    const raw = await ci.upload({
      desc: config.desc,
      project,
      robot: weixin.robot,
      setting: weixin.setting,
      version: config.version,
    }) as WeixinUploadRawResult

    const sizes = getPackageSizes(raw?.subPackageInfo)

    return {
      desc: config.desc,
      message: createWeixinMessage(config.version, raw?.subPackageInfo, config.desc),
      platform: 'weixin',
      raw: raw ?? {},
      ...(sizes ? { sizes } : {}),
      version: config.version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('微信小程序上传失败', error)
  }
}

export async function previewWeixin(
  config: WotciConfig,
  options: PreviewOptions = {},
): Promise<PreviewResult<'weixin', WeixinPreviewRawResult>> {
  const weixin = config.weixin
  if (!weixin)
    throw new PreviewError('缺少微信小程序预览配置（weixin）')

  const cwd = options.cwd ?? process.cwd()
  const previewConfig = weixin.preview
  const projectPath = resolveFromCwd(cwd, weixin.projectPath)
  const privateKeyPath = resolveFromCwd(cwd, weixin.privateKeyPath)

  try {
    await access(privateKeyPath)
  }
  catch (error) {
    throw new PreviewError(`微信私钥文件不存在：${privateKeyPath}`, error)
  }

  if (!await isDirectory(projectPath))
    throw new PreviewError(`微信小程序产物目录不存在：${projectPath}`)

  const qrFormat = options.qrFormat ?? previewConfig?.qrcodeFormat ?? 'image'
  const outputPath = resolveQrOutputPath(qrFormat, options, previewConfig?.qrcodeOutputDest, cwd)

  if (outputPath)
    await mkdir(path.dirname(outputPath), { recursive: true })

  const scene = resolveScene(options.scene ?? previewConfig?.scene)
  const desc = options.desc ?? previewConfig?.desc ?? config.desc
  const ci = resolveWeixinCI()

  try {
    const project = new ci.Project({
      appid: weixin.appid,
      ignores: weixin.ignores,
      privateKeyPath,
      projectPath,
      type: weixin.type ?? 'miniProgram',
    })

    const raw = await ci.preview({
      bigPackageSizeSupport: previewConfig?.bigPackageSizeSupport,
      desc,
      pagePath: options.pagePath ?? previewConfig?.pagePath,
      project,
      qrcodeFormat: qrFormat,
      ...(outputPath ? { qrcodeOutputDest: outputPath } : {}),
      robot: options.robot ?? previewConfig?.robot ?? weixin.robot,
      scene,
      searchQuery: options.query ?? previewConfig?.searchQuery,
      setting: previewConfig?.setting ?? weixin.setting,
      threads: previewConfig?.threads,
      version: config.version ?? '0.0.0',
    }) as WeixinPreviewRawResult

    const qrCode = await createQrCode(qrFormat, outputPath)
    const sizes = getPackageSizes(raw?.subPackageInfo)

    return {
      desc,
      message: appendDesc(createPreviewMessage(qrFormat, outputPath, sizes), desc),
      platform: 'weixin',
      qrCode,
      raw: raw ?? {},
      ...(sizes ? { sizes } : {}),
    }
  }
  catch (error) {
    if (error instanceof PreviewError)
      throw error
    throw new PreviewError('微信小程序预览失败', error)
  }
}

function resolveQrOutputPath(
  format: 'terminal' | 'image' | 'base64',
  options: PreviewOptions,
  configuredPath: string | undefined,
  cwd: string,
): string | undefined {
  if (format === 'terminal')
    return undefined

  const target = options.qrOutput
    ?? configuredPath
    ?? (format === 'base64' ? '.wotci/preview/weixin.txt' : '.wotci/preview/weixin.png')

  return resolveFromCwd(cwd, target)
}

function resolveScene(scene: string | number | undefined): number | undefined {
  if (scene === undefined)
    return undefined

  const value = typeof scene === 'number' ? scene : Number(scene)

  if (!Number.isInteger(value) || value < 0)
    throw new PreviewError(`微信预览场景值必须是大于等于 0 的整数：${scene}`)

  return value
}

async function createQrCode(
  format: 'terminal' | 'image' | 'base64',
  outputPath: string | undefined,
): Promise<PreviewQrCode> {
  if (format === 'terminal')
    return { kind: 'terminal', value: '' }

  const target = outputPath as string

  if (format === 'base64') {
    try {
      const content = await readFile(target, 'utf8')
      return { kind: 'base64', path: target, value: content.trim() }
    }
    catch (error) {
      throw new PreviewError(`读取微信预览二维码失败：${target}`, error)
    }
  }

  return { kind: 'file', path: target, value: target }
}

function createPreviewMessage(
  format: 'terminal' | 'image' | 'base64',
  outputPath: string | undefined,
  sizes: { total?: number, main?: number } | undefined,
): string {
  const parts = [format === 'terminal'
    ? '微信小程序预览二维码已输出到终端'
    : format === 'base64'
      ? '微信小程序预览二维码已生成（base64）'
      : `微信小程序预览二维码已生成：${outputPath}`]

  if (sizes?.total)
    parts.push(`总包 ${formatPackageSize(sizes.total)}`)
  if (sizes?.main)
    parts.push(`主包 ${formatPackageSize(sizes.main)}`)

  return parts.join('，')
}

function getPackageSizes(packages?: WeixinSubPackageInfo[]): { total?: number, main?: number } | undefined {
  if (!packages?.length)
    return undefined

  const fullPackage = packages.find(item => item.name === '__FULL__')
  const appPackage = packages.find(item => item.name === '__APP__')

  return {
    ...(fullPackage ? { total: fullPackage.size } : {}),
    ...(appPackage ? { main: appPackage.size } : {}),
  }
}

function createWeixinMessage(version: string, packages?: WeixinSubPackageInfo[], desc?: string): string {
  const parts = [`微信小程序上传成功，版本：${version}`]
  const fullPackage = packages?.find(item => item.name === '__FULL__')
  const appPackage = packages?.find(item => item.name === '__APP__')

  if (fullPackage)
    parts.push(`总包 ${formatPackageSize(fullPackage.size)}`)
  if (appPackage)
    parts.push(`主包 ${formatPackageSize(appPackage.size)}`)

  return appendDesc(parts.join('，'), desc)
}

function formatPackageSize(size: number): string {
  return `${Math.round(size / 1024)}KB`
}
