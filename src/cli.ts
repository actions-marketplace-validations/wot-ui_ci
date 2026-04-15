#!/usr/bin/env node

import type { PlatformName } from './types'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config'
import { ConfigError, UploadError } from './errors'
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
      stdout(getHelpText())
      return 0
    }

    if (!args.platform) {
      stderr('Missing required option: --platform')
      stderr(getHelpText())
      return 1
    }

    const platform = normalizePlatform(args.platform)
    const loaded = await loadConfig({
      configFile: args.configFile,
      cwd: args.cwd ?? options.cwd,
    })
    const result = await uploadPlatform(platform, loaded.config, { cwd: loaded.cwd })

    stdout(result.message)
    return 0
  }
  catch (error) {
    if (error instanceof ConfigError || error instanceof UploadError) {
      stderr(error.message)
      return 1
    }

    const message = error instanceof Error ? error.message : String(error)
    stderr(message)
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
        throw new ConfigError(`Unknown option: ${current}`)
    }
  }

  return parsed
}

function readOptionValue(argv: string[], index: number, optionName: string): string {
  const value = argv[index]
  if (!value)
    throw new ConfigError(`Missing value for option: ${optionName}`)
  return value
}

function normalizePlatform(platform: ParsedCliArgs['platform']): PlatformName {
  if (platform === 'dd')
    return 'dingtalk'
  if (platform === 'weixin' || platform === 'alipay' || platform === 'dingtalk')
    return platform
  throw new ConfigError(`Unsupported platform: ${platform ?? 'unknown'}`)
}

function getHelpText(): string {
  return [
    'Usage: minici --platform <weixin|alipay|dingtalk|dd> [options]',
    '',
    'Options:',
    '  -p, --platform <name>  Target platform',
    '  -c, --config <file>    Explicit config file path',
    '      --cwd <dir>        Resolve config from a specific working directory',
    '  -h, --help             Show this message',
  ].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode
  })
}
