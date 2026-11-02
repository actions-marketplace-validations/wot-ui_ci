import type { AlipayConfig, AlipayUploadRawResult, UploadOptions, UploadResult, WotciConfig } from '../types'

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import * as minidevModule from 'minidev'
import { UploadError } from '../errors'
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
    }
    upload: (options: {
      project: string
      appId: string
      version?: string
      clientType: string
      experience: boolean
    }) => Promise<AlipayUploadRawResult>
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
