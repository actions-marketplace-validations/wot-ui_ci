import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeIde: vi.fn(),
  openIde: vi.fn(),
  previewPlatform: vi.fn(),
  uploadPlatform: vi.fn(),
}))

vi.mock('../src/ide', () => ({
  closeIde: mocks.closeIde,
  openIde: mocks.openIde,
}))

vi.mock('../src/preview', () => ({
  previewPlatform: mocks.previewPlatform,
}))

vi.mock('../src/upload', () => ({
  uploadPlatform: mocks.uploadPlatform,
}))

const { runCli } = await import('../src/cli')
const { PreviewUnsupportedError } = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.previewPlatform.mockResolvedValue({ message: 'preview-ok' })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-preview-'))
  tempDirs.push(cwd)
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  return cwd
}

function createWriters() {
  const stdout: string[] = []
  const stderr: string[] = []

  return {
    stderr,
    stdout,
    writers: {
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
  }
}

describe('runCli preview 子命令', () => {
  it('传递二维码与页面参数', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    const exitCode = await runCli([
      'preview',
      '-p',
      'weixin',
      '--qr-format',
      'image',
      '--qr-output',
      'out/qr.png',
      '--page',
      'pages/index/index',
      '--page-query',
      'a=1',
      '--query',
      'b=2',
      '--scene',
      '1011',
      '--desc',
      'preview',
      '--robot',
      '3',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('正在生成微信小程序预览二维码'))).toBe(true)
    expect(stdout).toContain('[成功] preview-ok')
    expect(mocks.previewPlatform).toHaveBeenCalledWith('weixin', expect.anything(), {
      cwd,
      desc: 'preview',
      pagePath: 'pages/index/index',
      pageQuery: 'a=1',
      qrFormat: 'image',
      qrOutput: 'out/qr.png',
      query: 'b=2',
      robot: 3,
      scene: '1011',
    })
  })

  it('缺少 platform 时返回 1', async () => {
    const { stderr, writers } = createWriters()

    const exitCode = await runCli(['preview'], writers)

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 缺少必填参数：--platform')
  })

  it('预览不支持时按预期错误输出', async () => {
    const cwd = await createProject()
    const { stderr, writers } = createWriters()
    mocks.previewPlatform.mockRejectedValueOnce(new PreviewUnsupportedError('钉钉不支持预览'))

    const exitCode = await runCli(['preview', '-p', 'dingtalk'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('[失败] 钉钉不支持预览')
    expect(stderr.some(line => line.includes('发生未预期错误'))).toBe(false)
  })
})
