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

/** 微信小程序预览配置 */
export interface WeixinPreviewConfig {
  /** 二维码格式，默认 image */
  qrcodeFormat?: 'terminal' | 'image' | 'base64'
  /** 二维码输出路径；image / base64 时必填，缺省写入 .wotci/preview */
  qrcodeOutputDest?: string
  /** 预览页面路径 */
  pagePath?: string
  /** 预览页面启动参数 */
  searchQuery?: string
  /** 场景值 */
  scene?: number
  /** 预览备注 */
  desc?: string
  /** 指定 CI 机器人，1 ~ 30 */
  robot?: number
  /** 预览编译设置 */
  setting?: WeixinUploadSetting
  /** 本地编译线程数 */
  threads?: number
  /** 预览时主包、分包体积上限调整为 4M */
  bigPackageSizeSupport?: boolean
}

/** 微信开发者工具配置 */
export interface WeixinIdeConfig {
  /** 微信开发者工具 CLI 路径，缺省时自动探测 */
  cliPath?: string
  /** IDE HTTP server 端口，对应 CLI 的 --port */
  port?: number
  /** IDE 语言，对应 CLI 的 --lang */
  lang?: 'zh' | 'en'
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
  /** 开发者工具相关配置 */
  ide?: WeixinIdeConfig
  /** 预览配置 */
  preview?: WeixinPreviewConfig
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

/** 支付宝小程序预览配置 */
export interface AlipayPreviewConfig {
  /** 预览页面路径 */
  page?: string
  /** 页面参数 */
  pageQuery?: string
  /** 全局启动参数 */
  query?: string
  /** 场景值 */
  scene?: string
  /** 是否自动推送到客户端 */
  autoPush?: boolean
  /** 忽略 HTTP 请求白名单校验 */
  ignoreHttpDomainCheck?: boolean
  /** 忽略 WebView 域名白名单校验 */
  ignoreWebViewDomainCheck?: boolean
}

/** 支付宝开发者工具配置 */
export interface AlipayIdeConfig {
  /** 支付宝小程序开发者工具安装路径 */
  appPath?: string
}

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
  /** 开发者工具相关配置 */
  ide?: AlipayIdeConfig
  /** 预览配置 */
  preview?: AlipayPreviewConfig
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
  /** release 编排配置 */
  release?: ReleaseConfig
  /** 包体积预算，仅微信可计算 */
  budgets?: BudgetConfig
  /** 版本号策略，不会修改 package.json */
  versionStrategy?: VersionStrategy
}

/** 包体积预算，仅微信 result.sizes 可用 */
export interface BudgetConfig {
  /** 总包上限，如 '3MB' 或字节数 */
  total?: string | number
  /** 主包上限，如 '1.5MB' 或字节数 */
  main?: string | number
  /** 超限只告警，不判定失败 */
  warnOnly?: boolean
}

export interface BudgetViolation {
  metric: 'total' | 'main'
  limit: number
  actual: number
}

export interface BudgetReport {
  ok: boolean
  warnOnly: boolean
  violations: BudgetViolation[]
}

export type VersionBump = 'major' | 'minor' | 'patch'

/** 版本号策略 */
export type VersionStrategy
  = | { type: 'fixed', version?: string }
    | { type: 'package' }
    | { type: 'auto', bump: VersionBump, strict?: boolean }

/** 支付宝版本列表项 */
export interface VersionRecord {
  version: string
  description?: string
  status?: string
  createTime?: string
  operator?: string
}

/** 版本查询结果 */
export interface VersionInfo {
  platform: Platform
  latest?: string
  grayReleaseVersion?: string
  versions?: VersionRecord[]
}

/** release 编排配置 */
export interface ReleaseConfig {
  /** 上传前执行的构建命令，字符串或按顺序执行的命令数组 */
  buildCommand?: string | string[]
  /** 参与 release 的平台，缺省为配置中已配置的平台 */
  platforms?: Platform[]
  /** 是否写入发布历史，默认 true */
  history?: boolean
  /** 历史文件路径，默认 .wotci/history.json */
  historyFile?: string
  /** 历史保留条数，默认 50 */
  historyLimit?: number
  /** 是否评论 PR：true 总是尝试，false 关闭，auto 在 GitHub Actions 中自动 */
  prComment?: boolean | 'auto'
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
  /** 上传/预览前先执行微信「构建 npm」（packNpm），仅微信支持 */
  buildNpm?: boolean
}

/** 支持 IDE 操作的平台 */
export type IdePlatform = Exclude<Platform, 'dingtalk'>

export type IdeAction = 'open' | 'auto' | 'close' | 'quit'

/** IDE 操作选项 */
export interface IdeOptions extends UploadOptions {
  /** 只打印将要执行的命令，不真正启动 IDE */
  dryRun?: boolean
  /** CI 环境下显式允许启动 GUI */
  force?: boolean
  /** IDE 语言 */
  lang?: 'zh' | 'en'
  /** IDE HTTP server 端口 */
  port?: number
  /** close 时退出整个 IDE，而不是只关闭项目 */
  quit?: boolean
  /** auto 时信任当前项目 */
  trustProject?: boolean
  /** auto 时使用的 ticket */
  ticket?: string
}

/** IDE 操作结果 */
export interface IdeResult {
  platform: IdePlatform
  action: IdeAction
  projectPath: string
  executed: boolean
  /** 实际执行或将要执行的命令 */
  command?: string
  args?: string[]
  message: string
  stdout?: string
}

/** JS 调用入口的 IDE 选项 */
/** IDE 状态查询结果 */
export interface IdeStatusResult {
  platform: IdePlatform
  /** CLI 是否可用 */
  installed: boolean
  /** 探测到的 CLI 路径 */
  cliPath?: string
  /** 登录状态，无法判断时为 undefined */
  loggedIn?: boolean
  /** IDE 是否在运行，当前仅微信可能返回 */
  running?: boolean
  message: string
  stdout?: string
}

/** IDE 侧预览选项 */
export interface IdePreviewOptions extends IdeOptions {
  /** 二维码格式 */
  qrFormat?: 'terminal' | 'image' | 'base64'
  /** 二维码输出路径 */
  qrOutput?: string
  /** IDE CLI 的 info-output 路径 */
  infoOutput?: string
}

/** IDE 侧预览结果 */
export interface IdePreviewResult {
  platform: IdePlatform
  executed: boolean
  qrCode?: PreviewQrCode
  infoPath?: string
  message: string
  stdout?: string
}

export interface IdePreviewRequest extends IdePreviewOptions {
  /** 内联配置，传入后不再读取配置文件 */
  config?: UserConfig
  /** 显式指定的配置文件 */
  configFile?: string
}

export interface IdeRequest extends IdeOptions {
  /** 内联配置，传入后不再读取配置文件 */
  config?: UserConfig
  /** 显式指定的配置文件 */
  configFile?: string
}

/** release 构建结果 */
export interface ReleaseBuildResult {
  /** 实际执行的构建命令 */
  commands: string[]
  skipped: boolean
  ok: boolean
  durationMs: number
  error?: {
    code: string
    message: string
    cause?: string[]
  }
}

/** release 中单个平台的结果 */
export interface ReleasePlatformResult {
  platform: Platform
  ok: boolean
  version?: string
  sizes?: {
    total?: number
    main?: number
  }
  budget?: BudgetReport
  trend?: {
    previousTotal?: number
    previousMain?: number
    deltaTotal?: number
    deltaMain?: number
  }
  message: string
  durationMs: number
  error?: {
    code: string
    message: string
    cause?: string[]
  }
}

/** 发布历史里的 git 信息 */
export interface ReleaseGitInfo {
  branch?: string
  commit?: string
  tag?: string
}

/** release 结果 */
export interface ReleaseResult {
  /** 本次上传的版本解析依据 */
  versionResolution?: VersionResolution
  ok: boolean
  dryRun: boolean
  version?: string
  desc?: string
  build: ReleaseBuildResult
  platforms: ReleasePlatformResult[]
  durationMs: number
  historyFile?: string
  historyError?: string
  commentUrl?: string
  commentError?: string
  git?: ReleaseGitInfo
}

/** release 请求 */
export interface ReleaseRequest extends UploadOptions {
  /** 内联配置，传入后不再读取配置文件 */
  config?: UserConfig
  /** 显式指定的配置文件 */
  configFile?: string
  /** 覆盖构建命令 */
  buildCommand?: string | string[]
  /** 跳过构建 */
  skipBuild?: boolean
  /** 参与 release 的平台，缺省读取配置 */
  platforms?: PlatformInput[]
  /** 只输出计划，不执行构建/上传/历史/评论 */
  dryRun?: boolean
  /** 是否写历史，覆盖配置 */
  history?: boolean
  /** 历史文件路径，覆盖配置 */
  historyFile?: string
  /** 是否评论 PR，覆盖配置 */
  prComment?: boolean | 'auto'
}

/** 发布历史单条记录 */
export interface ReleaseHistoryRecord {
  /** 旧历史记录可能不含此字段 */
  versionResolution?: VersionResolution
  id: string
  createdAt: string
  version?: string
  desc?: string
  ok: boolean
  durationMs: number
  build: ReleaseBuildResult
  platforms: ReleasePlatformResult[]
  git?: ReleaseGitInfo
}

/** 序列化后的错误 */
export interface SerializedError {
  code: string
  message: string
  cause?: string[]
}

/** 批量执行中单个平台的结果 */
export interface BatchItemResult<T = unknown> {
  platform: Platform
  ok: boolean
  durationMs: number
  result?: T
  error?: SerializedError
}

/** 批量执行结果 */
export interface BatchResult<T = unknown> {
  /** 上传的共享版本解析依据；预览不解析版本策略 */
  versionResolution?: VersionResolution
  ok: boolean
  dryRun: boolean
  durationMs: number
  results: Array<BatchItemResult<T>>
}

export type DoctorStatus = 'ok' | 'warn' | 'error'

export interface DoctorCheck {
  id: string
  title: string
  status: DoctorStatus
  message?: string
  details?: string[]
}

export interface DoctorResult {
  ok: boolean
  checks: DoctorCheck[]
}

/** init 请求 */
export interface InitOptions extends UploadOptions {
  /** 目标配置文件，默认 wotci.config.ts */
  configFile?: string
  /** 生成的平台，缺省自动探测产物目录 */
  platforms?: PlatformInput[]
  /** 覆盖已有文件 */
  force?: boolean
  /** 只输出内容，不写文件 */
  dryRun?: boolean
}

export interface InitResult {
  file: string
  content: string
  platforms: Platform[]
  written: boolean
}

/** 微信构建/诊断请求 */
export interface WeixinDiagnosticRequest extends UploadOptions {
  /** 内联配置，传入后不再读取配置文件 */
  config?: UserConfig
  /** 显式指定的配置文件 */
  configFile?: string
}

/** 微信「构建 npm」请求 */
export interface WeixinBuildNpmRequest extends WeixinDiagnosticRequest {
  /** 覆盖 packNpm 的忽略规则 */
  ignores?: string[]
}

/** 微信 SourceMap 下载请求 */
export interface WeixinSourceMapRequest extends WeixinDiagnosticRequest {
  /** 保存路径，默认 .wotci/weixin/sourcemap.zip */
  output?: string
  /** CI 机器人编号，默认取配置或 1 */
  robot?: number
  /** 使用流式下载 */
  streaming?: boolean
}

/** 微信编译产物导出请求 */
export interface WeixinCompiledResultRequest extends WeixinDiagnosticRequest {
  /** 保存路径，默认 .wotci/weixin/compiled.zip */
  output?: string
  /** CI 机器人编号，默认取配置 */
  robot?: number
}

/** 微信代码质量检查请求 */
export interface WeixinQualityRequest extends WeixinDiagnosticRequest {
  /** 检查结果 JSON 输出路径，不传则只返回结果 */
  output?: string
}

/** 微信「构建 npm」结果 */
export interface WeixinBuildNpmResult {
  platform: 'weixin'
  warnings: WeixinWarning[]
  message: string
}

/** SourceMap / 编译产物导出结果 */
export interface WeixinDiagnosticResult {
  platform: 'weixin'
  outputPath: string
  message: string
}

/** 微信代码质量检查项 */
export interface WeixinQualityCheck {
  name: string
  success: boolean
  text?: string
  docURL?: string
  detail?: unknown
}

/** 微信代码质量检查结果 */
export interface WeixinQualityResult {
  platform: 'weixin'
  /** 检查项总数 */
  checks: number
  /** 未通过的检查项 */
  issues: WeixinQualityCheck[]
  /** 是否全部通过 */
  ok: boolean
  outputPath?: string
  message: string
}

/** 版本/体验版操作请求 */
export interface VersionMutationRequest extends VersionRequest {
  version: string
  /** 删除版本等破坏性操作必须显式确认 */
  confirm?: boolean
}

export interface VersionMutationResult {
  platform: 'alipay'
  action: 'set-experience' | 'cancel-experience' | 'delete'
  version: string
  qrCodeUrl?: string
  message: string
}

/** doctor 请求 */
export interface DoctorRequest extends UploadOptions {
  config?: UserConfig
  configFile?: string
  /** 执行网络校验（版本查询 / key + IP 白名单） */
  network?: boolean
}

/** 单个平台的自动版本查询状态；不包含 SDK 原始错误或凭据 */
export interface VersionQueryResult {
  platform: Platform
  status: 'success' | 'failed' | 'unsupported' | 'empty' | 'invalid' | 'skipped'
  version?: string
}

/** 版本策略解析结果，新增字段可选以兼容既有调用方 */
export interface VersionResolution {
  version?: string
  /** 策略名称，保留原有语义；实际基础版本来源见 baseSource */
  source: 'fixed' | 'package' | 'auto' | 'none'
  baseVersion?: string
  baseSource?: 'platform' | 'package' | 'config' | 'none'
  queries?: VersionQueryResult[]
  /** 自动版本未获得所有目标的有效线上版本，包含离线 dry-run */
  tentative?: boolean
  warnings?: string[]
}

/** 版本查询请求 */
export interface VersionRequest extends UploadOptions {
  /** 内联配置，传入后不再读取配置文件 */
  config?: UserConfig
  /** 显式指定的配置文件 */
  configFile?: string
}

/** 批量执行请求 */
export interface BatchRequest extends UploadRequest, PreviewOptions {
  /** 目标平台，缺省使用配置中已配置的平台 */
  platforms?: PlatformInput[]
  /** 并发数，默认 1（串行） */
  concurrency?: number
  /** 只校验并输出计划 */
  dryRun?: boolean
  /** JSON 模式下把 SDK 写到 stdout 的日志转 stderr */
  redirectStdoutToStderr?: boolean
}

/** 单个校验项 */
export interface PlatformPlanCheck {
  name: string
  ok: boolean
  message?: string
}

/** dry-run 计划 */
export interface PlatformPlan {
  platform: Platform
  action: 'upload' | 'preview'
  ok: boolean
  checks: PlatformPlanCheck[]
  version?: string
  projectPath?: string
  qrOutput?: string
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

/** 微信 packNpm / 编译警告 */
export interface WeixinWarning {
  /** 警告说明 */
  msg?: string
  /** 警告码 */
  code?: string | number
  /** 相关文件 */
  jsPath?: string
  startLine?: number
  endLine?: number
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
  /** 高层 upload API 的版本解析依据；底层 uploadPlatform 不执行策略 */
  versionResolution?: VersionResolution
  platform: TPlatform
  version: string
  desc?: string
  /** 面向用户的一行结果描述 */
  message: string
  /** 微信包体积，单位字节 */
  sizes?: {
    total?: number
    main?: number
  }
  /** 包体积预算检查结果 */
  budget?: BudgetReport
  /** 上传前「构建 npm」产生的警告，仅微信 */
  npmWarnings?: WeixinWarning[]
  /** SDK 原始返回值 */
  raw: TRaw
}

export type AnyUploadResult
  = | UploadResult<'weixin', WeixinUploadRawResult>
    | UploadResult<'alipay', AlipayUploadRawResult>
    | UploadResult<'dingtalk', DingtalkUploadRawResult>

/** 微信预览的原始返回 */
export interface WeixinPreviewRawResult {
  subPackageInfo?: WeixinSubPackageInfo[]
  pluginInfo?: Array<{
    pluginProviderAppid: string
    version: string
    size: number
  }>
}

/** 支付宝预览的原始返回 */
export interface AlipayPreviewRawResult {
  qrcodeUrl: string
  qrcodeSchema?: string
  version?: string
}

/** 二维码类型 */
export type QrCodeKind = 'file' | 'url' | 'terminal' | 'base64'

export interface PreviewQrCode {
  kind: QrCodeKind
  /** file 时为本地路径；url 时为二维码链接；base64 时为内容；terminal 时为空字符串 */
  value: string
  /** file / base64 写入的本地路径 */
  path?: string
  /** 支付宝远程二维码链接 */
  url?: string
}

/** 单平台预览结果 */
export interface PreviewResult<TPlatform extends Platform = Platform, TRaw = unknown> {
  platform: TPlatform
  version?: string
  desc?: string
  qrCode: PreviewQrCode
  /** 面向用户的一行结果描述 */
  message: string
  /** 微信包体积，单位字节 */
  sizes?: {
    total?: number
    main?: number
  }
  /** 包体积预算检查结果 */
  budget?: BudgetReport
  /** 预览前「构建 npm」产生的警告，仅微信 */
  npmWarnings?: WeixinWarning[]
  /** SDK 原始返回值 */
  raw: TRaw
}

export type AnyPreviewResult
  = | PreviewResult<'weixin', WeixinPreviewRawResult>
    | PreviewResult<'alipay', AlipayPreviewRawResult>

/** 预览选项 */
export interface PreviewOptions extends UploadOptions {
  /** 二维码格式 */
  qrFormat?: 'terminal' | 'image' | 'base64'
  /** 二维码输出路径，相对路径基于 cwd 解析 */
  qrOutput?: string
  /** 预览页面路径 */
  pagePath?: string
  /** 页面参数 */
  pageQuery?: string
  /** 全局启动参数 */
  query?: string
  /** 场景值，微信会转成数字 */
  scene?: string | number
  /** 预览备注 */
  desc?: string
  /** 指定 CI 机器人 */
  robot?: number
}

/** JS 调用入口的预览选项 */
export interface PreviewRequest extends PreviewOptions {
  /** 内联配置，传入后不再读取配置文件 */
  config?: UserConfig
  /** 显式指定的配置文件 */
  configFile?: string
}
