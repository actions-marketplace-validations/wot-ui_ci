# 能力与验证矩阵

> 盘点日期：2026-11-04。基线：`7acdccc`（包版本 0.4.1）。本页描述仓库当前接入范围；通过记录需引用具体 commit、环境和结果，不能只引用版本号。

## 状态规则

实现状态、离线验证和真实平台验证各自记录，不相互替代：

- **已实现**：有 CLI / JS API 执行入口。
- **离线通过**：指定环境下的单测、假 SDK / CLI 或 dry-run 检查通过，有命令与结果记录。
- **真实通过**：指定项目在真实平台执行成功，有平台结果；预览还需另记扫码结果。
- **待验证 / 失败 / 受限**：分别表示无对应证据、执行未通过、当前实现或平台能力不支持。失败应链接原因，受限应写清适用范围。

每条“通过”只适用于记录的版本与环境。下面列出的测试文件是验证入口，本身不代表最近运行成功。当前未归档真实平台证据；已有历史运行可以在核对 commit、版本和结果后补录，不据此断言历史从未验证。

## 平台能力

| 能力 | 微信 | 支付宝 | 钉钉 | 离线验证入口 |
| --- | --- | --- | --- | --- |
| 上传 | 已实现，默认 miniProgram | 已实现，默认 clientType=alipay | 已实现 | `test/platforms.test.ts`、`test/batch.test.ts` |
| 预览 | 已实现，文件 / 终端 / base64 | 已实现，默认 URL，可下载文件 | 受限，返回 PREVIEW_UNSUPPORTED | `test/preview.test.ts`、`test/preview-alipay-shapes.test.ts` |
| 最新版本查询 | 仅 miniProgramPlugin / miniGamePlugin；普通小程序、小游戏受限 | 已实现 | 受限 | `test/version.test.ts` |
| 版本列表 | 受限 | 已实现 | 受限 | `test/version.test.ts` |
| 体验版设置 / 取消、版本删除 | 受限 | 已实现；删除需显式确认 | 受限 | `test/version-mutation.test.ts` |
| 包体积预算 | SDK 返回体积后判定，可发生在上传成功之后 | 无体积数据，跳过 | 无体积数据，跳过 | `test/budget.test.ts` |
| 构建 npm、SourceMap、编译产物、质量检查 | 已实现；需 SDK 对应接口与项目权限 | 未接入 | 未接入 | `test/weixin-diagnostics.test.ts` |
| 打开 IDE | 已实现 | 已实现 | 未接入 | `test/ide.test.ts` |
| 关闭 / 退出、状态、自动化端口、IDE 预览 | 已实现；依赖本机安装和登录态 | 未接入 | 未接入 | `test/ide.test.ts`、`test/ide-runner.test.ts` |

微信四种项目类型、支付宝其它 clientType、钉钉其它应用类型应逐组合验证，不能从默认小程序的结果推导。钉钉配置中的 `projectType` 当前未参与上传实现。`release` 是构建与上传编排，未接入提审、上架或线上回滚。

普通微信小程序的 `doctor --network` 会跳过版本查询并给出 warn；doctor 通过不能证明上传权限、IP 白名单或远端上传已通过。自动版本查询失败可能回退本地版本，不保证全局唯一递增。

## 运行时与入口

| 组合 | 当前仓库约束 / 验证入口 | 当前验收状态 |
| --- | --- | --- |
| Node >=20 | `package.json` engines；ESM 发布 | 声明的兼容范围，不代表每个 Node 版本都验证通过 |
| Linux Node 20 / 22 / 24 / 26 | CI build + test；Verify Capabilities pack / install / CLI；仅 Node 24 执行 95% 覆盖率门禁 | 提交 66a5fd5 远端通过，见[运行时记录](verification/2026-11-04-runtime-matrix.md) |
| Windows / macOS Node 20 / 24 | CI build + test；部分 bash 用例在 Windows 跳过 | 提交 66a5fd5 远端通过，见[运行时记录](verification/2026-11-04-runtime-matrix.md)；真实 IDE 待实测 |
| 本地 macOS Node 22 / 24 / 26 | 构建、测试及消费者验证分项记录 | 见[运行时记录](verification/2026-11-04-runtime-matrix.md)，不替代远端矩阵；engines 与 Action 默认值不变 |
| CLI / ESM JS API / CommonJS 项目配置 | `scripts/verify-capabilities.mjs`、`test/config.test.ts`、`test/exports.test.ts` | 见本地或 CI 验收记录；库无同步 require 入口 |
| GitHub Action | `test/github-action.test.ts`、Verify Capabilities 的 composite job | 离线接线与真实平台调用分别记录 |
| Vite 构建后动作 | `test/vite.test.ts` | 单次构建动作，不包含 watch 验收 |

## 真实平台记录索引

| 场景 | 自动调用 | 人工确认 | 记录 |
| --- | --- | --- | --- |
| 微信 miniProgram 上传 | 待验证 | 平台后台版本 / 机器人待确认 | 使用下方验收指南建记录 |
| 微信 miniProgram 预览 | 待验证 | 手机扫码与页面待确认 | 同上 |
| 支付宝 alipay 上传 | 待验证 | 平台后台版本待确认 | 同上 |
| 支付宝 alipay 预览 | 待验证 | 手机扫码与页面待确认 | 同上 |
| 钉钉上传 | 待验证 | 平台后台版本及客户端运行待确认 | 同上 |

真实平台操作步骤、失败判定和记录模板见 [平台验收指南](platform-validation.md)。首轮定向测试与环境见 [本地离线基线](verification/2026-11-04-local-baseline.md)；该记录不提升真实平台状态。基线或支持范围变更时增补记录。
