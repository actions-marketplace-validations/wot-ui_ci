import type { AlipayClientType } from '../src'
import { defineConfig } from '../src'

function resolveWeixinRobot(value?: string): number {
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

function resolveBoolean(value?: string): boolean | undefined {
  if (value == null || value === '')
    return undefined
  return value === 'true'
}

function resolveAlipayClientType(value?: string): AlipayClientType {
  return (value ?? 'alipay') as AlipayClientType
}

function createAlipayConfig(env: NodeJS.ProcessEnv) {
  if (!env.ALIPAY_APPID || !env.ALIPAY_TOOL_ID)
    return undefined

  const baseConfig = {
    appid: env.ALIPAY_APPID,
    toolId: env.ALIPAY_TOOL_ID,
    projectPath: env.ALIPAY_PROJECT_PATH ?? 'dist/build/mp-alipay',
    clientType: resolveAlipayClientType(env.ALIPAY_CLIENT_TYPE),
    autoincrement: resolveBoolean(env.ALIPAY_AUTOINCREMENT) ?? true,
  }

  if (env.ALIPAY_PRIVATE_KEY) {
    return {
      ...baseConfig,
      privateKey: env.ALIPAY_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }
  }

  if (env.ALIPAY_PRIVATE_KEY_PATH) {
    return {
      ...baseConfig,
      privateKeyPath: env.ALIPAY_PRIVATE_KEY_PATH,
    }
  }

  return undefined
}

export default defineConfig(({ env, packageJson }) => ({
  version: env.MINICI_VERSION ?? packageJson?.version,
  desc: env.MINICI_DESC ?? packageJson?.description,
  weixin: env.WEIXIN_APPID
    ? {
        appid: env.WEIXIN_APPID,
        privateKeyPath: env.WEIXIN_PRIVATE_KEY_PATH ?? 'keys/weixin.private.key',
        projectPath: env.WEIXIN_PROJECT_PATH ?? 'dist/build/mp-weixin',
        robot: resolveWeixinRobot(env.WEIXIN_ROBOT),
        setting: {
          useProjectConfig: true,
        },
      }
    : undefined,
  alipay: createAlipayConfig(env),
  dingtalk: env.DINGTALK_APPID && env.DINGTALK_TOKEN
    ? {
        appid: env.DINGTALK_APPID,
        token: env.DINGTALK_TOKEN,
        projectPath: env.DINGTALK_PROJECT_PATH ?? 'dist/build/mp-dingtalk',
        autoincrement: resolveBoolean(env.DINGTALK_AUTOINCREMENT) ?? true,
      }
    : undefined,
}))
