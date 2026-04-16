import type { RunCliOptions } from './cli'
import { createConsola } from 'consola'

interface CliLogger {
  error: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  log: (...args: unknown[]) => void
  start: (...args: unknown[]) => void
  success: (...args: unknown[]) => void
}

export function createCliLogger(options: Pick<RunCliOptions, 'stderr' | 'stdout'> = {}): CliLogger {
  if (!options.stdout && !options.stderr)
    return createConsola().withTag('wotci')

  return {
    error: (...args: unknown[]) => write(options.stderr, `[失败] ${formatArgs(args)}`),
    info: (...args: unknown[]) => write(options.stdout, `[信息] ${formatArgs(args)}`),
    log: (...args: unknown[]) => write(options.stdout, formatArgs(args)),
    start: (...args: unknown[]) => write(options.stdout, `[开始] ${formatArgs(args)}`),
    success: (...args: unknown[]) => write(options.stdout, `[成功] ${formatArgs(args)}`),
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(formatArg).join(' ')
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error)
    return arg.message
  if (typeof arg === 'string')
    return arg
  return String(arg)
}

function write(writer: ((message: string) => void) | undefined, message: string): void {
  writer?.(message)
}
