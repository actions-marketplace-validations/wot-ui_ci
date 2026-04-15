import type { CIConfig, PlatformUploadResult, UploadContext } from '../types'
import { access } from 'node:fs/promises'
import process from 'node:process'
import * as ci from 'miniprogram-ci'
import { UploadError } from '../errors'
import { resolveFromCwd } from '../utils/path'

interface WeixinSubPackageInfo {
  name: string
  size: number
}

interface WeixinUploadRawResult {
  subPackageInfo?: WeixinSubPackageInfo[]
}

export async function uploadWeixin(config: CIConfig, options: UploadContext = {}): Promise<PlatformUploadResult<WeixinUploadRawResult>> {
  if (!config.weixin)
    throw new UploadError('Missing weixin config')
  if (!config.version)
    throw new UploadError('A version is required to upload Weixin mini programs')

  const cwd = options.cwd ?? process.cwd()
  const projectPath = resolveFromCwd(cwd, config.weixin.projectPath)
  const privateKeyPath = resolveFromCwd(cwd, config.weixin.privateKeyPath)

  try {
    await access(privateKeyPath)
  }
  catch (error) {
    throw new UploadError(`Weixin private key file does not exist: ${privateKeyPath}`, error)
  }

  try {
    const project = new ci.Project({
      appid: config.weixin.appid,
      ignores: config.weixin.ignores,
      privateKeyPath,
      projectPath,
      type: config.weixin.type ?? 'miniProgram',
    })
    const raw = await ci.upload({
      desc: config.desc,
      onProgressUpdate: undefined,
      project,
      robot: config.weixin.robot,
      setting: config.weixin.setting,
      version: config.version,
    }) as WeixinUploadRawResult

    return {
      desc: config.desc,
      message: createWeixinMessage(config.version, raw.subPackageInfo),
      platform: 'weixin',
      raw,
      version: config.version,
    }
  }
  catch (error) {
    throw new UploadError('Failed to upload Weixin mini program', error)
  }
}

function createWeixinMessage(version: string, packages?: WeixinSubPackageInfo[]): string {
  if (!packages?.length)
    return `Uploaded Weixin mini program ${version}`

  const fullPackage = packages.find(item => item.name === '__FULL__')
  const appPackage = packages.find(item => item.name === '__APP__')
  const parts = [`Uploaded Weixin mini program ${version}`]

  if (fullPackage)
    parts.push(`full package ${Math.round(fullPackage.size / 1024)}KB`)
  if (appPackage)
    parts.push(`main package ${Math.round(appPackage.size / 1024)}KB`)

  return parts.join(', ')
}
