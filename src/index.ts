import {
  CONFIG_FILE_NAMES,
  defineConfig,
  LEGACY_CONFIG_FILE_NAME,
  loadConfig,
} from './config'
import {
  ConfigError,
  IdeCommandError,
  IdeError,
  IdeNotFoundError,
  IdeUnsupportedError,
  UploadError,
  WotCIError,
} from './errors'
import { closeIde, openIde } from './ide'
import { runAlipayIde } from './ide/alipay'
import { runWeixinIde } from './ide/weixin'
import { uploadAlipay } from './platforms/alipay'
import { uploadDingTalk } from './platforms/dingtalk'
import { uploadWeixin } from './platforms/weixin'
import { upload, uploadPlatform } from './upload'
import { normalizePlatform } from './utils/platform'
import { compareVersion } from './utils/version'

export {
  CONFIG_FILE_NAMES,
  defineConfig,
  LEGACY_CONFIG_FILE_NAME,
  loadConfig,
}
export {
  ConfigError,
  IdeCommandError,
  IdeError,
  IdeNotFoundError,
  IdeUnsupportedError,
  UploadError,
  WotCIError,
}
export {
  closeIde,
  openIde,
  runAlipayIde,
  runWeixinIde,
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
  AlipayIdeConfig,
  AlipayUploadRawResult,
  AnyUploadResult,
  CIConfig,
  ConfigFactory,
  ConfigFactoryContext,
  ConfigSource,
  DingtalkConfig,
  DingtalkProjectType,
  DingtalkUploadRawResult,
  IdeAction,
  IdeOptions,
  IdePlatform,
  IdeRequest,
  IdeResult,
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
  WeixinIdeConfig,
  WeixinSubPackageInfo,
  WeixinUploadRawResult,
  WeixinUploadSetting,
  WotciConfig,
} from './types'

const wotci = {
  CONFIG_FILE_NAMES,
  ConfigError,
  IdeCommandError,
  IdeError,
  IdeNotFoundError,
  IdeUnsupportedError,
  LEGACY_CONFIG_FILE_NAME,
  UploadError,
  WotCIError,
  closeIde,
  compareVersion,
  defineConfig,
  loadConfig,
  normalizePlatform,
  openIde,
  runAlipayIde,
  runWeixinIde,
  upload,
  uploadAlipay,
  uploadDingTalk,
  uploadPlatform,
  uploadWeixin,
}

export default wotci
