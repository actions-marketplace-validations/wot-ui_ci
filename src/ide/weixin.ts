import type { IdeAction, IdeOptions, IdeResult, WeixinConfig, WotciConfig } from '../types'
import process from 'node:process'
import { ConfigError, IdeNotFoundError } from '../errors'
import { exists, isDirectory, resolveFromCwd } from '../utils/path'
import { formatInvocation, runCommand, toCommandInvocation } from './runner'

export interface WeixinCliLookup {
  configuredPath?: string
  envPath?: string
  platform?: NodeJS.Platform
}

/** 按优先级返回可能存在的微信开发者工具 CLI 路径 */
export function getWeixinCliCandidates(input: WeixinCliLookup = {}): string[] {
  if (input.configuredPath)
    return [input.configuredPath]

  const platform = input.platform ?? process.platform
  const defaults: string[] = []

  if (platform === 'darwin') {
    defaults.push('/Applications/wechatwebdevtools.app/Contents/MacOS/cli')
  }
  else if (platform === 'win32') {
    defaults.push(
      'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
      'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat',
    )
  }
  else {
    defaults.push('/opt/wechat-devtools/cli', '/usr/bin/wechat-devtools-cli')
  }

  return [input.envPath, ...defaults].filter((value): value is string => Boolean(value))
}

async function resolveWeixinCli(config: WeixinConfig, cwd: string): Promise<string> {
  const configuredPath = config.ide?.cliPath
  const candidates = getWeixinCliCandidates({
    configuredPath: configuredPath ? resolveFromCwd(cwd, configuredPath) : undefined,
    envPath: process.env.WECHAT_DEVTOOLS_CLI
      ? resolveFromCwd(cwd, process.env.WECHAT_DEVTOOLS_CLI)
      : undefined,
  })

  for (const candidate of candidates) {
    if (await exists(candidate))
      return candidate
  }

  throw new IdeNotFoundError([
    '未找到微信开发者工具 CLI，已尝试以下路径：',
    ...candidates.map(candidate => `- ${candidate}`),
    '请安装微信开发者工具，或通过 weixin.ide.cliPath / WECHAT_DEVTOOLS_CLI 指定 cli 路径。',
  ].join('\n'))
}

function getWeixinConfig(config: WotciConfig): WeixinConfig {
  if (!config.weixin)
    throw new ConfigError('缺少微信小程序配置（weixin）')
  return config.weixin
}

async function resolveProjectPath(config: WeixinConfig, cwd: string): Promise<string> {
  const projectPath = resolveFromCwd(cwd, config.projectPath)
  if (!await isDirectory(projectPath))
    throw new ConfigError(`微信小程序产物目录不存在：${projectPath}`)
  return projectPath
}

function buildWeixinArgs(action: IdeAction, projectPath: string, options: IdeOptions): string[] {
  if (action === 'quit')
    return ['quit']

  const args = [action, '--project', projectPath]

  if (options.port !== undefined)
    args.push('--port', String(options.port))
  if (options.lang)
    args.push('--lang', options.lang)

  return args
}

export async function runWeixinIde(
  action: IdeAction,
  config: WotciConfig,
  options: IdeOptions = {},
): Promise<IdeResult> {
  const weixin = getWeixinConfig(config)
  const cwd = options.cwd ?? process.cwd()
  const projectPath = await resolveProjectPath(weixin, cwd)
  const cliPath = await resolveWeixinCli(weixin, cwd)
  const args = buildWeixinArgs(action, projectPath, options)
  const invocation = toCommandInvocation(cliPath, args)

  if (options.dryRun) {
    return {
      action,
      args: invocation.args,
      command: invocation.command,
      executed: false,
      message: `将执行：${formatInvocation(invocation)}`,
      platform: 'weixin',
      projectPath,
    }
  }

  const result = await runCommand(invocation, { cwd })
  const stdout = result.stdout.trim()

  return {
    action,
    args: invocation.args,
    command: invocation.command,
    executed: true,
    message: createWeixinMessage(action, projectPath),
    platform: 'weixin',
    projectPath,
    ...(stdout ? { stdout } : {}),
  }
}

function createWeixinMessage(action: IdeAction, projectPath: string): string {
  if (action === 'open')
    return `已在微信开发者工具中打开：${projectPath}`
  if (action === 'close')
    return `已关闭微信开发者工具中的项目：${projectPath}`
  return '已退出微信开发者工具'
}
