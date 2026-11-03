import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initProject: vi.fn(),
}))

vi.mock('../src/init', () => ({ initProject: mocks.initProject }))
vi.mock('../src/batch', () => ({ previewMany: vi.fn(), uploadMany: vi.fn() }))
vi.mock('../src/doctor', () => ({ runDoctor: vi.fn() }))
vi.mock('../src/ide', () => ({
  autoIde: vi.fn(),
  closeIde: vi.fn(),
  getIdeStatus: vi.fn(),
  openIde: vi.fn(),
  previewIde: vi.fn(),
}))
vi.mock('../src/preview', () => ({ previewPlatform: vi.fn() }))
vi.mock('../src/release', () => ({ release: vi.fn() }))
vi.mock('../src/upload', () => ({ uploadPlatform: vi.fn() }))
vi.mock('../src/version', () => ({ getLatestVersion: vi.fn(), getVersionList: vi.fn() }))

const { runCli } = await import('../src/cli')

const tempDirs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.initProject.mockResolvedValue({
    content: 'export default {}',
    file: '/tmp/wotci.config.ts',
    platforms: ['weixin'],
    written: true,
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-init-'))
  tempDirs.push(cwd)
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  return cwd
}

function createWriters() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stderr,
    stdout,
    writers: {
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
  }
}

describe('runCli init', () => {
  it('传递平台/配置文件/force/dry-run', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.initProject.mockResolvedValueOnce({
      content: 'export default {}',
      file: '/tmp/wotci.config.ts',
      platforms: ['weixin', 'alipay'],
      written: false,
    })

    const exitCode = await runCli([
      'init',
      '--platform',
      'weixin,alipay',
      '--config',
      'ci.ts',
      '--force',
      '--dry-run',
    ], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(mocks.initProject).toHaveBeenCalledWith({
      configFile: 'ci.ts',
      cwd,
      dryRun: true,
      force: true,
      platforms: ['weixin', 'alipay'],
    })
    expect(stdout).toContain('export default {}')
  })

  it('写入成功时输出路径与平台', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    await runCli(['init'], { cwd, ...writers })

    expect(stdout.some(line => line.includes('配置文件已生成：/tmp/wotci.config.ts'))).toBe(true)
    expect(stdout.some(line => line.includes('平台：weixin'))).toBe(true)
  })

  it('--json 输出结构化结果', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    await runCli(['init', '--json'], { cwd, ...writers })

    expect(JSON.parse(stdout[0])).toMatchObject({
      command: 'init',
      file: '/tmp/wotci.config.ts',
      platforms: ['weixin'],
      schemaVersion: 1,
      written: true,
    })
  })
})
