# @wot-ui/ci 功能路线图

> 目标：从「三端上传脚本」升级为「小程序 CI 工具箱」，覆盖开发预览、发布、版本管理和 CI 集成。
>
> 原则：以官方 SDK 的实际能力为准；CLI 与 JS API 同构；默认安全；CI 友好；能力缺失要显式报错，不伪造。

## 1. 官方 CI 能力盘点

### 1.1 微信 `miniprogram-ci` 2.x

| 能力 | API | 关键参数 / 返回 |
| --- | --- | --- |
| 上传 | `upload(options)` | `version`、`desc`、`robot`、`setting`、`threads`、`useCOS`、`onProgressUpdate`；返回 `subPackageInfo`、`pluginInfo` |
| 预览 | `preview(options)` | `qrcodeFormat: terminal \| image \| base64`、`qrcodeOutputDest`、`pagePath`、`searchQuery`、`scene`、`robot`、`setting` |
| 打开 / 关闭 IDE | 开发者工具 CLI：`open` / `close` / `quit` / `auto` | 需额外调用 IDE CLI，不是 miniprogram-ci API |
| 最新版本 | `getLatestVersion({ project })` | `latestVersion`、`grayReleaseVersion` |
| SourceMap | `getDevSourceMap(options)` | `robot`、`sourceMapSavePath`、`streaming` |
| 构建 npm | `packNpm` / `packNpmManually` | 对应开发者工具「构建 npm」 |
| 编译产物 | `getCompiledResult(options, savePath)` | 导出最终上传的 zip，便于排查包体积 |
| 代码质量 | `checkCodeQuality(project)` | 返回检查项数组，可落盘 JSON |
| 云开发 | `cloud.uploadFunction` / `uploadStorage` 等 | 云函数、静态存储、定时触发器 |
| 网络代理 | `proxy(...)` | 配置 CI 请求代理 |

### 1.2 支付宝 `minidev`

| 能力 | API | 关键参数 / 返回 |
| --- | --- | --- |
| 上传 | `minidev.upload(opts)` | `version`、`experience`、`deleteVersion`、`versionDescription`、`isGame`；返回 `version`、`experienceQrCodeUrl` |
| 预览 | `minidev.preview(opts)` | `page`、`pageQuery`、`query`、`scene`、`autoPush`、`ignoreHttpDomainCheck`；返回 `qrcodeUrl`、`qrcodeSchema`、`version` |
| 打开 IDE | `minidev.startIde(opts)` | `project`、`appPath`、`lite`、`projectType` |
| 最新版本 | `minidev.app.getUploadedVersion(opts)` | 返回字符串版本号 |
| 版本列表 | `minidev.app.getUploadedVersionList(opts)` | 版本、状态、创建时间、操作人 |
| 删除版本 | `minidev.app.deleteVersion(opts)` | 危险操作 |
| 体验版 | `minidev.app.setExperience` / `cancelExperience` | 设置或取消体验版，返回体验版二维码 |
| 本地构建 | `minidev.build(opts)` | `output`、`sourceMap`、`parallel`、`minify` |
| 源码打包 | `minidev.pack(opts)` | 输出源码 zip |
| 远程调试 | `minidev.remoteDebug(opts)` | 真机调试 |

### 1.3 钉钉 `dingtalk-miniapp-opensdk`

| 能力 | API | 说明 |
| --- | --- | --- |
| 上传 | `sdk.miniUpload(opts)` | 通过进度回调返回 `version`、`log` |
| 预览 | 无 | SDK 未暴露预览能力 |
| 打开 IDE / 模拟器 | 无 | 可另行集成 `dd`（DingTalk Design CLI）的 `dev` / 模拟器能力 |
| 版本查询 / 列表 / 删除 | 无 | 只能从上传结果或进度回调拿版本号 |
| NPM / SourceMap / 质量检查 | 无 | — |

> 结论：钉钉只能做「上传 + 版本结果读取」，预览、版本管理等能力需要对用户显式说明。

## 2. 当前差距

当前 `@wot-ui/ci` 已具备：

- 三端上传
- JS/TS 配置与环境变量
- `.minicirc` / `uni-mini-ci` 兼容
- JS API（`upload` / `uploadPlatform` / `uploadWeixin` 等）
- 统一错误模型、结构化结果、CLI 退出码

尚缺：

- 预览（微信、支付宝）
- 打开 / 关闭微信、支付宝开发者工具，自动化调试
- 多平台批量执行
- JSON 输出、dry-run、CI summary
- 版本查询 / 版本策略
- 包体积预算
- 配置与凭证体检
- 构建 npm、SourceMap、编译产物检查
- 编辑器 / CI 平台集成

## 3. 路线图

### v0.4 — 预览、批量、CI 友好（P0）

> 状态：预览、批量执行、`--json`、`--dry-run`、CI summary 均已实现。

#### 3.1 预览能力

用户故事：

- 开发者改完代码，想直接生成预览二维码，不再打开开发者工具。
- CI 在合并前生成预览二维码，贴到 PR 或群里。

CLI：

```sh
wotci preview -p weixin
wotci preview -p weixin --qr-format image --qr-output dist/preview-weixin.png
wotci preview -p weixin --page pages/index/index --query "from=ci" --scene 1011
wotci preview -p alipay
wotci preview -p alipay --page pages/index/index --page-query "from=ci"
```

JS API：

```ts
import { preview, previewAlipay, previewWeixin } from '@wot-ui/ci'

const result = await preview('weixin', { cwd: process.cwd() })
// result.qrCode: { kind: 'file', value: '/abs/dist/preview-weixin.png' }

const alipay = await preview('alipay', { cwd: process.cwd() })
// alipay.qrCode: { kind: 'url', value: 'https://...' }
```

统一结果：

```ts
interface PreviewResult<TPlatform extends Platform, TRaw = unknown> {
  platform: TPlatform
  version?: string
  qrCode: {
    kind: 'file' | 'url' | 'terminal' | 'base64'
    value: string
  }
  raw: TRaw
}
```

平台差异：

| 平台 | 默认行为 | 备注 |
| --- | --- | --- |
| 微信 | `qrcodeFormat: 'image'`，默认输出 `.wotci/preview/weixin.png` | `qrcodeOutputDest` 必须是可写路径；`terminal` 时直接打印终端二维码 |
| 支付宝 | 打印 `qrcodeUrl` | 传 `--qr-output` 时下载二维码到本地 |
| 钉钉 | 抛 `UnsupportedCapabilityError` | SDK 不提供预览 |

配置建议放在平台配置内，保持内聚：

```ts
weixin: {
  // 上传配置...
  preview: {
    qrcodeFormat: 'image',
    qrcodeOutputDest: '.wotci/preview/weixin.png',
    pagePath: 'pages/index/index',
    scene: 1011,
  },
},
alipay: {
  // 上传配置...
  preview: {
    page: 'pages/index/index',
    pageQuery: 'from=ci',
    scene: '1011',
    autoPush: false,
  },
},
```

验收：

- `wotci preview -p weixin` 生成 PNG 并输出绝对路径
- `wotci preview -p alipay` 输出可访问的二维码 URL
- `wotci preview -p dingtalk` 返回明确的不支持错误和退出码
- JS API 与 CLI 返回同构结果

#### 3.2 多平台批量执行

```sh
wotci upload --all
wotci upload -p weixin -p alipay
wotci upload --all --concurrency 2
wotci preview --all
```

- 默认按配置顺序串行执行，避免多个 SDK 子进程/编译缓存互相干扰
- `--concurrency` 显式开启并行
- 单个平台失败不中断其它平台，最后统一汇总并以非 0 退出
- 结果中保留每个平台的成功/失败与耗时

JS API：

```ts
import { uploadMany } from '@wot-ui/ci'

const batch = await uploadMany(['weixin', 'alipay'], { cwd: process.cwd() })
// batch.results / batch.failures / batch.ok
```

#### 3.3 CI 输出与安全开关

```sh
wotci upload --all --json
wotci upload --all --dry-run
wotci upload --all --summary "$GITHUB_STEP_SUMMARY"
wotci upload --all --quiet
```

- `--json`：stdout 只输出 JSON，日志走 stderr；带 `schemaVersion`
- `--dry-run`：只做配置、路径、密钥、版本校验，不发起网络请求
- `--summary`：生成 Markdown 表格（平台、版本、包体积、耗时、结果）
- `--timeout`：单平台超时，避免 CI 挂死
- `--quiet` / `--verbose`：控制日志级别

JSON 结构草案：

```json
{
  "schemaVersion": 1,
  "command": "upload",
  "ok": false,
  "results": [
    {
      "platform": "weixin",
      "version": "1.2.3",
      "sizes": { "total": 2048000, "main": 1024000 },
      "durationMs": 18342
    }
  ],
  "failures": [
    {
      "platform": "alipay",
      "code": "UPLOAD_ERROR",
      "message": "支付宝小程序上传失败"
    }
  ]
}
```

### v0.4.1 — IDE 与本地开发集成（P0）

> 状态：`open` / `close` / `quit` / `auto` / `status` / `ide preview`、`--dry-run`、CI 保护和路径探测均已实现。

除了 CI 侧的上传/预览，日常开发里最高频的动作是「打开开发者工具」和「让 IDE 加载最新产物」。微信和支付宝都提供了可脚本化的 IDE 入口，可以一并收进 `wotci`。

#### 3.4 打开 / 关闭开发者工具

CLI：

```sh
wotci open -p weixin
wotci open -p weixin --port 9420 --lang zh
wotci open -p alipay
wotci close -p weixin
wotci ide status -p weixin
```

JS API：

```ts
import { closeIde, getIdeStatus, openIde } from '@wot-ui/ci'

await openIde('weixin', { cwd: process.cwd(), port: 9420 })
const status = await getIdeStatus('weixin')
await closeIde('weixin')
```

平台能力：

| 能力 | 微信 | 支付宝 | 钉钉 |
| --- | --- | --- | --- |
| 打开项目 | `cli open --project` | `minidev.startIde({ project })` | 无官方 SDK |
| 关闭项目 / 退出 IDE | `cli close` / `cli quit` | 无直接 API | 无 |
| 登录状态 | `cli islogin` / `cli login` | `minidev.login` | 无 |
| 自动化调试 | `cli auto`（automation 端口） | `minidev.dev` + devtools | 无 |
| 构建 npm | `cli build-npm` 或 `packNpm` | 无 | 无 |
| 本地 dev server | IDE 自身 watch | `minidev.dev` / `devWebSimulator` | `dd` CLI 的 dev |

实现要点：

- 微信 CLI 路径按平台探测，常见位置：
  - macOS：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
  - Windows：微信开发者工具安装目录下的 `cli.bat`
  - 允许通过 `weixin.ide.cliPath` 显式覆盖
- 支付宝通过 `minidev.startIde({ project, appPath })` 打开，`appPath` 可配置
- 找不到 IDE 时返回可操作的错误，提示安装路径或 `ide.cliPath` 配置
- 在 `CI=true` 环境下默认拒绝打开 GUI，需要 `--force` 才执行，避免 CI 卡死
- `--dry-run` 只打印将要执行的命令，不真正启动 IDE

配置：

```ts
weixin: {
  // ...
  ide: {
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    port: 9420,
    lang: 'zh',
  },
},
alipay: {
  // ...
  ide: {
    appPath: '/Applications/支付宝小程序开发者工具.app',
  },
},
```

#### 3.5 自动化调试与本地预览

```sh
# 微信自动化端口，供 miniprogram-automator / E2E 使用
wotci auto -p weixin --port 9420

# 支付宝启动 dev server（minidev.dev），再基于 dev 产物做真机预览
wotci dev -p alipay
wotci dev-preview -p alipay --page pages/index/index

# 打开 IDE 并让 IDE 自己生成预览（不经过 miniprogram-ci）
wotci ide preview -p weixin --qr-output dist/ide-preview.png
```

这些能力与 `wotci preview` 的区别：

- `wotci preview`：走 `miniprogram-ci` / `minidev`，不依赖 IDE，适合 CI
- `wotci ide preview`：走 IDE CLI，依赖本机 IDE 登录态，适合本地开发
- `wotci auto`：只负责开启自动化端口，不生成二维码

验收：

- `wotci open -p weixin` 能在 macOS / Windows 打开对应项目
- `wotci open -p alipay` 能打开支付宝 IDE
- IDE 未安装、路径错误、未登录时给出明确错误
- CI 环境下默认不启动 GUI
- IDE 相关测试通过 mock child_process，不依赖真实 GUI

### v0.4.2 — 发布编排与协作（已实现）

> 状态：`wotci release`、构建命令、发布历史、PR 评论已实现。

- `release` 依次执行构建命令、多平台上传，部分失败继续
- 历史写入 `.wotci/history.json`，支持条数限制与原子写入
- GitHub Actions 自动更新 PR 评论（marker 去重）
- `--dry-run` 只输出计划

### v0.5 — 版本、预算与体检（P1）

> 状态：版本查询/策略、doctor、包体积预算、init、支付宝体验版管理均已实现。

#### 3.6 版本查询

```sh
wotci version latest -p weixin
wotci version latest -p alipay
wotci version list -p alipay
```

- 微信：`getLatestVersion` → `latestVersion`、`grayReleaseVersion`
- 支付宝：`getUploadedVersion` / `getUploadedVersionList`
- 钉钉：不支持，返回 `UnsupportedCapabilityError`

#### 3.7 版本策略

在现有 `version` + `autoincrement` 之上增加显式策略，避免平台差异：

```ts
versionStrategy:
  | { type: 'fixed'; version: string }
  | { type: 'package' }
  | { type: 'auto'; bump: 'patch' | 'minor' | 'major' }
```

行为：

- `fixed`：使用配置版本
- `package`：读取 `package.json` 版本
- `auto`：查询线上最新版本后本地递增，再把结果传给三个平台
- 支付宝、钉钉仍可保留平台侧 `autoincrement: true`

#### 3.8 包体积预算

```ts
budgets: {
  total: '3MB',
  main: '1.5MB',
  warnOnly: true,
}
```

- 数据来源：微信 `subPackageInfo`（总包、主包、分包）
- 支付宝、钉钉当前不返回包体积，跳过并给出说明
- 超出预算时：`warnOnly` 仅告警，否则失败
- CLI summary 与 JSON 都输出体积明细

#### 3.9 支付宝体验版与版本管理

```sh
wotci experience set -p alipay --version 1.2.3
wotci experience cancel -p alipay --version 1.2.3
wotci version delete -p alipay --version 1.2.3 --yes
```

- 上传时支持 `experience: true`，结果中返回 `experienceQrCodeUrl`
- 删除 / 取消体验版属于破坏性操作，必须显式 `--yes`
- 默认只打印计划，不执行

#### 3.10 `wotci doctor`

```sh
wotci doctor
wotci doctor --offline
wotci doctor --json
```

检查项：

| 检查 | 说明 |
| --- | --- |
| Node 版本 | 是否满足 `>=20` |
| 配置来源 | 是否存在多个配置文件冲突 |
| 平台配置 | 必填字段、appid 格式、版本号格式 |
| 产物目录 | 是否存在，是否包含 `project.config.json` / `app.json` |
| 私钥 | 是否存在、可读、权限是否过宽、格式是否像 PEM |
| SDK | `miniprogram-ci` / `minidev` 实际加载版本 |
| 网络 | 可选：微信 `Project.attr()`、支付宝 `getUploadedVersion`，验证 key 与 IP 白名单 |
| 预算 | 当前配置是否可计算 |

### v0.6 — 构建与产物（P2）

| 功能 | 说明 | 平台 |
| --- | --- | --- |
| 构建 npm | 上传/预览前执行 `packNpm`，`--build-npm` 开关 | 微信 |
| SourceMap | `wotci sourcemap -p weixin --output sm.zip`，对应 `getDevSourceMap` | 微信 |
| 编译产物检查 | `wotci inspect -p weixin --output compiled.zip`，对应 `getCompiledResult` | 微信 |
| 代码质量 | `wotci quality -p weixin --output report.json`，对应 `checkCodeQuality` | 微信 |
| 代理 | 配置 `proxy`，透传 `setCiProxy` / 环境变量 | 微信 |
| 源码打包 | `wotci pack -p alipay`，对应 `minidev.pack` | 支付宝 |

这些能力更偏「诊断/构建」，建议在预览和批量稳定后再做。

### v0.7 — 集成（进行中）

> 状态：`@wot-ui/ci/vite` 插件、GitHub Action 已实现；watch、monorepo、插件 API 待做。

### v0.8+ — 扩展集成

- `@wot-ui/ci/vite`：uni-app 构建完成后自动预览/上传
- GitHub Action：复用 composite action，直接输出 summary 与二维码 artifact
- `wotci preview --watch`：监听产物变化，持续生成预览二维码
- monorepo：扫描 workspace 内多个小程序项目并批量执行

## 4. 架构改造建议

### 4.1 平台适配器

把现有 `src/platforms/*` 升级为带能力声明的适配器：

```ts
interface PlatformAdapter<TConfig, TRaw> {
  platform: Platform
  capabilities: {
    upload: true
    preview: boolean
    versionQuery: boolean
    npmBuild: boolean
    sourceMap: boolean
  }
  upload(config: WotciConfig, options: UploadOptions): Promise<UploadResult>
  preview?(config: WotciConfig, options: PreviewOptions): Promise<PreviewResult>
  getLatestVersion?(config: WotciConfig, options: UploadOptions): Promise<string>
}
```

调用方先看 `capabilities`，缺失时抛 `UnsupportedCapabilityError`，CLI 输出统一提示。

### 4.2 命令层

当前 CLI 只有一个隐式 upload 命令。建议拆成：

```
src/commands/
  upload.ts
  preview.ts
  doctor.ts
  version.ts
```

保留兼容：

- `wotci -p weixin` 等价于 `wotci upload -p weixin`
- 现有 `runCli` / `parseCliArgs` 导出继续可用

### 4.3 输出层

- `HumanReporter`：彩色日志、表格、二维码
- `JsonReporter`：stdout 单 JSON，日志走 stderr
- `MarkdownReporter`：GitHub Step Summary

报告器只消费统一结果对象，避免每个命令重复拼输出。

### 4.4 配置类型

新增建议：

```ts
interface WeixinConfig {
  // ...
  preview?: WeixinPreviewConfig
  buildNpm?: boolean
}

interface AlipayConfig {
  // ...
  preview?: AlipayPreviewConfig
  experience?: boolean
}

interface WotciConfig {
  // ...
  budgets?: BudgetConfig
  versionStrategy?: VersionStrategy
}

interface WeixinIdeConfig {
  cliPath?: string
  port?: number
  lang?: 'zh' | 'en'
}

interface AlipayIdeConfig {
  appPath?: string
}
```

## 5. 测试与验收

- 保持 statements / branches / functions / lines 95% 以上阈值，新代码继续按 100% 目标补
- 新增能力的单元测试全部 mock SDK，不依赖真实密钥
- 预览测试覆盖：PNG 路径、URL、terminal、base64、不可写路径、平台能力缺失
- IDE 测试覆盖：命令拼装、路径探测、未安装、CI 环境拒绝、子进程退出码
- 批量测试覆盖：全成功、部分失败、并发、超时、JSON 输出快照
- Windows 路径、二维码文件写入、GitHub summary 需要跨平台用例
- 真实上传/预览只放在手动或 nightly job，PR 中不跑

## 6. 风险与待确认

1. **钉钉能力缺失**：钉钉只有上传。预览、版本查询、体验版都无法对齐，需要对用户显式说明。
2. **预览二维码差异**：微信可以输出文件/终端/base64，支付宝只返回远程 URL；统一结果必须保留 `kind`。
3. **并行上传风险**：微信 SDK 会 fork 子进程，多个平台并行可能有构建缓存/端口冲突；默认串行更稳。
4. **包体积预算仅微信可用**：支付宝、钉钉上传结果不含包体积。
5. **破坏性操作**：支付宝删除版本、取消体验版必须二次确认并支持 `--dry-run`。
6. **`checkCodeQuality` / `cloud` 依赖官方服务**：需要真实项目验证后再决定是否纳入主线。
7. **IDE 路径与登录态**：微信/支付宝 IDE 的 CLI 路径、版本和登录态因机器而异；需要路径探测 + 显式配置兜底。
8. **GUI 副作用**：打开 IDE 会抢占焦点、启动 GUI，CI 中必须默认禁用；自动化端口只监听 localhost。

## 7. 建议实施顺序

1. 平台适配器 + capabilities（不改行为，先重构）
2. 预览（微信、支付宝）+ CLI/JS API
3. 打开/关闭 IDE、自动化调试（本地开发集成）
4. 批量执行 + JSON + dry-run + summary
5. doctor
6. 版本查询 + 版本策略 + 预算
7. npm 构建 / SourceMap / 产物检查
8. Vite 插件 / GitHub Action

建议先做 **v0.4（预览 + 批量 + CI 输出）**，这是投入产出比最高的一组能力。
