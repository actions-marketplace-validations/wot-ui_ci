import type {
  DoctorCheck,
  DoctorRequest,
  DoctorResult,
  DoctorStatus,
  Platform,
  WotciConfig,
} from './types'
import { readFile, stat } from 'node:fs/promises'
import process from 'node:process'
import { CONFIG_FILE_NAMES, LEGACY_CONFIG_FILE_NAME, loadConfig } from './config'
import { getWeixinCliCandidates } from './ide/weixin'
import { exists, isDirectory, resolveFromCwd } from './utils/path'

const MIN_NODE_MAJOR = 20

/** 配置、产物、密钥与可选网络的本地 Doctor 检查 */
export async function runDoctor(request: DoctorRequest = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = []
  const add = (
    status: DoctorStatus,
    id: string,
    title: string,
    message?: string,
    details?: string[],
  ): void => {
    checks.push({
      id,
      status,
      title,
      ...(message ? { message } : {}),
      ...(details?.length ? { details } : {}),
    })
  }

  const nodeMajor = Number(process.versions.node.split('.')[0])
  add(
    nodeMajor >= MIN_NODE_MAJOR ? 'ok' : 'error',
    'node',
    'Node.js 版本',
    `当前 ${process.versions.node}，要求 >= ${MIN_NODE_MAJOR}`,
  )

  let loaded

  try {
    loaded = await loadConfig({ config: request.config, configFile: request.configFile, cwd: request.cwd })
  }
  catch (error) {
    add('error', 'config', '配置加载', error instanceof Error ? error.message : String(error))
    return { checks, ok: false }
  }

  const cwd = loaded.cwd
  const config = loaded.config
  const sourceLabel = loaded.sourceFile ?? loaded.source
  add('ok', 'config', '配置加载', `来源：${sourceLabel}`)

  if (!request.configFile) {
    const conflictFiles = [
      ...CONFIG_FILE_NAMES,
      LEGACY_CONFIG_FILE_NAME,
    ]
    const found: string[] = []

    for (const fileName of conflictFiles) {
      if (await exists(resolveFromCwd(cwd, fileName)))
        found.push(fileName)
    }

    if (found.length > 1) {
      add('warn', 'config-conflict', '配置文件冲突', '检测到多个配置文件，当前使用优先级最高的一个', found)
    }
    else {
      add('ok', 'config-conflict', '配置文件', found.length ? `使用 ${found[0]}` : '未发现配置文件')
    }
  }

  const platforms = (['weixin', 'alipay', 'dingtalk'] as Platform[]).filter(platform => Boolean(config[platform]))
  if (!platforms.length) {
    add('error', 'platforms', '平台配置', '没有配置任何平台（weixin / alipay / dingtalk）')
  }

  if (config.weixin)
    await checkWeixin(config, cwd, add)
  if (config.alipay)
    await checkAlipay(config, cwd, add)
  if (config.dingtalk)
    await checkDingtalk(config, cwd, add)

  checkRelease(config, add)

  if (request.network) {
    for (const platform of platforms) {
      if (platform === 'dingtalk') {
        add('warn', 'network-dingtalk', '网络校验', '钉钉未提供线上版本查询，跳过网络校验')
        continue
      }

      const { getLatestVersion } = await import('./version')

      try {
        const info = await getLatestVersion(platform, { config, cwd })
        add('ok', `network-${platform}`, `${platform} 网络校验`, `线上最新版本：${info.latest ?? '未知'}`)
      }
      catch (error) {
        add(
          'error',
          `network-${platform}`,
          `${platform} 网络校验`,
          '版本查询失败，请检查 appid、私钥与 IP 白名单',
          [error instanceof Error ? error.message : String(error)],
        )
      }
    }
  }

  return {
    checks,
    ok: checks.every(check => check.status !== 'error'),
  }
}

type AddCheck = (
  status: DoctorStatus,
  id: string,
  title: string,
  message?: string,
  details?: string[],
) => void

async function checkWeixin(config: WotciConfig, cwd: string, add: AddCheck): Promise<void> {
  const weixin = config.weixin
  if (!weixin)
    return

  add(weixin.appid ? 'ok' : 'error', 'weixin-appid', '微信 appid', weixin.appid || '未配置')

  const projectPath = resolveFromCwd(cwd, weixin.projectPath)
  add(await isDirectory(projectPath) ? 'ok' : 'error', 'weixin-project', '微信产物目录', projectPath)

  if (await isDirectory(projectPath)) {
    add(
      await exists(resolveFromCwd(projectPath, 'project.config.json')) ? 'ok' : 'error',
      'weixin-project-config',
      '微信 project.config.json',
      '上传必须有 project.config.json',
    )
    add(
      await exists(resolveFromCwd(projectPath, 'app.json')) ? 'ok' : 'warn',
      'weixin-app-json',
      '微信 app.json',
      '未发现 app.json，请确认产物是否完整',
    )
  }

  const privateKeyPath = resolveFromCwd(cwd, weixin.privateKeyPath)
  const keyExists = await exists(privateKeyPath)
  add(keyExists ? 'ok' : 'error', 'weixin-key', '微信私钥文件', privateKeyPath)

  if (keyExists) {
    try {
      const info = await stat(privateKeyPath)
      if (process.platform === 'win32') {
        add('ok', 'weixin-key-permission', '微信私钥权限', 'Windows 跳过权限检查')
      }
      else if ((info.mode & 0o077) !== 0) {
        add('warn', 'weixin-key-permission', '微信私钥权限', '私钥对同组/其他用户可读，建议 chmod 600')
      }
      else {
        add('ok', 'weixin-key-permission', '微信私钥权限', '权限正常')
      }

      const content = await readFile(privateKeyPath, 'utf8')
      add(
        content.includes('-----BEGIN') ? 'ok' : 'warn',
        'weixin-key-format',
        '微信私钥格式',
        '未检测到 PEM 头，请确认是否为代码上传密钥',
      )
    }
    catch (error) {
      add('error', 'weixin-key-read', '微信私钥读取', error instanceof Error ? error.message : String(error))
    }
  }

  const cliPath = (await Promise.all(
    getWeixinCliCandidates({
      configuredPath: weixin.ide?.cliPath ? resolveFromCwd(cwd, weixin.ide.cliPath) : undefined,
      envPath: process.env.WECHAT_DEVTOOLS_CLI,
    }).map(async candidate => (await exists(candidate) ? candidate : undefined)),
  )).find(Boolean)

  if (cliPath)
    add('ok', 'weixin-ide', '微信开发者工具', `已找到：${cliPath}`)
  else if (weixin.ide?.cliPath)
    add('error', 'weixin-ide', '微信开发者工具', `配置的 cliPath 不存在：${weixin.ide.cliPath}`)
  else
    add('warn', 'weixin-ide', '微信开发者工具', '未找到 CLI，open / auto / ide preview 将不可用')
}

async function checkAlipay(config: WotciConfig, cwd: string, add: AddCheck): Promise<void> {
  const alipay = config.alipay
  if (!alipay)
    return

  add(alipay.appid ? 'ok' : 'error', 'alipay-appid', '支付宝 appid', alipay.appid || '未配置')
  add(alipay.toolId ? 'ok' : 'error', 'alipay-tool-id', '支付宝 toolId', alipay.toolId || '未配置')

  const projectPath = resolveFromCwd(cwd, alipay.projectPath)
  add(await isDirectory(projectPath) ? 'ok' : 'error', 'alipay-project', '支付宝产物目录', projectPath)

  if (await isDirectory(projectPath)) {
    add(
      await exists(resolveFromCwd(projectPath, 'app.json')) ? 'ok' : 'warn',
      'alipay-app-json',
      '支付宝 app.json',
      '未发现 app.json，请确认产物是否完整',
    )
  }

  if (alipay.privateKey) {
    add('ok', 'alipay-key', '支付宝私钥', '使用内联 privateKey')
  }
  else if (alipay.privateKeyPath) {
    const privateKeyPath = resolveFromCwd(cwd, alipay.privateKeyPath)
    add(await exists(privateKeyPath) ? 'ok' : 'error', 'alipay-key', '支付宝私钥文件', privateKeyPath)
  }
  else {
    add('error', 'alipay-key', '支付宝私钥', '需要配置 privateKey 或 privateKeyPath')
  }

  if (alipay.ide?.appPath) {
    const appPath = resolveFromCwd(cwd, alipay.ide.appPath)
    add(await exists(appPath) ? 'ok' : 'error', 'alipay-ide', '支付宝开发者工具', appPath)
  }
}

async function checkDingtalk(config: WotciConfig, cwd: string, add: AddCheck): Promise<void> {
  const dingtalk = config.dingtalk
  if (!dingtalk)
    return

  add(dingtalk.appid ? 'ok' : 'error', 'dingtalk-appid', '钉钉 appid', dingtalk.appid || '未配置')
  add(dingtalk.token ? 'ok' : 'error', 'dingtalk-token', '钉钉 token', dingtalk.token ? '已配置' : '未配置')

  const projectPath = resolveFromCwd(cwd, dingtalk.projectPath)
  add(await isDirectory(projectPath) ? 'ok' : 'error', 'dingtalk-project', '钉钉产物目录', projectPath)
}

function checkRelease(config: WotciConfig, add: AddCheck): void {
  const release = config.release
  if (!release)
    return

  if (release.buildCommand !== undefined) {
    const commands = Array.isArray(release.buildCommand) ? release.buildCommand : [release.buildCommand]
    add(
      commands.every(command => typeof command === 'string' && command.trim()) ? 'ok' : 'warn',
      'release-build',
      'release 构建命令',
      commands.filter(Boolean).join(' → ') || '未配置',
    )
  }

  if (release.prComment !== false && process.env.GITHUB_ACTIONS === 'true') {
    const missing = [
      !process.env.GITHUB_TOKEN && !process.env.GH_TOKEN ? 'GITHUB_TOKEN' : '',
      !process.env.GITHUB_REPOSITORY ? 'GITHUB_REPOSITORY' : '',
    ].filter(Boolean)

    add(
      missing.length ? 'warn' : 'ok',
      'release-github',
      'PR 评论环境',
      missing.length ? `缺少 ${missing.join('、')}` : 'GitHub 环境变量齐全',
    )
  }
}
