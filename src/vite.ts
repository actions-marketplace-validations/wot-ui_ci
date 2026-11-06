import type { Plugin } from 'vite'
import type {
  BatchRequest,
  BatchResult,
  PlatformInput,
  PreviewOptions,
  UserConfig,
} from './types'
import process from 'node:process'
import { createConsola } from 'consola'
import { previewMany, uploadMany } from './batch'
import { formatVersionResolution } from './output/version'

export interface WotciViteOptions {
  /** 构建完成后的动作，默认 preview；false 关闭 */
  action?: 'preview' | 'upload' | false
  /** 配置解析目录，默认 Vite root */
  cwd?: string
  /** 内联配置 */
  config?: UserConfig
  /** 显式配置文件 */
  configFile?: string
  /** 是否启用，默认 true */
  enabled?: boolean
  /** 动作失败时是否让构建失败，默认 true */
  failOnError?: boolean
  /** 目标平台，缺省从 UNI_PLATFORM 推断 */
  platforms?: PlatformInput[]
  /** 预览选项 */
  preview?: Omit<PreviewOptions, 'cwd'>
  /** 批量并发数 */
  concurrency?: number
  /** dry-run */
  dryRun?: boolean
  /** 结果回调 */
  onResult?: (result: BatchResult<unknown>) => void
}

const UNI_PLATFORM_MAP: Record<string, PlatformInput> = {
  'mp-alipay': 'alipay',
  'mp-dingtalk': 'dingtalk',
  'mp-weixin': 'weixin',
}

/** uni-app / Vite 构建完成后自动预览或上传 */
export function wotciPlugin(options: WotciViteOptions = {}): Plugin {
  let root = options.cwd ?? process.cwd()
  let command = 'build'
  let done = false
  let logger = createConsola().withTag('wotci')

  return {
    apply: 'build',
    enforce: 'post',
    name: 'wot-ui-ci',

    configResolved(config) {
      root = options.cwd ?? config.root
      command = config.command
      logger = {
        ...logger,
        error: (...args: unknown[]) => config.logger.error(`[wotci] ${args.join(' ')}`),
        info: (...args: unknown[]) => config.logger.info(`[wotci] ${args.join(' ')}`),
        warn: (...args: unknown[]) => config.logger.warn(`[wotci] ${args.join(' ')}`),
      } as typeof logger
    },

    async closeBundle() {
      if (done || options.enabled === false || options.action === false || command !== 'build')
        return

      done = true
      const action = options.action ?? 'preview'
      const platforms = options.platforms ?? inferPlatforms()
      const request: BatchRequest = {
        concurrency: options.concurrency,
        config: options.config,
        configFile: options.configFile,
        cwd: root,
        dryRun: options.dryRun,
        platforms,
        ...(action === 'preview' ? options.preview : {}),
      }

      const result = action === 'upload'
        ? await uploadMany(request)
        : await previewMany(request)

      options.onResult?.(result)

      for (const line of formatVersionResolution(result.versionResolution))
        logger.info(line)

      for (const item of result.results) {
        if (item.ok)
          logger.info(`${item.platform} ${action} 成功`)
        else
          logger.error(`${item.platform} ${action} 失败：${item.error?.message ?? '未知错误'}`)
      }

      if (!result.ok && (options.failOnError ?? true))
        throw new Error(`wot-ui-ci ${action} 失败，请查看构建日志`)
    },
  }
}

function inferPlatforms(): PlatformInput[] | undefined {
  const platform = process.env.UNI_PLATFORM
  return platform && UNI_PLATFORM_MAP[platform] ? [UNI_PLATFORM_MAP[platform]] : undefined
}

export default wotciPlugin
