import type { LoadedConfig, PlatformInput, VersionInfo, VersionMutationRequest, VersionMutationResult, VersionRequest } from './types'
import { loadConfig } from './config'
import { VersionError, VersionUnsupportedError } from './errors'
import {
  cancelAlipayExperience,
  deleteAlipayVersion,
  getAlipayLatestVersion,
  getAlipayVersionList,
  setAlipayExperience,
} from './platforms/alipay'
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

export async function setExperience(
  platform: PlatformInput,
  request: VersionMutationRequest,
): Promise<VersionMutationResult> {
  const loaded = await ensureAlipayMutation(platform, request)
  const { qrCodeUrl } = await setAlipayExperience(loaded.config, request.version, { cwd: loaded.cwd })

  return {
    action: 'set-experience',
    message: `已设置支付宝体验版：${request.version}`,
    platform: 'alipay',
    ...(qrCodeUrl ? { qrCodeUrl } : {}),
    version: request.version,
  }
}

export async function cancelExperience(
  platform: PlatformInput,
  request: VersionMutationRequest,
): Promise<VersionMutationResult> {
  const loaded = await ensureAlipayMutation(platform, request)
  await cancelAlipayExperience(loaded.config, request.version, { cwd: loaded.cwd })

  return {
    action: 'cancel-experience',
    message: `已取消支付宝体验版：${request.version}`,
    platform: 'alipay',
    version: request.version,
  }
}

export async function deleteVersion(
  platform: PlatformInput,
  request: VersionMutationRequest,
): Promise<VersionMutationResult> {
  if (!request.confirm)
    throw new VersionError('删除版本是破坏性操作，请传 confirm: true 或使用 --yes')

  const loaded = await ensureAlipayMutation(platform, request)
  await deleteAlipayVersion(loaded.config, request.version, { cwd: loaded.cwd })

  return {
    action: 'delete',
    message: `已删除支付宝版本：${request.version}`,
    platform: 'alipay',
    version: request.version,
  }
}

async function ensureAlipayMutation(
  platform: PlatformInput,
  request: VersionMutationRequest,
): Promise<LoadedConfig> {
  const normalized = normalizePlatform(platform)
  if (normalized !== 'alipay')
    throw new VersionUnsupportedError('当前仅支持支付宝体验版与版本管理')

  if (!request.version?.trim())
    throw new VersionError('必须提供 version')

  return loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })
}
