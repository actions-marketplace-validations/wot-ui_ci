import type {
  AnyPreviewResult,
  PlatformInput,
  PreviewOptions,
  PreviewRequest,
  WotciConfig,
} from './types'
import { loadConfig } from './config'
import { PreviewUnsupportedError } from './errors'
import { previewAlipay } from './platforms/alipay'
import { previewWeixin } from './platforms/weixin'
import { normalizePlatform } from './utils/platform'

/** 使用已加载的配置预览指定平台 */
export async function previewPlatform(
  platform: PlatformInput,
  config: WotciConfig,
  options: PreviewOptions = {},
): Promise<AnyPreviewResult> {
  switch (normalizePlatform(platform)) {
    case 'alipay':
      return previewAlipay(config, options)
    case 'weixin':
      return previewWeixin(config, options)
    case 'dingtalk':
      throw new PreviewUnsupportedError('钉钉小程序暂不支持预览二维码，SDK 未暴露 preview 能力')
  }
}

/**
 * JS 调用入口：加载配置并生成预览二维码。
 *
 * ```ts
 * const result = await preview('weixin', { cwd: process.cwd() })
 * ```
 */
export async function preview(
  platform: PlatformInput,
  request: PreviewRequest = {},
): Promise<AnyPreviewResult> {
  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  return previewPlatform(platform, loaded.config, { ...request, cwd: loaded.cwd })
}
