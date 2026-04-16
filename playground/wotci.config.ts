import { defineConfig } from '../src'

function resolveOptionalString(value?: string): string | undefined {
  if (value == null)
    return undefined

  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function resolvePlaygroundPath(value: string | undefined, fallback: string): string {
  const resolved = resolveOptionalString(value)
  if (!resolved)
    return fallback

  return resolved.startsWith('playground/')
    ? resolved.slice('playground/'.length)
    : resolved
}

function resolveWeixinRobot(value?: string): number {
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

function resolveBoolean(value?: string): boolean | undefined {
  if (value == null || value === '')
    return undefined
  return value === 'true'
}

export default defineConfig(({ env, packageJson }) => ({
  version: resolveOptionalString(env.WOTCI_VERSION) ?? packageJson?.version,
  desc: resolveOptionalString(env.WOTCI_DESC) ?? packageJson?.description,
  weixin: env.WEIXIN_APPID
    ? {
        appid: env.WEIXIN_APPID,
        privateKeyPath: resolvePlaygroundPath(env.WEIXIN_PRIVATE_KEY_PATH, 'keys/weixin.private.key'),
        projectPath: resolvePlaygroundPath(env.WEIXIN_PROJECT_PATH, 'dist/build/mp-weixin'),
        robot: resolveWeixinRobot(env.WEIXIN_ROBOT),
        setting: {
          useProjectConfig: true,
        },
      }
    : undefined,
  alipay: env.ALIPAY_APPID && env.ALIPAY_TOOL_ID
    ? {
        toolId: env.ALIPAY_TOOL_ID,
        appid: env.ALIPAY_APPID,
        privateKey: env.ALIPAY_PRIVATE_KEY!,
        projectPath: resolvePlaygroundPath(env.ALIPAY_PROJECT_PATH, 'dist/build/mp-alipay'),
        autoincrement: resolveBoolean(env.ALIPAY_AUTOINCREMENT) ?? true,
      }
    : undefined,
  dingtalk: env.DINGTALK_APPID && env.DINGTALK_TOKEN
    ? {
        appid: env.DINGTALK_APPID,
        token: env.DINGTALK_TOKEN,
        projectPath: resolvePlaygroundPath(env.DINGTALK_PROJECT_PATH, 'dist/build/mp-alipay'),
        autoincrement: resolveBoolean(env.DINGTALK_AUTOINCREMENT) ?? true,
      }
    : undefined,
}))
