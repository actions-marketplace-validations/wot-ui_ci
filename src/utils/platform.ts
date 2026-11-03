import type { Platform } from '../types'
import { ConfigError } from '../errors'

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
