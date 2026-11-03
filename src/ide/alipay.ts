import type { AlipayConfig, IdeAction, IdeOptions, IdeResult, WotciConfig } from '../types'
import process from 'node:process'
import * as minidevModule from 'minidev'
import { ConfigError, IdeUnsupportedError } from '../errors'
import { isDirectory, resolveFromCwd } from '../utils/path'

interface AlipayIdeRuntime {
  startIde: (options: { project: string, appPath?: string }) => Promise<void>
}

function resolveAlipayIdeRuntime(): AlipayIdeRuntime {
  const namespace = minidevModule as unknown as {
    default?: unknown
    minidev?: Partial<AlipayIdeRuntime>
  }

  let sdk: Partial<AlipayIdeRuntime> | undefined = namespace.minidev

  if (!sdk && namespace.default && typeof namespace.default === 'object') {
    const defaultExport = namespace.default as {
      minidev?: Partial<AlipayIdeRuntime>
      startIde?: AlipayIdeRuntime['startIde']
    }
    sdk = defaultExport.minidev ?? defaultExport
  }

  if (!sdk || typeof sdk.startIde !== 'function')
    throw new IdeUnsupportedError('minidev 未提供 startIde 能力，无法打开支付宝开发者工具')

  return sdk as AlipayIdeRuntime
}

function getAlipayConfig(config: WotciConfig): AlipayConfig {
  if (!config.alipay)
    throw new ConfigError('缺少支付宝小程序配置（alipay）')
  return config.alipay
}

async function resolveProjectPath(config: AlipayConfig, cwd: string): Promise<string> {
  const projectPath = resolveFromCwd(cwd, config.projectPath)
  if (!await isDirectory(projectPath))
    throw new ConfigError(`支付宝小程序产物目录不存在：${projectPath}`)
  return projectPath
}

export async function runAlipayIde(
  action: IdeAction,
  config: WotciConfig,
  options: IdeOptions = {},
): Promise<IdeResult> {
  if (action !== 'open')
    throw new IdeUnsupportedError('支付宝开发者工具暂不支持通过 CLI 关闭或退出')

  const alipay = getAlipayConfig(config)
  const cwd = options.cwd ?? process.cwd()
  const projectPath = await resolveProjectPath(alipay, cwd)
  const runtime = resolveAlipayIdeRuntime()
  const appPath = alipay.ide?.appPath
    ? resolveFromCwd(cwd, alipay.ide.appPath)
    : undefined

  if (options.dryRun) {
    return {
      action,
      executed: false,
      message: `将执行：minidev.startIde({ project: '${projectPath}'${appPath ? `, appPath: '${appPath}'` : ''} })`,
      platform: 'alipay',
      projectPath,
    }
  }

  await runtime.startIde({
    project: projectPath,
    ...(appPath ? { appPath } : {}),
  })

  return {
    action,
    executed: true,
    message: `已在支付宝小程序开发者工具中打开：${projectPath}`,
    platform: 'alipay',
    projectPath,
  }
}
