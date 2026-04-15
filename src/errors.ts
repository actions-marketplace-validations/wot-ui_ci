export class UniMiniCIError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'UniMiniCIError'
  }
}

export class ConfigError extends UniMiniCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause)
    this.name = 'ConfigError'
  }
}

export class UploadError extends UniMiniCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'UPLOAD_ERROR', cause)
    this.name = 'UploadError'
  }
}

export function formatErrorReport(error: unknown): string[] {
  const lines: string[] = []
  const visited = new Set<unknown>()

  appendErrorLine(error, lines, visited, 0)

  return lines
}

export function formatErrorStack(error: unknown): string[] {
  if (!(error instanceof Error) || !error.stack)
    return []

  return error.stack
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
}

function appendErrorLine(error: unknown, lines: string[], visited: Set<unknown>, depth: number): void {
  if (visited.has(error)) {
    lines.push(createPrefix(depth, '检测到循环错误引用'))
    return
  }

  if (error && (typeof error === 'object' || typeof error === 'function'))
    visited.add(error)

  if (error instanceof Error) {
    lines.push(createPrefix(depth, error.message || error.name))

    if ('cause' in error && error.cause !== undefined)
      appendErrorLine(error.cause, lines, visited, depth + 1)

    return
  }

  lines.push(createPrefix(depth, formatUnknownError(error)))
}

function createPrefix(depth: number, message: string): string {
  if (depth === 0)
    return message
  return `原因 ${depth}: ${message}`
}

function formatUnknownError(error: unknown): string {
  if (typeof error === 'string')
    return error

  try {
    return JSON.stringify(error)
  }
  catch {
    return String(error)
  }
}
