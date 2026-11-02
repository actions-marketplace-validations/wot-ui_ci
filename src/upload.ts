import type {
  AnyUploadResult,
  Platform,
  PlatformInput,
  UploadOptions,
  UploadRequest,
  WotciConfig,
} from './types'
import { loadConfig } from './config'
import { ConfigError } from './errors'
import { uploadAlipay } from './platforms/alipay'
import { uploadDingTalk } from './platforms/dingtalk'
import { uploadWeixin } from './platforms/weixin'

const PLATFORM_ALIASES: Record<string, Platform> = {
  dd: 'dingtalk',
  alipay: 'alipay',
  dingtalk: 'dingtalk',
  weixin: 'weixin',
}

/** 归一化平台名称，`dd` 会转换为 `dingtalk` */
export function normalizePlatform(platform: string): Platform {
  const normalized = PLATFORM_ALIASES[platform]
  if (!normalized)
    throw new ConfigError(`不支持的平台：${platform}`)
  return normalized
}

/** 使用已加载的配置上传到指定平台 */
export async function uploadPlatform(
  platform: PlatformInput,
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<AnyUploadResult> {
  const normalizedConfig = withLegacyAliases(config)

  switch (normalizePlatform(platform)) {
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

  return uploadPlatform(platform, loaded.config, { cwd: loaded.cwd })
}
