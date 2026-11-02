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

export function createCliIdeStartMessage(platform: Platform, action: IdeAction): string {
  if (action === 'open')
    return `正在打开${getPlatformLabel(platform)}开发者工具...`
  if (action === 'close')
    return `正在关闭${getPlatformLabel(platform)}项目...`
  return `正在退出${getPlatformLabel(platform)}开发者工具...`
}

export function createCliHelpText(): string {
  return [
    '用法：',
    '  wotci upload --platform <weixin|alipay|dingtalk|dd> [options]',
    '  wotci open   --platform <weixin|alipay> [options]',
    '  wotci close  --platform <weixin|alipay> [options]',
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
    '  -h, --help             查看帮助信息',
  ].join('\n')
}

export function appendDesc(message: string, desc?: string): string {
  return desc ? `${message}，描述：${desc}` : message
}
