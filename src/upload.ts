import type {
  AnyUploadResult,
  PlatformInput,
  UploadOptions,
  UploadRequest,
  WotciConfig,
} from './types'
import { loadConfig } from './config'
import { CapabilityError } from './errors'
import { uploadAlipay } from './platforms/alipay'
import { uploadDingTalk } from './platforms/dingtalk'
import { uploadWeixin } from './platforms/weixin'
import { normalizePlatform } from './utils/platform'
import { applyVersion, resolveVersion } from './version-strategy'

/** 使用已加载的配置上传到指定平台 */
export async function uploadPlatform(
  platform: PlatformInput,
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<AnyUploadResult> {
  const normalizedConfig = withLegacyAliases(config)
  const normalizedPlatform = normalizePlatform(platform)

  if (options.buildNpm && normalizedPlatform !== 'weixin')
    throw new CapabilityError('buildNpm 仅支持微信小程序')

  switch (normalizedPlatform) {
    case 'alipay':
      return uploadAlipay(normalizedConfig, options)
    case 'dingtalk':
      return uploadDingTalk(normalizedConfig, options)
    case 'weixin':
      return uploadWeixin(normalizedConfig, options)
  }
}

/** 直接调用 JS API 时也兼容 `dd` 别名 */
function withLegacyAliases(config: WotciConfig): WotciConfig {
  if (config.dingtalk || !config.dd)
    return config

  const { dd, ...rest } = config
  return { ...rest, dingtalk: dd }
}

/**
 * JS 调用入口：加载配置并上传。
 *
 * ```ts
 * const result = await upload('weixin', { cwd: process.cwd() })
 * ```
 */
export async function upload(
  platform: PlatformInput,
  request: UploadRequest = {},
): Promise<AnyUploadResult> {
  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  const resolution = await resolveVersion(loaded.config, {
    cwd: loaded.cwd,
    packageJson: loaded.packageJson,
    platforms: [normalizePlatform(platform)],
  })

  const result = await uploadPlatform(platform, applyVersion(loaded.config, resolution), { cwd: loaded.cwd })
  return { ...result, versionResolution: resolution }
}
