import type { ConfigSource, PlatformName } from './types'

const platformLabelMap: Record<PlatformName, string> = {
  alipay: '支付宝小程序',
  dingtalk: '钉钉小程序',
  weixin: '微信小程序',
}

const configSourceLabelMap: Record<ConfigSource, string> = {
  'defaults': '默认配置',
  'inline': '内联配置',
  'js': 'JS/TS 配置文件',
  'package-json': 'package.json 中的 wotci 字段',
}

export function getPlatformLabel(platform: PlatformName): string {
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

export function createCliUploadStartMessage(platform: PlatformName): string {
  return `开始上传${getPlatformLabel(platform)}...`
}

export function createCliHelpText(): string {
  return [
    '用法：wotci --platform <weixin|alipay|dingtalk|dd> [options]',
    '',
    '参数：',
    '  -p, --platform <name>  目标平台',
    '  -c, --config <file>    显式指定配置文件路径',
    '      --cwd <dir>        指定配置解析目录',
    '  -h, --help             查看帮助信息',
  ].join('\n')
}

export function appendDesc(message: string, desc?: string): string {
  return desc ? `${message}，描述：${desc}` : message
}
