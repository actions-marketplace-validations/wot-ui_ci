import type { ReleaseResult } from '../types'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { ReleaseError } from '../errors'
import { formatVersionResolution } from '../output/version'

export const RELEASE_COMMENT_MARKER = '<!-- wotci-release -->'

export interface GitHubPullRequestContext {
  token: string
  owner: string
  repo: string
  prNumber: number
  apiUrl: string
  serverUrl: string
  runUrl?: string
}

export interface ReleaseCommentResult {
  updated: boolean
  url: string
}

/** 从 GitHub Actions 环境推断 PR 上下文；不满足条件时返回 undefined */
export async function detectGitHubPullRequestContext(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GitHubPullRequestContext | undefined> {
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN
  const repository = env.GITHUB_REPOSITORY

  if (!token || !repository)
    return undefined

  const [owner, repo] = repository.split('/')
  if (!owner || !repo)
    return undefined

  const prNumber = await resolvePullRequestNumber(env)
  if (!prNumber)
    return undefined

  const serverUrl = (env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/$/, '')
  const apiUrl = (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
  const runUrl = env.GITHUB_RUN_ID
    ? `${serverUrl}/${owner}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`
    : undefined

  return {
    apiUrl,
    owner,
    prNumber,
    repo,
    serverUrl,
    token,
    ...(runUrl ? { runUrl } : {}),
  }
}

async function resolvePullRequestNumber(env: NodeJS.ProcessEnv): Promise<number | undefined> {
  if (env.GITHUB_EVENT_PATH) {
    try {
      const source = await readFile(env.GITHUB_EVENT_PATH, 'utf8')
      const event = JSON.parse(source) as {
        pull_request?: { number?: number }
        issue?: { number?: number }
      }
      const number = event.pull_request?.number ?? event.issue?.number
      if (number)
        return number
    }
    catch {
      // 继续尝试从 GITHUB_REF 解析
    }
  }

  const match = env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)
  return match ? Number(match[1]) : undefined
}

/** 生成发布评论的 Markdown */
export function renderReleaseComment(
  result: ReleaseResult,
  context?: Pick<GitHubPullRequestContext, 'runUrl'>,
): string {
  const lines: string[] = [
    RELEASE_COMMENT_MARKER,
    `## ${result.ok ? '✅' : '❌'} 小程序发布${result.ok ? '成功' : '失败'}`,
    '',
    '| 平台 | 结果 | 版本 | 总包 | 主包 | 耗时 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]

  for (const item of result.platforms) {
    lines.push([
      escapeCell(item.platform),
      item.ok ? '✅' : '❌',
      escapeCell(item.version ?? '-'),
      item.sizes?.total ? formatSizeCell(item.sizes.total, item.trend?.deltaTotal) : '-',
      item.sizes?.main ? formatSizeCell(item.sizes.main, item.trend?.deltaMain) : '-',
      `${(item.durationMs / 1000).toFixed(1)}s`,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }

  if (!result.platforms.length)
    lines.push('| - | - | - | - | - | - |')

  lines.push('', ...formatVersionResolution(result.versionResolution).map(line => `- ${escapeCell(line)}`))

  const buildText = result.build.skipped
    ? '跳过'
    : result.build.commands.length
      ? result.build.commands.map(command => `\`${command}\``).join(' → ')
      : '未配置'
  lines.push(`- 构建：${buildText}${result.build.ok ? '' : '（失败）'}`)

  if (result.git?.commit) {
    const branch = result.git.branch ? ` on \`${result.git.branch}\`` : ''
    lines.push(`- 提交：\`${result.git.commit}\`${branch}`)
  }

  if (context?.runUrl)
    lines.push(`- 运行：[GitHub Actions](${context.runUrl})`)

  const failures = result.platforms.filter(item => !item.ok && item.error)
  if (failures.length) {
    lines.push('', '<details><summary>失败详情</summary>', '')
    for (const item of failures) {
      lines.push(`- **${item.platform}**：${item.error?.message || '未知错误'}`)
      for (const cause of item.error?.cause ?? [])
        lines.push(`  - ${cause}`)
    }
    lines.push('', '</details>')
  }

  return `${lines.join('\n')}\n`
}

/** 创建或更新带 marker 的 PR 评论 */
export async function upsertReleaseComment(
  context: GitHubPullRequestContext,
  body: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ReleaseCommentResult> {
  if (typeof fetchImpl !== 'function')
    throw new ReleaseError('当前 Node 环境不支持 fetch，无法评论 PR')

  const baseUrl = `${context.apiUrl}/repos/${context.owner}/${context.repo}/issues/${context.prNumber}/comments`
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${context.token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const listResponse = await fetchImpl(`${baseUrl}?per_page=100`, { headers })

  if (!listResponse.ok)
    throw new ReleaseError(`获取 PR 评论失败：HTTP ${listResponse.status}`, await safeText(listResponse))

  const comments = await listResponse.json() as Array<{ id: number, body?: string, html_url?: string }>
  const existing = comments.find(comment => comment.body?.includes(RELEASE_COMMENT_MARKER))

  if (existing) {
    const response = await fetchImpl(`${baseUrl}/${existing.id}`, {
      body: JSON.stringify({ body }),
      headers,
      method: 'PATCH',
    })

    if (!response.ok)
      throw new ReleaseError(`更新 PR 评论失败：HTTP ${response.status}`, await safeText(response))

    const updated = await response.json() as { html_url?: string }
    return { updated: true, url: updated.html_url ?? existing.html_url ?? '' }
  }

  const response = await fetchImpl(baseUrl, {
    body: JSON.stringify({ body }),
    headers,
    method: 'POST',
  })

  if (!response.ok)
    throw new ReleaseError(`创建 PR 评论失败：HTTP ${response.status}`, await safeText(response))

  const created = await response.json() as { html_url?: string }
  return { updated: false, url: created.html_url ?? '' }
}

function formatSize(size: number): string {
  return `${(size / 1024 / 1024).toFixed(2)}MB`
}

function formatSizeCell(size: number, delta: number | undefined): string {
  if (delta === undefined || delta === 0)
    return formatSize(size)

  return `${formatSize(size)} (${delta > 0 ? '+' : '-'}${formatSize(Math.abs(delta))})`
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  }
  catch {
    return ''
  }
}
