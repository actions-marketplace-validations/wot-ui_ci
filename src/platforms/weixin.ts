import type { CIConfig, PlatformUploadResult, UploadContext } from '../types'
import { access } from 'node:fs/promises'
import process from 'node:process'
import * as ci from 'miniprogram-ci'
import { UploadError } from '../errors'
import { appendDesc } from '../messages'
import { resolveFromCwd } from '../utils/path'

interface WeixinSubPackageInfo {
  name: string
  size: number
}

interface WeixinUploadRawResult {
  subPackageInfo?: WeixinSubPackageInfo[]
}

type WeixinCIProjectConstructor = typeof ci.Project
type WeixinCIUpload = typeof ci.upload

interface WeixinCIModule {
  Project?: WeixinCIProjectConstructor
  upload?: WeixinCIUpload
  default?: {
    Project?: WeixinCIProjectConstructor
    upload?: WeixinCIUpload
  }
}

function resolveWeixinCI(module: WeixinCIModule): {
  Project: WeixinCIProjectConstructor
  upload: WeixinCIUpload
} {
  const Project = module.Project ?? module.default?.Project
  const upload = module.upload ?? module.default?.upload

  if (typeof Project !== 'function' || typeof upload !== 'function')
    throw new TypeError('miniprogram-ci 导出格式不受支持')

  return { Project, upload }
}

export async function uploadWeixin(config: CIConfig, options: UploadContext = {}): Promise<PlatformUploadResult<WeixinUploadRawResult>> {
  if (!config.weixin)
    throw new UploadError('缺少微信小程序上传配置（weixin）')
  if (!config.version)
    throw new UploadError('微信小程序上传需要提供 version')

  const cwd = options.cwd ?? process.cwd()
  const projectPath = resolveFromCwd(cwd, config.weixin.projectPath)
  const privateKeyPath = resolveFromCwd(cwd, config.weixin.privateKeyPath)

  try {
    await access(privateKeyPath)
  }
  catch (error) {
    throw new UploadError(`微信私钥文件不存在：${privateKeyPath}`, error)
  }

  try {
    const { Project, upload } = resolveWeixinCI(ci)
    const project = new Project({
      appid: config.weixin.appid,
      ignores: config.weixin.ignores,
      privateKeyPath,
      projectPath,
      type: config.weixin.type ?? 'miniProgram',
    })
    const raw = await upload({
      desc: config.desc,
      onProgressUpdate: undefined,
      project,
      robot: config.weixin.robot,
      setting: config.weixin.setting,
      version: config.version,
    }) as WeixinUploadRawResult

    return {
      desc: config.desc,
      message: createWeixinMessage(config.version, raw.subPackageInfo, config.desc),
      platform: 'weixin',
      raw,
      version: config.version,
    }
  }
  catch (error) {
    throw new UploadError('微信小程序上传失败', error)
  }
}

function createWeixinMessage(version: string, packages?: WeixinSubPackageInfo[], desc?: string): string {
  if (!packages?.length)
    return appendDesc(`微信小程序上传成功，版本：${version}`, desc)

  const fullPackage = packages.find(item => item.name === '__FULL__')
  const appPackage = packages.find(item => item.name === '__APP__')
  const parts = [`微信小程序上传成功，版本：${version}`]

  if (fullPackage)
    parts.push(`总代码包：${Math.round(fullPackage.size / 1024)}KB`)
  if (appPackage)
    parts.push(`主包：${Math.round(appPackage.size / 1024)}KB`)

  return appendDesc(parts.join('，'), desc)
}
