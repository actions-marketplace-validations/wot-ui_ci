#!/usr/bin/env node
/**
 * 端到端验证 @wot-ui/ci 的各项能力，全程离线、不需要真实 appid / 私钥 / 网络上传。
 *
 * 流程：
 *   1. 构建 dist，并把仓库打包成 tarball（验证发布产物）
 *   2. 在临时目录里创建一个“消费者”项目，用 npm 安装这个 tarball（模拟真实用户）
 *   3. 用消费者项目里的 wotci 逐个执行各命令，断言退出码、JSON 结构、输出文件与副作用
 *
 * 覆盖：帮助与参数校验、配置加载（TS 工厂 / -c / .minicirc）、init、doctor、upload（单平台、
 *     逗号列表、--all、并发、summary、dry-run 校验失败）、preview（含钉钉不支持）、release、
 *     版本与体验版参数校验、IDE 联动（假 CLI）、微信构建与诊断（build-npm / quality）、
 *     诊断平台守卫、JS API / Vite 插件 / 包导出。
 *
 * 用法：
 *   node scripts/verify-capabilities.mjs [options]
 *
 *   --workspace <dir>  消费者项目与夹具的创建位置，默认取系统临时目录
 *   --only <filter>    只跑名称或分组包含 filter 的用例（可重复）
 *   --list             列出全部用例后退出
 *   --keep             保留工作目录，便于排查
 *   --no-build         跳过 pnpm build（dist 已是最新时加速本地调试）
 *   --summary <file>   额外写入 Markdown 结果（可直接写 $GITHUB_STEP_SUMMARY）
 *   --verbose          打印每个用例的 stdout / stderr（默认只在失败时打印）
 */
import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const repoRoot = path.resolve(import.meta.dirname, '..')
const isWindows = process.platform === 'win32'

// ---------------------------------------------------------------------------
// 命令行参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { build: true, keep: false, list: false, only: [], summary: undefined, verbose: false, workspace: undefined }

  for (let index = 0; index < argv.length; index++) {
    const current = argv[index]

    switch (current) {
      case '--workspace':
        options.workspace = path.resolve(readValue(argv, ++index, current))
        break
      case '--only':
        options.only.push(readValue(argv, ++index, current))
        break
      case '--summary':
        options.summary = path.resolve(readValue(argv, ++index, current))
        break
      case '--list':
        options.list = true
        break
      case '--keep':
        options.keep = true
        break
      case '--no-build':
        options.build = false
        break
      case '--verbose':
        options.verbose = true
        break
      case '--help':
      case '-h':
        printUsage()
        process.exit(0)
        break
      default:
        console.error(`未知参数：${current}`)
        printUsage()
        process.exit(2)
    }
  }

  return options
}

function readValue(argv, index, name) {
  const value = argv[index]
  if (!value) {
    console.error(`参数缺少值：${name}`)
    process.exit(2)
  }
  return value
}

function printUsage() {
  console.log([
    '用法：node scripts/verify-capabilities.mjs [options]',
    '',
    '  --workspace <dir>  消费者项目与夹具的创建位置',
    '  --only <filter>    只跑名称或分组包含 filter 的用例，可重复',
    '  --list             列出全部用例',
    '  --keep             保留工作目录',
    '  --no-build         跳过 pnpm build',
    '  --summary <file>   写入 Markdown 结果',
    '  --verbose          打印每个用例的 stdout / stderr',
  ].join('\n'))
}

// ---------------------------------------------------------------------------
// 断言与进程
// ---------------------------------------------------------------------------

class VerificationError extends Error {}

function fail(message) {
  throw new VerificationError(message)
}

function assert(condition, message) {
  if (!condition)
    fail(message)
}

function formatValue(value) {
  if (typeof value === 'string')
    return JSON.stringify(value)
  return JSON.stringify(value)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected)
    fail(`${label}：期望 ${formatValue(expected)}，实际 ${formatValue(actual)}`)
}

function assertIncludes(text, needle, label) {
  if (!String(text).includes(needle))
    fail(`${label}：期望包含 ${formatValue(needle)}，实际 ${formatValue(truncate(String(text), 400))}`)
}

function assertNotIncludes(text, needle, label) {
  if (String(text).includes(needle))
    fail(`${label}：不应该包含 ${formatValue(needle)}`)
}

function assertArrayEqual(actual, expected, label) {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText)
    fail(`${label}：期望 ${expectedText}，实际 ${actualText}`)
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…（共 ${text.length} 字符）` : text
}

function parseJsonOutput(result, label = 'stdout') {
  try {
    return JSON.parse(result.stdout)
  }
  catch (error) {
    fail(`${label} 不是合法 JSON（${error.message}）：${formatValue(truncate(result.stdout, 400))}`)
  }
}

function expectExit(result, code) {
  if (result.error)
    fail(`无法执行命令：${result.error.message}`)
  if (result.code !== code)
    fail(`退出码：期望 ${code}，实际 ${result.code}${result.signal ? `（signal ${result.signal}）` : ''}`)
}

function platformList(payload) {
  return payload.results.map(item => item.platform)
}

function checkByName(checks, name) {
  return checks.find(check => check.name === name)
}

function assertAllChecksPass(checks, label) {
  const failed = checks.filter(check => !check.ok)
  if (failed.length)
    fail(`${label}：存在未通过的校验 ${JSON.stringify(failed)}`)
}

function runProcess(command, args, { cwd, env, timeout = 180_000 } = {}) {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...(isWindows ? { shell: true } : {}),
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)

    const finish = (payload) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      resolve({ ...payload, durationMs: Date.now() - startedAt })
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', error => finish({ code: null, error, stdout, stderr }))
    child.on('close', (code, signal) => finish({ code, error: undefined, signal, stderr, stdout }))
  })
}

// ---------------------------------------------------------------------------
// 夹具：一个可上传的“消费者”小程序项目
// ---------------------------------------------------------------------------

const PRIVATE_KEY_PLACEHOLDER = 'keys/weixin.private.key'
const FAKE_IDE_CLI = 'bin/fake-devtools-cli'
const FAKE_IDE_LOG = '.fake-devtools-calls.log'

function createPrivateKeyPem() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  return privateKey
}

async function writeFileTree(dir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(dir, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

async function writeMiniProgramArtifacts(dir) {
  await writeFileTree(dir, {
    'dist/build/mp-weixin/project.config.json': `${JSON.stringify({
      appid: 'wx0000000000000000',
      projectname: 'wotci-verify',
      miniprogramRoot: './',
      // 让离线的 build-npm 能找到一个可构建的 npm 依赖
      packNpmManually: true,
      packNpmRelationList: [{ packageJsonPath: './package.json', miniprogramNpmDistDir: './' }],
    }, null, 2)}\n`,
    'dist/build/mp-weixin/app.json': `${JSON.stringify({ pages: ['pages/index/index'], window: { navigationBarTitleText: 'wotci verify' } }, null, 2)}\n`,
    'dist/build/mp-weixin/app.js': 'App({})\n',
    'dist/build/mp-weixin/app.wxss': '.app { color: #333; }\n',
    'dist/build/mp-weixin/pages/index/index.js': 'Page({ data: { title: \'wotci\' } })\n',
    'dist/build/mp-weixin/pages/index/index.json': `${JSON.stringify({ navigationBarTitleText: 'index' }, null, 2)}\n`,
    'dist/build/mp-weixin/pages/index/index.wxml': '<view class="app">{{title}}</view>\n',
    'dist/build/mp-weixin/pages/index/index.wxss': '.app { padding: 12px; }\n',
    'dist/build/mp-weixin/package.json': `${JSON.stringify({
      name: 'mp-weixin-fixture',
      version: '1.0.0',
      dependencies: { 'tiny-dep': '^1.0.0' },
    }, null, 2)}\n`,
    'dist/build/mp-weixin/node_modules/tiny-dep/package.json': `${JSON.stringify({
      name: 'tiny-dep',
      version: '1.0.0',
      miniprogram: 'dist',
      main: 'index.js',
    }, null, 2)}\n`,
    'dist/build/mp-weixin/node_modules/tiny-dep/dist/index.js': 'module.exports = { hello: \'tiny-dep\' }\n',
    'dist/build/mp-alipay/project.config.json': `${JSON.stringify({ appid: '2021000000000000', projectname: 'wotci-verify' }, null, 2)}\n`,
    'dist/build/mp-alipay/app.json': `${JSON.stringify({ pages: ['pages/index/index'] }, null, 2)}\n`,
    'dist/build/mp-alipay/app.js': 'App({})\n',
  })
}

async function writePrivateKey(dir) {
  const keyPath = path.join(dir, PRIVATE_KEY_PLACEHOLDER)
  await mkdir(path.dirname(keyPath), { recursive: true })
  await writeFile(keyPath, createPrivateKeyPem())
  await chmod(keyPath, 0o600)
}

async function writeFakeIdeCli(dir) {
  const cliPath = path.join(dir, FAKE_IDE_CLI)
  await mkdir(path.dirname(cliPath), { recursive: true })
  await writeFile(cliPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `printf '%s\\n' "$*" >> "$(cd "$(dirname "$0")/.." && pwd)/${FAKE_IDE_LOG}"`,
    'previous=""',
    'for argument in "$@"; do',
    '  if [ "$previous" = "--qr-output" ]; then',
    '    printf \'ZmFrZS1xci1jb2Rl\' > "$argument"',
    '  fi',
    '  previous="$argument"',
    'done',
    'case "$*" in',
    '  islogin*) printf \'true\\n\' ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))
  await chmod(cliPath, 0o755)
}

function healthyConfig(options = {}) {
  const { ideCliPath = FAKE_IDE_CLI, privateKeyPath = PRIVATE_KEY_PLACEHOLDER } = options

  return `import { defineConfig } from '@wot-ui/ci'

export default defineConfig(({ env, packageJson }) => ({
  version: env.WOTCI_VERIFY_VERSION ?? packageJson?.version ?? '0.0.0',
  desc: 'wotci capability verify',
  weixin: {
    appid: 'wx0000000000000000',
    privateKeyPath: '${privateKeyPath}',
    projectPath: 'dist/build/mp-weixin',
    robot: 1,
    setting: { useProjectConfig: true },
    ide: { cliPath: '${ideCliPath}' },
  },
  alipay: {
    appid: '2021000000000000',
    toolId: 'wotci-verify',
    privateKeyPath: '${privateKeyPath}',
    projectPath: 'dist/build/mp-alipay',
  },
  dingtalk: {
    appid: 'dingtalk-verify-app',
    token: 'verify-token',
    projectPath: 'dist/build/mp-alipay',
  },
  release: { buildCommand: 'echo release-build', prComment: false },
  budgets: { main: '2MB', total: '4MB', warnOnly: true },
}))
`
}

const API_CHECK_SOURCE = `import process from 'node:process'

const api = await import('@wot-ui/ci')
const vite = await import('@wot-ui/ci/vite')

const functions = [
  'defineConfig', 'loadConfig', 'initProject', 'runDoctor',
  'upload', 'uploadMany', 'uploadPlatform', 'uploadWeixin', 'uploadAlipay', 'uploadDingTalk',
  'preview', 'previewMany', 'previewPlatform', 'release',
  'buildNpm', 'checkCodeQuality', 'downloadSourceMap', 'downloadCompiledResult',
  'getLatestVersion', 'getVersionList', 'resolveVersion', 'applyVersion', 'bumpVersion',
  'setExperience', 'cancelExperience', 'deleteVersion',
  'openIde', 'closeIde', 'autoIde', 'previewIde', 'getIdeStatus',
  'normalizePlatform', 'compareVersion',
]
const values = ['CONFIG_FILE_NAMES', 'WotCIError', 'CapabilityError', 'UploadError']

const missing = [
  ...functions.filter(name => typeof api[name] !== 'function'),
  ...values.filter(name => api[name] === undefined),
]
if (missing.length)
  throw new Error(\`缺少命名导出：\${missing.join(', ')}\`)

if (typeof vite.wotciPlugin !== 'function' || typeof vite.default !== 'function')
  throw new Error('@wot-ui/ci/vite 未导出 wotciPlugin')

const plugin = vite.wotciPlugin({ enabled: false })
if (plugin.name !== 'wot-ui-ci' || plugin.apply !== 'build')
  throw new Error(\`vite 插件形态不正确：\${JSON.stringify({ name: plugin.name, apply: plugin.apply })}\`)

const loaded = await api.loadConfig({ cwd: process.cwd() })
if (loaded.source !== 'file')
  throw new Error(\`loadConfig 来源应为 file，实际为 \${loaded.source}\`)
for (const platform of ['weixin', 'alipay', 'dingtalk']) {
  if (!loaded.config[platform])
    throw new Error(\`loadConfig 缺少 \${platform} 配置\`)
}

const batch = await api.uploadMany({ cwd: process.cwd(), config: loaded.config, dryRun: true, platforms: ['weixin', 'alipay'] })
if (!batch.ok)
  throw new Error(\`uploadMany dry-run 失败：\${JSON.stringify(batch.results)}\`)
if (batch.results.map(item => item.platform).join(',') !== 'weixin,alipay')
  throw new Error('uploadMany 未按请求顺序执行平台')

const doctor = await api.runDoctor({ cwd: process.cwd() })
if (!doctor.ok)
  throw new Error(\`runDoctor 未通过：\${JSON.stringify(doctor.checks.filter(check => check.status === 'error'))}\`)

console.log('ok')
`

const fixtureBuilders = new Map([
  ['healthy', async (dir) => {
    await writeMiniProgramArtifacts(dir)
    await writePrivateKey(dir)
    await writeFakeIdeCli(dir)
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({
      name: 'wotci-verify-consumer-fixture',
      version: '1.2.3',
      private: true,
      description: 'capability verify fixture',
    }, null, 2)}\n`)
    await writeFile(path.join(dir, 'wotci.config.ts'), healthyConfig())
    await writeFile(path.join(dir, 'api-check.mjs'), API_CHECK_SOURCE)
  }],
  ['alt-config', async (dir) => {
    await writeMiniProgramArtifacts(dir)
    await writePrivateKey(dir)
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'wotci-alt-config', version: '1.0.0', private: true })}\n`)
    await writeFile(path.join(dir, 'wotci.config.ts'), healthyConfig())
    await writeFileTree(dir, {
      'configs/alt.config.ts': `export default {
    version: '3.0.0',
    weixin: {
      appid: 'wx0000000000000000',
      privateKeyPath: 'keys/weixin.private.key',
      projectPath: 'dist/build/mp-weixin',
    },
  }
  `,
    })
  }],
  ['minicirc', async (dir) => {
    await writeMiniProgramArtifacts(dir)
    await writePrivateKey(dir)
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'wotci-minicirc', version: '1.0.0', private: true })}\n`)
    await writeFile(path.join(dir, '.minicirc'), `{
    // uni-mini-ci 兼容配置：JSON5 允许注释与尾逗号
    version: '4.5.6',
    weixin: {
      appid: 'wx0000000000000000',
      privateKeyPath: 'keys/weixin.private.key',
      projectPath: 'dist/build/mp-weixin',
    },
  }
  `)
  }],
  ['broken-key', async (dir) => {
    await writeMiniProgramArtifacts(dir)
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'wotci-broken-key', version: '1.0.0', private: true })}\n`)
    await writeFile(path.join(dir, 'wotci.config.ts'), healthyConfig({ privateKeyPath: 'keys/missing.private.key' }))
  }],
  ['alipay-only', async (dir) => {
    await writeMiniProgramArtifacts(dir)
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'wotci-alipay-only', version: '1.0.0', private: true })}\n`)
    await writeFile(path.join(dir, 'wotci.config.ts'), `export default {
    version: '1.0.0',
    alipay: {
      appid: '2021000000000000',
      toolId: 'wotci-verify',
      privateKey: 'inline-key-for-plan-check',
      projectPath: 'dist/build/mp-alipay',
    },
  }
  `)
  }],
  ['no-ide-cli', async (dir) => {
    await writeMiniProgramArtifacts(dir)
    await writePrivateKey(dir)
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'wotci-no-ide-cli', version: '1.0.0', private: true })}\n`)
    await writeFile(path.join(dir, 'wotci.config.ts'), healthyConfig({ ideCliPath: 'bin/missing-devtools-cli' }))
  }],
  ['bad-doctor', async (dir) => {
    await writeMiniProgramArtifacts(dir)
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'wotci-bad-doctor', version: '1.0.0', private: true })}\n`)
    await writeFile(path.join(dir, 'wotci.config.ts'), `export default {
    version: '1.0.0',
    weixin: {
      appid: 'wx0000000000000000',
      privateKeyPath: 'keys/missing.private.key',
      projectPath: 'dist/build/mp-weixin',
    },
    budgets: { total: '2MiB' },
  }
  `)
  }],
])
async function createEmptyProject(dir) {
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'wotci-init-target', version: '0.1.0', private: true })}\n`)
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

const cases = [
  // ---------------------------- 帮助与参数校验 ----------------------------
  {
    group: '帮助与参数校验',
    name: '--help 覆盖全部命令',
    fixture: 'healthy',
    args: ['--help'],
    verify(result) {
      expectExit(result, 0)
      for (const needle of [
        'wotci upload',
        'wotci release',
        'wotci version latest',
        'wotci experience set',
        'wotci doctor',
        'wotci init',
        'wotci build-npm',
        'wotci sourcemap',
        'wotci inspect',
        'wotci quality',
        'wotci preview',
        'wotci open',
        'wotci close',
        'wotci auto',
        'wotci ide status',
        'wotci ide preview',
      ]) {
        assertIncludes(result.stdout, needle, '帮助信息')
      }
    },
  },
  {
    group: '帮助与参数校验',
    name: '-h 与 --help 等价',
    fixture: 'healthy',
    args: ['preview', '-h'],
    verify(result) {
      expectExit(result, 0)
      assertIncludes(result.stdout, '用法：', '帮助信息')
    },
  },
  {
    group: '帮助与参数校验',
    name: '未知命令返回 1',
    fixture: 'healthy',
    args: ['frobnicate'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '未知命令：frobnicate', 'stderr')
    },
  },
  {
    group: '帮助与参数校验',
    name: '未知参数返回 1',
    fixture: 'healthy',
    args: ['doctor', '--frobnicate'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '未知参数：--frobnicate', 'stderr')
    },
  },
  {
    group: '帮助与参数校验',
    name: '缺少 --platform 返回 1',
    fixture: 'healthy',
    args: ['upload'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '缺少必填参数：--platform', 'stderr')
    },
  },

  // ------------------------------ 配置加载 ------------------------------
  {
    group: '配置加载',
    name: 'TS 配置工厂可以读取环境变量与 package.json',
    fixture: 'healthy',
    env: { WOTCI_VERIFY_VERSION: '9.9.9' },
    args: ['upload', '-p', 'weixin', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.config.source, 'file', '配置来源')
      assert(payload.config.sourceFile.endsWith('wotci.config.ts'), '配置来源文件应为 wotci.config.ts')
      assertEqual(payload.results[0].result.version, '9.9.9', '注入的版本号')
    },
  },
  {
    group: '配置加载',
    name: '-c 显式指定配置文件',
    fixture: 'alt-config',
    args: ['upload', '--config', 'configs/alt.config.ts', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assert(payload.config.sourceFile.endsWith('alt.config.ts'), `sourceFile 应为 alt.config.ts，实际 ${payload.config.sourceFile}`)
      assertEqual(payload.results[0].result.version, '3.0.0', '版本号')
    },
  },
  {
    group: '配置加载',
    name: '.minicirc 兼容 uni-mini-ci 配置',
    fixture: 'minicirc',
    args: ['upload', '-p', 'weixin', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.config.source, 'minicirc', '配置来源')
      assertEqual(payload.results[0].result.version, '4.5.6', '版本号')
    },
  },

  // -------------------------------- init --------------------------------
  {
    group: 'init',
    name: 'init --dry-run --json 只预览配置',
    fixture: 'init-preview',
    empty: true,
    args: ['init', '--dry-run', '--json', '--platform', 'weixin,alipay'],
    async verify(result, ctx) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.command, 'init', 'command')
      assertEqual(payload.written, false, 'written')
      assert(payload.file.endsWith('wotci.config.ts'), `file 应指向 wotci.config.ts，实际 ${payload.file}`)
      assertIncludes(payload.content, 'defineConfig', '生成的配置内容')
      assertArrayEqual(payload.platforms, ['weixin', 'alipay'], 'platforms')
      assert(!await ctx.exists('wotci.config.ts'), 'dry-run 不应该写入文件')
    },
  },
  {
    group: 'init',
    name: 'init 写入配置文件',
    fixture: 'init-write',
    empty: true,
    args: ['init', '--json', '--platform', 'weixin'],
    async verify(result, ctx) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.written, true, 'written')
      const content = await ctx.readText('wotci.config.ts')
      assertIncludes(content, 'weixin:', '生成的配置内容')
      assertIncludes(content, 'WEIXIN_APPID', '生成的配置内容应使用环境变量注入 appid')
    },
  },
  {
    group: 'init',
    name: '已存在时要求 --force，并支持只生成指定平台',
    fixture: 'init-force',
    empty: true,
    args: ['init', '--json', '--platform', 'weixin'],
    async verify(result, ctx) {
      expectExit(result, 0)

      const blocked = await ctx.run(['init', '--json'])
      expectExit(blocked, 1)
      assertIncludes(blocked.stderr, '--force', 'stderr')

      const forced = await ctx.run(['init', '--json', '--force', '--platform', 'alipay'])
      expectExit(forced, 0)
      const payload = parseJsonOutput(forced)
      assertArrayEqual(payload.platforms, ['alipay'], 'platforms')
      const content = await ctx.readText('wotci.config.ts')
      assertIncludes(content, 'alipay:', '生成的配置内容')
      assertNotIncludes(content, 'weixin:', '生成的配置内容')
    },
  },

  // ------------------------------- doctor -------------------------------
  {
    group: 'doctor',
    name: 'doctor --json 通过全部本地检查',
    fixture: 'healthy',
    args: ['doctor', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.ok, true, 'doctor ok')
      const ids = payload.checks.map(check => check.id)
      for (const id of [
        'node',
        'config',
        'weixin-appid',
        'weixin-project',
        'weixin-project-config',
        'weixin-key',
        'weixin-key-permission',
        'weixin-key-format',
        'weixin-diagnostics',
        'weixin-ide',
        'alipay-appid',
        'alipay-tool-id',
        'alipay-project',
        'alipay-key',
        'dingtalk-appid',
        'dingtalk-token',
        'dingtalk-project',
        'budgets',
        'release-build',
      ]) {
        assert(ids.includes(id), `doctor 结果缺少检查项 ${id}`)
      }
      const errors = payload.checks.filter(check => check.status === 'error')
      assertEqual(errors.length, 0, `doctor 不应有 error 检查项：${JSON.stringify(errors)}`)
    },
  },
  {
    group: 'doctor',
    name: 'doctor 报告缺失密钥与非法预算',
    fixture: 'bad-doctor',
    args: ['doctor', '--json'],
    verify(result) {
      expectExit(result, 1)
      const payload = parseJsonOutput(result)
      assertEqual(payload.ok, false, 'doctor ok')
      const byId = new Map(payload.checks.map(check => [check.id, check]))
      assertEqual(byId.get('weixin-key')?.status, 'error', 'weixin-key 状态')
      assertEqual(byId.get('budgets')?.status, 'error', 'budgets 状态')
    },
  },

  // ------------------------------- upload -------------------------------
  {
    group: 'upload',
    name: 'upload -p weixin --dry-run --json 校验产物与私钥',
    fixture: 'healthy',
    args: ['upload', '-p', 'weixin', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.command, 'upload', 'command')
      assertEqual(payload.schemaVersion, 1, 'schemaVersion')
      assertEqual(payload.dryRun, true, 'dryRun')
      assertEqual(payload.ok, true, 'ok')
      assertArrayEqual(platformList(payload), ['weixin'], '平台列表')
      const item = payload.results[0]
      assertEqual(item.result.action, 'upload', 'action')
      assert(item.result.projectPath.endsWith(path.join('dist', 'build', 'mp-weixin')), 'projectPath 应指向微信产物目录')
      assertEqual(item.result.version, '1.2.3', '版本号')
      assertAllChecksPass(item.result.checks, 'upload 计划校验')
      assert(result.stderr.length > 0, 'JSON 模式下日志应该输出到 stderr')
    },
  },
  {
    group: 'upload',
    name: 'upload -p alipay --dry-run --json',
    fixture: 'healthy',
    args: ['upload', '-p', 'alipay', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertArrayEqual(platformList(payload), ['alipay'], '平台列表')
      assertAllChecksPass(payload.results[0].result.checks, 'upload 计划校验')
    },
  },
  {
    group: 'upload',
    name: 'dd 是 dingtalk 的别名',
    fixture: 'healthy',
    args: ['upload', '-p', 'dd', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertArrayEqual(platformList(payload), ['dingtalk'], '平台列表')
    },
  },
  {
    group: 'upload',
    name: '逗号列表按顺序批量上传',
    fixture: 'healthy',
    args: ['upload', '-p', 'weixin,alipay', '--dry-run', '--json', '--concurrency', '2'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertArrayEqual(platformList(payload), ['weixin', 'alipay'], '平台列表')
    },
  },
  {
    group: 'upload',
    name: '--all 批量校验并写 Markdown summary',
    fixture: 'healthy',
    args: ['upload', '--all', '--dry-run', '--json', '--concurrency', '3', '--summary', 'out/upload-summary.md'],
    async verify(result, ctx) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertArrayEqual(platformList(payload), ['weixin', 'alipay', 'dingtalk'], '平台列表')
      for (const item of payload.results) {
        assertEqual(item.ok, true, `${item.platform} 结果`)
        assertAllChecksPass(item.result.checks, `${item.platform} 校验`)
      }

      const summary = await ctx.readText('out/upload-summary.md')
      assertIncludes(summary, '## 小程序上传结果（dry-run）', 'summary')
      for (const platform of ['weixin', 'alipay', 'dingtalk'])
        assertIncludes(summary, `| ${platform} | ✅ |`, 'summary')
    },
  },
  {
    group: 'upload',
    name: '校验失败时返回 1 并标出失败项',
    fixture: 'broken-key',
    args: ['upload', '--all', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 1)
      const payload = parseJsonOutput(result)
      assertEqual(payload.ok, false, 'ok')
      const weixin = payload.results.find(item => item.platform === 'weixin')
      assertEqual(weixin.ok, false, 'weixin 结果')
      const keyCheck = checkByName(weixin.result.checks, '私钥')
      assert(keyCheck, 'weixin 计划应包含私钥校验')
      assertEqual(keyCheck.ok, false, '私钥校验')
    },
  },

  // ------------------------------- preview -------------------------------
  {
    group: 'preview',
    name: 'preview -p weixin --dry-run --json',
    fixture: 'healthy',
    args: ['preview', '-p', 'weixin', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.command, 'preview', 'command')
      assertArrayEqual(platformList(payload), ['weixin'], '平台列表')
      assertEqual(payload.results[0].result.action, 'preview', 'action')
      assertAllChecksPass(payload.results[0].result.checks, 'preview 计划校验')
    },
  },
  {
    group: 'preview',
    name: 'preview -p alipay --dry-run --json',
    fixture: 'healthy',
    args: ['preview', '-p', 'alipay', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertArrayEqual(platformList(payload), ['alipay'], '平台列表')
    },
  },
  {
    group: 'preview',
    name: '钉钉预览返回 1 并说明不支持',
    fixture: 'healthy',
    args: ['preview', '-p', 'dingtalk', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 1)
      const payload = parseJsonOutput(result)
      assertEqual(payload.ok, false, 'ok')
      const capability = checkByName(payload.results[0].result.checks, '平台能力')
      assert(capability, '钉钉预览应包含平台能力校验')
      assertEqual(capability.ok, false, '平台能力校验')
      assertIncludes(capability.message, '钉钉 SDK 未提供预览能力', '平台能力说明')
    },
  },
  {
    group: 'preview',
    name: 'preview --all 汇总各平台支持情况',
    fixture: 'healthy',
    args: ['preview', '--all', '--dry-run', '--json'],
    verify(result) {
      expectExit(result, 1)
      const payload = parseJsonOutput(result)
      assertArrayEqual(platformList(payload), ['weixin', 'alipay', 'dingtalk'], '平台列表')
      const byPlatform = new Map(payload.results.map(item => [item.platform, item]))
      assertEqual(byPlatform.get('weixin').ok, true, 'weixin 结果')
      assertEqual(byPlatform.get('alipay').ok, true, 'alipay 结果')
      assertEqual(byPlatform.get('dingtalk').ok, false, 'dingtalk 结果')
    },
  },

  // ------------------------------- release -------------------------------
  {
    group: 'release',
    name: 'release --dry-run --skip-build 输出发布计划',
    fixture: 'healthy',
    args: ['release', '--dry-run', '--skip-build', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.command, 'release', 'command')
      assertEqual(payload.ok, true, 'ok')
      assertEqual(payload.dryRun, true, 'dryRun')
      assertEqual(payload.build.skipped, true, 'build.skipped')
      // 跳过构建时仍然回显配置里的构建命令，便于在 CI 日志里确认发布计划
      assertArrayEqual(payload.build.commands, ['echo release-build'], 'build.commands')
      assertArrayEqual(payload.platforms.map(item => item.platform), ['weixin', 'alipay', 'dingtalk'], '发布平台')
      assertEqual(payload.version, '1.2.3', '版本号')
    },
  },
  {
    group: 'release',
    name: '--build 覆盖配置里的构建命令',
    fixture: 'healthy',
    args: ['release', '--dry-run', '--build', 'echo cli-build', '--json'],
    verify(result) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.build.skipped, false, 'build.skipped')
      assertArrayEqual(payload.build.commands, ['echo cli-build'], 'build.commands')
    },
  },
  {
    group: 'release',
    name: 'release -p 只发布指定平台并写 summary',
    fixture: 'healthy',
    args: ['release', '-p', 'weixin', '--dry-run', '--skip-build', '--json', '--summary', 'out/release-summary.md'],
    async verify(result, ctx) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertArrayEqual(payload.platforms.map(item => item.platform), ['weixin'], '发布平台')

      const summary = await ctx.readText('out/release-summary.md')
      assertIncludes(summary, '<!-- wotci-release -->', 'summary')
      assertIncludes(summary, '| weixin | ✅ |', 'summary')
    },
  },

  // --------------------------- 版本与体验版参数 ---------------------------
  {
    group: '版本与体验版',
    name: 'version delete 缺少 --version 返回 1',
    fixture: 'healthy',
    args: ['version', 'delete', '-p', 'alipay'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '缺少必填参数：--version', 'stderr')
    },
  },
  {
    group: '版本与体验版',
    name: 'experience set 缺少 --version 返回 1',
    fixture: 'healthy',
    args: ['experience', 'set', '-p', 'alipay'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '缺少必填参数：--version', 'stderr')
    },
  },
  {
    group: '版本与体验版',
    name: 'version delete 缺少 --yes 时拒绝删除',
    fixture: 'healthy',
    args: ['version', 'delete', '-p', 'alipay', '--version', '1.0.0', '--json'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '破坏性操作', 'stderr')
      assertIncludes(result.stderr, '--yes', 'stderr')
    },
  },
  {
    group: '版本与体验版',
    name: 'version latest 拒绝钉钉',
    fixture: 'healthy',
    args: ['version', 'latest', '-p', 'dingtalk', '--json'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '钉钉小程序未提供线上版本查询能力', 'stderr')
    },
  },
  {
    group: '版本与体验版',
    name: 'version list 仅支持支付宝',
    fixture: 'healthy',
    args: ['version', 'list', '-p', 'weixin', '--json'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '当前仅支持查询支付宝版本列表', 'stderr')
    },
  },
  {
    group: '版本与体验版',
    name: '未知子命令给出明确报错',
    fixture: 'healthy',
    args: ['version', 'frobnicate'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '未知 version 子命令：frobnicate', 'stderr')
    },
  },
  {
    group: '版本与体验版',
    name: 'ide 未知子命令给出明确报错',
    fixture: 'healthy',
    args: ['ide', 'frobnicate'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '未知 ide 子命令：frobnicate', 'stderr')
    },
  },

  // ------------------------------ IDE 联动 ------------------------------
  {
    group: 'IDE 联动',
    name: 'ide status 读取登录状态',
    fixture: 'healthy',
    args: ['ide', 'status', '-p', 'weixin'],
    async verify(result, ctx) {
      expectExit(result, 0)
      assertIncludes(result.stdout, '已登录', 'stdout')
      assertIncludes(result.stdout, 'fake-devtools-cli', 'stdout')
      const calls = await ctx.ideCalls()
      assert(calls.some(line => line.startsWith('islogin')), `IDE CLI 应收到 islogin：${JSON.stringify(calls)}`)
    },
  },
  {
    group: 'IDE 联动',
    name: 'open --dry-run 只打印命令',
    fixture: 'healthy',
    args: ['open', '-p', 'weixin', '--dry-run'],
    async verify(result, ctx) {
      expectExit(result, 0)
      assertIncludes(result.stdout, '将执行：', 'stdout')
      assertIncludes(result.stdout, `open --project`, 'stdout')
      const calls = await ctx.ideCalls()
      assertEqual(calls.length, 0, 'dry-run 不应调用 IDE CLI')
    },
  },
  {
    group: 'IDE 联动',
    name: 'auto --dry-run 透传 port / ticket / trust-project',
    fixture: 'healthy',
    args: ['auto', '-p', 'weixin', '--dry-run', '--port', '9420', '--ticket', 'ticket-123', '--trust-project'],
    async verify(result, ctx) {
      expectExit(result, 0)
      assertIncludes(result.stdout, 'auto --project', 'stdout')
      assertIncludes(result.stdout, '--port 9420', 'stdout')
      assertIncludes(result.stdout, '--ticket ticket-123', 'stdout')
      assertIncludes(result.stdout, '--trust-project', 'stdout')
      const calls = await ctx.ideCalls()
      assertEqual(calls.length, 0, 'dry-run 不应调用 IDE CLI')
    },
  },
  {
    group: 'IDE 联动',
    name: 'open 真实执行时把项目路径传给 IDE',
    fixture: 'healthy',
    args: ['open', '-p', 'weixin'],
    async verify(result, ctx) {
      expectExit(result, 0)
      assertIncludes(result.stdout, '已在微信开发者工具中打开', 'stdout')
      const calls = await ctx.ideCalls()
      assert(calls.length === 1, `IDE CLI 应被调用一次，实际 ${JSON.stringify(calls)}`)
      assert(calls[0].startsWith('open --project '), `IDE CLI 参数不正确：${calls[0]}`)
      assert(calls[0].includes(path.join('dist', 'build', 'mp-weixin')), 'IDE CLI 应收到产物目录')
    },
  },
  {
    group: 'IDE 联动',
    name: 'close --quit 关闭整个开发者工具',
    fixture: 'healthy',
    args: ['close', '-p', 'weixin', '--quit', '--dry-run'],
    async verify(result, ctx) {
      expectExit(result, 0)
      assertIncludes(result.stdout, 'quit', 'stdout')
      const calls = await ctx.ideCalls()
      assertEqual(calls.length, 0, 'dry-run 不应调用 IDE CLI')
    },
  },
  {
    group: 'IDE 联动',
    name: 'ide preview --dry-run 透传二维码参数',
    fixture: 'healthy',
    args: ['ide', 'preview', '-p', 'weixin', '--dry-run', '--qr-format', 'base64', '--qr-output', 'out/qr.txt', '--info-output', 'out/info.json'],
    async verify(result, ctx) {
      expectExit(result, 0)
      assertIncludes(result.stdout, 'preview --project', 'stdout')
      assertIncludes(result.stdout, '--qr-format base64', 'stdout')
      assertIncludes(result.stdout, '--qr-output', 'stdout')
      assertIncludes(result.stdout, '--info-output', 'stdout')
      const calls = await ctx.ideCalls()
      assertEqual(calls.length, 0, 'dry-run 不应调用 IDE CLI')
    },
  },
  {
    group: 'IDE 联动',
    name: 'ide preview 生成 base64 二维码',
    fixture: 'healthy',
    args: ['ide', 'preview', '-p', 'weixin', '--qr-format', 'base64', '--qr-output', 'out/qr.txt'],
    async verify(result, ctx) {
      expectExit(result, 0)
      assertIncludes(result.stdout, '二维码已生成（base64）', 'stdout')
      const calls = await ctx.ideCalls()
      assert(calls.length === 1, `IDE CLI 应被调用一次，实际 ${JSON.stringify(calls)}`)
      assert(calls[0].includes('--qr-format base64'), `IDE CLI 参数不正确：${calls[0]}`)
      assertEqual((await ctx.readText('out/qr.txt')).trim(), 'ZmFrZS1xci1jb2Rl', '二维码文件内容')
    },
  },
  {
    group: 'IDE 联动',
    name: '找不到开发者工具时给出安装提示',
    fixture: 'no-ide-cli',
    args: ['open', '-p', 'weixin', '--dry-run'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '未找到微信开发者工具 CLI', 'stderr')
      assertIncludes(result.stderr, 'weixin.ide.cliPath', 'stderr')
    },
  },

  // ---------------------------- 微信构建与诊断 ----------------------------
  {
    group: '微信构建与诊断',
    name: 'build-npm 构建小程序 npm 并输出 JSON',
    fixture: 'healthy',
    args: ['build-npm', '-p', 'weixin', '--json'],
    async verify(result, ctx) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.command, 'build-npm', 'command')
      assertEqual(payload.platform, 'weixin', 'platform')
      assert(Array.isArray(payload.warnings), 'warnings 应为数组')
      assert(
        await ctx.exists(path.join('dist', 'build', 'mp-weixin', 'miniprogram_npm', 'tiny-dep', 'index.js')),
        'build-npm 应该把 tiny-dep 构建到 miniprogram_npm',
      )
    },
  },
  {
    group: '微信构建与诊断',
    name: 'quality 运行代码质量检查并写报告',
    fixture: 'healthy',
    args: ['quality', '-p', 'weixin', '--json', '--output', 'out/quality.json'],
    async verify(result, ctx) {
      expectExit(result, 0)
      const payload = parseJsonOutput(result)
      assertEqual(payload.command, 'quality', 'command')
      assert(payload.checks > 0, 'quality 应该返回检查项数量')
      const report = JSON.parse(await ctx.readText('out/quality.json'))
      assert(Array.isArray(report), '--output 应写入检查项数组')
      assertEqual(report.length, payload.checks, '报告条目数')
    },
  },
  {
    group: '微信构建与诊断',
    name: 'quality --fail-on-issues 有未通过项时返回 1',
    fixture: 'healthy',
    args: ['quality', '-p', 'weixin', '--json', '--fail-on-issues'],
    verify(result) {
      expectExit(result, 1)
      const payload = parseJsonOutput(result)
      assertEqual(payload.ok, false, 'quality ok')
      assert(payload.issues.length > 0, 'quality 应该报告未通过项')
      assert(payload.issues[0].name, '未通过项应有 name 字段')
    },
  },
  {
    group: '微信构建与诊断',
    name: '诊断命令拒绝非微信平台',
    fixture: 'healthy',
    args: ['quality', '-p', 'alipay', '--json'],
    async verify(result, ctx) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '仅支持 weixin 平台', 'quality stderr')
      assertEqual(result.stdout.trim(), '', 'quality 失败时 stdout 不应有内容')

      for (const command of ['sourcemap', 'inspect']) {
        const blocked = await ctx.run([command, '-p', 'alipay', '--json'])
        expectExit(blocked, 1)
        assertIncludes(blocked.stderr, '仅支持 weixin 平台', `${command} stderr`)
        assertEqual(blocked.stdout.trim(), '', `${command} 失败时 stdout 不应有内容`)
      }
    },
  },
  {
    group: '微信构建与诊断',
    name: '缺少微信配置时诊断命令给出明确报错',
    fixture: 'alipay-only',
    args: ['build-npm', '-p', 'weixin'],
    verify(result) {
      expectExit(result, 1)
      assertIncludes(result.stderr, '缺少微信小程序配置', 'stderr')
    },
  },

  // -------------------------- JS API 与发包产物 --------------------------
  {
    group: 'JS API 与发包产物',
    name: 'JS API / Vite 插件 / 配置加载可用',
    fixture: 'healthy',
    args: ['api-check.mjs'],
    node: true,
    verify(result) {
      expectExit(result, 0)
      assertIncludes(result.stdout, 'ok', 'stdout')
    },
  },
  {
    group: 'JS API 与发包产物',
    name: '包清单暴露 CLI 与入口',
    fixture: 'healthy',
    skipRun: true,
    async verify(result, ctx) {
      const manifest = JSON.parse(await readFile(path.join(ctx.packageDir, 'package.json'), 'utf8'))
      const expectedEntrypoints = ['.', './bin', './cli', './vite', './package.json']
      for (const entry of expectedEntrypoints)
        assert(manifest.exports?.[entry], `package.json exports 缺少 ${entry}`)
      assertEqual(manifest.bin?.wotci, './dist/bin.mjs', 'bin.wotci')
      assertArrayEqual(manifest.files, ['dist'], 'files')
      assertEqual(typeof manifest.version, 'string', 'version')
    },
  },
  {
    group: 'JS API 与发包产物',
    name: '@wot-ui/ci/bin 入口可直接执行',
    fixture: 'healthy',
    args: ['--help'],
    node: true,
    packagePath: ['dist', 'bin.mjs'],
    verify(result) {
      expectExit(result, 0)
      assertIncludes(result.stdout, '用法：', 'stdout')
    },
  },
]

// IDE 用例通过 bash 假 CLI 验证参数透传，Windows 上跳过
for (const testCase of cases) {
  if (testCase.group === 'IDE 联动')
    testCase.unixOnly = true
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const selected = cases.filter(item => options.only.length === 0
    || options.only.some(filter => item.name.includes(filter) || item.group.includes(filter)))

  if (options.list) {
    for (const item of selected)
      console.log(`[${item.group}] ${item.name}`)
    return
  }

  const workspace = options.workspace ?? await mkdtemp(path.join(os.tmpdir(), 'wotci-verify-'))
  await mkdir(workspace, { recursive: true })

  const consumerDir = path.join(workspace, 'consumer')
  const fixturesDir = path.join(consumerDir, '.verify')

  let summaryLines = []

  try {
    const tarball = await prepareConsumer({ consumerDir, options, workspace })
    const cli = path.join(consumerDir, 'node_modules', '.bin', isWindows ? 'wotci.cmd' : 'wotci')
    const packageDir = path.join(consumerDir, 'node_modules', '@wot-ui', 'ci')

    const packageVersion = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')).version

    console.log('')
    console.log(`wot-ui-ci 能力验证（${packageVersion}，node ${process.versions.node}）`)
    console.log(`  CLI          ${cli}`)
    console.log(`  tarball      ${path.basename(tarball)}`)
    console.log(`  workspace    ${workspace}`)
    console.log('')

    const context = await createContext({ cli, consumerDir, fixturesDir })
    const results = []

    for (const testCase of selected) {
      if (testCase.unixOnly && isWindows) {
        results.push({ case: testCase, status: 'skipped', durationMs: 0 })
        console.log(`  ○ ${testCase.name}（Windows 跳过）`)
        continue
      }

      const startedAt = Date.now()
      let run

      try {
        run = await context.execute(testCase)
        if (options.verbose) {
          console.log(`    $ ${testCase.node === true ? 'node' : 'wotci'} ${(testCase.args ?? []).join(' ')}`)
          if (run.result.stdout.trim())
            console.log(`    stdout: ${truncate(run.result.stdout.trim(), 1200)}`)
          if (run.result.stderr.trim())
            console.log(`    stderr: ${truncate(run.result.stderr.trim(), 1200)}`)
        }
        await testCase.verify(run.result, run.ctx)
        results.push({ case: testCase, status: 'passed', durationMs: Date.now() - startedAt })
        console.log(`  ✔ ${testCase.name}（${formatDuration(Date.now() - startedAt)}）`)
      }
      catch (error) {
        const durationMs = Date.now() - startedAt
        results.push({ case: testCase, status: 'failed', durationMs, error })
        console.log(`  ✘ ${testCase.name}（${formatDuration(durationMs)}）`)
        console.log(`      ${error instanceof VerificationError ? error.message : error.stack ?? error.message}`)
        if (run?.result) {
          console.log(`      stdout: ${truncate(run.result.stdout.trim(), 1200) || '(空)'}`)
          console.log(`      stderr: ${truncate(run.result.stderr.trim(), 1200) || '(空)'}`)
        }
      }
    }

    summaryLines = renderSummaryTable(results)

    const failed = results.filter(item => item.status === 'failed')
    const passed = results.filter(item => item.status === 'passed')
    const skipped = results.filter(item => item.status === 'skipped')

    const markdown = [
      `## wot-ui-ci 能力验证`,
      '',
      `- 通过 **${passed.length}** / 失败 **${failed.length}** / 跳过 **${skipped.length}**`,
      `- 版本：\`${packageVersion}\`，Node \`${process.versions.node}\`，${process.platform}`,
      '',
      ...summaryLines,
      '',
    ].join('\n')

    if (options.summary)
      await writeFile(options.summary, `${markdown}\n`, { flag: 'a' })

    console.log('')
    for (const line of summaryLines)
      console.log(line)
    console.log('')
    console.log(`通过 ${passed.length}，失败 ${failed.length}，跳过 ${skipped.length}`)

    if (failed.length) {
      console.log('')
      console.log('失败用例：')
      for (const item of failed)
        console.log(`  - [${item.case.group}] ${item.case.name}`)
      process.exitCode = 1
    }
  }
  finally {
    if (options.keep) {
      console.log('')
      console.log(`已保留工作目录：${workspace}`)
    }
    else {
      await rm(workspace, { force: true, recursive: true })
    }
  }
}

async function prepareConsumer({ consumerDir, options, workspace }) {
  await mkdir(consumerDir, { recursive: true })
  await writeFile(path.join(consumerDir, 'package.json'), `${JSON.stringify({
    name: 'wotci-verify-consumer',
    private: true,
    version: '0.0.0',
  }, null, 2)}\n`)

  if (options.build) {
    console.log('构建 dist…')
    const build = await runProcess('pnpm', ['run', 'build'], { cwd: repoRoot, timeout: 300_000 })
    if (build.code !== 0)
      throw new Error(`pnpm build 失败：\n${build.stdout}\n${build.stderr}`)
  }

  console.log('打包 tarball…')
  const packDir = path.join(workspace, 'pack')
  await mkdir(packDir, { recursive: true })
  const pack = await runProcess('pnpm', ['pack', '--pack-destination', packDir], { cwd: repoRoot, timeout: 300_000 })
  if (pack.code !== 0)
    throw new Error(`pnpm pack 失败：\n${pack.stdout}\n${pack.stderr}`)

  const tarballs = (await readdir(packDir)).filter(name => name.endsWith('.tgz'))
  if (!tarballs.length)
    throw new Error(`pnpm pack 没有产出台本包：${packDir}`)
  const tarball = path.join(packDir, tarballs.sort().at(-1))

  console.log('在消费者项目里安装 tarball（模拟真实用户）…')
  const install = await runProcess('npm', ['install', '--no-audit', '--no-fund', '--no-progress', '--loglevel=error', tarball], {
    cwd: consumerDir,
    env: { npm_config_cache: path.join(workspace, '.npm-cache') },
    timeout: 900_000,
  })
  if (install.code !== 0)
    throw new Error(`npm install ${tarball} 失败：\n${install.stdout}\n${install.stderr}`)

  return tarball
}

async function createContext({ cli, consumerDir, fixturesDir }) {
  const packageDir = path.join(consumerDir, 'node_modules', '@wot-ui', 'ci')
  const fixtureCache = new Map()

  async function fixture(name) {
    if (fixtureCache.has(name))
      return fixtureCache.get(name)

    const dir = path.join(fixturesDir, name)
    await mkdir(dir, { recursive: true })
    const testCase = cases.find(item => item.fixture === name)
    if (testCase?.empty)
      await createEmptyProject(dir)
    else if (fixtureBuilders.has(name))
      await fixtureBuilders.get(name)(dir)
    else
      throw new Error(`未定义的夹具：${name}`)

    fixtureCache.set(name, dir)
    return dir
  }

  function caseContext(dir) {
    const file = relative => path.join(dir, relative)
    return {
      packageDir,
      exists: async relative => stat(file(relative)).then(() => true).catch(() => false),
      readText: async relative => readFile(file(relative), 'utf8'),
      run: async (args, runOptions = {}) => runProcess(cli, args, {
        cwd: dir,
        env: { GITHUB_ACTIONS: 'false', ...(runOptions.env ?? {}) },
        timeout: runOptions.timeout ?? 120_000,
      }),
      ideCalls: async () => {
        const content = await readFile(file(FAKE_IDE_LOG), 'utf8').catch(() => '')
        return content.split('\n').filter(Boolean)
      },
      resetIdeCalls: async () => rm(file(FAKE_IDE_LOG), { force: true }),
    }
  }

  return {
    async execute(testCase) {
      const dir = await fixture(testCase.fixture)
      const ctx = caseContext(dir)
      await ctx.resetIdeCalls()

      if (testCase.skipRun)
        return { ctx, result: { code: 0, error: undefined, stderr: '', stdout: '' } }

      const isNodeCase = testCase.node === true
      const command = isNodeCase ? process.execPath : cli
      const args = testCase.packagePath
        ? [path.join(consumerDir, 'node_modules', '@wot-ui', 'ci', ...testCase.packagePath), ...testCase.args]
        : testCase.args

      const result = await runProcess(command, args, {
        cwd: dir,
        env: { GITHUB_ACTIONS: 'false', ...(testCase.env ?? {}) },
        timeout: testCase.timeout ?? 180_000,
      })

      return { ctx, result }
    },
    cli,
    consumerDir,
  }
}

function formatDuration(durationMs) {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
}

function renderSummaryTable(results) {
  const lines = [
    '| 能力 | 检查 | 结果 | 耗时 |',
    '| --- | --- | --- | --- |',
  ]

  for (const item of results) {
    const mark = item.status === 'passed' ? '✅' : item.status === 'failed' ? '❌' : '⏭️'
    lines.push(`| ${item.case.group} | ${item.case.name} | ${mark} | ${formatDuration(item.durationMs)} |`)
  }

  return lines
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
