import type { IdeAction, PlatformInput } from './types'
import process from 'node:process'
import { loadConfig } from './config'
import { ConfigError, formatErrorReport, formatErrorStack, WotCIError } from './errors'
import { autoIde, closeIde, getIdeStatus, openIde, previewIde } from './ide'
import { createCliLogger } from './logger'
import {
  createCliConfigLoadedMessage,
  createCliHelpText,
  createCliIdeStartMessage,
  createCliPreviewStartMessage,
  createCliUploadStartMessage,
} from './messages'
import { previewPlatform } from './preview'
import { uploadPlatform } from './upload'
import { normalizePlatform } from './utils/platform'

export interface RunCliOptions {
  cwd?: string
  stderr?: (message: string) => void
  stdout?: (message: string) => void
}

export type CliCommand = 'upload' | 'preview' | 'open' | 'close' | 'auto' | 'ide-status' | 'ide-preview'

export interface ParsedCliArgs {
  command?: CliCommand
  configFile?: string
  cwd?: string
  desc?: string
  dryRun?: boolean
  force?: boolean
  help?: boolean
  infoOutput?: string
  lang?: 'zh' | 'en'
  page?: string
  pageQuery?: string
  platform?: PlatformInput
  port?: number
  qrFormat?: 'terminal' | 'image' | 'base64'
  qrOutput?: string
  query?: string
  quit?: boolean
  robot?: number
  scene?: string
  ticket?: string
  trustProject?: boolean
}

const CLI_COMMANDS = new Set<CliCommand>(['upload', 'preview', 'open', 'close', 'auto'])

export async function runCli(argv: string[] = process.argv.slice(2), options: RunCliOptions = {}): Promise<number> {
  const logger = createCliLogger(options)

  try {
    const args = parseCliArgs(argv)
    const command = args.command ?? 'upload'

    if (args.help) {
      logger.log(createCliHelpText())
      return 0
    }

    if (!args.platform) {
      logger.error('缺少必填参数：--platform')
      logger.log(createCliHelpText())
      return 1
    }

    const platform = normalizePlatform(args.platform)
    const loaded = await loadConfig({
      configFile: args.configFile,
      cwd: args.cwd ?? options.cwd,
    })

    logger.info(createCliConfigLoadedMessage(loaded.source, loaded.sourceFile))

    if (command === 'ide-status') {
      const result = await getIdeStatus(platform, {
        config: loaded.config,
        cwd: loaded.cwd,
        lang: args.lang,
        port: args.port,
      })

      logger.log(result.message)

      if (!result.installed)
        return 1

      return 0
    }

    if (command === 'auto' || command === 'ide-preview') {
      logger.start(command === 'auto'
        ? createCliIdeStartMessage(platform, 'auto')
        : createCliPreviewStartMessage(platform))

      const result = command === 'auto'
        ? await autoIde(platform, {
            config: loaded.config,
            cwd: loaded.cwd,
            dryRun: args.dryRun,
            force: args.force,
            lang: args.lang,
            port: args.port,
            ticket: args.ticket,
            trustProject: args.trustProject,
          })
        : await previewIde(platform, {
            config: loaded.config,
            cwd: loaded.cwd,
            dryRun: args.dryRun,
            force: args.force,
            infoOutput: args.infoOutput,
            lang: args.lang,
            port: args.port,
            qrFormat: args.qrFormat,
            qrOutput: args.qrOutput,
          })

      logger.success(result.message)
      return 0
    }

    if (command === 'preview') {
      logger.start(createCliPreviewStartMessage(platform))

      const result = await previewPlatform(platform, loaded.config, {
        cwd: loaded.cwd,
        desc: args.desc,
        pagePath: args.page,
        pageQuery: args.pageQuery,
        qrFormat: args.qrFormat,
        qrOutput: args.qrOutput,
        query: args.query,
        robot: args.robot,
        scene: args.scene,
      })

      logger.success(result.message)
      return 0
    }

    if (command === 'open' || command === 'close') {
      const action: IdeAction = command === 'close' && args.quit ? 'quit' : command
      logger.start(createCliIdeStartMessage(platform, action))

      const result = command === 'open'
        ? await openIde(platform, {
            config: loaded.config,
            cwd: loaded.cwd,
            dryRun: args.dryRun,
            force: args.force,
            lang: args.lang,
            port: args.port,
          })
        : await closeIde(platform, {
            config: loaded.config,
            cwd: loaded.cwd,
            dryRun: args.dryRun,
            quit: args.quit,
          })

      logger.success(result.message)
      return 0
    }

    logger.start(createCliUploadStartMessage(platform))
    const result = await uploadPlatform(platform, loaded.config, { cwd: loaded.cwd })
    logger.success(result.message)
    return 0
  }
  catch (error) {
    if (error instanceof WotCIError) {
      logError(logger, error)
      return 1
    }

    const message = error instanceof Error ? error.message : String(error)
    logger.error(`发生未预期错误：${message}`)
    logError(logger, error, { includeStack: true, skipFirstLine: true })
    return 1
  }
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {}
  let index = 0
  const first = argv[0]

  if (first && !first.startsWith('-')) {
    if (first === 'ide') {
      const subcommand = argv[1]
      if (subcommand === 'status')
        parsed.command = 'ide-status'
      else if (subcommand === 'preview')
        parsed.command = 'ide-preview'
      else
        throw new ConfigError(`未知 ide 子命令：${subcommand ?? '（空）'}`)
      index = 2
    }
    else if (CLI_COMMANDS.has(first as CliCommand)) {
      parsed.command = first as CliCommand
      index = 1
    }
    else {
      throw new ConfigError(`未知命令：${first}`)
    }
  }

  for (; index < argv.length; index++) {
    const current = argv[index]

    switch (current) {
      case '--help':
      case '-h':
        parsed.help = true
        break
      case '--platform':
      case '-p':
        parsed.platform = readOptionValue(argv, ++index, current) as PlatformInput
        break
      case '--config':
      case '-c':
        parsed.configFile = readOptionValue(argv, ++index, current)
        break
      case '--cwd':
        parsed.cwd = readOptionValue(argv, ++index, current)
        break
      case '--dry-run':
        parsed.dryRun = true
        break
      case '--force':
        parsed.force = true
        break
      case '--quit':
        parsed.quit = true
        break
      case '--port':
        parsed.port = readPort(argv, ++index, current)
        break
      case '--lang':
        parsed.lang = readLang(argv, ++index, current)
        break
      case '--qr-format':
        parsed.qrFormat = readQrFormat(argv, ++index, current)
        break
      case '--qr-output':
        parsed.qrOutput = readOptionValue(argv, ++index, current)
        break
      case '--page':
        parsed.page = readOptionValue(argv, ++index, current)
        break
      case '--page-query':
        parsed.pageQuery = readOptionValue(argv, ++index, current)
        break
      case '--query':
        parsed.query = readOptionValue(argv, ++index, current)
        break
      case '--scene':
        parsed.scene = readOptionValue(argv, ++index, current)
        break
      case '--desc':
        parsed.desc = readOptionValue(argv, ++index, current)
        break
      case '--robot':
        parsed.robot = readRobot(argv, ++index, current)
        break
      case '--info-output':
        parsed.infoOutput = readOptionValue(argv, ++index, current)
        break
      case '--trust-project':
        parsed.trustProject = true
        break
      case '--ticket':
        parsed.ticket = readOptionValue(argv, ++index, current)
        break
      default:
        throw new ConfigError(`未知参数：${current}`)
    }
  }

  return parsed
}

function readOptionValue(argv: string[], index: number, optionName: string): string {
  const value = argv[index]
  if (!value)
    throw new ConfigError(`参数缺少值：${optionName}`)
  return value
}

function readPort(argv: string[], index: number, optionName: string): number {
  const raw = readOptionValue(argv, index, optionName)
  const value = Number(raw)

  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new ConfigError(`参数 ${optionName} 必须是 1-65535 的整数：${raw}`)

  return value
}

function readQrFormat(
  argv: string[],
  index: number,
  optionName: string,
): 'terminal' | 'image' | 'base64' {
  const raw = readOptionValue(argv, index, optionName)

  if (raw !== 'terminal' && raw !== 'image' && raw !== 'base64')
    throw new ConfigError(`参数 ${optionName} 必须是 terminal、image 或 base64：${raw}`)

  return raw
}

function readRobot(argv: string[], index: number, optionName: string): number {
  const raw = readOptionValue(argv, index, optionName)
  const value = Number(raw)

  if (!Number.isInteger(value) || value < 1 || value > 30)
    throw new ConfigError(`参数 ${optionName} 必须是 1-30 的整数：${raw}`)

  return value
}

function readLang(argv: string[], index: number, optionName: string): 'zh' | 'en' {
  const raw = readOptionValue(argv, index, optionName)

  if (raw !== 'zh' && raw !== 'en')
    throw new ConfigError(`参数 ${optionName} 必须是 zh 或 en：${raw}`)

  return raw
}

function logError(
  logger: Pick<ReturnType<typeof createCliLogger>, 'error'>,
  error: unknown,
  options: {
    includeStack?: boolean
    skipFirstLine?: boolean
  } = {},
): void {
  const reportLines = formatErrorReport(error)
  const lines = options.skipFirstLine ? reportLines.slice(1) : reportLines

  for (const line of lines)
    logger.error(line)

  if (!options.includeStack)
    return

  for (const line of formatErrorStack(error))
    logger.error(`堆栈: ${line}`)
}
