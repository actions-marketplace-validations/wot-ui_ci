#!/usr/bin/env node
/**
 * 校验发布 tag 与 package.json 版本一致。
 *
 * tag / npm / GitHub Release / Marketplace listing 四者靠版本号对齐，
 * 任何一处对不上都会让用户 `uses: wot-ui/ci@vX.Y.Z` 拿到错的东西，
 * 所以在发版 workflow 里先卡这一关。
 *
 * 用法：node scripts/verify-release.mjs [tag] [package.json 路径]
 *   tag 缺省取 GITHUB_REF_NAME，便于在 Actions 里直接用。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const tagPattern = /^v\d+\.\d+\.\d+(?:-[0-9A-Z][0-9A-Z.-]*)?$/
const repoRoot = path.resolve(import.meta.dirname, '..')
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || ''
const pkgPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repoRoot, 'package.json')

if (!tag) {
  console.error('✖ 没有拿到 tag：传入参数或设置 GITHUB_REF_NAME')
  process.exit(1)
}

const matched = tagPattern.exec(tag)
if (!matched) {
  console.error(`✖ tag "${tag}" 不是可发布的版本号，期望 v<major>.<minor>.<patch>[-prerelease]`)
  process.exit(1)
}

const version = tag.slice(1)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
if (!pkg.version) {
  console.error(`✖ ${pkgPath} 里没有 version 字段`)
  process.exit(1)
}

if (pkg.version !== version) {
  console.error(`✖ tag "${tag}" 与 package.json 版本 "${pkg.version}" 不一致`)
  console.error('  bumpp 会同时改 package.json 和 tag；手改版本时容易只改一边，先对齐再发。')
  process.exit(1)
}

if (version === '0.0.0') {
  console.error('✖ 版本号还是占位符 0.0.0')
  process.exit(1)
}

console.log(`✔ tag ${tag} 与 package.json ${pkg.version} 一致`)
