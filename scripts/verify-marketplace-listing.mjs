#!/usr/bin/env node
/**
 * 校验 GitHub Marketplace 上的 listing 是否已经指向本次发布的版本。
 *
 * 只读：抓公开的 listing 页面做字符串比对，不调用任何未公开接口。
 * 上架动作本身没有公开 API（勾选框只存在于 draft release 的表单里），
 * 所以这里的职责是「发布后守夜」：人忘了勾选就让 workflow 变红并开 issue。
 *
 * 用法：node scripts/verify-marketplace-listing.mjs <tag> [slug]
 *   环境变量：
 *     MARKETPLACE_RETRIES       轮询次数，默认 6
 *     MARKETPLACE_INTERVAL_MS   轮询间隔，默认 20000（Marketplace 有传播延迟）
 *
 * 退出码：0 已同步；2 listing 不存在；3 listing 落后于本次版本；4 网络/HTTP 异常
 */
import process from 'node:process'

const tag = process.argv[2] || process.env.RELEASE_TAG || ''
const slug = process.argv[3] || 'wot-ui-ci'
const url = `https://github.com/marketplace/actions/${slug}`
const retries = Number(process.env.MARKETPLACE_RETRIES ?? 6)
const intervalMs = Number(process.env.MARKETPLACE_INTERVAL_MS ?? 20000)

if (!tag) {
  console.error('✖ 没有拿到 tag：传入参数或设置 RELEASE_TAG')
  process.exit(1)
}

const version = tag.replace(/^v/, '')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function probe() {
  const response = await fetch(url, {
    headers: { 'user-agent': 'wot-ui-ci-marketplace-verifier' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })

  if (response.status === 404) {
    return { state: 'missing' }
  }

  if (!response.ok) {
    return { state: 'http-error', detail: `HTTP ${response.status}` }
  }

  const html = await response.text()
  return { state: 'ok', upToDate: html.includes(tag) || html.includes(version) }
}

async function main() {
  let last = { state: 'unknown' }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      last = await probe()
    }
    catch (error) {
      last = { state: 'http-error', detail: error.message }
    }

    if (last.state === 'ok' && last.upToDate) {
      console.log(`✔ Marketplace listing 已指向 ${tag}：${url}`)
      return 0
    }

    if (attempt < retries) {
      const reason = last.state === 'ok' ? 'listing 还是旧版本' : last.state
      console.log(`… 第 ${attempt}/${retries} 次探测：${reason}，${intervalMs / 1000}s 后重试`)
      await sleep(intervalMs)
    }
  }

  if (last.state === 'ok') {
    console.error(`✖ listing 存在，但页面上找不到 ${tag}：${url}`)
    console.error('  最常见原因：发布 release 时没勾选 "Publish this Action to the GitHub Marketplace"。')
    console.error('  补救：删除该 release（保留 tag）→ Draft a new release 选已有 tag → 勾选后重新发布。')
    return 3
  }

  if (last.state === 'missing') {
    console.error(`✖ 找不到 Marketplace listing：${url}（HTTP 404）`)
    console.error('  说明该 action 还没上架过：需要一个勾选了 Marketplace 的 release 作为首次上架。')
    return 2
  }

  console.error(`✖ 探测 Marketplace listing 失败：${last.detail ?? '未知错误'}`)
  return 4
}

process.exit(await main())
