export class WotCIError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'WotCIError'
  }
}

export class ConfigError extends WotCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause)
    this.name = 'ConfigError'
  }
}

export class UploadError extends WotCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'UPLOAD_ERROR', cause)
    this.name = 'UploadError'
  }
}

export class PreviewError extends WotCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PREVIEW_ERROR', cause)
    this.name = 'PreviewError'
  }
}

export class PreviewUnsupportedError extends WotCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PREVIEW_UNSUPPORTED', cause)
    this.name = 'PreviewUnsupportedError'
  }
}

export class ReleaseError extends WotCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'RELEASE_ERROR', cause)
    this.name = 'ReleaseError'
  }
}

export class BuildError extends WotCIError {
  constructor(message: string, cause?: unknown) {
    super(message, 'BUILD_ERROR', cause)
    this.name = 'BuildError'
  }
}

export class IdeError extends WotCIError {
  constructor(message: string, code = 'IDE_ERROR', cause?: unknown) {
    super(message, code, cause)
    this.name = 'IdeError'
  }
}

export class IdeNotFoundError extends IdeError {
  constructor(message: string, cause?: unknown) {
    super(message, 'IDE_NOT_FOUND', cause)
    this.name = 'IdeNotFoundError'
  }
}

export class IdeUnsupportedError extends IdeError {
  constructor(message: string, cause?: unknown) {
    super(message, 'IDE_UNSUPPORTED', cause)
    this.name = 'IdeUnsupportedError'
  }
}

export class IdeCommandError extends IdeError {
  constructor(message: string, cause?: unknown) {
    super(message, 'IDE_COMMAND_FAILED', cause)
    this.name = 'IdeCommandError'
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
