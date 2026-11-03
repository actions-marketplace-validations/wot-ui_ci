import type { IdeAction, PlatformInput } from './types'
import process from 'node:process'
import { previewMany, uploadMany } from './batch'
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
import { renderBatchJson } from './output/json'
import { renderBatchSummary, writeBatchSummary } from './output/summary'
import { previewPlatform } from './preview'
import { release } from './release'
import { uploadPlatform } from './upload'
import { normalizePlatform } from './utils/platform'

export interface RunCliOptions {
  cwd?: string
  stderr?: (message: string) => void
  stdout?: (message: string) => void
}

export type CliCommand = 'upload' | 'release' | 'preview' | 'open' | 'close' | 'auto' | 'ide-status' | 'ide-preview'

export interface ParsedCliArgs {
  all?: boolean
  build?: string
  command?: CliCommand
  concurrency?: number
  configFile?: string
  cwd?: string
  desc?: string
  dryRun?: boolean
  force?: boolean
  help?: boolean
  history?: boolean
  historyFile?: string
  infoOutput?: string
  json?: boolean
  lang?: 'zh' | 'en'
  page?: string
  pageQuery?: string
  platform?: PlatformInput
  port?: number
  prComment?: boolean
  qrFormat?: 'terminal' | 'image' | 'base64'
  qrOutput?: string
  query?: string
  quit?: boolean
  robot?: number
  scene?: string
  skipBuild?: boolean
  summary?: string
  ticket?: string
  trustProject?: boolean
}

const CLI_COMMANDS = new Set<CliCommand>(['upload', 'release', 'preview', 'open', 'close', 'auto'])

export async function runCli(argv: string[] = process.argv.slice(2), options: RunCliOptions = {}): Promise<number> {
  let logger = createCliLogger(options)

  try {
    const args = parseCliArgs(argv)
    const command = args.command ?? 'upload'
    const batchRequested = (command === 'upload' || command === 'preview')
      && (Boolean(args.all)
        || Boolean(args.platform?.includes(','))
        || Boolean(args.json)
        || Boolean(args.summary)
        || Boolean(args.dryRun)
        || args.concurrency !== undefined)

    if (args.json) {
      const stderrWriter = options.stderr
        ?? ((message: string) => process.stderr.write(`${message}\n`))
      logger = createCliLogger({ stderr: stderrWriter, stdout: stderrWriter })
    }

    if (args.help) {
      logger.log(createCliHelpText())
      return 0
    }

    if (!args.platform && command !== 'release' && !batchRequested) {
      logger.error('缺少必填参数：--platform')
      logger.log(createCliHelpText())
      return 1
    }

    // release / 批量模式可以不带 --platform，这里仅占位，后续分支不会使用
    const platform = command === 'release' || batchRequested
      ? 'weixin'
      : normalizePlatform(args.platform!)
    const loaded = await loadConfig({
      configFile: args.configFile,
      cwd: args.cwd ?? options.cwd,
    })

    logger.info(createCliConfigLoadedMessage(loaded.source, loaded.sourceFile))

    if (batchRequested) {
      const platforms = args.all
        ? undefined
        : args.platform?.split(',').map(item => item.trim()).filter(Boolean) as PlatformInput[] | undefined

      if (!args.json)
        logger.start(command === 'upload' ? '开始批量上传小程序...' : '开始批量生成预览二维码...')

      const result = command === 'upload'
        ? await uploadMany({
            concurrency: args.concurrency,
            config: loaded.config,
            cwd: loaded.cwd,
            dryRun: args.dryRun,
            platforms,
            redirectStdoutToStderr: args.json,
          })
        : await previewMany({
            concurrency: args.concurrency,
            config: loaded.config,
            cwd: loaded.cwd,
            dryRun: args.dryRun,
            pagePath: args.page,
            platforms,
            qrFormat: args.qrFormat,
            qrOutput: args.qrOutput,
            query: args.query,
            redirectStdoutToStderr: args.json,
            scene: args.scene,
          })

      if (args.summary) {
        const summaryPath = await writeBatchSummary(
          args.summary,
          renderBatchSummary(result, command),
          loaded.cwd,
        )
        logger.info(`summary 已写入：${summaryPath}`)
      }

      if (args.json) {
        const json = renderBatchJson(result, command, {
          source: loaded.source,
          ...(loaded.sourceFile ? { sourceFile: loaded.sourceFile } : {}),
        })
        const writeStdout = options.stdout ?? ((message: string) => process.stdout.write(message))
        writeStdout(json)
      }
      else {
        for (const item of result.results) {
          const message = item.error?.message
            ?? (item.result as { message?: string } | undefined)?.message
            ?? (item.ok ? '成功' : '失败')
          if (item.ok)
            logger.success(`[${item.platform}] ${message}`)
          else
            logger.error(`[${item.platform}] ${message}`)
        }
        if (result.dryRun)
          logger.log(`dry-run：共 ${result.results.length} 个平台`)
        logger.success(result.ok ? `${command === 'upload' ? '上传' : '预览'}完成` : `${command === 'upload' ? '上传' : '预览'}失败`)
      }

      return result.ok ? 0 : 1
    }

    if (command === 'release') {
      logger.start('开始构建并发布小程序...')

      const platformInput = args.platform
        ? args.platform.split(',').map(item => item.trim()).filter(Boolean) as PlatformInput[]
        : undefined
      const result = await release({
        buildCommand: args.build,
        config: loaded.config,
        cwd: loaded.cwd,
        dryRun: args.dryRun,
        history: args.history,
        historyFile: args.historyFile,
        platforms: args.all ? undefined : platformInput,
        prComment: args.prComment,
        skipBuild: args.skipBuild,
      })

      if (result.build.error)
        logger.error(`构建失败：${result.build.error.message}`)

      for (const item of result.platforms) {
        if (item.ok)
          logger.success(`[${item.platform}] ${item.message}`)
        else
          logger.error(`[${item.platform}] ${item.message}`)
      }

      if (result.dryRun)
        logger.log(`dry-run：构建 ${result.build.skipped ? '跳过' : result.build.commands.join(' → ') || '未配置'}，平台 ${result.platforms.map(item => item.platform).join(', ')}`)

      if (result.historyFile)
        logger.info(`发布历史已写入：${result.historyFile}`)
      if (result.historyError)
        logger.error(`写入发布历史失败：${result.historyError}`)
      if (result.commentUrl)
        logger.info(`PR 评论：${result.commentUrl}`)
      if (result.commentError)
        logger.error(`PR 评论失败：${result.commentError}`)

      logger.success(result.ok ? '发布完成' : '发布失败')
      return result.ok ? 0 : 1
    }

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
      case '--all':
        parsed.all = true
        break
      case '--build':
        parsed.build = readOptionValue(argv, ++index, current)
        break
      case '--skip-build':
        parsed.skipBuild = true
        break
      case '--history-file':
        parsed.historyFile = readOptionValue(argv, ++index, current)
        break
      case '--no-history':
        parsed.history = false
        break
      case '--pr-comment':
        parsed.prComment = true
        break
      case '--no-pr-comment':
        parsed.prComment = false
        break
      case '--json':
        parsed.json = true
        break
      case '--summary':
        parsed.summary = readOptionValue(argv, ++index, current)
        break
      case '--concurrency':
        parsed.concurrency = readConcurrency(argv, ++index, current)
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

function readConcurrency(argv: string[], index: number, optionName: string): number {
  const raw = readOptionValue(argv, index, optionName)
  const value = Number(raw)

  if (!Number.isInteger(value) || value < 1)
    throw new ConfigError(`参数 ${optionName} 必须是大于等于 1 的整数：${raw}`)

  return value
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
