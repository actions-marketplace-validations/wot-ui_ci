import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, formatErrorReport, formatErrorStack, UploadError, WotCIError } from '../src/errors'
import { createCliLogger } from '../src/logger'
import {
  appendDesc,
  createCliConfigLoadedMessage,
  createCliHelpText,
  createCliUploadStartMessage,
  getConfigSourceLabel,
  getPlatformLabel,
} from '../src/messages'
import { isPlainObject, unwrapModuleExport } from '../src/utils/module'
import { resolveFromCwd } from '../src/utils/path'
import { compareVersion } from '../src/utils/version'

describe('compareVersion', () => {
  it('按段比较版本号', () => {
    expect(compareVersion('1.0.0', '1')).toBe(0)
    expect(compareVersion('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersion('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersion('2', '2.0.0')).toBe(0)
  })

  it('非法版本号抛出错误', () => {
    expect(() => compareVersion('1.0.0-beta', '1.0.0')).toThrow(TypeError)
  })
})

describe('unwrapModuleExport', () => {
  const config = { version: '1.0.0' }

  it('解开 ESM 命名空间', () => {
    expect(unwrapModuleExport({ default: config })).toBe(config)
  })

  it('解开 tsx 在 CJS 项目中的双重包装', () => {
    expect(unwrapModuleExport({ default: { __esModule: true, default: config } })).toBe(config)
  })

  it('保留带具名导出的命名空间的 default', () => {
    const namespace = { default: config, helper: () => {} }
    Object.defineProperty(namespace, Symbol.toStringTag, { value: 'Module' })

    expect(unwrapModuleExport(namespace)).toBe(config)
  })

  it('不会误伤普通配置对象', () => {
    const value = { default: 'x', version: '1.0.0' }
    expect(unwrapModuleExport(value)).toBe(value)
  })
})

describe('isPlainObject', () => {
  it('只接受普通对象', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject(new Date())).toBe(false)
  })
})

describe('errors', () => {
  it('保留错误码与 cause 链', () => {
    const error = new UploadError('外层错误', new ConfigError('配置错误'))

    expect(error).toBeInstanceOf(WotCIError)
    expect(error.code).toBe('UPLOAD_ERROR')
    expect(error.name).toBe('UploadError')
    expect(formatErrorReport(error)).toEqual([
      '外层错误',
      '原因 1: 配置错误',
    ])
  })

  it('处理循环 cause', () => {
    const error = new Error('循环错误') as Error & { cause?: unknown }
    error.cause = error

    expect(formatErrorReport(error)).toEqual([
      '循环错误',
      '原因 1: 检测到循环错误引用',
    ])
  })

  it('格式化字符串错误与堆栈', () => {
    expect(formatErrorReport('plain error')).toEqual(['plain error'])
    expect(formatErrorStack(new Error('stack error')).length).toBeGreaterThan(0)
    expect(formatErrorStack('plain error')).toEqual([])
  })
})

describe('messages', () => {
  it('输出平台与配置来源标签', () => {
    expect(getPlatformLabel('weixin')).toBe('微信小程序')
    expect(getConfigSourceLabel('file')).toBe('JS/TS 配置文件')
    expect(getConfigSourceLabel('minicirc')).toBe('.minicirc 配置文件')
    expect(createCliConfigLoadedMessage('defaults')).toBe('配置加载完成，来源：默认配置')
    expect(createCliConfigLoadedMessage('file', '/tmp/wotci.config.ts')).toBe(
      '配置加载完成，来源：JS/TS 配置文件（/tmp/wotci.config.ts）',
    )
    expect(createCliUploadStartMessage('alipay')).toBe('开始上传支付宝小程序...')
  })

  it('拼接描述信息', () => {
    expect(appendDesc('上传成功', 'release')).toBe('上传成功，描述：release')
    expect(appendDesc('上传成功')).toBe('上传成功')
  })

  it('帮助信息包含平台说明', () => {
    expect(createCliHelpText()).toContain('wotci --platform')
    expect(createCliHelpText()).toContain('--cwd')
  })
})

describe('path utils', () => {
  it('相对路径基于 cwd 解析，绝对路径原样返回', () => {
    const cwd = path.resolve('/tmp/project')
    const absoluteKey = path.resolve('/opt/keys/private.key')

    expect(resolveFromCwd(cwd, 'dist/weixin')).toBe(path.resolve(cwd, 'dist/weixin'))
    expect(resolveFromCwd(cwd, absoluteKey)).toBe(absoluteKey)
  })
})

describe('logger', () => {
  it('未注入 writer 时返回 consola 实例', () => {
    const logger = createCliLogger()

    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  it('处理 Error、字符串与其它类型的参数', () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const logger = createCliLogger({
      stderr: message => stderr.push(message),
      stdout: message => stdout.push(message),
    })

    logger.log('value', 42, { a: 1 })
    logger.error(new Error('boom'))

    expect(stdout).toEqual(['value 42 [object Object]'])
    expect(stderr).toEqual(['[失败] boom'])
  })

  it('只注入单侧 writer 时另一侧静默', () => {
    const stdout: string[] = []
    const logger = createCliLogger({ stdout: message => stdout.push(message) })

    logger.error('ignored')
    logger.info('kept')

    expect(stdout).toEqual(['[信息] kept'])
  })
})

describe('formatUnknownError', () => {
  it('无法 JSON 序列化时回退到 String', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(formatErrorReport(circular)).toEqual(['[object Object]'])
  })
})

describe('formatErrorReport 普通错误', () => {
  it('没有 cause 时只输出自身消息', () => {
    expect(formatErrorReport(new Error('single error'))).toEqual(['single error'])
  })
})

describe('error.message 为空', () => {
  it('回退到错误名称', () => {
    const error = new Error('placeholder')
    error.message = ''

    expect(formatErrorReport(error)).toEqual(['Error'])
  })
})
