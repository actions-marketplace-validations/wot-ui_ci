import type { ReleaseResult } from '../src/types'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReleaseError } from '../src/errors'
import {
  detectGitHubPullRequestContext,
  RELEASE_COMMENT_MARKER,
  renderReleaseComment,
  upsertReleaseComment,
} from '../src/release/github'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createEventFile(event: unknown): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-github-'))
  tempDirs.push(cwd)
  const file = path.join(cwd, 'event.json')
  await writeFile(file, JSON.stringify(event))
  return file
}

function createResult(overrides: Partial<ReleaseResult> = {}): ReleaseResult {
  return {
    build: { commands: ['npm run build'], durationMs: 1000, ok: true, skipped: false },
    dryRun: false,
    durationMs: 5000,
    git: { branch: 'main', commit: 'abc1234' },
    ok: false,
    platforms: [
      {
        durationMs: 2000,
        message: '微信上传成功',
        ok: true,
        platform: 'weixin',
        sizes: { main: 1024 * 1024, total: 2 * 1024 * 1024 },
        version: '1.0.0',
      },
      {
        durationMs: 3000,
        error: { cause: ['原因 1: sdk down'], code: 'UPLOAD_ERROR', message: '支付宝上传失败' },
        message: '支付宝上传失败',
        ok: false,
        platform: 'alipay',
      },
    ],
    version: '1.0.0',
    ...overrides,
  }
}

function createResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('detectGitHubPullRequestContext', () => {
  it('从 GITHUB_REF 解析 PR', async () => {
    const context = await detectGitHubPullRequestContext({
      GITHUB_API_URL: 'https://api.github.com/',
      GITHUB_REF: 'refs/pull/42/merge',
      GITHUB_REPOSITORY: 'wot-ui/ci',
      GITHUB_RUN_ID: '100',
      GITHUB_SERVER_URL: 'https://github.com/',
      GITHUB_TOKEN: 'token',
    })

    expect(context).toMatchObject({
      owner: 'wot-ui',
      prNumber: 42,
      repo: 'ci',
      runUrl: 'https://github.com/wot-ui/ci/actions/runs/100',
    })

    const withGhToken = await detectGitHubPullRequestContext({
      GH_TOKEN: 'gh-token',
      GITHUB_REF: 'refs/pull/43/merge',
      GITHUB_REPOSITORY: 'wot-ui/ci',
    })
    expect(withGhToken?.prNumber).toBe(43)
  })

  it('从 event 文件的 issue 字段解析 PR', async () => {
    const eventPath = await createEventFile({ issue: { number: 8 } })

    const context = await detectGitHubPullRequestContext({
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'wot-ui/ci',
      GITHUB_TOKEN: 'token',
    })

    expect(context?.prNumber).toBe(8)
  })

  it('从 event 文件解析 PR', async () => {
    const eventPath = await createEventFile({ pull_request: { number: 7 } })

    const context = await detectGitHubPullRequestContext({
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'wot-ui/ci',
      GITHUB_TOKEN: 'token',
    })

    expect(context?.prNumber).toBe(7)
  })

  it('缺少 token / repo / PR 时返回 undefined', async () => {
    expect(await detectGitHubPullRequestContext({})).toBeUndefined()
    expect(await detectGitHubPullRequestContext({ GITHUB_REPOSITORY: 'wot-ui/ci' })).toBeUndefined()
    expect(await detectGitHubPullRequestContext({
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'wot-ui/ci',
      GITHUB_TOKEN: 'token',
    })).toBeUndefined()
    expect(await detectGitHubPullRequestContext({
      GITHUB_REF: 'refs/pull/1/merge',
      GITHUB_REPOSITORY: 'invalid',
      GITHUB_TOKEN: 'token',
    })).toBeUndefined()
  })

  it('event 文件损坏时回退到 GITHUB_REF', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-github-'))
    tempDirs.push(cwd)
    const eventPath = path.join(cwd, 'event.json')
    await writeFile(eventPath, '{ invalid')

    const context = await detectGitHubPullRequestContext({
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: 'refs/pull/9/merge',
      GITHUB_REPOSITORY: 'wot-ui/ci',
      GITHUB_TOKEN: 'token',
    })

    expect(context?.prNumber).toBe(9)
  })
})

describe('renderReleaseComment', () => {
  it('输出表格、构建、提交、运行链接与失败详情', () => {
    const body = renderReleaseComment(createResult(), { runUrl: 'https://run/1' })

    expect(body).toContain(RELEASE_COMMENT_MARKER)
    expect(body).toContain('❌ 小程序发布失败')
    expect(body).toContain('| weixin | ✅ | 1.0.0 | 2.00MB | 1.00MB | 2.0s |')
    expect(body).toContain('| alipay | ❌ | - | - | - | 3.0s |')
    expect(body).toContain('`npm run build`')
    expect(body).toContain('abc1234')
    expect(body).toContain('[GitHub Actions](https://run/1)')
    expect(body).toContain('支付宝上传失败')
    expect(body).toContain('sdk down')
  })

  it('没有平台/构建时使用占位', () => {
    const body = renderReleaseComment(createResult({
      build: { commands: [], durationMs: 0, ok: true, skipped: true },
      platforms: [],
    }))

    expect(body).toContain('| - | - | - | - | - | - |')
    expect(body).toContain('跳过')
  })

  it('成功、无分支、空构建命令与失败无详情', () => {
    const body = renderReleaseComment(createResult({
      build: { commands: [], durationMs: 0, ok: false, skipped: false },
      git: { commit: 'def5678' },
      ok: true,
      platforms: [
        {
          durationMs: 1000,
          error: { code: 'UPLOAD_ERROR', message: '' },
          message: '',
          ok: false,
          platform: 'weixin',
        },
      ],
    }))

    expect(body).toContain('✅ 小程序发布成功')
    expect(body).toContain('- 构建：未配置（失败）')
    expect(body).toContain('`def5678`')
    expect(body).toContain('未知错误')
  })

  it('没有 git 信息时不输出提交行', () => {
    const body = renderReleaseComment(createResult({ git: undefined }))

    expect(body).not.toContain('- 提交：')
  })
})

describe('upsertReleaseComment', () => {
  const context = {
    apiUrl: 'https://api.github.com',
    owner: 'wot-ui',
    prNumber: 1,
    repo: 'ci',
    serverUrl: 'https://github.com',
    token: 'token',
  }

  it('没有旧评论时创建', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse([]))
      .mockResolvedValueOnce(createResponse({ html_url: 'https://comment/1' }))

    const result = await upsertReleaseComment(context, 'body', fetchMock)

    expect(result).toEqual({ updated: false, url: 'https://comment/1' })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/wot-ui/ci/issues/1/comments',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('已有 marker 评论时更新', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse([
        { body: `old\n${RELEASE_COMMENT_MARKER}`, html_url: 'https://comment/old', id: 10 },
      ]))
      .mockResolvedValueOnce(createResponse({ html_url: 'https://comment/10' }))

    const result = await upsertReleaseComment(context, 'body', fetchMock)

    expect(result).toEqual({ updated: true, url: 'https://comment/10' })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/wot-ui/ci/issues/1/comments/10',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('列表或写入失败时抛出 ReleaseError', async () => {
    await expect(upsertReleaseComment(context, 'body', vi.fn(async () => createResponse({}, false, 500))))
      .rejects
      .toThrow('获取 PR 评论失败')

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse([]))
      .mockResolvedValueOnce(createResponse({}, false, 403))

    await expect(upsertReleaseComment(context, 'body', fetchMock))
      .rejects
      .toThrow('创建 PR 评论失败')
  })

  it('更新评论响应没有 html_url 时回退旧链接', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse([
        { body: RELEASE_COMMENT_MARKER, html_url: 'https://comment/old', id: 10 },
      ]))
      .mockResolvedValueOnce(createResponse({}))

    await expect(upsertReleaseComment(context, 'body', fetchMock))
      .resolves
      .toEqual({ updated: true, url: 'https://comment/old' })
  })

  it('更新评论且新旧链接都为空时返回空字符串', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse([
        { body: RELEASE_COMMENT_MARKER, id: 10 },
      ]))
      .mockResolvedValueOnce(createResponse({}))

    await expect(upsertReleaseComment(context, 'body', fetchMock))
      .resolves
      .toEqual({ updated: true, url: '' })
  })

  it('创建评论响应没有 html_url 时返回空字符串', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse([]))
      .mockResolvedValueOnce(createResponse({}))

    await expect(upsertReleaseComment(context, 'body', fetchMock))
      .resolves
      .toEqual({ updated: false, url: '' })
  })

  it('更新评论失败时抛出 ReleaseError', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse([
        { body: RELEASE_COMMENT_MARKER, html_url: 'https://comment/old', id: 10 },
      ]))
      .mockResolvedValueOnce(createResponse({}, false, 500))

    await expect(upsertReleaseComment(context, 'body', fetchMock))
      .rejects
      .toThrow('更新 PR 评论失败')
  })

  it('读取错误响应体失败时使用空字符串', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('body failed')
      },
    } as unknown as Response))

    await expect(upsertReleaseComment(context, 'body', fetchMock))
      .rejects
      .toThrow('获取 PR 评论失败')
  })

  it('没有 fetch 时抛出 ReleaseError', async () => {
    await expect(upsertReleaseComment(context, 'body', null as never))
      .rejects
      .toThrow(ReleaseError)
  })
})
