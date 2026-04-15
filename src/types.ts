export type ProjectType = 'miniProgram' | 'miniGame' | 'miniProgramPlugin' | 'miniGamePlugin'

export interface WeixinUploadSetting {
  useProjectConfig?: boolean
  es6?: boolean
  es7?: boolean
  disableUseStrict?: boolean
  minifyJS?: boolean
  minifyWXML?: boolean
  minifyWXSS?: boolean
  minify?: boolean
  codeProtect?: boolean
  autoPrefixWXSS?: boolean
  compileWorklet?: boolean
  [key: string]: unknown
}

export interface WeixinConfig {
  projectPath: string
  appid: string
  privateKeyPath: string
  type?: ProjectType
  ignores?: string[]
  robot?: number
  setting?: WeixinUploadSetting
}

export type AlipayClientType
  = | 'alipay'
    | 'ampe'
    | 'amap'
    | 'genie'
    | 'alios'
    | 'uc'
    | 'quark'
    | 'koubei'
    | 'alipayiot'
    | 'cainiao'
    | 'alihealth'
    | 'health'

interface AlipayBaseConfig {
  projectPath: string
  appid: string
  toolId: string
  clientType?: AlipayClientType
  autoincrement?: boolean
}

type AlipayCredential
  = {
    privateKey: string
    privateKeyPath?: string
  }
  | {
    privateKey?: undefined
    privateKeyPath: string
  }

export type AlipayConfig = AlipayBaseConfig & AlipayCredential

export type DingtalkProjectType
  = | 'dingtalk-personal'
    | 'dingtalk-biz-isv'
    | 'dingtalk-biz'
    | 'dingtalk-biz-custom'
    | 'dingtalk-biz-worktab-plugin'

export interface DingtalkConfig {
  projectPath: string
  appid: string
  token: string
  projectType?: DingtalkProjectType
  autoincrement?: boolean
}

export interface CIConfig {
  version?: string
  desc?: string
  weixin?: WeixinConfig
  alipay?: AlipayConfig
  /** @deprecated Use dingtalk instead. Kept for legacy .minicirc compatibility. */
  dd?: DingtalkConfig
  dingtalk?: DingtalkConfig
}

export interface PackageJsonConfig {
  description?: string
  minici?: CIConfig
  version?: string
}

export interface ConfigFactoryContext {
  cwd: string
  env: NodeJS.ProcessEnv
  packageJson?: PackageJsonConfig
}

export type MaybePromise<T> = T | Promise<T>

export type ConfigFactory = (context: ConfigFactoryContext) => MaybePromise<CIConfig>

export type UserConfig = CIConfig | ConfigFactory

export type ConfigSource = 'inline' | 'js' | 'minicirc' | 'package-json' | 'defaults'

export interface LoadConfigOptions {
  cwd?: string
  config?: UserConfig
  configFile?: string
}

export interface LoadedConfig {
  config: CIConfig
  cwd: string
  source: ConfigSource
  sourceFile?: string
  packageJson?: PackageJsonConfig
}

export type PlatformName = 'weixin' | 'alipay' | 'dingtalk'

export interface UploadContext {
  cwd?: string
}

export interface PlatformUploadResult<TRaw = unknown> {
  platform: PlatformName
  version: string
  desc?: string
  message: string
  raw: TRaw
}
