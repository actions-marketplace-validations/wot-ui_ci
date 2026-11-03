import type { PlatformInput, VersionInfo, VersionRequest } from './types'
import { loadConfig } from './config'
import { VersionUnsupportedError } from './errors'
import { getAlipayLatestVersion, getAlipayVersionList } from './platforms/alipay'
import { getWeixinLatestVersion } from './platforms/weixin'
import { normalizePlatform } from './utils/platform'

/** 查询平台线上最新版本；钉钉不支持 */
export async function getLatestVersion(
  platform: PlatformInput,
  request: VersionRequest = {},
): Promise<VersionInfo> {
  const normalized = normalizePlatform(platform)
  if (normalized === 'dingtalk')
    throw new VersionUnsupportedError('钉钉小程序未提供线上版本查询能力')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  if (normalized === 'weixin') {
    const info = await getWeixinLatestVersion(loaded.config, { cwd: loaded.cwd })
    return { platform: 'weixin', ...info }
  }

  const latest = await getAlipayLatestVersion(loaded.config, { cwd: loaded.cwd })
  return { platform: 'alipay', ...(latest ? { latest } : {}) }
}

/** 查询版本列表；目前仅支付宝支持 */
export async function getVersionList(
  platform: PlatformInput,
  request: VersionRequest = {},
): Promise<VersionInfo> {
  const normalized = normalizePlatform(platform)
  if (normalized !== 'alipay')
    throw new VersionUnsupportedError('当前仅支持查询支付宝版本列表')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })
  const versions = await getAlipayVersionList(loaded.config, { cwd: loaded.cwd })

  return { platform: 'alipay', versions }
}
