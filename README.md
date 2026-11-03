# @wot-ui/ci

`@wot-ui/ci` 是一个面向微信、支付宝、钉钉小程序的多平台 CI 上传工具，由 `uni-mini-ci` 迁移而来。既可以在 `package.json` 里作为命令行工具使用，也可以作为 ESM 库被 JS/TS 脚本直接调用。

## 特性

- 支持微信、支付宝、钉钉三端小程序上传
- 微信上传链路基于 `miniprogram-ci` 2.x
- 提供 CLI（`wotci`）与 JS API（`upload`、`uploadPlatform`、`uploadWeixin` 等）
- 支持 `wotci init` 自动生成配置
- 支持包体积预算与发布体积趋势
- 支持 `release` 一步完成构建、多平台上传、历史记录与 PR 评论
- 支持微信、支付宝预览二维码（文件 / 终端 / URL）
- 支持通过 CLI/JS API 打开、关闭微信与支付宝开发者工具
- 支持 `wotci.config.ts/js/mjs/cjs/mts/cts` 配置文件，TS 配置在 CommonJS 项目中同样可用
- 配置文件可以通过工厂函数读取 `process.env`，避免把密钥写死
- 兼容 `uni-mini-ci` 的 `.minicirc`、`package.json` 中的 `uni-mini-ci` 字段以及 `dd` 平台别名
- 使用 tsdown 打包，输出 ESM 与类型声明；错误不会在库层调用 `process.exit`

## 环境要求

- Node.js >= 20
- 包本身只提供 ESM 入口；CommonJS 脚本可通过 `await import('@wot-ui/ci')` 调用

## 安装

```sh
# 项目内安装（推荐）
pnpm add -D @wot-ui/ci

# 或
# npm i -D @wot-ui/ci
# yarn add -D @wot-ui/ci
```

全局安装后可以直接使用 `wotci` 命令：

```sh
pnpm add -g @wot-ui/ci
```

## 快速开始（CLI）

在项目根目录创建配置文件（推荐 `wotci.config.ts` 或 `wotci.config.js`），然后执行：

```sh
pnpm exec wotci --platform weixin
npx wotci --platform weixin
```

通常会把上传命令和构建命令组合起来：

```json
{
  "scripts": {
    "upload:mp-weixin": "uni build -p mp-weixin && wotci -p weixin",
    "upload:mp-alipay": "uni build -p mp-alipay && wotci -p alipay",
    "upload:mp-dingtalk": "uni build -p mp-dingtalk && wotci -p dingtalk"
  }
}
```

### CLI 参数

```sh
wotci --platform weixin
wotci --platform alipay --config ./wotci.config.mjs
wotci --platform dd
wotci preview -p weixin
wotci open -p weixin
wotci close -p weixin --quit
```

| 参数 | 说明 |
| --- | --- |
| `-p, --platform <name>` | 目标平台：`weixin`、`alipay`、`dingtalk`，`dd` 是 `dingtalk` 的别名 |
| `-c, --config <file>` | 显式指定配置文件，相对路径基于 `--cwd` 解析 |
| `--cwd <dir>` | 配置解析目录，默认 `process.cwd()` |
| `-h, --help` | 查看帮助 |

上传成功退出码为 `0`，失败为 `1`，适合直接在 CI 中使用。

## 版本查询与策略

```sh
wotci version latest -p weixin
wotci version latest -p alipay
wotci version list -p alipay
wotci version latest -p weixin --json
```

配置：

```ts
export default defineConfig({
  versionStrategy: { type: 'auto', bump: 'patch' },
  // 或 { type: 'fixed', version: '1.2.3' }
  // 或 { type: 'package' }
})
```

- `fixed`：使用配置版本
- `package`：读取 `package.json` 的 version
- `auto`：查询线上最新版本后本地递增，不会修改 `package.json`
- 微信取 `getLatestVersion`，支付宝取 `getUploadedVersion`
- 钉钉没有版本查询能力，会回退到 `package.json` / 配置版本
- `--dry-run` 时 `auto` 不发起网络请求，使用 `package.json` 版本递增

版本策略会应用到 `upload`、`uploadMany`、`release`，只影响本次上传的版本号。

## 初始化配置（init）

```sh
wotci init
wotci init --platform weixin,alipay
wotci init --config ci.config.ts
wotci init --force
wotci init --dry-run --json
```

- 自动探测 `dist/build/mp-weixin`、`dist/build/mp-alipay`、`dist/build/mp-dingtalk` 等产物目录
- 探测不到平台时生成三端模板
- 默认写 `wotci.config.ts`，指定 `.js` 时生成 JS 配置
- 已存在配置文件时默认拒绝，`--force` 覆盖
- `--dry-run` 只输出内容，不写文件
- `--json` 输出生成路径、平台与内容

生成后按 env 注入 appid / 私钥路径即可，例如：

```ts
export default defineConfig(({ env, packageJson }) => ({
  version: env.WOTCI_VERSION ?? packageJson?.version,
  weixin: {
    appid: env.WEIXIN_APPID!,
    projectPath: env.WEIXIN_PROJECT_PATH ?? 'dist/build/mp-weixin',
    privateKeyPath: env.WEIXIN_PRIVATE_KEY_PATH!,
    robot: 1,
    setting: { useProjectConfig: true },
  },
}))
```

## 包体积预算

```ts
export default defineConfig({
  budgets: {
    total: '3MB',
    main: '1.5MB',
    warnOnly: false,
  },
})
```

- 数据来源：微信 `subPackageInfo`（总包、主包）
- 支付宝、钉钉不返回包体积，会自动跳过
- 超限且 `warnOnly: false`：该平台判定失败，退出码 `1`
- `warnOnly: true`：只输出告警
- `upload` / `uploadMany` / `release` / `preview` 均会附带 `budget` 结果
- `release` 会读取历史记录，在 PR 评论里展示体积增减

示例输出：

```text
总包 4.00MB 超出预算 3MB；主包 2.00MB 超出预算 1.5MB
```

## 配置体检（doctor）

```sh
wotci doctor
wotci doctor --network
wotci doctor --json
```

检查项：

- Node.js 版本（>= 20）
- 配置来源与多个配置文件冲突
- 各平台必填字段（appid、toolId、token 等）
- 产物目录、`project.config.json` / `app.json`
- 私钥存在性、权限、PEM 格式
- 微信/支付宝开发者工具路径
- release 构建命令与 GitHub PR 评论环境
- `--network` 时调用线上版本接口，校验 appid、私钥和 IP 白名单

退出码：有 `error` 时为 `1`，只有 `warn` 时为 `0`。`--json` 输出结构化检查结果，适合 CI。

## 批量执行与 CI 输出

上传和预览都支持多平台批量执行：

```sh
# 执行配置中所有平台
wotci upload --all
wotci preview --all

# 指定多个平台
wotci upload -p weixin,alipay

# 控制并发（默认 1，串行）
wotci upload --all --concurrency 2

# 只校验，不调用 SDK
wotci upload --all --dry-run

# JSON 输出
wotci upload --all --json

# 写入 GitHub Step Summary
wotci upload --all --summary "$GITHUB_STEP_SUMMARY"
```

- 单个平台失败不中断其它平台，最终退出码为 `1`
- `--dry-run` 只做本地校验：配置、产物目录、私钥、版本，不调用 SDK、不请求网络、不写文件
- `--json` 时 stdout 只输出 JSON，日志走 stderr；SDK 写到 stdout 的日志会被自动转发到 stderr
- `--summary` 生成 Markdown 表格，可直接写入 `$GITHUB_STEP_SUMMARY`

JSON 结构：

```json
{
  "schemaVersion": 1,
  "command": "upload",
  "dryRun": false,
  "ok": false,
  "durationMs": 12000,
  "results": [
    {
      "platform": "weixin",
      "ok": true,
      "durationMs": 8000,
      "result": {
        "version": "1.2.3",
        "sizes": { "total": 2048000, "main": 1024000 },
        "message": "微信小程序上传成功"
      }
    },
    {
      "platform": "alipay",
      "ok": false,
      "durationMs": 4000,
      "error": { "code": "UPLOAD_ERROR", "message": "支付宝小程序上传失败" }
    }
  ]
}
```

SDK raw 返回值不会进入 JSON，避免循环引用和超大对象。

## 预览二维码

```sh
# 微信：默认生成 PNG 到 .wotci/preview/weixin.png
wotci preview -p weixin

# 指定页面、参数、场景值和备注
wotci preview -p weixin \
  --page pages/index/index \
  --query "from=ci" \
  --scene 1011 \
  --desc "PR 预览"

# 终端二维码（不落盘）
wotci preview -p weixin --qr-format terminal

# 支付宝：默认输出远程二维码 URL
wotci preview -p alipay

# 支付宝下载二维码到本地
wotci preview -p alipay --qr-output dist/preview-alipay.png
```

| 参数 | 说明 |
| --- | --- |
| `--qr-format <type>` | `terminal`、`image`、`base64`，默认 `image`（微信） |
| `--qr-output <file>` | 二维码输出路径；微信缺省 `.wotci/preview/weixin.png`，支付宝传入后会下载 |
| `--page <path>` | 预览页面路径 |
| `--page-query <str>` | 支付宝页面参数 |
| `--query <str>` | 微信 `searchQuery` / 支付宝全局 `query` |
| `--scene <value>` | 场景值；微信要求整数 |
| `--desc <text>` | 微信预览备注 |
| `--robot <1-30>` | 指定 CI 机器人 |

平台差异：

- **微信**：支持 `terminal` / `image` / `base64`；`image` 返回本地文件路径，`base64` 会把内容读入结果
- **支付宝**：返回远程 `qrcodeUrl`；传 `--qr-output` 时下载到本地
- **钉钉**：SDK 未暴露预览能力，返回明确的不支持错误

## 打开开发者工具

除了 CI 上传/预览，`wotci` 也可以直接打开微信、支付宝开发者工具：

```sh
wotci open -p weixin
wotci open -p weixin --port 9420 --lang zh
wotci open -p alipay

wotci close -p weixin
wotci close -p weixin --quit

# 查询安装与登录状态
wotci ide status -p weixin

# 开启自动化端口，配合 miniprogram-automator
wotci auto -p weixin --port 9420 --trust-project

# 使用 IDE 自身 CLI 生成预览二维码
wotci ide preview -p weixin --qr-output dist/ide-preview.png
```

| 参数 | 说明 |
| --- | --- |
| `--dry-run` | 只打印将要执行的命令，不真正启动 IDE |
| `--force` | 在 `CI=true` 环境下显式允许打开 GUI |
| `--port <number>` | 微信开发者工具 HTTP server 端口 |
| `--lang <zh 或 en>` | 微信开发者工具语言 |
| `--quit` | `close` 时退出整个 IDE，而不是只关闭项目 |
| `--info-output <file>` | `ide preview` 时输出 IDE 的附加信息 |
| `--trust-project` | `auto` 时信任当前项目 |
| `--ticket <ticket>` | `auto` 时使用的 ticket |

平台差异：

- **微信**：通过开发者工具自带 CLI 执行 `open` / `close` / `quit` / `auto` / `preview` / `islogin`，会自动探测 macOS/Windows/Linux 的常见安装路径；也可以用 `weixin.ide.cliPath` 或环境变量 `WECHAT_DEVTOOLS_CLI` 指定
- **支付宝**：通过 `minidev.startIde` 打开，`alipay.ide.appPath` 可指定 IDE 安装路径；暂不支持命令行关闭、状态查询、自动化与 IDE 预览
- **钉钉**：`dingtalk-miniapp-opensdk` 未暴露 IDE 能力，会返回明确的不支持错误

`wotci ide status` 通过 `cli islogin` 判断登录状态；如果 IDE 未启动，该命令可能会启动 IDE。`wotci ide preview` 与 `wotci preview` 的区别是：前者走 IDE 自身 CLI、依赖本机登录态，后者走 `miniprogram-ci`、适合 CI。

为避免 CI 卡在 GUI 上，`CI=true` 时 `open` 默认拒绝执行；`--dry-run` 不受此限制。

## 发布编排（release）

`release` 把「构建 → 多平台上传 → 记录历史 → 评论 PR」串成一条命令：

```sh
# 构建并发布配置中的所有平台
wotci release

# 覆盖构建命令
wotci release --build "uni build -p mp-weixin"

# 只发布指定平台
wotci release -p weixin,alipay

# 跳过构建，直接上传已有产物
wotci release --skip-build

# 只看计划
wotci release --dry-run

# 关闭历史 / PR 评论
wotci release --no-history --no-pr-comment
```

配置：

```ts
export default defineConfig({
  version: '1.2.3',
  release: {
    buildCommand: 'uni build -p mp-weixin',
    platforms: ['weixin', 'alipay'],
    history: true,
    historyFile: '.wotci/history.json',
    historyLimit: 50,
    prComment: 'auto',
  },
})
```

`release` 的行为：

- 构建命令失败：不再上传，返回构建错误
- 单个平台上传失败：继续其它平台，最后以退出码 `1` 结束
- 历史写入失败、PR 评论失败：只告警，不影响发布结果
- `--dry-run`：不执行构建、不上传、不写历史、不评论

### 发布历史

默认写入 `.wotci/history.json`：

```json
{
  "version": 1,
  "records": [
    {
      "id": "uuid",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "version": "1.2.3",
      "ok": true,
      "git": { "branch": "main", "commit": "abc1234" },
      "build": { "commands": ["uni build -p mp-weixin"], "ok": true, "skipped": false },
      "platforms": [{ "platform": "weixin", "ok": true, "version": "1.2.3" }]
    }
  ]
}
```

- 自动限制条数（`historyLimit`）
- 原子写入，避免并发写坏文件
- `.wotci/` 已在 `.gitignore` 中

### PR 评论

在 GitHub Actions 中设置：

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

`release` 会自动读取：

- `GITHUB_TOKEN` / `GH_TOKEN`
- `GITHUB_REPOSITORY`
- PR 编号：`GITHUB_EVENT_PATH` 中的 `pull_request.number`，或 `GITHUB_REF=refs/pull/<n>/merge`
- 可选 `GITHUB_API_URL`（GitHub Enterprise）

评论内容包含平台结果、版本、包体积、耗时、构建命令、commit 和运行链接；同一 PR 使用 marker 更新已有评论，不会重复刷屏。

## 配置

### 配置加载顺序

1. JS API 传入的内联 `config`
2. CLI `--config` 或 JS API 传入的 `configFile`
3. 当前目录下的 `wotci.config.js`
4. `wotci.config.mjs`
5. `wotci.config.cjs`
6. `wotci.config.ts`
7. `wotci.config.mts`
8. `wotci.config.cts`
9. `package.json` 中的 `wotci` 字段
10. 当前目录下的 `.minicirc`（兼容 `uni-mini-ci`，支持 JSON5）
11. `package.json` 中的 `uni-mini-ci` 字段（兼容旧项目）
12. `package.json` 的 `version` / `description` 默认值

`version` 和 `desc` 没有显式配置时，会分别回退到 `package.json` 的 `version` 和 `description`。

### TS / JS 配置示例

```ts
import type { AlipayClientType } from '@wot-ui/ci'
import { defineConfig } from '@wot-ui/ci'

export default defineConfig(({ env, packageJson }) => ({
  version: env.WOTCI_VERSION ?? packageJson?.version,
  desc: env.WOTCI_DESC ?? packageJson?.description,
  weixin: {
    appid: env.WEIXIN_APPID!,
    projectPath: env.WEIXIN_PROJECT_PATH || 'dist/build/mp-weixin',
    privateKeyPath: env.WEIXIN_PRIVATE_KEY_PATH!,
    robot: env.WEIXIN_ROBOT ? Number(env.WEIXIN_ROBOT) : 1,
    setting: {
      useProjectConfig: true,
    },
  },
  alipay: {
    appid: env.ALIPAY_APPID!,
    toolId: env.ALIPAY_TOOL_ID!,
    projectPath: env.ALIPAY_PROJECT_PATH || 'dist/build/mp-alipay',
    privateKey: env.ALIPAY_PRIVATE_KEY,
    privateKeyPath: env.ALIPAY_PRIVATE_KEY_PATH,
    clientType: env.ALIPAY_CLIENT_TYPE as AlipayClientType | undefined,
    autoincrement: env.ALIPAY_AUTOINCREMENT === 'true',
  },
  dingtalk: {
    appid: env.DINGTALK_APPID!,
    token: env.DINGTALK_TOKEN!,
    projectPath: env.DINGTALK_PROJECT_PATH || 'dist/build/mp-dingtalk',
    autoincrement: env.DINGTALK_AUTOINCREMENT === 'true',
  },
}))
```

配置工厂会收到：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `cwd` | `string` | 配置解析目录的绝对路径 |
| `env` | `NodeJS.ProcessEnv` | 当前进程环境变量 |
| `packageJson` | `object \| undefined` | 当前目录下的 `package.json` |

> 在 `package.json` 没有 `"type": "module"` 的 CommonJS 项目中，`wotci.config.ts` 也能正确加载；旧版本中 tsx 双层 `default` 包装导致配置丢失的问题已修复。

### `.minicirc`（兼容 uni-mini-ci）

```jsonc
// .minicirc
{
  "version": "1.0.0",
  "desc": "发布描述",
  "weixin": {
    "appid": "微信小程序 appid",
    "privateKeyPath": "keys/private.appid.key",
    "projectPath": "dist/build/mp-weixin"
  },
  "alipay": {
    "appid": "支付宝小程序 appid",
    "toolId": "支付宝开放平台工具 ID",
    "privateKey": "私钥文本内容",
    "projectPath": "dist/build/mp-alipay",
    "autoincrement": true
  },
  "dd": {
    "appid": "钉钉 MiniAppId",
    "token": "钉钉 API Token",
    "projectPath": "dist/build/mp-dingtalk",
    "autoincrement": true
  }
}
```

`dd` 会在加载后自动归一为 `dingtalk`；同时存在时以 `dingtalk` 为准。

## 配置字段

### 微信小程序（weixin）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectPath` | `string` | 是 | 小程序产物目录，例如 `dist/build/mp-weixin` |
| `appid` | `string` | 是 | 小程序 / 小游戏 appid |
| `privateKeyPath` | `string` | 是 | 代码上传密钥文件路径；密钥需在微信公众平台生成并配置 IP 白名单 |
| `type` | `string` | 否 | `miniProgram`（默认）/ `miniGame` / `miniProgramPlugin` / `miniGamePlugin` |
| `ignores` | `string[]` | 否 | 上传时排除的目录或文件 |
| `robot` | `number` | 否 | 使用第几个 CI 机器人，1 ~ 30 |
| `setting` | `object` | 否 | 上传编译设置，透传给 miniprogram-ci |
| `ide` | `object` | 否 | 开发者工具配置：`cliPath`、`port`、`lang` |
| `preview` | `object` | 否 | 预览配置：`qrcodeFormat`、`qrcodeOutputDest`、`pagePath`、`searchQuery`、`scene`、`robot` 等 |

`setting` 常用字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `useProjectConfig` | `boolean` | 使用项目 `project.config.json` 中的设置 |
| `es6` | `boolean` | 「es6 转 es5」 |
| `es7` | `boolean` | 「增强编译」 |
| `disableUseStrict` | `boolean` | 增强编译时禁用 JS 严格模式 |
| `minifyJS` | `boolean` | 压缩 JS |
| `minifyWXML` | `boolean` | 压缩 WXML |
| `minifyWXSS` | `boolean` | 压缩 WXSS |
| `minify` | `boolean` | 压缩所有代码 |
| `codeProtect` | `boolean` | 代码保护 |
| `autoPrefixWXSS` | `boolean` | 样式自动补全 |

微信 CI 文档：https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html

### 支付宝小程序（alipay）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectPath` | `string` | 是 | 小程序产物目录 |
| `appid` | `string` | 是 | 小程序 appid |
| `toolId` | `string` | 是 | 开放平台工具 ID：https://open.alipay.com/dev/workspace/key-manage/tool |
| `privateKey` | `string` | 二选一 | 私钥文本内容 |
| `privateKeyPath` | `string` | 二选一 | 私钥文件路径 |
| `clientType` | `string` | 否 | 上传终端，默认 `alipay` |
| `autoincrement` | `boolean` | 否 | 是否由平台自动递增版本号，默认 `false` |
| `ide` | `object` | 否 | 开发者工具配置：`appPath` |
| `preview` | `object` | 否 | 预览配置：`page`、`pageQuery`、`query`、`scene`、`autoPush` 等 |

`clientType` 可选值：`alipay`、`ampe`、`amap`、`genie`、`alios`、`uc`、`quark`、`koubei`、`alipayiot`、`cainiao`、`alihealth`、`health`。

支付宝 CLI 文档：https://opendocs.alipay.com/mini/02q29z

### 钉钉小程序（dingtalk）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectPath` | `string` | 是 | 小程序产物目录 |
| `appid` | `string` | 是 | 开放平台 MiniAppId |
| `token` | `string` | 是 | 开放平台 API Token |
| `projectType` | `string` | 否 | 应用类型，当前仅保留字段 |
| `autoincrement` | `boolean` | 否 | 是否由平台自动递增版本号，默认 `false` |

钉钉上传文档：https://github.com/open-dingtalk/dingtalk-design-cli

## 版本号策略

- 微信：必须提供 `version`（可以来自配置或 `package.json`）
- 支付宝、钉钉：`autoincrement` 默认 `false`
  - `autoincrement: false`：必须提供 `version`；支付宝还会校验版本号必须大于线上最新版本
  - `autoincrement: true`：上传时传空版本号，由平台生成，结果版本从接口返回值读取

## JS API

### 一步上传

```ts
import { upload } from '@wot-ui/ci'

const result = await upload('weixin', {
  cwd: process.cwd(),
})

console.log(result.platform) // 'weixin'
console.log(result.version)
console.log(result.message)
```

`upload` 会自动加载配置，因此支持与 CLI 相同的配置来源。也可以直接传内联配置或指定配置文件：

```ts
await upload('alipay', { config: { alipay: { /* ... */ } } })
await upload('dingtalk', { configFile: './custom.config.ts' })
```

### 先加载配置，再上传

```ts
import { loadConfig, uploadPlatform } from '@wot-ui/ci'

const loaded = await loadConfig({ cwd: process.cwd() })
const result = await uploadPlatform('weixin', loaded.config, { cwd: loaded.cwd })

console.log(loaded.source) // 'file' | 'package-json' | 'minicirc' | 'inline' | 'defaults'
```

### 直接调用单平台上传

```ts
import { uploadAlipay, uploadDingTalk, uploadWeixin } from '@wot-ui/ci'

const result = await uploadWeixin({
  version: '1.0.0',
  desc: 'release',
  weixin: {
    appid: 'wx123',
    projectPath: 'dist/build/mp-weixin',
    privateKeyPath: 'keys/private.key',
  },
}, { cwd: process.cwd() })
```

三个平台函数都会返回统一结构：

```ts
interface UploadResult {
  platform: 'weixin' | 'alipay' | 'dingtalk'
  version: string
  desc?: string
  message: string
  raw: unknown // SDK 原始返回值
}
```

### 版本查询

```ts
import { getLatestVersion, getVersionList, resolveVersion } from '@wot-ui/ci'

const latest = await getLatestVersion('weixin', { cwd: process.cwd() })
const list = await getVersionList('alipay', { cwd: process.cwd() })

const resolution = await resolveVersion(loaded.config, {
  cwd: loaded.cwd,
  packageJson: loaded.packageJson,
})
console.log(resolution.version, resolution.source)
```

### 批量上传 / 预览

```ts
import { previewMany, uploadMany } from '@wot-ui/ci'

const result = await uploadMany({
  cwd: process.cwd(),
  platforms: ['weixin', 'alipay'],
  concurrency: 1,
})

console.log(result.ok)
console.log(result.results)

const dryRun = await uploadMany({
  cwd: process.cwd(),
  dryRun: true,
})

const previews = await previewMany({
  cwd: process.cwd(),
  platforms: ['weixin'],
  qrFormat: 'image',
})
```

### 发布编排

```ts
import { release } from '@wot-ui/ci'

const result = await release({
  cwd: process.cwd(),
  buildCommand: 'uni build -p mp-weixin',
  platforms: ['weixin', 'alipay'],
  prComment: 'auto',
})

console.log(result.ok)
console.log(result.historyFile)
console.log(result.commentUrl)
```

### 生成预览二维码

```ts
import { preview } from '@wot-ui/ci'

const result = await preview('weixin', {
  cwd: process.cwd(),
  qrFormat: 'image',
  qrOutput: 'dist/preview.png',
  pagePath: 'pages/index/index',
  query: 'from=ci',
  scene: 1011,
})

console.log(result.qrCode.kind) // 'file'
console.log(result.qrCode.value) // /abs/dist/preview.png
console.log(result.message)
```

支付宝返回远程链接：

```ts
const result = await preview('alipay', { cwd: process.cwd() })
console.log(result.qrCode.kind) // 'url'
console.log(result.qrCode.url)
```

### 打开 / 关闭开发者工具

```ts
import { closeIde, openIde } from '@wot-ui/ci'

const result = await openIde('weixin', {
  cwd: process.cwd(),
  port: 9420,
  lang: 'zh',
})

console.log(result.message)
// 已在微信开发者工具中打开：/path/to/dist/build/mp-weixin

await closeIde('weixin', { cwd: process.cwd(), quit: true })
```

状态、自动化与 IDE 预览：

```ts
import { autoIde, getIdeStatus, previewIde } from '@wot-ui/ci'

const status = await getIdeStatus('weixin', { cwd: process.cwd() })
console.log(status.installed, status.loggedIn)

await autoIde('weixin', {
  cwd: process.cwd(),
  port: 9420,
  trustProject: true,
})

const preview = await previewIde('weixin', {
  cwd: process.cwd(),
  qrOutput: 'dist/ide-preview.png',
})
console.log(preview.qrCode?.value)
```

`openIde` 同样会加载 `wotci.config.*`，因此可以用配置里的 `projectPath` 和 `ide.cliPath`；也可以直接传内联配置：

```ts
await openIde('alipay', {
  config: {
    alipay: {
      appid: '2021...',
      toolId: '...',
      privateKey: '...',
      projectPath: 'dist/build/mp-alipay',
      ide: { appPath: '/Applications/支付宝小程序开发者工具.app' },
    },
  },
})
```

### 默认导出

```ts
import wotci from '@wot-ui/ci'

await wotci.upload('weixin')
```

### 错误模型

库层不会调用 `process.exit`：

- 配置错误抛出 `ConfigError`
- 上传错误抛出 `UploadError`，原始错误挂在 `cause` 上
- 预览错误抛出 `PreviewError`；平台不支持预览时抛出 `PreviewUnsupportedError`
- 发布编排错误抛出 `ReleaseError`，构建失败抛出 `BuildError`
- IDE 相关错误抛出 `IdeError` 的子类：`IdeNotFoundError`（找不到 IDE）、`IdeUnsupportedError`（平台不支持）、`IdeCommandError`（命令执行失败）
- 以上错误都继承 `WotCIError`（带 `code` 字段）
- `formatErrorReport(error)` 可以把 `cause` 链格式化为字符串数组

CLI 会捕获这些错误、打印原因链并返回退出码 `1`，调用方也可以自行决定日志和退出策略。

## 从 uni-mini-ci 迁移

| uni-mini-ci | @wot-ui/ci |
| --- | --- |
| `minici --platform weixin` | `wotci --platform weixin` |
| `uni-mini-ci` 包 | `@wot-ui/ci` 包 |
| `.minicirc` | 继续可用（JSON5） |
| `package.json` 的 `uni-mini-ci` 字段 | 继续可用 |
| `dd` 配置 / `--platform dd` | 继续可用，内部归一为 `dingtalk` |
| 库层 `process.exit` | 抛出 `ConfigError` / `UploadError` |
| `miniprogram-ci` 1.x | `miniprogram-ci` 2.x |

需要注意：`autoincrement` 未配置时按 `false` 处理，与旧版行为一致；如果希望平台自动递增版本号，请显式配置 `autoincrement: true`。

## Playground

仓库内的 [playground/wotci.config.ts](playground/wotci.config.ts) 通过环境变量注入三端配置：

- `WOTCI_VERSION`、`WOTCI_DESC`：上传版本号和描述
- `WEIXIN_APPID`、`WEIXIN_PRIVATE_KEY_PATH`、`WEIXIN_PROJECT_PATH`、`WEIXIN_ROBOT`
- `ALIPAY_APPID`、`ALIPAY_TOOL_ID`、`ALIPAY_PRIVATE_KEY` 或 `ALIPAY_PRIVATE_KEY_PATH`、`ALIPAY_PROJECT_PATH`、`ALIPAY_CLIENT_TYPE`、`ALIPAY_AUTOINCREMENT`
- `DINGTALK_APPID`、`DINGTALK_TOKEN`、`DINGTALK_PROJECT_PATH`、`DINGTALK_AUTOINCREMENT`

本地示例：

```sh
WOTCI_VERSION=1.0.0 pnpm upload:playground:weixin
ALIPAY_PRIVATE_KEY="$(cat keys/alipay.private.key)" pnpm upload:playground:alipay
DINGTALK_APPID=xxx DINGTALK_TOKEN=xxx pnpm upload:playground:dingtalk
```

GitHub Actions 可参考 [.github/workflows/upload-playground.yml](.github/workflows/upload-playground.yml)。微信上传需要文件路径，工作流会先把 `WEIXIN_PRIVATE_KEY` 写入 `playground/keys/weixin.private.key`，再把路径注入 `WEIXIN_PRIVATE_KEY_PATH`。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test:run
pnpm test:coverage
pnpm build
```

测试覆盖率由 vitest 统计，并对 statements / branches / functions / lines 设置 95% 阈值；`src/bin.ts` 是进程入口，依赖 `process.exit`，不纳入覆盖率统计。

## 路线图

后续功能规划（预览、批量执行、版本管理、体检等）见 [docs/roadmap.md](docs/roadmap.md)。

## License

MIT
