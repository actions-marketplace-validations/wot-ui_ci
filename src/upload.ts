import type { CIConfig, PlatformName, PlatformUploadResult, UploadContext } from './types'

import { uploadAlipay } from './platforms/alipay'
import { uploadDingTalk } from './platforms/dingtalk'
import { uploadWeixin } from './platforms/weixin'

export async function uploadPlatform(platform: PlatformName, config: CIConfig, options: UploadContext = {}): Promise<PlatformUploadResult> {
  switch (platform) {
    case 'alipay':
      return uploadAlipay(config, options)
    case 'dingtalk':
      return uploadDingTalk(config, options)
    case 'weixin':
      return uploadWeixin(config, options)
  }
}
