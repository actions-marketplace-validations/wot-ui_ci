import type { InitOptions, InitResult, Platform, PlatformInput } from './types'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { ConfigError } from './errors'
import { exists, resolveFromCwd } from './utils/path'
import { normalizePlatform } from './utils/platform'

const DEFAULT_PATHS: Record<Platform, string> = {
  alipay: 'dist/build/mp-alipay',
  dingtalk: 'dist/build/mp-dingtalk',
  weixin: 'dist/build/mp-weixin',
}

const DETECT_PATHS: Record<Platform, string[]> = {
  alipay: ['dist/build/mp-alipay', 'dist/dev/mp-alipay'],
  dingtalk: ['dist/build/mp-dingtalk', 'dist/dev/mp-dingtalk'],
  weixin: ['dist/build/mp-weixin', 'dist/dev/mp-weixin'],
}

const PLATFORM_ORDER: Platform[] = ['weixin', 'alipay', 'dingtalk']

/** 生成配置文件，默认非交互；不覆盖已有文件 */
export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const configFile = normalizeConfigFileName(options.configFile ?? 'wotci.config.ts')
  const file = resolveFromCwd(cwd, configFile)
  const platforms = await resolvePlatforms(cwd, options.platforms)

  if (await exists(file) && !options.force) {
    throw new ConfigError(`配置文件已存在：${file}，如需覆盖请加 --force`)
  }

  const content = await renderConfig(platforms, cwd)

  if (!options.dryRun) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }

  return {
    content,
    file,
    platforms,
    written: !options.dryRun,
  }
}

async function resolvePlatforms(cwd: string, requested: PlatformInput[] | undefined): Promise<Platform[]> {
  if (requested?.length) {
    return [...new Set(requested.map(platform => normalizePlatform(platform)))]
  }

  const detected: Platform[] = []

  for (const platform of PLATFORM_ORDER) {
    for (const relativePath of DETECT_PATHS[platform]) {
      if (await exists(resolveFromCwd(cwd, relativePath))) {
        detected.push(platform)
        break
      }
    }
  }

  return detected.length ? detected : [...PLATFORM_ORDER]
}

function normalizeConfigFileName(fileName: string): string {
  const trimmed = fileName.trim()
  if (!trimmed)
    throw new ConfigError('configFile 不能为空')

  return path.extname(trimmed) ? trimmed : `${trimmed}.ts`
}

async function renderConfig(platforms: Platform[], cwd: string): Promise<string> {
  const lines = [
    `import { defineConfig } from '@wot-ui/ci'`,
    '',
    'export default defineConfig(({ env, packageJson }) => ({',
    '  version: env.WOTCI_VERSION ?? packageJson?.version,',
    '  desc: env.WOTCI_DESC ?? packageJson?.description,',
  ]

  const blocks: Record<Platform, string[]> = {
    alipay: [
      '  alipay: {',
      '    appid: env.ALIPAY_APPID!,',
      '    toolId: env.ALIPAY_TOOL_ID!,',
      `    projectPath: env.ALIPAY_PROJECT_PATH ?? '${await detectPath(cwd, 'alipay')}',`,
      '    privateKeyPath: env.ALIPAY_PRIVATE_KEY_PATH,',
      '    privateKey: env.ALIPAY_PRIVATE_KEY,',
      '    autoincrement: false,',
      '  },',
    ],
    dingtalk: [
      '  dingtalk: {',
      '    appid: env.DINGTALK_APPID!,',
      '    token: env.DINGTALK_TOKEN!,',
      `    projectPath: env.DINGTALK_PROJECT_PATH ?? '${await detectPath(cwd, 'dingtalk')}',`,
      '    autoincrement: false,',
      '  },',
    ],
    weixin: [
      '  weixin: {',
      '    appid: env.WEIXIN_APPID!,',
      `    projectPath: env.WEIXIN_PROJECT_PATH ?? '${await detectPath(cwd, 'weixin')}',`,
      '    privateKeyPath: env.WEIXIN_PRIVATE_KEY_PATH!,',
      '    robot: 1,',
      '    setting: { useProjectConfig: true },',
      '  },',
    ],
  }

  for (const platform of PLATFORM_ORDER) {
    if (platforms.includes(platform))
      lines.push(...blocks[platform], '')
  }

  lines.push(
    '  // release: { buildCommand: \'uni build -p mp-weixin\', prComment: \'auto\' },',
    '  // budgets: { total: \'3MB\', main: \'1.5MB\', warnOnly: true },',
    '}))',
    '',
  )

  return lines.join('\n')
}

async function detectPath(cwd: string, platform: Platform): Promise<string> {
  for (const candidate of DETECT_PATHS[platform]) {
    if (await exists(resolveFromCwd(cwd, candidate)))
      return candidate
  }

  return DEFAULT_PATHS[platform]
}
