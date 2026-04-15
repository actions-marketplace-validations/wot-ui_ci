import type { CIConfig, PlatformUploadResult, UploadContext } from '../types'

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import * as minidevModule from 'minidev'
import { UploadError } from '../errors'
import { resolveFromCwd } from '../utils/path'
import { compareVersion } from '../utils/version'

interface AlipayUploadRawResult {
  version?: string
}

const runtimeMinidev = resolveRuntimeMinidev()
const runtimeUseDefaults = resolveRuntimeUseDefaults()

export async function uploadAlipay(config: CIConfig, options: UploadContext = {}): Promise<PlatformUploadResult<AlipayUploadRawResult>> {
  if (!config.alipay)
    throw new UploadError('Missing alipay config')

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
        throw new UploadError('A version is required when Alipay autoincrement is disabled')
      if (compareVersion(config.version, latestVersion) <= 0) {
        throw new UploadError(`Alipay version ${config.version} must be greater than latest uploaded version ${latestVersion}`)
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
      message: `Uploaded Alipay mini program ${version}`,
      platform: 'alipay',
      raw,
      version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('Failed to upload Alipay mini program', error)
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
    throw new UploadError('Invalid minidev runtime export: missing minidev object')

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
    throw new UploadError('Invalid minidev runtime export: missing useDefaults function')

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
    throw new UploadError('Alipay config requires privateKey or privateKeyPath')

  try {
    const privateKeyPath = resolveFromCwd(cwd, config.alipay.privateKeyPath)
    return await readFile(privateKeyPath, 'utf8')
  }
  catch (error) {
    throw new UploadError('Failed to read Alipay private key file', error)
  }
}
