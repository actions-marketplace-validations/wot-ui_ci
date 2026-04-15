#!/usr/bin/env node

import type { PlatformName } from './types'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config'
import { ConfigError, UploadError } from './errors'
import {
  createCliConfigLoadedMessage,
  createCliErrorMessage,
  createCliHelpText,
  createCliInfoMessage,
  createCliSuccessMessage,
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
  const stdout = options.stdout ?? console.log
  const stderr = options.stderr ?? console.error

  try {
    const args = parseCliArgs(argv)

    if (args.help) {
      stdout(createCliHelpText())
      return 0
    }

    if (!args.platform) {
      stderr(createCliErrorMessage('缺少必填参数：--platform'))
      stderr(createCliHelpText())
      return 1
    }

    const platform = normalizePlatform(args.platform)
    const loaded = await loadConfig({
      configFile: args.configFile,
      cwd: args.cwd ?? options.cwd,
    })
    stdout(createCliInfoMessage(createCliConfigLoadedMessage(loaded.source, loaded.sourceFile)))
    stdout(createCliInfoMessage(createCliUploadStartMessage(platform)))
    const result = await uploadPlatform(platform, loaded.config, { cwd: loaded.cwd })

    stdout(createCliSuccessMessage(result.message))
    return 0
  }
  catch (error) {
    if (error instanceof ConfigError || error instanceof UploadError) {
      stderr(createCliErrorMessage(error.message))
      return 1
    }

    const message = error instanceof Error ? error.message : String(error)
    stderr(createCliErrorMessage(`发生未预期错误：${message}`))
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode
  })
}
