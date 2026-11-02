import type { UploadOptions, UploadResult, WeixinSubPackageInfo, WeixinUploadRawResult, WotciConfig } from '../types'
import { access } from 'node:fs/promises'
import process from 'node:process'
import * as weixinCIModule from 'miniprogram-ci'
import { UploadError } from '../errors'
import { appendDesc } from '../messages'
import { isDirectory, resolveFromCwd } from '../utils/path'

type WeixinCI = typeof import('miniprogram-ci')

/** Node 对 CJS 包同时提供命名导出与 default 导出，两种形态都兼容 */
function resolveWeixinCI(): Pick<WeixinCI, 'Project' | 'upload'> {
  const candidates: unknown[] = [
    weixinCIModule,
    (weixinCIModule as { default?: unknown }).default,
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object')
      continue

    const value = candidate as Partial<WeixinCI>
    if (typeof value.Project === 'function' && typeof value.upload === 'function')
      return { Project: value.Project, upload: value.upload }
  }

  throw new UploadError('miniprogram-ci 导出格式不受支持')
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

    return {
      desc: config.desc,
      message: createWeixinMessage(config.version, raw?.subPackageInfo, config.desc),
      platform: 'weixin',
      raw: raw ?? {},
      version: config.version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('微信小程序上传失败', error)
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
