import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runDoctor: vi.fn(),
}))

vi.mock('../src/doctor', () => ({ runDoctor: mocks.runDoctor }))
vi.mock('../src/batch', () => ({ previewMany: vi.fn(), uploadMany: vi.fn() }))
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
  mocks.runDoctor.mockResolvedValue({
    checks: [
      { id: 'node', status: 'ok', title: 'Node.js 版本', message: '当前 v22' },
      { id: 'platforms', status: 'error', title: '平台配置', message: '没有配置平台', details: ['detail-1'] },
    ],
    ok: false,
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-cli-doctor-'))
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

describe('runCli doctor', () => {
  it('输出人类可读结果并以检查结果决定退出码', async () => {
    const cwd = await createProject()
    const { stdout, stderr, writers } = createWriters()

    const exitCode = await runCli(['doctor', '--network'], { cwd, ...writers })

    expect(exitCode).toBe(1)
    expect(mocks.runDoctor).toHaveBeenCalledWith(expect.objectContaining({ cwd, network: true }))
    expect(stdout.some(line => line.includes('✓ Node.js 版本：当前 v22'))).toBe(true)
    expect(stderr.some(line => line.includes('✗ 平台配置：没有配置平台'))).toBe(true)
    expect(stdout.some(line => line.includes('  - detail-1'))).toBe(true)
  })

  it('--json 输出结构化结果', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()

    await runCli(['doctor', '--json'], { cwd, ...writers })

    expect(JSON.parse(stdout[0])).toMatchObject({
      checks: expect.arrayContaining([expect.objectContaining({ id: 'platforms', status: 'error' })]),
      command: 'doctor',
      ok: false,
      schemaVersion: 1,
    })
  })

  it('全部通过时返回 0', async () => {
    const cwd = await createProject()
    const { stdout, writers } = createWriters()
    mocks.runDoctor.mockResolvedValueOnce({
      checks: [{ id: 'node', status: 'ok', title: 'Node.js 版本' }],
      ok: true,
    })

    const exitCode = await runCli(['doctor'], { cwd, ...writers })

    expect(exitCode).toBe(0)
    expect(stdout.some(line => line.includes('doctor 通过'))).toBe(true)
  })
})
