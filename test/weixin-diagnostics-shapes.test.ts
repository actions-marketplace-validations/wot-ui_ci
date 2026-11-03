import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []

afterEach(async () => {
  vi.doUnmock('miniprogram-ci')
  vi.resetModules()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-diagnostics-shape-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/weixin'), { recursive: true })
  await writeFile(path.join(cwd, 'weixin.key'), 'key')
  return cwd
}

describe('weixin-diagnostics 导出形态', () => {
  it('miniprogram-ci 无法解析时抛出加载错误', async () => {
    const cwd = await createProject()
    vi.resetModules()
    vi.doMock('miniprogram-ci', () => ({ default: 'not-a-module' }))
    const { buildNpm } = await import('../src/weixin-diagnostics')

    await expect(buildNpm('weixin', {
      config: {
        weixin: {
          appid: 'wx123',
          privateKeyPath: 'weixin.key',
          projectPath: 'dist/weixin',
        },
      },
      cwd,
    }))
      .rejects
      .toThrow('miniprogram-ci 加载失败')
  })
})
