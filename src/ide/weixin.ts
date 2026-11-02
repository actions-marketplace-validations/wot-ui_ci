import type {
  IdeAction,
  IdeOptions,
  IdePreviewOptions,
  IdePreviewResult,
  IdeResult,
  IdeStatusResult,
  PreviewQrCode,
  WeixinConfig,
  WotciConfig,
} from '../types'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { ConfigError, IdeError, IdeNotFoundError } from '../errors'
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

async function findWeixinCli(config: WeixinConfig, cwd: string): Promise<string | undefined> {
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

  return undefined
}

async function resolveWeixinCli(config: WeixinConfig, cwd: string): Promise<string> {
  const cliPath = await findWeixinCli(config, cwd)
  if (cliPath)
    return cliPath

  const configuredPath = config.ide?.cliPath
  const candidates = getWeixinCliCandidates({
    configuredPath: configuredPath ? resolveFromCwd(cwd, configuredPath) : undefined,
    envPath: process.env.WECHAT_DEVTOOLS_CLI
      ? resolveFromCwd(cwd, process.env.WECHAT_DEVTOOLS_CLI)
      : undefined,
  })

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

export async function autoWeixinIde(
  config: WotciConfig,
  options: IdeOptions = {},
): Promise<IdeResult> {
  const weixin = getWeixinConfig(config)
  const cwd = options.cwd ?? process.cwd()
  const projectPath = await resolveProjectPath(weixin, cwd)
  const cliPath = await resolveWeixinCli(weixin, cwd)
  const args = ['auto', '--project', projectPath]

  if (options.port !== undefined)
    args.push('--port', String(options.port))
  if (options.trustProject)
    args.push('--trust-project')
  if (options.ticket)
    args.push('--ticket', options.ticket)
  if (options.lang)
    args.push('--lang', options.lang)

  const invocation = toCommandInvocation(cliPath, args)

  if (options.dryRun) {
    return {
      action: 'auto',
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
    action: 'auto',
    args: invocation.args,
    command: invocation.command,
    executed: true,
    message: `已开启微信开发者工具自动化：${projectPath}`,
    platform: 'weixin',
    projectPath,
    ...(stdout ? { stdout } : {}),
  }
}

export async function getWeixinIdeStatus(
  config: WotciConfig,
  options: IdeOptions = {},
): Promise<IdeStatusResult> {
  const weixin = getWeixinConfig(config)
  const cwd = options.cwd ?? process.cwd()
  const cliPath = await findWeixinCli(weixin, cwd)

  if (!cliPath) {
    return {
      installed: false,
      message: '未找到微信开发者工具 CLI，请先安装或配置 weixin.ide.cliPath。',
      platform: 'weixin',
    }
  }

  const args = ['islogin']
  if (options.port !== undefined)
    args.push('--port', String(options.port))
  if (options.lang)
    args.push('--lang', options.lang)

  try {
    const result = await runCommand(toCommandInvocation(cliPath, args), { cwd })
    const stdout = result.stdout.trim()
    const loggedIn = parseLoginStatus(stdout)

    return {
      cliPath,
      installed: true,
      ...(loggedIn !== undefined ? { loggedIn } : {}),
      message: createStatusMessage(cliPath, loggedIn),
      platform: 'weixin',
      ...(stdout ? { stdout } : {}),
    }
  }
  catch (error) {
    return {
      cliPath,
      installed: true,
      message: `微信开发者工具已安装，但无法获取登录状态：${error instanceof Error ? error.message : String(error)}`,
      platform: 'weixin',
    }
  }
}

export async function previewWeixinIde(
  config: WotciConfig,
  options: IdePreviewOptions = {},
): Promise<IdePreviewResult> {
  const weixin = getWeixinConfig(config)
  const cwd = options.cwd ?? process.cwd()
  const projectPath = await resolveProjectPath(weixin, cwd)
  const cliPath = await resolveWeixinCli(weixin, cwd)
  const qrFormat = options.qrFormat ?? 'image'
  const outputPath = resolveIdeQrOutputPath(qrFormat, options.qrOutput, cwd)
  const infoPath = options.infoOutput
    ? resolveFromCwd(cwd, options.infoOutput)
    : undefined

  if (outputPath)
    await mkdir(path.dirname(outputPath), { recursive: true })
  if (infoPath)
    await mkdir(path.dirname(infoPath), { recursive: true })

  const args = ['preview', '--project', projectPath, '--qr-format', qrFormat]
  if (outputPath)
    args.push('--qr-output', outputPath)
  if (infoPath)
    args.push('--info-output', infoPath)
  if (options.port !== undefined)
    args.push('--port', String(options.port))
  if (options.lang)
    args.push('--lang', options.lang)

  const invocation = toCommandInvocation(cliPath, args)

  if (options.dryRun) {
    return {
      executed: false,
      ...(infoPath ? { infoPath } : {}),
      message: `将执行：${formatInvocation(invocation)}`,
      platform: 'weixin',
    }
  }

  const result = await runCommand(invocation, { cwd })
  const stdout = result.stdout.trim()
  const qrCode = await createIdeQrCode(qrFormat, outputPath)

  return {
    executed: true,
    ...(infoPath ? { infoPath } : {}),
    message: createIdePreviewMessage(qrFormat, outputPath),
    platform: 'weixin',
    qrCode,
    ...(stdout ? { stdout } : {}),
  }
}

function resolveIdeQrOutputPath(
  format: 'terminal' | 'image' | 'base64',
  qrOutput: string | undefined,
  cwd: string,
): string | undefined {
  if (format === 'terminal')
    return undefined

  return resolveFromCwd(cwd, qrOutput ?? (format === 'base64'
    ? '.wotci/preview/weixin-ide.txt'
    : '.wotci/preview/weixin-ide.png'))
}

async function createIdeQrCode(
  format: 'terminal' | 'image' | 'base64',
  outputPath: string | undefined,
): Promise<PreviewQrCode> {
  if (format === 'terminal')
    return { kind: 'terminal', value: '' }

  const target = outputPath as string

  if (format === 'base64') {
    try {
      const content = await readFile(target, 'utf8')
      return { kind: 'base64', path: target, value: content.trim() }
    }
    catch (error) {
      throw new IdeError(`读取 IDE 预览二维码失败：${target}`, 'IDE_PREVIEW_READ_FAILED', error)
    }
  }

  return { kind: 'file', path: target, value: target }
}

function createIdePreviewMessage(
  format: 'terminal' | 'image' | 'base64',
  outputPath: string | undefined,
): string {
  if (format === 'terminal')
    return '微信开发者工具预览二维码已输出到终端'
  if (format === 'base64')
    return '微信开发者工具预览二维码已生成（base64）'
  return `微信开发者工具预览二维码已生成：${outputPath}`
}

function parseLoginStatus(output: string): boolean | undefined {
  const text = output.toLowerCase()

  if (/\btrue\b/.test(text) || text.includes('已登录'))
    return true
  if (/\bfalse\b/.test(text) || text.includes('未登录') || text.includes('not login'))
    return false

  return undefined
}

function createStatusMessage(cliPath: string, loggedIn: boolean | undefined): string {
  if (loggedIn === true)
    return `微信开发者工具已安装（${cliPath}），当前已登录`
  if (loggedIn === false)
    return `微信开发者工具已安装（${cliPath}），当前未登录`
  return `微信开发者工具已安装（${cliPath}），登录状态未知`
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
