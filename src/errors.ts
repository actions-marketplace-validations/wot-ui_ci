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
