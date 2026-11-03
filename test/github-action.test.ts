import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const repoRoot = path.resolve(import.meta.dirname, '..')
const actionPath = path.join(repoRoot, 'action.yml')
const scriptPath = path.join(repoRoot, 'scripts/github-action.sh')
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-action-'))
  tempDirs.push(cwd)
  return cwd
}

async function writeFakeCli(file: string): Promise<void> {
  await writeFile(file, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$OUTPUT_FILE"\n')
  await chmod(file, 0o755)
}

describe('action.yml', () => {
  it('声明 composite action 与核心输入', async () => {
    const action = parse(await readFile(actionPath, 'utf8')) as {
      name: string
      runs: { using: string, steps: unknown[] }
      inputs: Record<string, unknown>
    }

    expect(action.name).toBe('wot-ui-ci')
    expect(action.runs.using).toBe('composite')
    expect(action.runs.steps.length).toBeGreaterThan(0)
    expect(action.inputs).toHaveProperty('command')
    expect(action.inputs).toHaveProperty('platform')
    expect(action.inputs).toHaveProperty('summary')
  })
})

describe.skipIf(process.platform === 'win32')('github-action.sh', () => {
  it('组装 upload 参数并调用本地 wotci', async () => {
    const cwd = await createProject()
    const binDir = path.join(cwd, 'node_modules/.bin')
    await mkdir(binDir, { recursive: true })
    await writeFakeCli(path.join(binDir, 'wotci'))
    const outputFile = path.join(cwd, 'args.txt')

    execFileSync('bash', [scriptPath], {
      env: {
        ...process.env,
        INPUT_ARGS: '--concurrency 2',
        INPUT_COMMAND: 'upload',
        INPUT_CONFIG: 'wotci.config.ts',
        INPUT_DRY_RUN: 'true',
        INPUT_HISTORY: 'false',
        INPUT_JSON: 'true',
        INPUT_PLATFORM: 'weixin,alipay',
        INPUT_PR_COMMENT: 'false',
        INPUT_SUMMARY: 'summary.md',
        INPUT_WORKING_DIRECTORY: cwd,
        OUTPUT_FILE: outputFile,
      },
    })

    const args = (await readFile(outputFile, 'utf8')).trim().split('\n')
    expect(args).toEqual([
      'upload',
      '-p',
      'weixin,alipay',
      '-c',
      'wotci.config.ts',
      '--json',
      '--dry-run',
      '--no-pr-comment',
      '--no-history',
      '--summary',
      'summary.md',
      '--concurrency',
      '2',
    ])
  })

  it('本地没有 wotci 时回退到 npx', async () => {
    const cwd = await createProject()
    const binDir = path.join(cwd, 'bin')
    await mkdir(binDir, { recursive: true })
    await writeFakeCli(path.join(binDir, 'npx'))
    const outputFile = path.join(cwd, 'npx-args.txt')

    execFileSync('bash', [scriptPath], {
      env: {
        ...process.env,
        INPUT_COMMAND: 'doctor',
        INPUT_PACKAGE_VERSION: '1.2.3',
        INPUT_WORKING_DIRECTORY: cwd,
        OUTPUT_FILE: outputFile,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    })

    const args = (await readFile(outputFile, 'utf8')).trim().split('\n')
    expect(args).toEqual(['--yes', '@wot-ui/ci@1.2.3', 'doctor'])
  })
})
