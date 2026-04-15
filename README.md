# @wot-ui/ci

@wot-ui/ci 是一个面向多平台小程序产物上传的 ESM 库，支持微信、支付宝、钉钉三端上传能力，并支持通过 JS/TS 配置文件读取环境变量。

## 特性

- 使用 tsdown 打包，输出 ESM 与类型声明
- 使用 vitest 覆盖配置加载、版本比较与上传参数组装
- 支持 minici.config.js / .mjs / .cjs / .ts / .mts / .cts 配置文件
- 提供轻量 CLI 包装层，可直接使用 minici 触发上传
- JS 配置支持读取 process.env，不必把密钥或版本号写死在 JSON 中
- 微信上传链路升级到 miniprogram-ci v2

## 安装

```sh
pnpm add @wot-ui/ci
```

## 配置

推荐使用 JS 配置文件。默认搜索顺序如下：

1. 显式传入的 config
2. minici.config.js
3. minici.config.mjs
4. minici.config.cjs
5. minici.config.ts
6. minici.config.mts
7. minici.config.cts
8. .minicirc
9. package.json 中的 minici 字段
10. package.json 中的 version 和 description 默认值

为了兼容旧项目，.minicirc 和 package.json 中历史上使用的 dd 字段仍然可用，加载后会自动归一为 dingtalk 配置。

### TS 配置示例

```ts
import { defineConfig } from '@wot-ui/ci'

export default defineConfig(({ env }) => ({
  version: env.APP_VERSION,
  desc: env.APP_DESC,
  weixin: {
    appid: env.WEIXIN_APPID,
    projectPath: 'dist/build/mp-weixin',
    privateKeyPath: env.WEIXIN_PRIVATE_KEY_PATH,
    robot: 1,
    setting: {
      useProjectConfig: true,
    },
  },
  alipay: {
    appid: env.ALIPAY_APPID,
    toolId: env.ALIPAY_TOOL_ID,
    privateKeyPath: env.ALIPAY_PRIVATE_KEY_PATH,
    projectPath: 'dist/build/mp-alipay',
  },
  dingtalk: {
    appid: env.DINGTALK_APPID,
    token: env.DINGTALK_TOKEN,
    projectPath: 'dist/build/mp-dingtalk',
  },
}))
```

### JS 配置示例

```js
import { defineConfig } from '@wot-ui/ci'

export default defineConfig(({ env }) => ({
  version: env.APP_VERSION,
  desc: env.APP_DESC,
  weixin: {
    appid: env.WEIXIN_APPID,
    projectPath: 'dist/build/mp-weixin',
    privateKeyPath: env.WEIXIN_PRIVATE_KEY_PATH,
    robot: 1,
    setting: {
      useProjectConfig: true,
    },
  },
  alipay: {
    appid: env.ALIPAY_APPID,
    toolId: env.ALIPAY_TOOL_ID,
    privateKeyPath: env.ALIPAY_PRIVATE_KEY_PATH,
    projectPath: 'dist/build/mp-alipay',
  },
  dingtalk: {
    appid: env.DINGTALK_APPID,
    token: env.DINGTALK_TOKEN,
    projectPath: 'dist/build/mp-dingtalk',
  },
}))
```

### .minicirc 示例

```json
{
  "dd": {
    "appid": "legacy-dd-appid",
    "token": "legacy-token",
    "projectPath": "dist/build/mp-dingtalk"
  },
  "weixin": {
    "appid": "wx123",
    "privateKeyPath": "keys/private.key",
    "projectPath": "dist/build/mp-weixin"
  },
  "version": "1.0.0",
  "desc": "release"
}
```

## 使用

### 加载配置

```ts
import { loadConfig } from '@wot-ui/ci'

const loaded = await loadConfig()
console.log(loaded.source)
console.log(loaded.config)
```

### 按平台上传

```ts
import { loadConfig, uploadWeixin } from '@wot-ui/ci'

const { config, cwd } = await loadConfig()
const result = await uploadWeixin(config, { cwd })

console.log(result.message)
```

### 动态选择平台

```ts
import { loadConfig, uploadPlatform } from '@wot-ui/ci'

const { config, cwd } = await loadConfig()
const result = await uploadPlatform('alipay', config, { cwd })

console.log(result.version)
```

### CLI

```sh
minici --platform weixin
minici --platform alipay --config ./minici.config.mjs
minici --platform dd
```

CLI 参数：

- --platform 或 -p：目标平台，支持 weixin、alipay、dingtalk、dd
- --config 或 -c：显式指定配置文件路径
- --cwd：指定配置解析目录
- --help 或 -h：查看帮助

## Playground 示例

playground 中的 [playground/minici.config.ts](playground/minici.config.ts) 已经预留了微信、支付宝、钉钉三端配置，统一通过环境变量注入：

- `MINICI_VERSION`：上传版本号，未传时回退到 playground 的 package.json version
- `MINICI_DESC`：上传描述，未传时回退到 playground 的 package.json description
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
MINICI_VERSION=1.0.0 pnpm upload:playground:weixin
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

## API

### 导出

- defineConfig
- loadConfig
- uploadWeixin
- uploadAlipay
- uploadDingTalk
- uploadPlatform
- compareVersion

### 错误模型

库层不再调用 process.exit。配置错误会抛出 ConfigError，上传过程错误会抛出 UploadError，由调用方决定日志输出和退出策略。

## Breaking Changes

- 不再提供旧版 minici CLI
- 不再以 CommonJS 为主产物
- 配置加载从旧的隐式读取逻辑改为显式 loadConfig API

当前版本重新提供了一个轻量 CLI，但它只负责把 loadConfig 和 uploadPlatform 串起来，不再保留旧实现里的进程控制和参数解析方式。

## License

ISC
