import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  vi.doUnmock('minidev')
  vi.resetModules()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-preview-alipay-'))
  tempDirs.push(cwd)
  await mkdir(path.join(cwd, 'dist/alipay'), { recursive: true })
  return cwd
}

describe('minidev 缺少 preview 能力', () => {
  it('抛出 PreviewError', async () => {
    const cwd = await createFixture()

    vi.doMock('minidev', () => {
      const minidev = {
        app: { getUploadedVersion: vi.fn(async () => '1.0.0') },
        preview: undefined,
        upload: vi.fn(),
      }

      return {
        minidev,
        useDefaults: vi.fn(),
        default: { minidev, useDefaults: vi.fn() },
      }
    })

    const { previewAlipay } = await import('../src/platforms/alipay')

    await expect(previewAlipay({
      alipay: {
        appid: 'ali123',
        privateKey: 'key',
        projectPath: 'dist/alipay',
        toolId: 'tool-id',
      },
    }, { cwd }))
      .rejects
      .toThrow('minidev 未提供 preview 能力')
  })
})
