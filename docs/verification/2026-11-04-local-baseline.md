# 支持矩阵首轮离线基线

- 日期：2026-11-04（Asia/Shanghai）。执行：Codex 本地命令。
- 状态：下列离线检查通过，真实平台调用待验证。
- 基线 commit：`7acdccc`；分支 `codex/support-matrix-validation`，包含本轮未提交的文档、playground 工作流和测试改动。
- CLI 包声明版本：0.4.1。本轮测试使用仓库源码 / 从 YAML 读取的工作流脚本，未验证 npm 发布包。
- 环境：Node v22.17.1，pnpm 10.25.0，darwin 24.6.0，arm64。
- 已安装 SDK：miniprogram-ci 2.1.31、minidev 1.9.5、dingtalk-miniapp-opensdk 1.0.8。版本从各自安装目录的 package.json 读取；单测使用 mock，不代表上述 SDK 的真实服务兼容性通过。

## 已执行

| 检查 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| 平台与工作流定向测试 | 下方 Vitest 命令 | 9 文件，190 测试通过 |
| 类型检查 | `pnpm typecheck:all` | 主包与 playground 均通过 |
| 改动文件 lint | `pnpm exec eslint test/playground-workflow.test.ts .github/workflows/upload-playground.yml README.md` | 通过 |
| 差异格式 | `git diff --check` | 通过 |

```sh
pnpm exec vitest run test/playground-workflow.test.ts test/platforms.test.ts test/preview.test.ts test/version.test.ts test/ide.test.ts test/weixin-diagnostics.test.ts test/budget.test.ts test/batch.test.ts test/vite.test.ts
```

工作流新增的 9 项测试实际执行 YAML 中的脚本，覆盖 push 强制 dry-run、手动平台与命令解析、拒绝钉钉预览 / 非法命令、上传 / 预览 CLI 参数与二维码路径、管道传播非零退出码，以及失败场景的版本记录与凭证字段排除。SDK 执行入口使用假 node，未连接真实服务。

后续完整测试、运行时与消费验证结果见 [运行时矩阵记录](2026-11-04-runtime-matrix.md)；以下范围描述本记录首次执行时的状态。

## 未覆盖

- GitHub 托管 Runner 上的完整工作流、Secrets 注入、artifact 上传和真实平台 SDK 调用。
- 平台后台版本核对、客户端扫码与真实 IDE 操作。
- Linux / Windows、Node 20/24/26、pack / install 消费验证、完整测试与覆盖率门禁。
- npm、GitHub Release、Marketplace 和浮动 tag 状态。

lint 提示 baseline-browser-mapping 数据较旧，不影响本轮 lint 退出码。运行时扩展与覆盖率门禁仍按路线图下一项推进；真实平台验收按 [指南](../platform-validation.md) 执行并独立归档。
