import {
  CONFIG_FILE_NAMES,
  defineConfig,
  loadConfig,
} from './config'
import {
  ConfigError,
  UniMiniCIError,
  UploadError,
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
  UniMiniCIError,
  UploadError,
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
export type * from './types'
export {
  uploadPlatform,
}
export {
  compareVersion,
}

const minici = {
  CONFIG_FILE_NAMES,
  ConfigError,
  UniMiniCIError,
  UploadError,
  compareVersion,
  defineConfig,
  loadConfig,
  uploadAlipay,
  uploadDingTalk,
  uploadPlatform,
  uploadWeixin,
}

export default minici
