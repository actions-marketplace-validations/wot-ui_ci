import type { CIConfig, ConfigFactoryContext, LoadConfigOptions, LoadedConfig, PackageJsonConfig, UserConfig } from './types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import JSON5 from 'json5'
import { tsImport } from 'tsx/esm/api'
import { ConfigError } from './errors'
import { exists, resolveFromCwd } from './utils/path'

const PACKAGE_CONFIG_KEY = 'minici'
const TYPESCRIPT_CONFIG_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])

export const CONFIG_FILE_NAMES = [
  'minici.config.js',
  'minici.config.mjs',
  'minici.config.cjs',
  'minici.config.ts',
  'minici.config.mts',
  'minici.config.cts',
  '.minicirc',
] as const

export function defineConfig<T extends UserConfig>(config: T): T {
  return config
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const packageJson = await loadPackageJson(cwd)
  const context: ConfigFactoryContext = {
    cwd,
    env: process.env,
    packageJson,
  }

  if (options.config) {
    return {
      config: withPackageDefaults(await resolveConfigValue(options.config, context), packageJson),
      cwd,
      packageJson,
      source: 'inline',
    }
  }

  if (options.configFile) {
    const filePath = resolveFromCwd(cwd, options.configFile)
    return loadConfigFromFile(filePath, context, packageJson)
  }

  const jsConfigFile = await findExistingConfigFile(cwd, CONFIG_FILE_NAMES.slice(0, 6))
  if (jsConfigFile)
    return loadConfigFromFile(jsConfigFile, context, packageJson)

  const minicircPath = resolveFromCwd(cwd, '.minicirc')
  if (await exists(minicircPath))
    return loadConfigFromFile(minicircPath, context, packageJson)

  const packageConfig = packageJson?.[PACKAGE_CONFIG_KEY]
  if (packageConfig && isConfigObject(packageConfig)) {
    return {
      config: withPackageDefaults(packageConfig, packageJson),
      cwd,
      packageJson,
      source: 'package-json',
    }
  }

  return {
    config: withPackageDefaults({}, packageJson),
    cwd,
    packageJson,
    source: 'defaults',
  }
}

async function loadConfigFromFile(filePath: string, context: ConfigFactoryContext, packageJson?: PackageJsonConfig): Promise<LoadedConfig> {
  const source = filePath.endsWith('.minicirc') ? 'minicirc' : 'js'
  const config = source === 'minicirc'
    ? await loadMinicirc(filePath)
    : await loadModuleConfig(filePath, context)

  return {
    config: withPackageDefaults(config, packageJson),
    cwd: context.cwd,
    packageJson,
    source,
    sourceFile: filePath,
  }
}

async function loadPackageJson(cwd: string): Promise<PackageJsonConfig | undefined> {
  const packageJsonPath = resolveFromCwd(cwd, 'package.json')
  if (!await exists(packageJsonPath))
    return undefined

  try {
    const source = await readFile(packageJsonPath, 'utf8')
    return JSON.parse(source) as PackageJsonConfig
  }
  catch (error) {
    throw new ConfigError(`Failed to read package.json from ${packageJsonPath}`, error)
  }
}

async function findExistingConfigFile(cwd: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    const candidate = resolveFromCwd(cwd, name)
    if (await exists(candidate))
      return candidate
  }

  return undefined
}

async function loadMinicirc(filePath: string): Promise<CIConfig> {
  try {
    const source = await readFile(filePath, 'utf8')
    const parsed = JSON5.parse(source) as unknown
    if (!isConfigObject(parsed))
      throw new ConfigError(`Config file ${filePath} must export an object`)
    return parsed
  }
  catch (error) {
    if (error instanceof ConfigError)
      throw error
    throw new ConfigError(`Failed to parse config file ${filePath}`, error)
  }
}

async function loadModuleConfig(filePath: string, context: ConfigFactoryContext): Promise<CIConfig> {
  try {
    const module = isTypeScriptConfigFile(filePath)
      ? await tsImport(pathToFileURL(filePath).href, import.meta.url)
      : await import(pathToFileURL(filePath).href)
    const configValue = 'default' in module ? module.default : module
    return await resolveConfigValue(configValue as UserConfig, context)
  }
  catch (error) {
    throw new ConfigError(`Failed to load config module ${filePath}`, error)
  }
}

async function resolveConfigValue(config: UserConfig, context: ConfigFactoryContext): Promise<CIConfig> {
  const resolved = typeof config === 'function'
    ? await config(context)
    : config

  if (!isConfigObject(resolved))
    throw new ConfigError('Config must resolve to an object')

  return normalizeConfig(resolved)
}

function withPackageDefaults(config: CIConfig, packageJson?: PackageJsonConfig): CIConfig {
  return normalizeConfig({
    ...config,
    desc: config.desc ?? packageJson?.description,
    version: config.version ?? packageJson?.version,
  })
}

function isConfigObject(value: unknown): value is CIConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeConfig(config: CIConfig): CIConfig {
  const dingtalk = config.dingtalk ?? config.dd
  return {
    ...config,
    dd: undefined,
    dingtalk,
  }
}

function isTypeScriptConfigFile(filePath: string): boolean {
  return TYPESCRIPT_CONFIG_EXTENSIONS.has(path.extname(filePath))
}
