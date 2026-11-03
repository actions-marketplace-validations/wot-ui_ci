import type {
  PlatformInput,
  PlatformPlan,
  PlatformPlanCheck,
  PreviewOptions,
  UploadOptions,
  WotciConfig,
} from './types'
import process from 'node:process'
import { exists, isDirectory, resolveFromCwd } from './utils/path'
import { normalizePlatform } from './utils/platform'

/** 不调用 SDK、不发起网络的本地校验计划 */
export async function planPlatform(
  platformInput: PlatformInput,
  config: WotciConfig,
  action: 'upload' | 'preview',
  options: UploadOptions | PreviewOptions = {},
): Promise<PlatformPlan> {
  const platform = normalizePlatform(platformInput)
  const cwd = options.cwd ?? process.cwd()
  const checks: PlatformPlanCheck[] = []

  if (platform === 'dingtalk' && action === 'preview') {
    checks.push({ message: '钉钉 SDK 未提供预览能力', name: '平台能力', ok: false })
    return { action, checks, ok: false, platform }
  }

  if (platform === 'weixin') {
    const weixin = config.weixin
    checks.push({ message: weixin ? undefined : '缺少 weixin 配置', name: '配置', ok: Boolean(weixin) })

    if (!weixin)
      return { action, checks, ok: false, platform }

    const projectPath = resolveFromCwd(cwd, weixin.projectPath)
    checks.push({ message: projectPath, name: '产物目录', ok: await isDirectory(projectPath) })

    const privateKeyPath = resolveFromCwd(cwd, weixin.privateKeyPath)
    checks.push({ message: privateKeyPath, name: '私钥', ok: await exists(privateKeyPath) })

    if (action === 'upload') {
      checks.push({ message: config.version, name: '版本号', ok: Boolean(config.version) })
    }

    return createPlan(platform, action, checks, config.version, projectPath)
  }

  if (platform === 'alipay') {
    const alipay = config.alipay
    checks.push({ message: alipay ? undefined : '缺少 alipay 配置', name: '配置', ok: Boolean(alipay) })

    if (!alipay)
      return { action, checks, ok: false, platform }

    const projectPath = resolveFromCwd(cwd, alipay.projectPath)
    checks.push({ message: projectPath, name: '产物目录', ok: await isDirectory(projectPath) })

    const keyMessage = alipay.privateKey
      ? '使用内联 privateKey'
      : alipay.privateKeyPath
        ? resolveFromCwd(cwd, alipay.privateKeyPath)
        : '缺少 privateKey / privateKeyPath'
    const keyOk = Boolean(alipay.privateKey)
      || Boolean(alipay.privateKeyPath && await exists(resolveFromCwd(cwd, alipay.privateKeyPath)))
    checks.push({ message: keyMessage, name: '私钥', ok: keyOk })

    if (action === 'upload' && !alipay.autoincrement) {
      checks.push({ message: config.version, name: '版本号', ok: Boolean(config.version) })
    }

    return createPlan(platform, action, checks, config.version, projectPath)
  }

  const dingtalk = config.dingtalk
  checks.push({ message: dingtalk ? undefined : '缺少 dingtalk 配置', name: '配置', ok: Boolean(dingtalk) })

  if (!dingtalk)
    return { action, checks, ok: false, platform }

  const projectPath = resolveFromCwd(cwd, dingtalk.projectPath)
  checks.push({ message: projectPath, name: '产物目录', ok: await isDirectory(projectPath) })

  if (!dingtalk.autoincrement) {
    checks.push({ message: config.version, name: '版本号', ok: Boolean(config.version) })
  }

  return createPlan(platform, action, checks, config.version, projectPath)
}

function createPlan(
  platform: PlatformPlan['platform'],
  action: PlatformPlan['action'],
  checks: PlatformPlanCheck[],
  version: string | undefined,
  projectPath: string,
): PlatformPlan {
  return {
    action,
    checks,
    ok: checks.every(check => check.ok),
    platform,
    projectPath,
    ...(version ? { version } : {}),
  }
}
