/** 上传平台 */
export type Platform = 'weixin' | 'alipay' | 'dingtalk'

/** 允许传入的平台名称，`dd` 为钉钉的历史别名 */
export type PlatformInput = Platform | 'dd'

/** 微信小程序类型 */
export type ProjectType = 'miniProgram' | 'miniGame' | 'miniProgramPlugin' | 'miniGamePlugin'

/** 微信小程序上传编译设置，字段透传给 miniprogram-ci */
export interface WeixinUploadSetting {
  /** 使用项目 project.config.json 中的设置 */
  useProjectConfig?: boolean
  /** 对应微信开发者工具的「es6 转 es5」 */
  es6?: boolean
  /** 对应微信开发者工具的「增强编译」 */
  es7?: boolean
  /** 「增强编译」开启时是否禁用 JS 文件严格模式 */
  disableUseStrict?: boolean
  /** 上传时压缩 JS 代码 */
  minifyJS?: boolean
  /** 上传时压缩 WXML 代码 */
  minifyWXML?: boolean
  /** 上传时压缩 WXSS 代码 */
  minifyWXSS?: boolean
  /** 上传时压缩所有代码 */
  minify?: boolean
  /** 上传时进行代码保护 */
  codeProtect?: boolean
  /** 上传时样式自动补全 */
  autoPrefixWXSS?: boolean
  /** 编译 worklet */
  compileWorklet?: boolean
  [key: string]: unknown
}

/** 微信小程序配置 */
export interface WeixinConfig {
  /** 小程序产物目录，相对路径基于 cwd 解析 */
  projectPath: string
  /** 小程序 / 小游戏 appid */
  appid: string
  /** 代码上传密钥文件路径，相对路径基于 cwd 解析 */
  privateKeyPath: string
  /** 项目类型，默认 miniProgram */
  type?: ProjectType
  /** 上传时排除的目录或文件 */
  ignores?: string[]
  /** CI 机器人编号，1 ~ 30 */
  robot?: number
  /** 上传编译设置 */
  setting?: WeixinUploadSetting
}

/** 支付宝小程序终端类型 */
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

/** 支付宝小程序配置 */
export interface AlipayConfig {
  /** 小程序产物目录，相对路径基于 cwd 解析 */
  projectPath: string
  /** 小程序 appid */
  appid: string
  /** 开放平台工具 ID */
  toolId: string
  /** 私钥文本内容，与 privateKeyPath 二选一 */
  privateKey?: string
  /** 私钥文件路径，与 privateKey 二选一 */
  privateKeyPath?: string
  /** 上传终端类型，默认 alipay */
  clientType?: AlipayClientType
  /** 是否由平台自动递增版本号，默认 false */
  autoincrement?: boolean
}

/** 钉钉小程序类型 */
export type DingtalkProjectType
  = | 'dingtalk-personal'
    | 'dingtalk-biz-isv'
    | 'dingtalk-biz'
    | 'dingtalk-biz-custom'
    | 'dingtalk-biz-worktab-plugin'

/** 钉钉小程序配置 */
export interface DingtalkConfig {
  /** 小程序产物目录，相对路径基于 cwd 解析 */
  projectPath: string
  /** 开放平台 MiniAppId */
  appid: string
  /** 开放平台 API Token */
  token: string
  /** 应用类型，当前仅保留字段，上传实现未使用 */
  projectType?: DingtalkProjectType
  /** 是否由平台自动递增版本号，默认 false */
  autoincrement?: boolean
}

/** 配置文件内容 */
export interface WotciConfig {
  /** 上传版本号，缺省时读取 package.json 的 version */
  version?: string
  /** 上传描述，缺省时读取 package.json 的 description */
  desc?: string
  /** 微信小程序配置 */
  weixin?: WeixinConfig
  /** 支付宝小程序配置 */
  alipay?: AlipayConfig
  /** 钉钉小程序配置 */
  dingtalk?: DingtalkConfig
  /** @deprecated 钉钉配置的历史别名，请使用 dingtalk */
  dd?: DingtalkConfig
}

/** @deprecated 请使用 WotciConfig */
export type CIConfig = WotciConfig

/** 读取到的 package.json 中与配置相关的字段 */
export interface PackageJsonLike {
  'name'?: string
  'version'?: string
  'description'?: string
  'wotci'?: unknown
  'uni-mini-ci'?: unknown
}

/** 配置工厂上下文 */
export interface ConfigFactoryContext {
  /** 配置解析目录 */
  cwd: string
  /** 当前进程环境变量 */
  env: NodeJS.ProcessEnv
  /** 当前目录下的 package.json */
  packageJson?: PackageJsonLike
}

export type MaybePromise<T> = T | Promise<T>

export type ConfigFactory = (context: ConfigFactoryContext) => MaybePromise<WotciConfig>

export type UserConfig = WotciConfig | ConfigFactory

/** 配置来源 */
export type ConfigSource = 'inline' | 'file' | 'package-json' | 'minicirc' | 'defaults'

export interface LoadConfigOptions {
  /** 配置解析目录，默认 process.cwd() */
  cwd?: string
  /** 内联配置，优先级最高 */
  config?: UserConfig
  /** 显式指定的配置文件，相对路径基于 cwd 解析 */
  configFile?: string
}

export interface LoadedConfig {
  config: WotciConfig
  cwd: string
  source: ConfigSource
  /** 当 source 为 file 或 minicirc 时的文件路径 */
  sourceFile?: string
  packageJson?: PackageJsonLike
}

/** 单个平台上传的通用选项 */
export interface UploadOptions {
  /** 相对路径的解析目录，默认 process.cwd() */
  cwd?: string
}

/** JS 调用入口的选项 */
export interface UploadRequest extends UploadOptions {
  /** 内联配置，传入后不再读取配置文件 */
  config?: UserConfig
  /** 显式指定的配置文件 */
  configFile?: string
}

/** 微信上传的原始返回 */
export interface WeixinSubPackageInfo {
  name: string
  size: number
}

export interface WeixinUploadRawResult {
  subPackageInfo?: WeixinSubPackageInfo[]
}

/** 支付宝上传的原始返回 */
export interface AlipayUploadRawResult {
  version?: string
}

/** 钉钉上传的原始返回 */
export interface DingtalkUploadRawResult {
  packageVersion?: string
}

/** 单平台上传结果 */
export interface UploadResult<TPlatform extends Platform = Platform, TRaw = unknown> {
  platform: TPlatform
  version: string
  desc?: string
  /** 面向用户的一行结果描述 */
  message: string
  /** SDK 原始返回值 */
  raw: TRaw
}

export type AnyUploadResult
  = | UploadResult<'weixin', WeixinUploadRawResult>
    | UploadResult<'alipay', AlipayUploadRawResult>
    | UploadResult<'dingtalk', DingtalkUploadRawResult>
