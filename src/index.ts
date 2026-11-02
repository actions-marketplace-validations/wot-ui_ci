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
  PreviewError,
  PreviewUnsupportedError,
  UploadError,
  WotCIError,
} from './errors'
import { closeIde, openIde } from './ide'
import { runAlipayIde } from './ide/alipay'
import { runWeixinIde } from './ide/weixin'
import { previewAlipay, uploadAlipay } from './platforms/alipay'
import { uploadDingTalk } from './platforms/dingtalk'
import { previewWeixin, uploadWeixin } from './platforms/weixin'
import { preview, previewPlatform } from './preview'
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
  PreviewError,
  PreviewUnsupportedError,
  UploadError,
  WotCIError,
}
export {
  preview,
  previewAlipay,
  previewPlatform,
  previewWeixin,
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
  AlipayPreviewConfig,
  AlipayPreviewRawResult,
  AlipayUploadRawResult,
  AnyPreviewResult,
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
  PreviewOptions,
  PreviewQrCode,
  PreviewRequest,
  PreviewResult,
  ProjectType,
  QrCodeKind,
  UploadOptions,
  UploadRequest,
  UploadResult,
  UserConfig,
  WeixinConfig,
  WeixinIdeConfig,
  WeixinPreviewConfig,
  WeixinPreviewRawResult,
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
  PreviewError,
  PreviewUnsupportedError,
  UploadError,
  WotCIError,
  closeIde,
  compareVersion,
  defineConfig,
  loadConfig,
  normalizePlatform,
  openIde,
  preview,
  previewAlipay,
  previewPlatform,
  previewWeixin,
  runAlipayIde,
  runWeixinIde,
  upload,
  uploadAlipay,
  uploadDingTalk,
  uploadPlatform,
  uploadWeixin,
}

export default wotci
