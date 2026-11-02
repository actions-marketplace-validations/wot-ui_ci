import {
  CONFIG_FILE_NAMES,
  defineConfig,
  LEGACY_CONFIG_FILE_NAME,
  loadConfig,
} from './config'
import {
  ConfigError,
  UploadError,
  WotCIError,
} from './errors'
import { uploadAlipay } from './platforms/alipay'
import { uploadDingTalk } from './platforms/dingtalk'
import { uploadWeixin } from './platforms/weixin'
import { normalizePlatform, upload, uploadPlatform } from './upload'
import { compareVersion } from './utils/version'

export {
  CONFIG_FILE_NAMES,
  defineConfig,
  LEGACY_CONFIG_FILE_NAME,
  loadConfig,
}
export {
  ConfigError,
  UploadError,
  WotCIError,
}
export {
  normalizePlatform,
  upload,
  uploadAlipay,
  uploadDingTalk,
  uploadPlatform,
  uploadWeixin,
}
export { compareVersion }

export type {
  AlipayClientType,
  AlipayConfig,
  AlipayUploadRawResult,
  AnyUploadResult,
  CIConfig,
  ConfigFactory,
  ConfigFactoryContext,
  ConfigSource,
  DingtalkConfig,
  DingtalkProjectType,
  DingtalkUploadRawResult,
  LoadConfigOptions,
  LoadedConfig,
  MaybePromise,
  PackageJsonLike,
  Platform,
  PlatformInput,
  ProjectType,
  UploadOptions,
  UploadRequest,
  UploadResult,
  UserConfig,
  WeixinConfig,
  WeixinSubPackageInfo,
  WeixinUploadRawResult,
  WeixinUploadSetting,
  WotciConfig,
} from './types'

const wotci = {
  CONFIG_FILE_NAMES,
  ConfigError,
  LEGACY_CONFIG_FILE_NAME,
  UploadError,
  WotCIError,
  compareVersion,
  defineConfig,
  loadConfig,
  normalizePlatform,
  upload,
  uploadAlipay,
  uploadDingTalk,
  uploadPlatform,
  uploadWeixin,
}

export default wotci
