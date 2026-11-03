import type { ConfigSource, IdeAction, Platform } from './types'

const platformLabelMap: Record<Platform, string> = {
  alipay: '支付宝小程序',
  dingtalk: '钉钉小程序',
  weixin: '微信小程序',
}

const configSourceLabelMap: Record<ConfigSource, string> = {
  'defaults': '默认配置',
  'file': 'JS/TS 配置文件',
  'inline': '内联配置',
  'minicirc': '.minicirc 配置文件',
  'package-json': 'package.json 配置字段',
}

export function getPlatformLabel(platform: Platform): string {
  return platformLabelMap[platform]
}

export function getConfigSourceLabel(source: ConfigSource): string {
  return configSourceLabelMap[source]
}

export function createCliConfigLoadedMessage(source: ConfigSource, sourceFile?: string): string {
  const label = getConfigSourceLabel(source)
  return sourceFile
    ? `配置加载完成，来源：${label}（${sourceFile}）`
    : `配置加载完成，来源：${label}`
}

export function createCliUploadStartMessage(platform: Platform): string {
  return `开始上传${getPlatformLabel(platform)}...`
}

export function createCliPreviewStartMessage(platform: Platform): string {
  return `正在生成${getPlatformLabel(platform)}预览二维码...`
}

export function createCliIdeStartMessage(platform: Platform, action: IdeAction): string {
  if (action === 'open')
    return `正在打开${getPlatformLabel(platform)}开发者工具...`
  if (action === 'auto')
    return `正在开启${getPlatformLabel(platform)}开发者工具自动化...`
  if (action === 'close')
    return `正在关闭${getPlatformLabel(platform)}项目...`
  return `正在退出${getPlatformLabel(platform)}开发者工具...`
}

export function createCliHelpText(): string {
  return [
    '用法：',
    '  wotci upload  --platform <weixin|alipay|dingtalk|dd> [options]',
    '  wotci release --platform <weixin,alipay,...> [options]',
    '  wotci version latest --platform <weixin|alipay> [--json]',
    '  wotci version list   --platform alipay [--json]',
    '  wotci preview --platform <weixin|alipay> [options]',
    '  wotci open   --platform <weixin|alipay> [options]',
    '  wotci close  --platform <weixin|alipay> [options]',
    '  wotci auto   --platform weixin [options]',
    '  wotci ide status  --platform weixin [options]',
    '  wotci ide preview --platform weixin [options]',
    '',
    '参数：',
    '  -p, --platform <name>  目标平台：weixin、alipay、dingtalk（dd 为钉钉别名）',
    '  -c, --config <file>    显式指定配置文件路径',
    '      --cwd <dir>        指定配置解析目录，默认当前目录',
    '      --dry-run          只打印将要执行的 IDE 命令，不真正启动',
    '      --force            CI 环境下允许打开开发者工具',
    '      --port <number>    IDE HTTP server 端口',
    '      --lang <zh|en>     IDE 语言',
    '      --quit             关闭 IDE 而不是只关闭项目',
    '      --qr-format <type> 预览二维码格式：terminal、image、base64',
    '      --qr-output <file> 预览二维码输出路径',
    '      --page <path>      预览页面路径',
    '      --page-query <str> 页面参数',
    '      --query <str>      全局启动参数',
    '      --scene <value>    预览场景值',
    '      --desc <text>      预览备注',
    '      --robot <1-30>     指定 CI 机器人',
    '      --info-output <file> IDE 预览信息输出路径',
    '      --trust-project    auto 时信任当前项目',
    '      --ticket <ticket>  auto 时使用的 ticket',
    '      --all              release 时发布配置中的所有平台',
    '      --build <command>  release 时覆盖构建命令',
    '      --skip-build       release 时跳过构建',
    '      --history-file <file> 发布历史文件路径',
    '      --no-history       不写发布历史',
    '      --pr-comment       强制尝试评论 PR',
    '      --no-pr-comment    不评论 PR',
    '      --json             以 JSON 输出到 stdout，日志走 stderr',
    '      --summary <file>   写入 CI Markdown summary',
    '      --concurrency <n>  批量执行并发数，默认 1',
    '  -h, --help             查看帮助信息',
  ].join('\n')
}

export function appendDesc(message: string, desc?: string): string {
  return desc ? `${message}，描述：${desc}` : message
}
