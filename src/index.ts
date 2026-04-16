import {
  CONFIG_FILE_NAMES,
  defineConfig,
  loadConfig,
} from './config'
import {
  ConfigError,
  UploadError,
  WotCIError,
} from './errors'
import {
  uploadAlipay,
} from './platforms/alipay'
import {
  uploadDingTalk,
} from './platforms/dingtalk'
import {
  uploadWeixin,
} from './platforms/weixin'
import {
  uploadPlatform,
} from './upload'
import {
  compareVersion,
} from './utils/version'

export {
  CONFIG_FILE_NAMES,
  defineConfig,
  loadConfig,
}
export {
  ConfigError,
  UploadError,
  WotCIError,
}
export {
  uploadAlipay,
}
export {
  uploadDingTalk,
}
export {
  uploadWeixin,
}
export type {
  AlipayClientType,
  AlipayConfig,
  CIConfig,
  ConfigFactory,
  ConfigFactoryContext,
  ConfigSource,
  DingtalkConfig,
  DingtalkProjectType,
  LoadConfigOptions,
  LoadedConfig,
  MaybePromise,
  PackageJsonConfig,
  PlatformName,
  PlatformUploadResult,
  ProjectType,
  UploadContext,
  UserConfig,
  WeixinConfig,
  WeixinUploadSetting,
} from './types'
export {
  uploadPlatform,
}
export {
  compareVersion,
}

const wotci = {
  CONFIG_FILE_NAMES,
  ConfigError,
  WotCIError,
  UploadError,
  compareVersion,
  defineConfig,
  loadConfig,
  uploadAlipay,
  uploadDingTalk,
  uploadPlatform,
  uploadWeixin,
}

export default wotci
