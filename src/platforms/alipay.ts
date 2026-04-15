import type { CIConfig, PlatformUploadResult, UploadContext } from '../types'

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import * as minidevModule from 'minidev'
import { UploadError } from '../errors'
import { appendDesc } from '../messages'
import { resolveFromCwd } from '../utils/path'
import { compareVersion } from '../utils/version'

interface AlipayUploadRawResult {
  version?: string
}

const runtimeMinidev = resolveRuntimeMinidev()
const runtimeUseDefaults = resolveRuntimeUseDefaults()

export async function uploadAlipay(config: CIConfig, options: UploadContext = {}): Promise<PlatformUploadResult<AlipayUploadRawResult>> {
  if (!config.alipay)
    throw new UploadError('缺少支付宝小程序上传配置（alipay）')

  const cwd = options.cwd ?? process.cwd()
  const clientType = config.alipay.clientType ?? 'alipay'
  const projectPath = resolveFromCwd(cwd, config.alipay.projectPath)
  const privateKey = await resolveAlipayPrivateKey(config, cwd)

  runtimeUseDefaults({
    config: {
      defaults: {
        'alipay.authentication.privateKey': privateKey,
        'alipay.authentication.toolId': config.alipay.toolId,
      },
    },
  })

  try {
    const latestVersion = await runtimeMinidev.app.getUploadedVersion({
      appId: config.alipay.appid,
      clientType,
    })

    if (!config.alipay.autoincrement) {
      if (!config.version)
        throw new UploadError('支付宝小程序关闭自动递增时必须提供 version')
      if (compareVersion(config.version, latestVersion) <= 0) {
        throw new UploadError(`支付宝上传版本号必须大于线上最新版本，当前：${config.version}，最新：${latestVersion}`)
      }
    }

    const raw = await runtimeMinidev.upload({
      appId: config.alipay.appid,
      clientType,
      experience: true,
      project: projectPath,
      version: config.alipay.autoincrement ? '' : config.version,
    }) as AlipayUploadRawResult
    const version = raw.version ?? config.version ?? 'auto'

    return {
      desc: config.desc,
      message: appendDesc(`支付宝小程序上传成功，版本：${version}`, config.desc),
      platform: 'alipay',
      raw,
      version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('支付宝小程序上传失败', error)
  }
}

function resolveRuntimeMinidev(): {
  app: {
    getUploadedVersion: (options: {
      appId: string
      clientType: string
    }) => Promise<string>
  }
  upload: (options: {
    project: string
    appId: string
    version?: string
    clientType: string
    experience: boolean
  }) => Promise<AlipayUploadRawResult>
} {
  const moduleValue = minidevModule as {
    default?: unknown
    minidev?: unknown
  }
  const resolved = moduleValue.minidev
    ?? extractObjectProperty(moduleValue.default, 'minidev')
    ?? moduleValue.default

  if (!resolved || typeof resolved !== 'object')
    throw new UploadError('minidev 运行时导出异常：缺少 minidev 对象')

  return resolved as {
    app: {
      getUploadedVersion: (options: {
        appId: string
        clientType: string
      }) => Promise<string>
    }
    upload: (options: {
      project: string
      appId: string
      version?: string
      clientType: string
      experience: boolean
    }) => Promise<AlipayUploadRawResult>
  }
}

function resolveRuntimeUseDefaults(): (options: {
  config: {
    defaults: Record<string, string>
  }
}) => void {
  const moduleValue = minidevModule as {
    default?: unknown
    useDefaults?: unknown
  }
  const resolved = moduleValue.useDefaults
    ?? extractObjectProperty(moduleValue.default, 'useDefaults')

  if (typeof resolved !== 'function')
    throw new UploadError('minidev 运行时导出异常：缺少 useDefaults 方法')

  return resolved as (options: {
    config: {
      defaults: Record<string, string>
    }
  }) => void
}

function extractObjectProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object')
    return undefined
  return (value as Record<string, unknown>)[key]
}

async function resolveAlipayPrivateKey(config: CIConfig, cwd: string): Promise<string> {
  if (config.alipay?.privateKey)
    return config.alipay.privateKey
  if (!config.alipay?.privateKeyPath)
    throw new UploadError('支付宝小程序配置需要提供 privateKey 或 privateKeyPath')

  try {
    const privateKeyPath = resolveFromCwd(cwd, config.alipay.privateKeyPath)
    return await readFile(privateKeyPath, 'utf8')
  }
  catch (error) {
    throw new UploadError('读取支付宝私钥文件失败', error)
  }
}
