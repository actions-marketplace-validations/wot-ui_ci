import type {
  IdePreviewRequest,
  IdePreviewResult,
  IdeRequest,
  IdeResult,
  IdeStatusResult,
  PlatformInput,
} from '../types'
import process from 'node:process'
import { loadConfig } from '../config'
import { IdeError, IdeUnsupportedError } from '../errors'
import { normalizePlatform } from '../utils/platform'
import { runAlipayIde } from './alipay'
import {
  autoWeixinIde,
  getWeixinIdeStatus,
  previewWeixinIde,
  runWeixinIde,
} from './weixin'

function isCiEnvironment(): boolean {
  const value = process.env.CI
  return value !== undefined && value !== '' && value !== 'false' && value !== '0'
}

/** 打开微信 / 支付宝开发者工具 */
export async function openIde(platform: PlatformInput, request: IdeRequest = {}): Promise<IdeResult> {
  if (!request.dryRun && isCiEnvironment() && !request.force) {
    throw new IdeError(
      '检测到 CI 环境，默认不启动开发者工具；如确需启动请传 force: true 或 --force。',
      'IDE_CI_BLOCKED',
    )
  }

  const normalized = normalizePlatform(platform)
  if (normalized === 'dingtalk')
    throw new IdeUnsupportedError('钉钉小程序暂不支持通过 CLI 打开开发者工具')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })
  const options = { ...request, cwd: loaded.cwd }

  return normalized === 'alipay'
    ? runAlipayIde('open', loaded.config, options)
    : runWeixinIde('open', loaded.config, options)
}

/** 查询 IDE 安装与登录状态；目前仅微信支持 */
export async function getIdeStatus(
  platform: PlatformInput,
  request: IdeRequest = {},
): Promise<IdeStatusResult> {
  const normalized = normalizePlatform(platform)
  if (normalized !== 'weixin')
    throw new IdeUnsupportedError('当前仅支持查询微信开发者工具状态')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  return getWeixinIdeStatus(loaded.config, { ...request, cwd: loaded.cwd })
}

/** 开启微信开发者工具自动化端口 */
export async function autoIde(
  platform: PlatformInput,
  request: IdeRequest = {},
): Promise<IdeResult> {
  if (!request.dryRun && isCiEnvironment() && !request.force) {
    throw new IdeError(
      '检测到 CI 环境，默认不启动开发者工具自动化；如确需启动请传 force: true 或 --force。',
      'IDE_CI_BLOCKED',
    )
  }

  const normalized = normalizePlatform(platform)
  if (normalized !== 'weixin')
    throw new IdeUnsupportedError('当前仅支持微信开发者工具自动化')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  return autoWeixinIde(loaded.config, { ...request, cwd: loaded.cwd })
}

/** 使用 IDE 自带 CLI 生成预览二维码；目前仅微信支持 */
export async function previewIde(
  platform: PlatformInput,
  request: IdePreviewRequest = {},
): Promise<IdePreviewResult> {
  if (!request.dryRun && isCiEnvironment() && !request.force) {
    throw new IdeError(
      '检测到 CI 环境，默认不启动开发者工具预览；如确需启动请传 force: true 或 --force。',
      'IDE_CI_BLOCKED',
    )
  }

  const normalized = normalizePlatform(platform)
  if (normalized !== 'weixin')
    throw new IdeUnsupportedError('当前仅支持微信开发者工具预览')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  return previewWeixinIde(loaded.config, { ...request, cwd: loaded.cwd })
}

/** 关闭微信项目或退出微信开发者工具；支付宝暂不支持 */
export async function closeIde(platform: PlatformInput, request: IdeRequest = {}): Promise<IdeResult> {
  const normalized = normalizePlatform(platform)
  if (normalized === 'dingtalk')
    throw new IdeUnsupportedError('钉钉小程序暂不支持通过 CLI 关闭开发者工具')
  if (normalized === 'alipay')
    throw new IdeUnsupportedError('支付宝开发者工具暂不支持通过 CLI 关闭或退出')

  const loaded = await loadConfig({
    config: request.config,
    configFile: request.configFile,
    cwd: request.cwd,
  })

  return runWeixinIde(request.quit ? 'quit' : 'close', loaded.config, {
    ...request,
    cwd: loaded.cwd,
  })
}
