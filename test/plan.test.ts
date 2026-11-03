import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planPlatform } from '../src/plan'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-plan-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await mkdir(path.join(cwd, 'dist/alipay'), { recursive: true })
  await mkdir(path.join(cwd, 'dist/dingtalk'), { recursive: true })
  await mkdir(path.join(cwd, 'keys'), { recursive: true })
  await writeFile(path.join(cwd, 'keys/weixin.key'), 'key')
  await writeFile(path.join(cwd, 'keys/alipay.key'), 'key')
  return cwd
}

function weixinConfig(extra: Record<string, unknown> = {}) {
  return {
    weixin: {
      appid: 'wx',
      privateKeyPath: 'keys/weixin.key',
      projectPath: 'dist/weixin',
      ...extra,
    },
  }
}

describe('planPlatform: 微信', () => {
  it('上传计划通过', async () => {
    const cwd = await createFixture()

    const plan = await planPlatform('weixin', { version: '1.0.0', ...weixinConfig() }, 'upload', { cwd })

    expect(plan.ok).toBe(true)
    expect(plan.checks.map(check => check.name)).toContain('私钥')
    expect(plan.version).toBe('1.0.0')
  })

  it('缺少版本、私钥、目录或配置时失败', async () => {
    const cwd = await createFixture()

    await expect(planPlatform('weixin', weixinConfig(), 'upload', { cwd }))
      .resolves
      .toMatchObject({ ok: false })

    await expect(planPlatform('weixin', {
      version: '1.0.0',
      ...weixinConfig({ privateKeyPath: 'keys/missing.key' }),
    }, 'upload', { cwd })).resolves.toMatchObject({ ok: false })

    await expect(planPlatform('weixin', {
      version: '1.0.0',
      ...weixinConfig({ projectPath: 'dist/missing' }),
    }, 'upload', { cwd })).resolves.toMatchObject({ ok: false })

    await expect(planPlatform('weixin', {}, 'upload', { cwd })).resolves.toMatchObject({ ok: false })
  })

  it('不传 cwd 时使用 process.cwd()', async () => {
    const cwd = await createFixture()

    const plan = await planPlatform('weixin', {
      version: '1.0.0',
      weixin: {
        appid: 'wx',
        privateKeyPath: path.join(cwd, 'keys/weixin.key'),
        projectPath: path.join(cwd, 'dist/weixin'),
      },
    }, 'upload')

    expect(plan.ok).toBe(true)
  })

  it('预览不要求版本', async () => {
    const cwd = await createFixture()

    const plan = await planPlatform('weixin', weixinConfig(), 'preview', { cwd })

    expect(plan.ok).toBe(true)
    expect(plan.checks.some(check => check.name === '版本号')).toBe(false)
  })
})

describe('planPlatform: 支付宝', () => {
  it('内联私钥与自动递增计划', async () => {
    const cwd = await createFixture()

    const plan = await planPlatform('alipay', {
      alipay: {
        appid: 'ali',
        autoincrement: true,
        privateKey: 'inline',
        projectPath: 'dist/alipay',
        toolId: 'tool',
      },
    }, 'upload', { cwd })

    expect(plan.ok).toBe(true)
    expect(plan.checks.some(check => check.name === '版本号')).toBe(false)
  })

  it('私钥文件/版本缺失时失败', async () => {
    const cwd = await createFixture()

    await expect(planPlatform('alipay', {
      version: '1.0.0',
      alipay: {
        appid: 'ali',
        privateKeyPath: 'keys/missing.key',
        projectPath: 'dist/alipay',
        toolId: 'tool',
      },
    }, 'upload', { cwd })).resolves.toMatchObject({ ok: false })

    await expect(planPlatform('alipay', {
      alipay: {
        appid: 'ali',
        privateKey: 'inline',
        projectPath: 'dist/alipay',
        toolId: 'tool',
      },
    }, 'upload', { cwd })).resolves.toMatchObject({ ok: false })

    await expect(planPlatform('alipay', {}, 'upload', { cwd })).resolves.toMatchObject({ ok: false })

    const noKey = await planPlatform('alipay', {
      version: '1.0.0',
      alipay: {
        appid: 'ali',
        projectPath: 'dist/alipay',
        toolId: 'tool',
      },
    }, 'upload', { cwd })
    expect(noKey.checks.some(check => check.name === '私钥' && !check.ok)).toBe(true)
  })
})

describe('planPlatform: 钉钉', () => {
  it('上传计划与版本校验', async () => {
    const cwd = await createFixture()

    const ok = await planPlatform('dingtalk', {
      version: '1.0.0',
      dingtalk: { appid: 'dd', projectPath: 'dist/dingtalk', token: 'token' },
    }, 'upload', { cwd })
    expect(ok.ok).toBe(true)

    const fail = await planPlatform('dingtalk', {
      dingtalk: { appid: 'dd', projectPath: 'dist/dingtalk', token: 'token' },
    }, 'upload', { cwd })
    expect(fail.ok).toBe(false)

    const auto = await planPlatform('dingtalk', {
      dingtalk: { appid: 'dd', autoincrement: true, projectPath: 'dist/dingtalk', token: 'token' },
    }, 'upload', { cwd })
    expect(auto.ok).toBe(true)
  })

  it('预览返回不支持', async () => {
    const cwd = await createFixture()

    const missing = await planPlatform('dingtalk', {}, 'upload', { cwd })
    expect(missing.ok).toBe(false)

    const plan = await planPlatform('dingtalk', {}, 'preview', { cwd })

    expect(plan).toMatchObject({
      checks: [expect.objectContaining({ name: '平台能力', ok: false })],
      ok: false,
    })
  })
})
