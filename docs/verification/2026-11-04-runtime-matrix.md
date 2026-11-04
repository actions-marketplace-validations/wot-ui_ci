# 运行时矩阵与覆盖率门禁

- 日期：2026-11-04（Asia/Shanghai）。
- 分支：`codex/support-matrix-validation`；基线 `7acdccc`，包含本轮未提交改动。
- 包版本：0.4.1；没有调整 engines、构建 target 或 Action 默认 Node。
- 本地环境：darwin 24.6.0 / arm64，pnpm 10.25.0。

## 工作流变更

| 工作流 | 组合 | 检查 |
| --- | --- | --- |
| CI | Linux Node 20 / 22 / 24 / 26 | 安装、构建、完整测试；仅 Node 24 使用 test:coverage |
| CI | Windows、macOS 各 Node 20 / 24 | 安装、构建、完整测试 |
| Verify Capabilities | Linux Node 20 / 22 / 24 / 26 | pack → 临时消费者安装 → CLI / JS API / Vite 能力验证 |

保留四项 95% 阈值；没有降低阈值或增加排除项。覆盖率 job 未使用 continue-on-error，未达标会阻断 CI；报告以 `coverage-node24` artifact 保存 7 天，即使测试失败也尝试上传。其它组合使用 `test:run`，避免在非 CI 环境进入 watch。

本轮静态检查确认八组 build/test、四组消费验证、唯一 Linux Node 24 coverage 组合；全仓库 lint 与 `typecheck:all` 均通过。初次记录时 GitHub 托管 Runner 尚未运行；提交后的远端结果见下方补充，本地与远端证据分别记录。

## 本地运行结果

| Node | build / publint | 完整测试 | 覆盖率 | 打包消费验证 |
| --- | --- | --- | --- | --- |
| 22.17.1 | 通过 | 40 文件，490 项通过 | 四项达标 | 本轮未执行 |
| 24.7.0 | 通过 | 40 文件，490 项通过 | 四项达标 | 50 通过，0 失败，0 跳过 |
| 26.13.0 | 通过 | 40 文件，490 项通过 | 本轮未执行 | 50 通过，0 失败，0 跳过 |

Node 22 / 24 的覆盖率结果相同：statements 98.91%、branches 95.33%、functions 97.04%、lines 99.22%。这只证明当前本地环境达标，远端 Node 24 job 会重新计算。

源码测试使用的已安装 SDK 为 miniprogram-ci 2.1.31、minidev 1.9.5、dingtalk-miniapp-opensdk 1.0.8；单测使用 mock，未连接平台服务。两个消费者项目通过 tarball 独立安装，实际解析的三个 SDK 版本与上述一致。50 项消费检查覆盖 CLI、配置加载、dry-run、假 IDE、诊断守卫和 JS API / Vite 导出；未执行真实平台上传。

## 复跑

先将目标 Node 的 bin 目录放入 PATH，并用 `node --version` 确认。每个版本顺序运行，避免同时清理 dist 或覆盖 coverage：

```sh
node --version
pnpm build
pnpm test:run
# 覆盖率仅在需要验证门禁的环境运行
pnpm test:coverage
# dist 已由本轮目标 Node 构建；每个运行时使用独立临时目录
node scripts/verify-capabilities.mjs --no-build --keep --summary /tmp/wotci-capabilities-summary.md
```

能力自检会联网安装消费者依赖；上传 / 预览服务由假 SDK 或 dry-run 替代。初次受沙箱网络限制的 Node 26 下载未成功，随后将临时运行时安装到 `/tmp/wotci-node26-runtime` 完成测试，没有改动系统默认 Node。

本地日志位于 `/tmp/wotci-coverage.log`、`/tmp/wotci-node24-coverage.log`、`/tmp/wotci-node26-tests.log`、`/tmp/wotci-node24-consumer.log`、`/tmp/wotci-node26-consumer.log`。这些是临时文件，本记录保留结论；远端运行完成后补 run URL 与 artifact。

## 远端验证补充（2026-11-04）

以下结果对应 PR #3 的提交 `66a5fd528f02046fb31e1509bdaf04a336047ae8`，不自动适用于后续提交。

- [CI run 41838959523](https://github.com/wot-ui/ci/actions/runs/41838959523)：lint/typecheck 与八组构建测试全部 success。
- [Linux Node 24 job](https://github.com/wot-ui/ci/actions/runs/41838959523/job/126605141290)：`Check coverage thresholds` 和 `Upload coverage report` 均 success，报告名称为 `coverage-node24`。本段仅核验门禁与上传结果，不以本地覆盖率数值替代远端数值。
- [Verify Capabilities run 41838959528](https://github.com/wot-ui/ci/actions/runs/41838959528)：Node 20/22/24/26 四组消费者验证与 Composite action job 全部 success。

这些工作流验证构建、测试、打包消费与 dry-run 接线，没有完成真实小程序上传或扫码。

## 后续证据

- 后续提交的 GitHub 矩阵与覆盖率门禁：以对应 commit 的运行结果为准。
- 真正 SDK 上传 / 预览、平台后台核对、手机扫码：待按平台验收指南执行。
- Node 最低版本、Action 默认值与正式支持承诺：待远端及真实 SDK 证据齐备后决定。
