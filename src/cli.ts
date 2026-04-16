import type { PlatformName } from './types'
import process from 'node:process'
import { loadConfig } from './config'
import { ConfigError, formatErrorReport, formatErrorStack, UploadError } from './errors'
import { createCliLogger } from './logger'
import {
  createCliConfigLoadedMessage,
  createCliHelpText,
  createCliUploadStartMessage,
} from './messages'
import { uploadPlatform } from './upload'

export interface RunCliOptions {
  cwd?: string
  stderr?: (message: string) => void
  stdout?: (message: string) => void
}

interface ParsedCliArgs {
  configFile?: string
  cwd?: string
  help?: boolean
  platform?: PlatformName | 'dd'
}

export async function runCli(argv: string[] = process.argv.slice(2), options: RunCliOptions = {}): Promise<number> {
  const logger = createCliLogger(options)

  try {
    const args = parseCliArgs(argv)

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
    logger.start(createCliUploadStartMessage(platform))
    const result = await uploadPlatform(platform, loaded.config, { cwd: loaded.cwd })

    logger.success(result.message)
    return 0
  }
  catch (error) {
    if (error instanceof ConfigError || error instanceof UploadError) {
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

  for (let index = 0; index < argv.length; index++) {
    const current = argv[index]

    switch (current) {
      case '--help':
      case '-h':
        parsed.help = true
        break
      case '--platform':
      case '-p':
        parsed.platform = readOptionValue(argv, ++index, current) as ParsedCliArgs['platform']
        break
      case '--config':
      case '-c':
        parsed.configFile = readOptionValue(argv, ++index, current)
        break
      case '--cwd':
        parsed.cwd = readOptionValue(argv, ++index, current)
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

function normalizePlatform(platform: ParsedCliArgs['platform']): PlatformName {
  if (platform === 'dd')
    return 'dingtalk'
  if (platform === 'weixin' || platform === 'alipay' || platform === 'dingtalk')
    return platform
  throw new ConfigError(`不支持的平台：${platform ?? 'unknown'}`)
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
