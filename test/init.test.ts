import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors'
import { initProject } from '../src/init'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-init-'))
  tempDirs.push(cwd)
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  return cwd
}

describe('initProject', () => {
  it('根据产物目录自动探测平台并生成 TS 配置', async () => {
    const cwd = await createProject()
    await mkdir(path.join(cwd, 'dist/build/mp-weixin'), { recursive: true })

    const result = await initProject({ cwd })

    expect(result.platforms).toEqual(['weixin'])
    expect(result.file).toBe(path.join(cwd, 'wotci.config.ts'))
    expect(result.written).toBe(true)
    const content = await readFile(result.file, 'utf8')
    expect(content).toContain('defineConfig')
    expect(content).toContain('weixin:')
    expect(content).not.toContain('alipay:')
    expect(content).toContain('dist/build/mp-weixin')
  })

  it('显式平台优先并支持 .js 配置', async () => {
    const cwd = await createProject()

    const result = await initProject({
      configFile: 'ci.config.js',
      cwd,
      platforms: ['alipay', 'dingtalk', 'alipay'],
    })

    expect(result.platforms).toEqual(['alipay', 'dingtalk'])
    expect(result.content).toContain('alipay:')
    expect(result.content).toContain('dingtalk:')
  })

  it('没有产物时生成全部平台，并优先使用 dev 目录', async () => {
    const cwd = await createProject()
    await mkdir(path.join(cwd, 'dist/dev/mp-weixin'), { recursive: true })

    const result = await initProject({ cwd })

    expect(result.platforms).toEqual(['weixin'])
    expect(result.content).toContain('dist/dev/mp-weixin')
  })

  it('没有平台提示时返回全部平台占位', async () => {
    const cwd = await createProject()

    const result = await initProject({ cwd })

    expect(result.platforms).toEqual(['weixin', 'alipay', 'dingtalk'])
  })

  it('配置文件已存在时拒绝，--force 覆盖', async () => {
    const cwd = await createProject()
    await writeFile(path.join(cwd, 'wotci.config.ts'), 'old')

    await expect(initProject({ cwd })).rejects.toThrow(ConfigError)

    const result = await initProject({ cwd, force: true })
    expect(await readFile(result.file, 'utf8')).toContain('defineConfig')
  })

  it('dryRun 不写文件', async () => {
    const cwd = await createProject()

    const result = await initProject({ cwd, dryRun: true })

    expect(result.written).toBe(false)
    await expect(readFile(result.file, 'utf8')).rejects.toThrow()
  })

  it('configFile 为空时报错', async () => {
    const cwd = await createProject()

    await expect(initProject({ configFile: '  ', cwd })).rejects.toThrow(ConfigError)
  })

  it('无扩展名时自动补 .ts', async () => {
    const cwd = await createProject()

    const result = await initProject({ configFile: 'custom', cwd })

    expect(result.file).toBe(path.join(cwd, 'custom.ts'))
  })
})
