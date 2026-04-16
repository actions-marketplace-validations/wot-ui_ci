# @wot-ui/ci

@wot-ui/ci 是一个面向多平台小程序产物上传的 ESM 库，支持微信、支付宝、钉钉三端上传能力，并支持通过 JS/TS 配置文件读取环境变量。

## 特性

- 使用 tsdown 打包，输出 ESM 与类型声明
- 使用 vitest 覆盖配置加载、版本比较与上传参数组装
- 支持 wotci.config.js / .mjs / .cjs / .ts / .mts / .cts 配置文件
- 提供轻量 CLI 包装层，可直接使用 wotci 触发上传
- JS 配置支持读取 process.env，不必把密钥或版本号写死在 JSON 中
- 微信上传链路升级到 miniprogram-ci v2

## 安装

```sh
# 推荐：项目内安装（devDependency）
pnpm add -D @wot-ui/ci

# 或
# npm i -D @wot-ui/ci
# yarn add -D @wot-ui/ci
```

### 全局安装（可选）

全局安装后可直接使用 `wotci` 命令：

```sh
pnpm add -g @wot-ui/ci

# 或
# npm i -g @wot-ui/ci
# yarn global add @wot-ui/ci
```

## 快速开始（CLI）

在项目根目录准备配置文件（推荐 `wotci.config.ts/js`），然后执行：

```sh
# 直接运行（node_modules/.bin）
pnpm exec wotci --platform weixin

# 或
npx wotci --platform weixin
```

也可以把上传命令写进 `package.json`：

```json
{
  "scripts": {
    "upload:weixin": "wotci -p weixin",
    "upload:alipay": "wotci -p alipay",
    "upload:dingtalk": "wotci -p dingtalk"
  }
}
```

然后通过包管理器的 scripts 运行（`npm run`/`pnpm`/`yarn` 都会把 `node_modules/.bin` 加到 PATH 里）：
https://docs.npmjs.com/cli/v9/commands/npm-run-script

与构建命令组合：

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
```

- --platform 或 -p：目标平台，支持 weixin、alipay、dingtalk、dd（dd 会归一到 dingtalk）
- --config 或 -c：显式指定配置文件路径
- --cwd：指定配置解析目录（相对路径配置/私钥/产物目录通常会基于该目录解析；默认 process.cwd()）
- --help 或 -h：查看帮助

## 配置

推荐使用 JS 配置文件。默认搜索顺序如下：

1. 显式传入的 config
2. --config 指定的配置文件
3. wotci.config.js
4. wotci.config.mjs
5. wotci.config.cjs
6. wotci.config.ts
7. wotci.config.mts
8. wotci.config.cts
9. package.json 中的 wotci 字段
10. package.json 中的 version 和 description 默认值

为了兼容旧项目，配置中历史上使用的 dd 字段仍然可用，加载后会自动归一为 dingtalk 配置。

### 配置字段

- 顶层
  - version：上传版本号（可选；部分平台在关闭自动递增时要求必填）
  - desc：上传描述（可选）
  - weixin / alipay / dingtalk：各平台配置（可选）
  - dd：历史兼容字段（可用但不推荐；会归一到 dingtalk）

#### weixin

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| projectPath | string | 是 | 微信小程序产物目录，例如 dist/build/mp-weixin |
| appid | string | 是 | 小程序/小游戏项目的 appid |
| privateKeyPath | string | 是 | 代码上传密钥文件路径（相对或绝对均可）；密钥需在微信公众平台生成，并配置 IP 白名单 |
| type | string | 否 | 项目类型：miniProgram / miniGame / miniProgramPlugin / miniGamePlugin |
| ignores | string[] | 否 | 上传需要排除的目录/文件规则（glob 风格，行为以微信 CI 为准） |
| robot | number | 否 | 指定使用哪一个 ci 机器人，可选值：1 ~ 30 |
| setting | object | 否 | 上传编译设置（透传给 miniprogram-ci；常用字段见下表，更多字段以官方文档为准） |

微信 CI 文档：https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html

**setting 常用字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| useProjectConfig | boolean | 是否使用项目 `project.config.json` 中的设置 |
| es6 | boolean | 对应微信开发者工具「es6 转 es5」 |
| es7 | boolean | 对应微信开发者工具「增强编译」 |
| disableUseStrict | boolean | 「增强编译」开启时，是否禁用 JS 文件严格模式 |
| minifyJS | boolean | 上传时压缩 JS 代码 |
| minifyWXML | boolean | 上传时压缩 WXML 代码 |
| minifyWXSS | boolean | 上传时压缩 WXSS 代码 |
| minify | boolean | 上传时压缩所有代码（对应「上传时压缩代码」） |
| codeProtect | boolean | 上传时进行代码保护 |
| autoPrefixWXSS | boolean | 上传时样式自动补全 |

#### alipay

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| projectPath | string | 是 | 支付宝小程序产物目录，例如 dist/build/mp-alipay |
| appid | string | 是 | 支付宝小程序 appid |
| toolId | string | 是 | 支付宝开放平台工具 ID（在开放平台控制台的「工具」里创建/查看）：https://open.alipay.com/dev/workspace/key-manage/tool |
| privateKey / privateKeyPath | string | 是（二选一） | 私钥文本内容或私钥文件路径；私钥可通过官方工具生成：https://opendocs.alipay.com/common/02kipl |
| clientType | string | 否 | 上传终端类型，默认 alipay（可选值见下表） |
| autoincrement | boolean | 否 | 版本号是否自动递增（默认开启）；关闭后需要提供顶层 version，且版本号必须大于线上最新版本 |

支付宝小程序 CLI 文档：
- 产品介绍：https://opendocs.alipay.com/mini/miniu/api
- 指令列表概览：https://opendocs.alipay.com/mini/02q29z

**clientType 可选值**

| 值 | 含义 |
| --- | --- |
| alipay | 支付宝 |
| ampe | AMPE |
| amap | 高德 |
| genie | 天猫精灵 |
| alios | ALIOS |
| uc | UC |
| quark | 夸克 |
| koubei | 口碑 |
| alipayiot | IoT |
| cainiao | 菜鸟 |
| alihealth | 阿里健康 |
| health | 阿里医院 |

#### dingtalk

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| projectPath | string | 是 | 钉钉小程序产物目录，例如 dist/build/mp-dingtalk |
| appid | string | 是 | 钉钉开发者后台的 MiniAppId |
| token | string | 是 | 钉钉开发者后台的 API Token |
| projectType | string | 否 | 钉钉小程序应用类型（预留字段；当前上传实现未使用） |
| autoincrement | boolean | 否 | 版本号是否自动递增（默认开启） |

### 版本号策略（autoincrement）

- 支付宝与钉钉默认开启自动递增（autoincrement 未配置时视为开启）
- autoincrement: true：上传时会把 version 置空交由平台侧自动生成版本号，结果版本号会从接口返回值中读取
- autoincrement: false：要求你显式提供顶层 version
  - 支付宝：还会校验 version 必须大于线上最新版本，否则拒绝上传

钉钉上传相关文档（Design CLI）：https://github.com/open-dingtalk/dingtalk-design-cli

### TS 配置示例（推荐）

```ts
import { defineConfig } from '@wot-ui/ci'

export default defineConfig(({ env }) => ({
  version: env.WOTCI_VERSION,
  desc: env.WOTCI_DESC,
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
    clientType: env.ALIPAY_CLIENT_TYPE,
    autoincrement: env.ALIPAY_AUTOINCREMENT ? env.ALIPAY_AUTOINCREMENT === 'true' : undefined,
  },
  dingtalk: {
    appid: env.DINGTALK_APPID!,
    token: env.DINGTALK_TOKEN!,
    projectPath: env.DINGTALK_PROJECT_PATH || 'dist/build/mp-dingtalk',
    autoincrement: env.DINGTALK_AUTOINCREMENT ? env.DINGTALK_AUTOINCREMENT === 'true' : undefined,
  },
}))
```

### JS 配置示例

```js
import { defineConfig } from '@wot-ui/ci'

export default defineConfig(({ env }) => ({
  version: env.WOTCI_VERSION,
  desc: env.WOTCI_DESC,
  weixin: {
    appid: env.WEIXIN_APPID,
    projectPath: env.WEIXIN_PROJECT_PATH || 'dist/build/mp-weixin',
    privateKeyPath: env.WEIXIN_PRIVATE_KEY_PATH,
    robot: env.WEIXIN_ROBOT ? Number(env.WEIXIN_ROBOT) : 1,
    setting: {
      useProjectConfig: true,
    },
  },
  alipay: {
    appid: env.ALIPAY_APPID,
    toolId: env.ALIPAY_TOOL_ID,
    projectPath: env.ALIPAY_PROJECT_PATH || 'dist/build/mp-alipay',
    privateKey: env.ALIPAY_PRIVATE_KEY,
    privateKeyPath: env.ALIPAY_PRIVATE_KEY_PATH,
    clientType: env.ALIPAY_CLIENT_TYPE,
    autoincrement: env.ALIPAY_AUTOINCREMENT ? env.ALIPAY_AUTOINCREMENT === 'true' : undefined,
  },
  dingtalk: {
    appid: env.DINGTALK_APPID,
    token: env.DINGTALK_TOKEN,
    projectPath: env.DINGTALK_PROJECT_PATH || 'dist/build/mp-dingtalk',
    autoincrement: env.DINGTALK_AUTOINCREMENT ? env.DINGTALK_AUTOINCREMENT === 'true' : undefined,
  },
}))
```

## Playground 示例

playground 中的 [playground/wotci.config.ts](playground/wotci.config.ts) 已经预留了微信、支付宝、钉钉三端配置，统一通过环境变量注入：

- `WOTCI_VERSION`：上传版本号，未传时回退到 playground 的 package.json version
- `WOTCI_DESC`：上传描述，未传时回退到 playground 的 package.json description
- `WEIXIN_APPID`
- `WEIXIN_PRIVATE_KEY_PATH`
- `WEIXIN_PROJECT_PATH`
- `WEIXIN_ROBOT`
- `ALIPAY_APPID`
- `ALIPAY_TOOL_ID`
- `ALIPAY_PRIVATE_KEY` 或 `ALIPAY_PRIVATE_KEY_PATH`
- `ALIPAY_PROJECT_PATH`
- `ALIPAY_CLIENT_TYPE`
- `ALIPAY_AUTOINCREMENT`
- `DINGTALK_APPID`
- `DINGTALK_TOKEN`
- `DINGTALK_PROJECT_PATH`
- `DINGTALK_AUTOINCREMENT`

本地示例命令：

```sh
WOTCI_VERSION=1.0.0 pnpm upload:playground:weixin
ALIPAY_PRIVATE_KEY="$(cat keys/alipay.private.key)" pnpm upload:playground:alipay
DINGTALK_APPID=xxx DINGTALK_TOKEN=xxx pnpm upload:playground:dingtalk
```

### GitHub Actions 变量映射

仓库内提供了可手动触发的工作流 [upload-playground.yml](.github/workflows/upload-playground.yml)。建议在 GitHub Secrets 中配置以下变量：

- `WEIXIN_APPID`
- `WEIXIN_PRIVATE_KEY`
- `WEIXIN_ROBOT`
- `ALIPAY_APPID`
- `ALIPAY_TOOL_ID`
- `ALIPAY_PRIVATE_KEY`
- `ALIPAY_CLIENT_TYPE`
- `ALIPAY_AUTOINCREMENT`
- `DINGTALK_APPID`
- `DINGTALK_TOKEN`
- `DINGTALK_PROJECT_PATH`
- `DINGTALK_AUTOINCREMENT`

其中：

- 微信因为上传 SDK 要求传文件路径，工作流会先把 `WEIXIN_PRIVATE_KEY` 写入 `playground/keys/weixin.private.key`，再把路径注入 `WEIXIN_PRIVATE_KEY_PATH`
- 支付宝支持直接传 `ALIPAY_PRIVATE_KEY` 内容；如果你更想走文件，也可以改成 `ALIPAY_PRIVATE_KEY_PATH`
- 钉钉默认读取 `dist/build/mp-dingtalk`，如果你的产物目录不同，直接在 Secret `DINGTALK_PROJECT_PATH` 里覆盖

## API（可选）

### 导出

- defineConfig
- loadConfig
- uploadWeixin
- uploadAlipay
- uploadDingTalk
- uploadPlatform
- compareVersion
- default: wotci

### 用法

```ts
import wotci, { loadConfig } from '@wot-ui/ci'

const loaded = await loadConfig()
const result = await wotci.uploadPlatform('weixin', loaded.config, { cwd: loaded.cwd })

console.log(result.version)
console.log(result.message)
```

### 错误模型

库层不再调用 process.exit。配置错误会抛出 ConfigError，上传过程错误会抛出 UploadError，由调用方决定日志输出和退出策略。

## License

MIT
