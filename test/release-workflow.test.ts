import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')
const metadataScript = path.join(repoRoot, 'scripts/verify-action-metadata.mjs')
const releaseScript = path.join(repoRoot, 'scripts/verify-release.mjs')
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wotci-release-'))
  tempDirs.push(dir)
  return dir
}

function run(script: string, args: string[] = []): { code: number, stdout: string, stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  }
  catch (error) {
    const failure = error as { status?: number, stdout?: string, stderr?: string }
    return {
      code: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

describe('verify-action-metadata', () => {
  it('仓库内的 action.yml 通过 Marketplace 校验', () => {
    const result = run(metadataScript)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('通过校验')
  })

  it('缺少 branding.icon 的图标或 run 步骤缺少 shell 时报错', async () => {
    const dir = await createTempDir()
    const file = path.join(dir, 'action.yml')
    await writeFile(file, [
      'name: broken',
      'description: broken action',
      'branding:',
      '  icon: not-a-feather-icon',
      '  color: blue',
      'runs:',
      '  using: composite',
      '  steps:',
      '    - run: echo hi',
      '',
    ].join('\n'))

    const result = run(metadataScript, [file])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('not-a-feather-icon')
    expect(result.stderr).toContain('没声明 shell')
  })

  it('声明的 input 没有通过 INPUT_* 接线时报错', async () => {
    const dir = await createTempDir()
    const file = path.join(dir, 'action.yml')
    await writeFile(file, [
      'name: broken',
      'description: broken action',
      'inputs:',
      '  command:',
      '    description: cmd',
      'runs:',
      '  using: composite',
      '  steps:',
      '    - run: echo hi',
      '      shell: bash',
      '',
    ].join('\n'))

    const result = run(metadataScript, [file])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('INPUT_COMMAND')
  })
})

describe('verify-release', () => {
  it('tag 与版本一致时通过', async () => {
    const dir = await createTempDir()
    const pkg = path.join(dir, 'package.json')
    await writeFile(pkg, JSON.stringify({ name: 'demo', version: '1.4.0' }))

    const result = run(releaseScript, ['v1.4.0', pkg])
    expect(result.code).toBe(0)
  })

  it('tag 与版本不一致时失败', async () => {
    const dir = await createTempDir()
    const pkg = path.join(dir, 'package.json')
    await writeFile(pkg, JSON.stringify({ name: 'demo', version: '1.4.0' }))

    const result = run(releaseScript, ['v1.4.1', pkg])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('不一致')
  })

  it('浮动主版本 tag 不是可发布版本号', async () => {
    const dir = await createTempDir()
    const pkg = path.join(dir, 'package.json')
    await writeFile(pkg, JSON.stringify({ name: 'demo', version: '1.4.0' }))

    const result = run(releaseScript, ['v1', pkg])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('不是可发布的版本号')
  })
})

describe('changelogithub 配置', () => {
  it('release 必须保持 draft，否则 Marketplace 复选框永久消失', async () => {
    const config = JSON.parse(
      await readFile(path.join(repoRoot, 'changelogithub.config.json'), 'utf8'),
    ) as { draft?: boolean }

    expect(config.draft).toBe(true)
  })
})
