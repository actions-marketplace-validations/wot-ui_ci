# 发布流程

> 一句话：npm 自动发，GitHub Release 自动建但**保持 draft**，Marketplace 勾选只留一次人工点击。

## 为什么 release 必须是 draft

GitHub Marketplace 的「Publish this Action to the GitHub Marketplace」复选框**只出现在「Draft a new release」表单里**。release 一旦正式发布，就再也回不到 draft 状态，REST / GraphQL 也没有任何参数能勾这个框（`gh release create` 同样没有）。

所以发布链路里唯一不可自动化的就是这一下点击。为了让这次点击始终存在，[`changelogithub.config.json`](../changelogithub.config.json) 把 changelogithub 设成 draft 模式：

```json
{ "draft": true }
```

> 0.4.0 及更早的版本是「tag 推上去 → changelogithub 直接建正式 release」，复选框从没出现过，所以历史版本无法上架（补救办法见文末）。

## 一次正常发布

```sh
pnpm release   # bumpp：改版本 → 提交 chore: release vX.Y.Z → 打 annotated tag → push
```

tag 推送后 `Release` workflow（[release.yml](../.github/workflows/release.yml)）依次做：

| 阶段 | 内容 |
| --- | --- |
| `verify` | tag 与 `package.json` 版本一致、`action.yml` 合规、`changelogithub.config.json` 仍是 draft、lint、typecheck、test、build |
| `release` | `pnpm publish`（OIDC trusted publishing）+ `changelogithub` 建 **draft** release |
| `ensure-draft` | 断言 release 存在且确实是 draft，并把下一步操作指引写进 Job Summary |

然后**人工**（约 10 秒）：

1. 打开 Job Summary 里的 draft release 链接
2. 勾选 **Publish this Action to the GitHub Marketplace**
3. 选 Primary / Secondary category → **Publish release**

发布后 `Marketplace Listing` workflow（[marketplace-listing.yml](../.github/workflows/marketplace-listing.yml)）自动跑：

- 轮询 <https://github.com/marketplace/actions/wot-ui-ci>，确认页面版本已经是新 tag；对不上就开 issue 并标红
- 把浮动主版本 tag `v0` 强制指向本版本，用户就能写 `uses: wot-ui/ci@v0`

## 首次上架（0.4.1）

0.4.0 因为历史流程已经无法上架，首个上架版本是 **0.4.1**：

1. `pnpm release` → 选 `0.4.1`
2. 等 `Release` 跑完，打开 draft
3. 勾选 Marketplace，分类建议：
   - Primary：`Continuous integration`
   - Secondary：`Deployment`（备选 `Utilities`）
4. Publish
5. 等 `Marketplace Listing` 变绿；变红就按 issue 里的步骤处理

> `uses: wot-ui/ci@v0` 要等 0.4.1 发布、`major-tag` job 跑完才存在。在那之前请用 `@v0.4.1`。

## 忘了勾选 / listing 落后怎么办

```text
Releases → 该版本 → Delete release（弹窗里不要勾删 tag）
→ Draft a new release → Choose a tag → 选已存在的 vX.Y.Z
→ 勾选 Marketplace → Publish
```

复用已有 tag 不会重跑 npm 发布，也不会重新触发 `Release` workflow。代价只有原 release 的正文与表情会丢。

## 维护者 checklist

- [ ] 版本号用 `pnpm release` 改，别手改 `package.json`（`verify` 会拦）
- [ ] 改了 `action.yml` 的 inputs 后，确认 `scripts/github-action.sh` 里接了 `INPUT_*`（`verify:action` 会拦）
- [ ] 新增 release 默认仍是 draft（别删 `changelogithub.config.json`）
- [ ] 上架后隔一分钟看一眼 Marketplace listing 的版本号

## 本地自检

```sh
pnpm verify:action                   # action.yml 是否满足 Marketplace 要求
pnpm verify:release v0.4.1           # tag 与 package.json 是否一致
pnpm verify:marketplace v0.4.1       # listing 是否已指向该版本（需要联网）
```
