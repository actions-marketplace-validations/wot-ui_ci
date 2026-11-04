# 参与贡献

欢迎提 Issue 和 PR。改动较大（新增命令、调整配置格式、改公开 API）时，建议先开 Issue 说明场景，避免做完才发现方向不一致。

## 环境要求

- Node.js ≥ 20（见 `engines`）
- pnpm：仓库锁定 `pnpm@10.25.0`，执行 `corepack enable` 即可获得
- 平台无关：CI 覆盖 Linux / Windows / macOS。少数依赖 bash 的用例在 Windows 上会自动跳过

## 本地开发

```sh
corepack enable
pnpm install        # prepare 会安装 git hooks（提交时跑 lint-staged）
pnpm build          # tsdown → dist
pnpm dev            # watch 构建
pnpm test           # vitest watch
pnpm test:run       # 单次执行
pnpm typecheck:all  # 包含 playground
pnpm lint
```

改 CLI 时用 playground 做真实链路验证：`pnpm dev:playground` 起 H5 调试，上传/预览命令见 [Playground](README.md#playground)。

## 目录结构

```text
src/
  bin.ts        进程入口（wotci）
  cli.ts        命令注册与参数解析
  config.ts     配置加载（wotci.config.ts / .minicirc / 环境变量）
  platforms/    微信、支付宝、钉钉的平台适配
  release/      版本策略、GitHub Release 历史、git 信息
  ide/          开发者工具联动
  output/       JSON 输出与 Job Summary
  utils/        错误、路径、平台等通用工具
test/           vitest 用例
scripts/        composite action 脚本、能力自检、发布校验
playground/     uni-app 小程序示例，用于端到端验证
docs/           路线图与发布流程
```

## 代码约定

- 风格由 ESLint（`@antfu/eslint-config`）统一，**没有 Prettier**；VS Code 保存时自动 `eslint --fix`，推荐安装 `.vscode/extensions.json` 里列出的插件
- 类型必须过：`pnpm typecheck:all`
- 文档、注释、错误提示用中文，标识符用英文
- 错误信息要说清「哪个平台 / 哪个文件 / 怎么修」，并在 `--json` 模式下保持机器可读（诊断日志走 stderr）
- 平台能力以官方 SDK 为准：能力缺失就显式报错，不要伪造成功结果

## 测试

- 测试默认离线，不需要真实 appid、私钥或网络；上传类能力通过 mock 与假 CLI 覆盖
- 覆盖率阈值 95%（statements / branches / functions / lines），`pnpm test:coverage` 会校验；CI 由 Linux Node 24 单独执行该门禁并保留报告，其余组合运行常规测试
- 修 bug 请附能复现的用例；新增命令请覆盖参数校验、`--dry-run` 与 JSON 输出
- 改动 CLI 行为后建议跑一遍端到端自检：`pnpm verify:capabilities`（构建 → 打包 → 临时项目安装 → 逐项执行）
- 动了 `action.yml` 或 composite 接线，跑 `pnpm verify:action`

## 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/)：release notes 由 changelogithub 从提交信息生成，写错就进不了 changelog。

```text
<type>(<scope>): <中文描述>
```

- `type`：`feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`ci`、`chore`
- `scope` 用模块名：`cli`、`config`、`weixin`、`alipay`、`dingtalk`、`action`、`release`、`api`、`workflow`、`readme`
- 破坏性变更加 `!`，例如 `feat(config)!: 重命名 weixin 配置字段`
- 只有 `feat` / `fix` / `perf` 会进 release notes，`chore:`、`docs:` 等不会

示例（取自仓库历史）：

```text
fix(cli): --json 时把诊断 SDK 日志改到 stderr
feat(action): 新增 composite GitHub Action
```

## 提 PR

1. 一个 PR 只做一件事，尽量小
2. 提交前本地跑通：`pnpm lint && pnpm typecheck:all && pnpm test:run`
3. 面向用户的变化（命令、参数、配置字段、行为）同步更新 README —— README 是主要文档
4. 不要提交私钥、appid、真实项目配置；`dist`、`coverage`、`.wotci`、`.pnpm-store` 已在 `.gitignore` 中
5. CI 会跑 lint + typecheck，以及八组矩阵（Linux Node 20/22/24/26、Windows Node 20/24、macOS Node 20/24）的 build + test；Linux Node 24 执行覆盖率门禁。能力自检在 Linux Node 20/22/24/26 打包、安装并验证消费者项目，另有 playground 冒烟

## 发布

维护者流程见 [docs/releasing.md](docs/releasing.md)，包含 npm 发布、draft release 与 GitHub Marketplace 上架的人工那一步。

## 安全问题

请勿在公开 Issue 中粘贴私钥或 token。安全相关问题请通过 GitHub Security Advisories 私下报告。
