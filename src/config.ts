import type {
  ConfigFactory,
  ConfigFactoryContext,
  ConfigSource,
  LoadConfigOptions,
  LoadedConfig,
  PackageJsonLike,
  UserConfig,
  WotciConfig,
} from './types'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import JSON5 from 'json5'
import { tsImport } from 'tsx/esm/api'
import { ConfigError } from './errors'
import { isPlainObject, unwrapModuleExport } from './utils/module'
import { exists, resolveFromCwd } from './utils/path'

const requireFromHere = createRequire(import.meta.url)
const PACKAGE_CONFIG_KEY = 'wotci'
const LEGACY_PACKAGE_CONFIG_KEY = 'uni-mini-ci'
const TYPESCRIPT_CONFIG_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])
const PLATFORM_KEYS = ['weixin', 'alipay', 'dingtalk'] as const

/** 按优先级排列的配置文件名称 */
export const CONFIG_FILE_NAMES = [
  'wotci.config.js',
  'wotci.config.mjs',
  'wotci.config.cjs',
  'wotci.config.ts',
  'wotci.config.mts',
  'wotci.config.cts',
] as const

/** 兼容 uni-mini-ci 的配置文件名称 */
export const LEGACY_CONFIG_FILE_NAME = '.minicirc'

export function defineConfig(config: WotciConfig): WotciConfig
export function defineConfig(config: ConfigFactory): ConfigFactory
export function defineConfig(config: UserConfig): UserConfig {
  return config
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const packageJson = await readPackageJson(cwd)
  const context = createContext(cwd, packageJson)

  if (options.config !== undefined) {
    const config = await resolveConfigValue(options.config, context, '内联配置')
    return {
      config: withPackageDefaults(config, packageJson),
      cwd,
      packageJson,
      source: 'inline',
    }
  }

  if (options.configFile !== undefined) {
    if (!options.configFile.trim())
      throw new ConfigError('configFile 不能为空')
    const filePath = resolveFromCwd(cwd, options.configFile)
    return loadModuleConfig(filePath, context)
  }

  const discoveredFile = await findFirstConfigFile(cwd)
  if (discoveredFile)
    return loadModuleConfig(discoveredFile, context)

  const packageConfig = packageJson?.[PACKAGE_CONFIG_KEY]
  if (packageConfig !== undefined)
    return loadPackageConfig(packageConfig, 'package.json 中的 wotci 字段', cwd, packageJson, 'package-json')

  const legacyFilePath = resolveFromCwd(cwd, LEGACY_CONFIG_FILE_NAME)
  if (await exists(legacyFilePath))
    return loadMinicirc(legacyFilePath, cwd, packageJson)

  const legacyPackageConfig = packageJson?.[LEGACY_PACKAGE_CONFIG_KEY]
  if (legacyPackageConfig !== undefined)
    return loadPackageConfig(legacyPackageConfig, 'package.json 中的 uni-mini-ci 字段', cwd, packageJson, 'package-json')

  return {
    config: withPackageDefaults({}, packageJson),
    cwd,
    packageJson,
    source: 'defaults',
  }
}

function createContext(cwd: string, packageJson?: PackageJsonLike): ConfigFactoryContext {
  return {
    cwd,
    env: process.env,
    packageJson,
  }
}

async function loadModuleConfig(filePath: string, context: ConfigFactoryContext): Promise<LoadedConfig> {
  if (!await exists(filePath))
    throw new ConfigError(`配置文件不存在：${filePath}`)

  try {
    const moduleExports = await loadModuleExports(filePath)
    const configValue = unwrapModuleExport(moduleExports)
    const config = await resolveConfigValue(configValue, context, `配置文件 ${filePath}`)

    return {
      config: withPackageDefaults(config, context.packageJson),
      cwd: context.cwd,
      packageJson: context.packageJson,
      source: 'file',
      sourceFile: filePath,
    }
  }
  catch (error) {
    if (error instanceof ConfigError)
      throw error
    throw new ConfigError(`加载配置文件失败：${filePath}`, error)
  }
}

async function loadPackageConfig(
  value: unknown,
  label: string,
  cwd: string,
  packageJson: PackageJsonLike | undefined,
  source: ConfigSource,
): Promise<LoadedConfig> {
  const config = await resolveConfigValue(value, createContext(cwd, packageJson), label)

  return {
    config: withPackageDefaults(config, packageJson),
    cwd,
    packageJson,
    source,
  }
}

async function loadMinicirc(filePath: string, cwd: string, packageJson?: PackageJsonLike): Promise<LoadedConfig> {
  try {
    const source = await readFile(filePath, 'utf8')
    const parsed = JSON5.parse(source) as unknown
    const config = await resolveConfigValue(parsed, createContext(cwd, packageJson), `.minicirc 配置：${filePath}`)

    return {
      config: withPackageDefaults(config, packageJson),
      cwd,
      packageJson,
      source: 'minicirc',
      sourceFile: filePath,
    }
  }
  catch (error) {
    if (error instanceof ConfigError)
      throw error
    throw new ConfigError(`读取 .minicirc 失败：${filePath}`, error)
  }
}

async function loadModuleExports(filePath: string): Promise<unknown> {
  const extension = path.extname(filePath)

  if (extension === '.cts')
    return loadCommonJsTypeScriptModule(filePath)
  if (TYPESCRIPT_CONFIG_EXTENSIONS.has(extension))
    return tsImport(pathToFileURL(filePath).href, import.meta.url)

  return import(pathToFileURL(filePath).href)
}

/**
 * `.cts` 一律按 CommonJS 处理，交给 tsx 的 CJS API 加载。
 * 这里通过 createRequire 取运行时，避免 playground 的 TS 4.9 无法解析
 * `tsx/cjs/api` 的 exports 类型声明。
 */
function loadCommonJsTypeScriptModule(filePath: string): unknown {
  const tsxCjsApi = requireFromHere('tsx/cjs/api') as {
    require: (id: string, fromFile: string | URL) => unknown
  }

  return tsxCjsApi.require(filePath, import.meta.url)
}

async function resolveConfigValue(value: unknown, context: ConfigFactoryContext, label: string): Promise<WotciConfig> {
  let resolved: unknown

  try {
    resolved = typeof value === 'function'
      ? await (value as ConfigFactory)(context)
      : await value
  }
  catch (error) {
    throw new ConfigError(`执行配置函数失败：${label}`, error)
  }

  if (!isPlainObject(resolved))
    throw new ConfigError(`${label}必须导出配置对象，或导出返回配置对象的函数`)

  return normalizeConfig(resolved as WotciConfig, label)
}

/**
 * 校验平台、预算、版本策略和发布配置的结构，并将旧 dd 别名归一为 dingtalk。
 * @throws {ConfigError} 配置字段类型或策略取值无效时抛出带配置来源的错误。
 */
function normalizeConfig(config: WotciConfig, label: string): WotciConfig {
  for (const key of PLATFORM_KEYS) {
    const value = config[key]
    if (value !== undefined && !isPlainObject(value))
      throw new ConfigError(`${label}中的 ${key} 必须是对象`)
  }

  if (config.budgets !== undefined && !isPlainObject(config.budgets))
    throw new ConfigError(`${label}中的 budgets 必须是对象`)

  if (config.versionStrategy !== undefined) {
    if (!isPlainObject(config.versionStrategy))
      throw new ConfigError(`${label}中的 versionStrategy 必须是对象`)

    const type = config.versionStrategy.type
    if (type !== 'fixed' && type !== 'package' && type !== 'auto')
      throw new ConfigError(`${label}中的 versionStrategy.type 无效：${String(type)}`)

    if (type === 'auto') {
      const bump = config.versionStrategy.bump
      if (bump !== 'major' && bump !== 'minor' && bump !== 'patch')
        throw new ConfigError(`${label}中的 versionStrategy.bump 无效：${String(bump)}`)
      if (config.versionStrategy.strict !== undefined && typeof config.versionStrategy.strict !== 'boolean')
        throw new ConfigError(`${label}中的 versionStrategy.strict 必须是布尔值`)
    }
  }

  if (config.release !== undefined) {
    if (!isPlainObject(config.release))
      throw new ConfigError(`${label}中的 release 必须是对象`)
    if (config.release.platforms !== undefined && !Array.isArray(config.release.platforms))
      throw new ConfigError(`${label}中的 release.platforms 必须是数组`)
  }

  const { dd, ...rest } = config
  const dingtalk = rest.dingtalk ?? dd

  return dingtalk === undefined
    ? rest
    : { ...rest, dingtalk }
}

function withPackageDefaults(config: WotciConfig, packageJson?: PackageJsonLike): WotciConfig {
  const result: WotciConfig = { ...config }

  if (result.version === undefined)
    result.version = packageJson?.version
  if (result.desc === undefined)
    result.desc = packageJson?.description

  return result
}

async function findFirstConfigFile(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = resolveFromCwd(cwd, name)
    if (await exists(candidate))
      return candidate
  }

  return undefined
}

async function readPackageJson(cwd: string): Promise<PackageJsonLike | undefined> {
  const packageJsonPath = resolveFromCwd(cwd, 'package.json')
  if (!await exists(packageJsonPath))
    return undefined

  try {
    const source = await readFile(packageJsonPath, 'utf8')
    const parsed = JSON.parse(source) as unknown
    if (!isPlainObject(parsed))
      throw new TypeError('package.json 必须是对象')
    return parsed as PackageJsonLike
  }
  catch (error) {
    throw new ConfigError(`读取 package.json 失败：${packageJsonPath}`, error)
  }
}
