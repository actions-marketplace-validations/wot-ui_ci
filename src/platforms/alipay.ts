import type {
  AlipayConfig,
  AlipayPreviewRawResult,
  AlipayUploadRawResult,
  PreviewOptions,
  PreviewResult,
  UploadOptions,
  UploadResult,
  VersionRecord,
  WotciConfig,
} from '../types'

import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as minidevModule from 'minidev'
import { PreviewError, UploadError, VersionError } from '../errors'
import { appendDesc } from '../messages'
import { isDirectory, resolveFromCwd } from '../utils/path'
import { compareVersion } from '../utils/version'

interface MinidevRuntime {
  minidev: {
    app: {
      getUploadedVersion: (options: {
        appId: string
        clientType: string
      }) => Promise<string>
      getUploadedVersionList: (options: {
        appId: string
        clientType: string
      }) => Promise<Array<{
        appVersion?: string
        versionDescription?: string
        versionStatus?: string
        createTime?: string
        operateName?: string
      }>>
      setExperience: (options: {
        appId: string
        clientType: string
        version: string
      }) => Promise<{ qrCodeUrl?: string }>
      cancelExperience: (options: {
        appId: string
        clientType: string
        version: string
      }) => Promise<void>
      deleteVersion: (options: {
        appId: string
        clientType: string
        version: string
      }) => Promise<void>
    }
    upload: (options: {
      project: string
      appId: string
      version?: string
      clientType: string
      experience: boolean
    }) => Promise<AlipayUploadRawResult>
    preview: (options: {
      project: string
      appId: string
      clientType: string
      page?: string
      pageQuery?: string
      query?: string
      scene?: string
      autoPush?: boolean
      ignoreHttpDomainCheck?: boolean
      ignoreWebViewDomainCheck?: boolean
    }) => Promise<AlipayPreviewRawResult>
  }
  useDefaults: (options: {
    config: {
      defaults: Record<string, string>
    }
  }) => void
}

export async function uploadAlipay(
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<UploadResult<'alipay', AlipayUploadRawResult>> {
  const alipay = config.alipay
  if (!alipay)
    throw new UploadError('缺少支付宝小程序上传配置（alipay）')
  if (!alipay.autoincrement && !config.version)
    throw new UploadError('支付宝小程序关闭自动递增时必须提供 version')

  const cwd = options.cwd ?? process.cwd()
  const projectPath = resolveFromCwd(cwd, alipay.projectPath)

  if (!await isDirectory(projectPath))
    throw new UploadError(`支付宝小程序产物目录不存在：${projectPath}`)

  const privateKey = await resolvePrivateKey(alipay, cwd)
  const runtime = resolveMinidevRuntime()

  try {
    runtime.useDefaults({
      config: {
        defaults: {
          'alipay.authentication.privateKey': privateKey,
          'alipay.authentication.toolId': alipay.toolId,
        },
      },
    })

    const clientType = alipay.clientType ?? 'alipay'

    if (!alipay.autoincrement) {
      const latestVersion = await runtime.minidev.app.getUploadedVersion({
        appId: alipay.appid,
        clientType,
      })

      if (latestVersion && compareVersion(config.version!, latestVersion) <= 0) {
        throw new UploadError(
          `支付宝小程序上传版本号必须大于线上最新版本，当前：${config.version}，线上：${latestVersion}`,
        )
      }
    }

    const raw = await runtime.minidev.upload({
      appId: alipay.appid,
      clientType,
      experience: true,
      project: projectPath,
      version: alipay.autoincrement ? '' : config.version,
    }) as AlipayUploadRawResult

    const version = raw?.version ?? (alipay.autoincrement ? 'auto' : config.version!)

    return {
      desc: config.desc,
      message: appendDesc(`支付宝小程序上传成功，版本：${version}`, config.desc),
      platform: 'alipay',
      raw: raw ?? {},
      version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('支付宝小程序上传失败', error)
  }
}

async function resolveAlipayMutationRuntime(
  config: WotciConfig,
  options: UploadOptions,
): Promise<{
  alipay: NonNullable<WotciConfig['alipay']>
  clientType: string
  runtime: MinidevRuntime
}> {
  const alipay = config.alipay
  if (!alipay)
    throw new VersionError('缺少支付宝小程序配置（alipay）')

  const cwd = options.cwd ?? process.cwd()
  const privateKey = await resolvePrivateKey(alipay, cwd).catch((error: unknown) => {
    throw new VersionError('支付宝版本操作失败', error)
  })
  const runtime = resolveMinidevRuntime()
  runtime.useDefaults({
    config: {
      defaults: {
        'alipay.authentication.privateKey': privateKey,
        'alipay.authentication.toolId': alipay.toolId,
      },
    },
  })

  return { alipay, clientType: alipay.clientType ?? 'alipay', runtime }
}

export async function setAlipayExperience(
  config: WotciConfig,
  version: string,
  options: UploadOptions = {},
): Promise<{ qrCodeUrl?: string }> {
  const { alipay, clientType, runtime } = await resolveAlipayMutationRuntime(config, options)

  try {
    return await runtime.minidev.app.setExperience({
      appId: alipay.appid,
      clientType,
      version,
    })
  }
  catch (error) {
    throw new VersionError('设置支付宝体验版失败', error)
  }
}

export async function cancelAlipayExperience(
  config: WotciConfig,
  version: string,
  options: UploadOptions = {},
): Promise<void> {
  const { alipay, clientType, runtime } = await resolveAlipayMutationRuntime(config, options)

  try {
    await runtime.minidev.app.cancelExperience({
      appId: alipay.appid,
      clientType,
      version,
    })
  }
  catch (error) {
    throw new VersionError('取消支付宝体验版失败', error)
  }
}

export async function deleteAlipayVersion(
  config: WotciConfig,
  version: string,
  options: UploadOptions = {},
): Promise<void> {
  const { alipay, clientType, runtime } = await resolveAlipayMutationRuntime(config, options)

  try {
    await runtime.minidev.app.deleteVersion({
      appId: alipay.appid,
      clientType,
      version,
    })
  }
  catch (error) {
    throw new VersionError('删除支付宝版本失败', error)
  }
}

export async function getAlipayLatestVersion(
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<string> {
  const alipay = config.alipay
  if (!alipay)
    throw new VersionError('缺少支付宝小程序配置（alipay）')

  const cwd = options.cwd ?? process.cwd()
  const privateKey = await resolvePrivateKey(alipay, cwd).catch((error: unknown) => {
    throw new VersionError('获取支付宝线上版本失败', error)
  })
  const runtime = resolveMinidevRuntime()

  try {
    runtime.useDefaults({
      config: {
        defaults: {
          'alipay.authentication.privateKey': privateKey,
          'alipay.authentication.toolId': alipay.toolId,
        },
      },
    })

    return await runtime.minidev.app.getUploadedVersion({
      appId: alipay.appid,
      clientType: alipay.clientType ?? 'alipay',
    })
  }
  catch (error) {
    if (error instanceof VersionError)
      throw error
    throw new VersionError('获取支付宝线上版本失败', error)
  }
}

export async function getAlipayVersionList(
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<VersionRecord[]> {
  const alipay = config.alipay
  if (!alipay)
    throw new VersionError('缺少支付宝小程序配置（alipay）')

  const cwd = options.cwd ?? process.cwd()
  const privateKey = await resolvePrivateKey(alipay, cwd).catch((error: unknown) => {
    throw new VersionError('获取支付宝版本列表失败', error)
  })
  const runtime = resolveMinidevRuntime()

  try {
    runtime.useDefaults({
      config: {
        defaults: {
          'alipay.authentication.privateKey': privateKey,
          'alipay.authentication.toolId': alipay.toolId,
        },
      },
    })

    const rows = await runtime.minidev.app.getUploadedVersionList({
      appId: alipay.appid,
      clientType: alipay.clientType ?? 'alipay',
    })

    return rows.map(row => ({
      ...(row.appVersion ? { version: row.appVersion } : {}),
      ...(row.versionDescription ? { description: row.versionDescription } : {}),
      ...(row.versionStatus ? { status: row.versionStatus } : {}),
      ...(row.createTime ? { createTime: row.createTime } : {}),
      ...(row.operateName ? { operator: row.operateName } : {}),
    })) as VersionRecord[]
  }
  catch (error) {
    if (error instanceof VersionError)
      throw error
    throw new VersionError('获取支付宝版本列表失败', error)
  }
}

export async function previewAlipay(
  config: WotciConfig,
  options: PreviewOptions = {},
): Promise<PreviewResult<'alipay', AlipayPreviewRawResult>> {
  const alipay = config.alipay
  if (!alipay)
    throw new PreviewError('缺少支付宝小程序预览配置（alipay）')

  const cwd = options.cwd ?? process.cwd()
  const previewConfig = alipay.preview
  const projectPath = resolveFromCwd(cwd, alipay.projectPath)

  if (!await isDirectory(projectPath))
    throw new PreviewError(`支付宝小程序产物目录不存在：${projectPath}`)

  const privateKey = await resolvePrivateKey(alipay, cwd).catch((error: unknown) => {
    throw new PreviewError('支付宝小程序预览失败', error)
  })
  const runtime = resolveMinidevRuntime()

  try {
    runtime.useDefaults({
      config: {
        defaults: {
          'alipay.authentication.privateKey': privateKey,
          'alipay.authentication.toolId': alipay.toolId,
        },
      },
    })

    if (typeof runtime.minidev.preview !== 'function')
      throw new PreviewError('minidev 未提供 preview 能力')

    const raw = await runtime.minidev.preview({
      appId: alipay.appid,
      autoPush: previewConfig?.autoPush,
      clientType: alipay.clientType ?? 'alipay',
      ignoreHttpDomainCheck: previewConfig?.ignoreHttpDomainCheck,
      ignoreWebViewDomainCheck: previewConfig?.ignoreWebViewDomainCheck,
      page: options.pagePath ?? previewConfig?.page,
      pageQuery: options.pageQuery ?? previewConfig?.pageQuery,
      project: projectPath,
      query: options.query ?? previewConfig?.query,
      scene: options.scene !== undefined ? String(options.scene) : previewConfig?.scene,
    }) as AlipayPreviewRawResult

    if (!raw?.qrcodeUrl)
      throw new PreviewError('支付宝预览未返回二维码地址')

    const qrCode = await createAlipayQrCode(raw.qrcodeUrl, options.qrOutput, cwd)
    const version = raw.version

    return {
      message: createAlipayPreviewMessage(qrCode, raw.qrcodeUrl, version),
      platform: 'alipay',
      qrCode,
      raw,
      ...(version ? { version } : {}),
    }
  }
  catch (error) {
    if (error instanceof PreviewError)
      throw error
    throw new PreviewError('支付宝小程序预览失败', error)
  }
}

async function createAlipayQrCode(
  qrcodeUrl: string,
  qrOutput: string | undefined,
  cwd: string,
): Promise<PreviewResult['qrCode']> {
  if (!qrOutput)
    return { kind: 'url', url: qrcodeUrl, value: qrcodeUrl }

  const outputPath = resolveFromCwd(cwd, qrOutput)

  try {
    const response = await fetch(qrcodeUrl)
    if (!response.ok)
      throw new Error(`下载二维码失败：HTTP ${response.status}`)

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, Buffer.from(await response.arrayBuffer()))

    return { kind: 'file', path: outputPath, url: qrcodeUrl, value: outputPath }
  }
  catch (error) {
    throw new PreviewError(`下载支付宝预览二维码失败：${qrcodeUrl}`, error)
  }
}

function createAlipayPreviewMessage(
  qrCode: PreviewResult['qrCode'],
  qrcodeUrl: string,
  version: string | undefined,
): string {
  const versionText = version ? `，版本：${version}` : ''

  if (qrCode.kind === 'file')
    return `支付宝小程序预览二维码已下载：${qrCode.path}，原始链接：${qrcodeUrl}${versionText}`

  return `支付宝小程序预览二维码：${qrcodeUrl}${versionText}`
}

function resolveMinidevRuntime(): MinidevRuntime {
  const namespace = minidevModule as unknown as {
    default?: unknown
    minidev?: unknown
    useDefaults?: unknown
  }

  const root = namespace.default && typeof namespace.default === 'object'
    ? namespace.default as { minidev?: unknown, useDefaults?: unknown }
    : undefined

  const sdk = namespace.minidev ?? root?.minidev
  const useDefaults = namespace.useDefaults ?? root?.useDefaults

  if (!sdk || typeof sdk !== 'object')
    throw new UploadError('minidev 运行时导出异常：缺少 minidev 对象')
  if (typeof useDefaults !== 'function')
    throw new UploadError('minidev 运行时导出异常：缺少 useDefaults 方法')

  return {
    minidev: sdk as MinidevRuntime['minidev'],
    useDefaults: useDefaults as MinidevRuntime['useDefaults'],
  }
}

async function resolvePrivateKey(alipay: AlipayConfig, cwd: string): Promise<string> {
  if (alipay.privateKey)
    return alipay.privateKey
  if (!alipay.privateKeyPath)
    throw new UploadError('支付宝小程序配置需要提供 privateKey 或 privateKeyPath')

  const privateKeyPath = resolveFromCwd(cwd, alipay.privateKeyPath)

  try {
    return await readFile(privateKeyPath, 'utf8')
  }
  catch (error) {
    throw new UploadError(`支付宝私钥文件读取失败：${privateKeyPath}`, error)
  }
}
