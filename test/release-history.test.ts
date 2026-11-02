import type { ReleaseHistoryRecord } from '../src/types'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReleaseError } from '../src/errors'
import { appendReleaseHistory } from '../src/release/history'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'wotci-history-'))
  tempDirs.push(cwd)
  return cwd
}

function createRecord(index: number): ReleaseHistoryRecord {
  return {
    build: { commands: ['npm run build'], durationMs: 1, ok: true, skipped: false },
    createdAt: new Date(2026, 0, index + 1).toISOString(),
    durationMs: 10,
    id: `id-${index}`,
    ok: true,
    platforms: [],
    version: `1.0.${index}`,
  }
}

describe('appendReleaseHistory', () => {
  it('没有历史文件时创建并写入', async () => {
    const cwd = await createProject()

    const file = await appendReleaseHistory(createRecord(0), {
      cwd,
      file: '.wotci/history.json',
    })

    const content = JSON.parse(await readFile(file, 'utf8')) as { version: number, records: Array<{ id: string }> }
    expect(content.version).toBe(1)
    expect(content.records).toHaveLength(1)
    expect(content.records[0].id).toBe('id-0')
  })

  it('按顺序追加并支持 limit 截断', async () => {
    const cwd = await createProject()

    await appendReleaseHistory(createRecord(0), { cwd, file: 'history.json', limit: 2 })
    await appendReleaseHistory(createRecord(1), { cwd, file: 'history.json', limit: 2 })
    const file = await appendReleaseHistory(createRecord(2), { cwd, file: 'history.json', limit: 2 })

    const content = JSON.parse(await readFile(file, 'utf8')) as { records: Array<{ id: string }> }
    expect(content.records.map(item => item.id)).toEqual(['id-1', 'id-2'])
  })

  it('兼容旧版数组格式', async () => {
    const cwd = await createProject()
    await writeFile(path.join(cwd, 'history.json'), JSON.stringify([createRecord(0)]))

    const file = await appendReleaseHistory(createRecord(1), { cwd, file: 'history.json' })

    const content = JSON.parse(await readFile(file, 'utf8')) as { records: Array<{ id: string }> }
    expect(content.records.map(item => item.id)).toEqual(['id-0', 'id-1'])
  })

  it('历史文件格式错误时抛出 ReleaseError', async () => {
    const cwd = await createProject()
    await mkdir(path.join(cwd, '.wotci'), { recursive: true })
    await writeFile(path.join(cwd, '.wotci/history.json'), '{ invalid')

    await expect(appendReleaseHistory(createRecord(0), { cwd, file: '.wotci/history.json' }))
      .rejects
      .toThrow(ReleaseError)
  })

  it('历史文件不是数组或对象时抛出 ReleaseError', async () => {
    const cwd = await createProject()
    await writeFile(path.join(cwd, 'history.json'), '"string"')

    await expect(appendReleaseHistory(createRecord(0), { cwd, file: 'history.json' }))
      .rejects
      .toThrow('解析发布历史失败')
  })

  it('目标是目录时读取失败并抛出 ReleaseError', async () => {
    const cwd = await createProject()
    await mkdir(path.join(cwd, 'history.json'))

    await expect(appendReleaseHistory(createRecord(0), { cwd, file: 'history.json' }))
      .rejects
      .toThrow(ReleaseError)
  })
})
