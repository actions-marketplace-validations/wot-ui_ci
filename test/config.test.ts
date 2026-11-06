import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG_FILE_NAMES, defineConfig, LEGACY_CONFIG_FILE_NAME, loadConfig } from '../src/config'
import { ConfigError } from '../src/errors'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

interface ProjectOptions {
  files?: Record<string, string>
  packageJson?: Record<string, unknown>
  type?: 'commonjs' | 'module'
}

async function createProject(options: ProjectOptions = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wotci-config-'))
  tempDirs.push(dir)

  const packageJson = {
    description: 'fixture description',
    name: 'fixture',
    version: '1.0.0',
    ...(options.type ? { type: options.type } : {}),
    ...options.packageJson,
  }

  await writeFile(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2))

  for (const [fileName, content] of Object.entries(options.files ?? {})) {
    const filePath = path.join(dir, fileName)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }

  return dir
}

const weixinConfig = `{
  appid: 'wx-fixture',
  projectPath: 'dist/weixin',
  privateKeyPath: 'keys/private.key',
}`

describe('loadConfig: 内联与默认值', () => {
  it('支持内联工厂函数并注入 env 与 package.json', async () => {
    const cwd = await createProject()
    process.env.WOTCI_TEST_VERSION = '2.0.0'

    try {
      const loaded = await loadConfig({
        config: ({ env, packageJson }) => ({
          desc: env.WOTCI_TEST_DESC ?? packageJson?.description,
          version: env.WOTCI_TEST_VERSION,
        }),
        cwd,
      })

      expect(loaded.source).toBe('inline')
      expect(loaded.config.version).toBe('2.0.0')
      expect(loaded.config.desc).toBe('fixture description')
      expect(loaded.cwd).toBe(cwd)
    }
    finally {
      delete process.env.WOTCI_TEST_VERSION
    }
  })

  it('没有配置来源时回退到 package.json 默认值', async () => {
    const cwd = await createProject()
    const loaded = await loadConfig({ cwd })

    expect(loaded.source).toBe('defaults')
    expect(loaded.config).toEqual({
      desc: 'fixture description',
      version: '1.0.0',
    })
  })

  it('defineConfig 保持引用不变', () => {
    const factory = defineConfig(() => ({ version: '1.0.0' }))
    expect(typeof factory).toBe('function')
    expect(defineConfig({ version: '1.0.0' })).toEqual({ version: '1.0.0' })
  })
})

describe('loadConfig: JS / TS 配置文件', () => {
  it('加载 ESM 项目中的 wotci.config.js', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default {\n  version: '2.0.0',\n  weixin: ${weixinConfig},\n}\n`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.source).toBe('file')
    expect(loaded.sourceFile).toBe(path.join(cwd, 'wotci.config.js'))
    expect(loaded.config.version).toBe('2.0.0')
    expect(loaded.config.weixin?.appid).toBe('wx-fixture')
  })

  it('加载 CJS 配置文件', async () => {
    const cwd = await createProject({
      files: {
        'wotci.config.cjs': `module.exports = { version: '2.1.0', weixin: ${weixinConfig} }\n`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.config.version).toBe('2.1.0')
    expect(loaded.config.weixin?.appid).toBe('wx-fixture')
  })

  it('在 CJS 项目中加载 wotci.config.ts（回归：tsx 双重 default 包装）', async () => {
    const cwd = await createProject({
      files: {
        'wotci.config.ts': `export default () => ({\n  version: '3.0.0',\n  weixin: ${weixinConfig},\n})\n`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.source).toBe('file')
    expect(loaded.config.version).toBe('3.0.0')
    expect(loaded.config.weixin?.appid).toBe('wx-fixture')
    expect(loaded.config).not.toHaveProperty('__esModule')
    expect(loaded.config).not.toHaveProperty('default')
  })

  it('在 ESM 项目中加载 wotci.config.ts', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.ts': `export default {\n  version: '3.1.0',\n  weixin: ${weixinConfig},\n}\n`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.config.version).toBe('3.1.0')
    expect(loaded.config.weixin?.appid).toBe('wx-fixture')
  })

  it('加载 wotci.config.cts', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.cts': `export = { version: '3.2.0', weixin: ${weixinConfig} }\n`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.config.version).toBe('3.2.0')
    expect(loaded.config.weixin?.appid).toBe('wx-fixture')
  })

  it('显式 configFile 优先于默认搜索，且支持相对路径', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default { version: '1.0.0' }\n`,
        'custom.config.mjs': `export default { version: '9.9.9' }\n`,
      },
    })

    const loaded = await loadConfig({ configFile: 'custom.config.mjs', cwd })

    expect(loaded.config.version).toBe('9.9.9')
    expect(loaded.sourceFile).toBe(path.join(cwd, 'custom.config.mjs'))
  })

  it('显式 configFile 不存在时抛出 ConfigError', async () => {
    const cwd = await createProject()

    await expect(loadConfig({ configFile: 'missing.config.js', cwd }))
      .rejects
      .toThrow(ConfigError)
  })

  it('导出默认的配置文件搜索顺序', () => {
    expect(CONFIG_FILE_NAMES[0]).toBe('wotci.config.js')
    expect(CONFIG_FILE_NAMES).toContain('wotci.config.ts')
    expect(LEGACY_CONFIG_FILE_NAME).toBe('.minicirc')
  })
})

describe('loadConfig: package.json 与 .minicirc', () => {
  it('读取 package.json 中的 wotci 字段，并保留 package 默认值', async () => {
    const cwd = await createProject({
      packageJson: {
        wotci: {
          weixin: {
            appid: 'wx-pkg',
            privateKeyPath: 'keys/private.key',
            projectPath: 'dist/weixin',
          },
        },
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.source).toBe('package-json')
    expect(loaded.config.version).toBe('1.0.0')
    expect(loaded.config.weixin?.appid).toBe('wx-pkg')
  })

  it('兼容 package.json 中的 uni-mini-ci 字段', async () => {
    const cwd = await createProject({
      packageJson: {
        'uni-mini-ci': {
          version: '5.0.0',
          weixin: {
            appid: 'wx-legacy',
            privateKeyPath: 'keys/private.key',
            projectPath: 'dist/weixin',
          },
        },
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.source).toBe('package-json')
    expect(loaded.config.version).toBe('5.0.0')
    expect(loaded.config.weixin?.appid).toBe('wx-legacy')
  })

  it('读取 .minicirc 并支持 JSON5 注释与尾逗号', async () => {
    const cwd = await createProject({
      files: {
        '.minicirc': `{
          // 旧版 uni-mini-ci 配置
          version: '4.0.0',
          weixin: ${weixinConfig},
        }`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.source).toBe('minicirc')
    expect(loaded.sourceFile).toBe(path.join(cwd, '.minicirc'))
    expect(loaded.config.version).toBe('4.0.0')
    expect(loaded.config.weixin?.appid).toBe('wx-fixture')
  })

  it('wotci.config.js 优先于 .minicirc', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        '.minicirc': `{ version: '4.0.0' }`,
        'wotci.config.js': `export default { version: '6.0.0' }\n`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.source).toBe('file')
    expect(loaded.config.version).toBe('6.0.0')
  })

  it('将 dd 字段归一为 dingtalk', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default {\n  dd: { appid: 'dd-app', token: 'token', projectPath: 'dist/dingtalk' },\n}\n`,
      },
    })

    const loaded = await loadConfig({ cwd })

    expect(loaded.config.dingtalk?.appid).toBe('dd-app')
    expect(loaded.config).not.toHaveProperty('dd')
  })
})

describe('loadConfig: 错误处理', () => {
  it('配置导出不是对象时抛出 ConfigError', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default 'not-a-config'\n`,
      },
    })

    await expect(loadConfig({ cwd })).rejects.toThrow(ConfigError)
  })

  it('平台配置不是对象时抛出 ConfigError', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default { weixin: true }\n`,
      },
    })

    await expect(loadConfig({ cwd })).rejects.toThrow('weixin 必须是对象')
  })

  it('package.json 无法解析时抛出 ConfigError', async () => {
    const cwd = await createProject()
    await writeFile(path.join(cwd, 'package.json'), '{ invalid json')

    await expect(loadConfig({ cwd })).rejects.toThrow(ConfigError)
  })

  it('配置文件执行报错时保留原始错误作为 cause', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `throw new Error('boom')\n`,
      },
    })

    const error = await loadConfig({ cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).cause).toBeInstanceOf(Error)
  })
})

describe('loadConfig: 更多异常分支', () => {
  it('内联工厂抛错时包装为 ConfigError', async () => {
    const cwd = await createProject()

    const error = await loadConfig({
      config: () => {
        throw new Error('inline boom')
      },
      cwd,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).message).toContain('执行配置函数失败')
    expect((error as ConfigError).cause).toBeInstanceOf(Error)
  })

  it('配置文件中的工厂抛错时包装为 ConfigError', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default () => { throw new Error('file boom') }\n`,
      },
    })

    const error = await loadConfig({ cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).cause).toBeInstanceOf(Error)
  })

  it('.minicirc 语法错误时包装为 ConfigError', async () => {
    const cwd = await createProject({
      files: {
        '.minicirc': '{ version: ',
      },
    })

    const error = await loadConfig({ cwd }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).cause).toBeInstanceOf(SyntaxError)
  })

  it('.minicirc 内容不是对象时抛出 ConfigError', async () => {
    const cwd = await createProject({
      files: {
        '.minicirc': '"not-an-object"',
      },
    })

    await expect(loadConfig({ cwd })).rejects.toThrow(ConfigError)
  })

  it('package.json 不是对象时抛出 ConfigError', async () => {
    const cwd = await createProject()
    await writeFile(path.join(cwd, 'package.json'), '[]')

    await expect(loadConfig({ cwd })).rejects.toThrow(ConfigError)
  })

  it('package.json 的平台配置不是对象时抛出 ConfigError', async () => {
    const cwd = await createProject({
      packageJson: {
        wotci: { alipay: [] },
      },
    })

    await expect(loadConfig({ cwd })).rejects.toThrow('alipay 必须是对象')
  })
})

describe('loadConfig: 显式空配置路径', () => {
  it('configFile 为空白字符串时抛出 ConfigError', async () => {
    const cwd = await createProject()

    await expect(loadConfig({ configFile: '   ', cwd }))
      .rejects
      .toThrow('configFile 不能为空')
  })
})

describe('loadConfig: 默认 cwd', () => {
  it('未传 cwd 时使用 process.cwd()', async () => {
    const cwd = await createProject()
    const originalCwd = process.cwd()
    process.chdir(cwd)

    try {
      const loaded = await loadConfig()
      expect(loaded.cwd).toBe(process.cwd())
      expect(loaded.source).toBe('defaults')
    }
    finally {
      process.chdir(originalCwd)
    }
  })
})

describe('release 配置校验', () => {
  it('release 不是对象时抛出 ConfigError', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default { release: 'invalid' }\n`,
      },
    })

    await expect(loadConfig({ cwd })).rejects.toThrow('release 必须是对象')
  })

  it('release.platforms 不是数组时抛出 ConfigError', async () => {
    const cwd = await createProject({
      type: 'module',
      files: {
        'wotci.config.js': `export default { release: { platforms: 'weixin' } }\n`,
      },
    })

    await expect(loadConfig({ cwd })).rejects.toThrow('release.platforms 必须是数组')
  })
})

describe('versionStrategy 配置校验', () => {
  it('strict 只接受布尔值', async () => {
    await expect(loadConfig({ config: { versionStrategy: { type: 'auto', bump: 'patch', strict: 'true' as unknown as boolean } } }))
      .rejects
      .toThrow('versionStrategy.strict 必须是布尔值')
    await expect(loadConfig({ config: { versionStrategy: { type: 'auto', bump: 'patch', strict: false } } }))
      .resolves
      .toMatchObject({ config: { versionStrategy: { strict: false } } })
  })

  it('非法 type / bump 抛出 ConfigError', async () => {
    const badType = await createProject({
      type: 'module',
      files: { 'wotci.config.js': `export default { versionStrategy: { type: 'bad' } }\n` },
    })
    await expect(loadConfig({ cwd: badType })).rejects.toThrow('versionStrategy.type 无效')

    const badBump = await createProject({
      type: 'module',
      files: { 'wotci.config.js': `export default { versionStrategy: { type: 'auto', bump: 'bad' } }\n` },
    })
    await expect(loadConfig({ cwd: badBump })).rejects.toThrow('versionStrategy.bump 无效')

    const notObject = await createProject({
      type: 'module',
      files: { 'wotci.config.js': `export default { versionStrategy: 'auto' }\n` },
    })
    await expect(loadConfig({ cwd: notObject })).rejects.toThrow('versionStrategy 必须是对象')
  })
})

describe('budgets 配置校验', () => {
  it('budgets 不是对象时抛出 ConfigError', async () => {
    const cwd = await createProject({
      type: 'module',
      files: { 'wotci.config.js': `export default { budgets: '2MB' }\n` },
    })

    await expect(loadConfig({ cwd })).rejects.toThrow('budgets 必须是对象')
  })
})
