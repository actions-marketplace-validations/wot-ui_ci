import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectContext: vi.fn(),
  readGitInfo: vi.fn(),
  renderComment: vi.fn(() => 'comment-body'),
  runShellCommand: vi.fn(),
  uploadPlatform: vi.fn(),
  upsertComment: vi.fn(),
}))

vi.mock('../src/upload', () => ({
  uploadPlatform: mocks.uploadPlatform,
}))

vi.mock('../src/release/command', () => ({
  runShellCommand: mocks.runShellCommand,
}))

vi.mock('../src/release/git', () => ({
  readGitInfo: mocks.readGitInfo,
}))

vi.mock('../src/release/github', () => ({
  RELEASE_COMMENT_MARKER: '<!-- wotci-release -->',
  detectGitHubPullRequestContext: mocks.detectContext,
  renderReleaseComment: mocks.renderComment,
  upsertReleaseComment: mocks.upsertComment,
}))

const { release } = await import('../src/release')
const { BuildError, ConfigError, ReleaseError, UploadError } = await import('../src/errors')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runShellCommand.mockResolvedValue({ stderr: '', stdout: '' })
  mocks.readGitInfo.mockResolvedValue({ branch: 'main', commit: 'abc1234' })
  mocks.detectContext.mockResolvedValue(undefined)
  mocks.uploadPlatform.mockImplementation(async (platform: string) => {
    if (platform === 'weixin') {
      return {
        message: '微信上传成功',
        platform,
        raw: {},
        sizes: { main: 1024, total: 2048 },
        version: '1.0.0',
      }
    }

    return { message: '支付宝上传成功', platform, raw: {}, version: '1.0.0' }
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-release-'))
  tempDirs.push(cwd)
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  return cwd
}

function createConfig(extra: Record<string, unknown> = {}) {
  return {
    desc: 'release desc',
    release: { buildCommand: 'npm run build' },
    version: '1.0.0',
    weixin: {
      appid: 'wx123',
      privateKeyPath: 'key',
      projectPath: 'dist/weixin',
    },
    alipay: {
      appid: 'ali123',
      privateKey: 'key',
      projectPath: 'dist/alipay',
      toolId: 'tool-id',
    },
    ...extra,
  }
}

describe('release 主流程', () => {
  it('构建后按顺序上传并写入历史', async () => {
    const cwd = await createProject()

    const result = await release({ config: createConfig(), cwd })

    expect(mocks.runShellCommand).toHaveBeenCalledWith('npm run build', { cwd })
    expect(mocks.uploadPlatform).toHaveBeenNthCalledWith(1, 'weixin', expect.anything(), { cwd })
    expect(mocks.uploadPlatform).toHaveBeenNthCalledWith(2, 'alipay', expect.anything(), { cwd })
    expect(result.ok).toBe(true)
    expect(result.platforms).toHaveLength(2)
    expect(result.platforms[0].sizes).toEqual({ main: 1024, total: 2048 })
    expect(result.historyFile).toBe(path.join(cwd, '.wotci/history.json'))

    const history = JSON.parse(await readFile(result.historyFile!, 'utf8')) as {
      version: number
      records: Array<Record<string, unknown>>
    }
    expect(history.version).toBe(1)
    expect(history.records).toHaveLength(1)
    expect(history.records[0]).toMatchObject({
      ok: true,
      version: '1.0.0',
      git: { branch: 'main', commit: 'abc1234' },
    })
  })

  it('单个平台失败不中断其它平台，历史记录失败', async () => {
    const cwd = await createProject()
    mocks.uploadPlatform.mockImplementation(async (platform: string) => {
      if (platform === 'alipay')
        throw new UploadError('支付宝上传失败', new Error('sdk error'))
      return { message: '微信上传成功', platform, raw: {}, version: '1.0.0' }
    })

    const result = await release({ config: createConfig(), cwd })

    expect(result.ok).toBe(false)
    expect(result.platforms).toHaveLength(2)
    expect(result.platforms[0].ok).toBe(true)
    expect(result.platforms[1]).toMatchObject({
      ok: false,
      platform: 'alipay',
      error: { code: 'UPLOAD_ERROR', message: '支付宝上传失败', cause: ['原因 1: sdk error'] },
    })
  })

  it('非 WotCIError 的上传异常使用 RELEASE_ERROR 错误码', async () => {
    const cwd = await createProject()
    mocks.uploadPlatform.mockRejectedValueOnce(new Error('plain failure'))

    const result = await release({ config: createConfig(), cwd, platforms: ['weixin'] })

    expect(result.platforms[0].error).toMatchObject({
      code: 'RELEASE_ERROR',
      message: 'plain failure',
    })
  })

  it('构建失败时不再上传，并返回 build error', async () => {
    const cwd = await createProject()
    mocks.runShellCommand.mockRejectedValueOnce(new BuildError('build failed'))

    const result = await release({ config: createConfig(), cwd })

    expect(result.ok).toBe(false)
    expect(result.build).toMatchObject({
      ok: false,
      skipped: false,
      error: { code: 'BUILD_ERROR', message: 'build failed' },
    })
    expect(result.platforms).toEqual([])
    expect(mocks.uploadPlatform).not.toHaveBeenCalled()
  })

  it('skipBuild 跳过构建但仍记录命令', async () => {
    const cwd = await createProject()

    const result = await release({ config: createConfig(), cwd, skipBuild: true })

    expect(mocks.runShellCommand).not.toHaveBeenCalled()
    expect(result.build).toMatchObject({
      commands: ['npm run build'],
      ok: true,
      skipped: true,
    })
  })

  it('支持 buildCommand 数组与命令行覆盖', async () => {
    const cwd = await createProject()

    await release({
      buildCommand: ['npm ci', 'npm run build'],
      config: createConfig(),
      cwd,
    })

    expect(mocks.runShellCommand).toHaveBeenNthCalledWith(1, 'npm ci', { cwd })
    expect(mocks.runShellCommand).toHaveBeenNthCalledWith(2, 'npm run build', { cwd })
  })

  it('dryRun 不执行构建/上传/历史/评论', async () => {
    const cwd = await createProject()

    const result = await release({ config: createConfig(), cwd, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.build.commands).toEqual(['npm run build'])
    expect(result.platforms.map(item => item.platform)).toEqual(['weixin', 'alipay'])
    expect(mocks.runShellCommand).not.toHaveBeenCalled()
    expect(mocks.uploadPlatform).not.toHaveBeenCalled()
    expect(result.historyFile).toBeUndefined()
    expect(mocks.upsertComment).not.toHaveBeenCalled()
  })

  it('没有可发布平台时抛出 ConfigError', async () => {
    const cwd = await createProject()

    await expect(release({ config: { version: '1.0.0' }, cwd }))
      .rejects
      .toThrow(ConfigError)
  })

  it('release.platforms 与显式 platforms 覆盖默认顺序并去重', async () => {
    const cwd = await createProject()

    await release({
      config: createConfig({ release: { platforms: ['alipay'] } }),
      cwd,
    })
    expect(mocks.uploadPlatform).toHaveBeenLastCalledWith('alipay', expect.anything(), { cwd })

    mocks.uploadPlatform.mockClear()
    await release({
      config: createConfig(),
      cwd,
      platforms: ['alipay', 'alipay'],
    })
    expect(mocks.uploadPlatform).toHaveBeenCalledTimes(1)
  })

  it('history:false 不写历史，历史损坏时仅记录 historyError', async () => {
    const cwd = await createProject()

    const disabled = await release({ config: createConfig(), cwd, history: false })
    expect(disabled.historyFile).toBeUndefined()

    await mkdir(path.join(cwd, '.wotci'), { recursive: true })
    await writeFile(path.join(cwd, '.wotci/history.json'), '{ invalid')

    const broken = await release({ config: createConfig(), cwd })
    expect(broken.ok).toBe(true)
    expect(broken.historyError).toContain('解析发布历史失败')
  })
})

describe('release PR 评论', () => {
  it('检测到 PR 时创建/更新评论', async () => {
    const cwd = await createProject()
    const context = {
      apiUrl: 'https://api.github.com',
      owner: 'wot-ui',
      prNumber: 1,
      repo: 'ci',
      serverUrl: 'https://github.com',
      token: 'token',
    }
    mocks.detectContext.mockResolvedValueOnce(context)
    mocks.upsertComment.mockResolvedValueOnce({ updated: true, url: 'https://comment/1' })

    const result = await release({ config: createConfig(), cwd })

    expect(mocks.upsertComment).toHaveBeenCalledWith(context, 'comment-body')
    expect(result.commentUrl).toBe('https://comment/1')
  })

  it('评论失败不阻塞发布', async () => {
    const cwd = await createProject()
    mocks.detectContext.mockResolvedValueOnce({ token: 't' })
    mocks.upsertComment.mockRejectedValueOnce(new ReleaseError('comment failed'))

    const result = await release({ config: createConfig(), cwd })

    expect(result.ok).toBe(true)
    expect(result.commentError).toBe('comment failed')
  })

  it('prComment:true 但没有 PR 上下文时给出 warning', async () => {
    const cwd = await createProject()

    const result = await release({ config: createConfig(), cwd, prComment: true })

    expect(result.ok).toBe(true)
    expect(result.commentError).toContain('未检测到 GitHub PR 上下文')
  })

  it('prComment:false 不检测 PR', async () => {
    const cwd = await createProject()

    await release({ config: createConfig(), cwd, prComment: false })

    expect(mocks.detectContext).not.toHaveBeenCalled()
    expect(mocks.upsertComment).not.toHaveBeenCalled()
  })
})
