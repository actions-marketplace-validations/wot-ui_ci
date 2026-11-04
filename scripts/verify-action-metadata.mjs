#!/usr/bin/env node
/**
 * 校验 action.yml 是否满足 GitHub Marketplace 上架条件，并检查 inputs 与 composite 步骤的接线。
 *
 * 检查项：
 *   1. name / description 必填；description 超过 125 字符只告警（列表页会截断）
 *   2. runs.using 必须是 composite —— 本仓库的 action 形态，换形态要同步改这里
 *   3. branding.icon 必须在 Feather 图标集内、branding.color 必须在白名单内，
 *      否则 Marketplace 会静默不显示图标（网页上没有任何报错）
 *   4. 每个 run 步骤必须声明 shell（composite action 的硬性要求）
 *   5. 每个声明的 input 都必须通过 INPUT_<NAME> 传进脚本，避免新增 input 静默失效
 *   6. ${{ github.action_path }}/xxx 引用的文件必须真实存在
 *
 * 用法：node scripts/verify-action-metadata.mjs [action.yml 路径]
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'yaml'

const repoRoot = path.resolve(import.meta.dirname, '..')
const actionPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, 'action.yml')
const featherIcons = new Set(JSON.parse(readFileSync(path.join(import.meta.dirname, 'feather-icons.json'), 'utf8')))
const brandingColors = new Set(['white', 'yellow', 'blue', 'green', 'orange', 'red', 'purple', 'gray-dark'])
const maxDescription = 125

const errors = []
const warnings = []

function fail(message) {
  errors.push(message)
}

function warn(message) {
  warnings.push(message)
}

function toInputEnv(name) {
  return `INPUT_${name.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}`
}

function readActionFile() {
  if (!existsSync(actionPath)) {
    console.error(`✖ 找不到 ${actionPath}`)
    process.exit(1)
  }

  try {
    return parse(readFileSync(actionPath, 'utf8'))
  }
  catch (error) {
    console.error(`✖ ${actionPath} 不是合法 YAML：${error.message}`)
    process.exit(1)
  }
}

function checkIdentity(action) {
  if (typeof action?.name !== 'string' || !action.name.trim()) {
    fail('缺少 name：Marketplace 列表页与 `uses:` 报错都依赖它')
  }
  else if (action.name.length > 60) {
    warn(`name 有 ${action.name.length} 个字符，列表页可能截断（建议 ≤ 60）`)
  }

  if (typeof action?.description !== 'string' || !action.description.trim()) {
    fail('缺少 description：Marketplace 列表页必须展示一行简介')
  }
  else if (action.description.length > maxDescription) {
    warn(`description 有 ${action.description.length} 个字符，超过 ${maxDescription} 会被列表页截断`)
  }

  if (!action?.author) {
    warn('缺少 author：Marketplace 列表页的作者一栏会退回仓库 owner')
  }
}

function checkBranding(action) {
  const branding = action?.branding
  if (!branding) {
    warn('缺少 branding：Marketplace 列表页会没有图标，几乎没人点')
    return
  }

  if (!featherIcons.has(branding.icon)) {
    fail(`branding.icon "${branding.icon}" 不在 Feather 图标集内，Marketplace 会静默不显示图标`)
  }

  if (!brandingColors.has(branding.color)) {
    fail(`branding.color "${branding.color}" 不是合法取值，可选：${[...brandingColors].join(', ')}`)
  }
}

function checkSteps(action) {
  if (action?.runs?.using !== 'composite') {
    fail(`runs.using 是 "${action?.runs?.using}"，本仓库约定为 composite`)
    return []
  }

  const steps = action.runs.steps
  if (!Array.isArray(steps) || steps.length === 0) {
    fail('runs.steps 为空，composite action 至少要有一个步骤')
    return []
  }

  for (const [index, step] of steps.entries()) {
    const label = `runs.steps[${index}]${step?.name ? ` (${step.name})` : ''}`
    if (typeof step?.run === 'string') {
      if (!step.shell) {
        fail(`${label} 有 run 但没声明 shell，GitHub 会直接报错`)
      }
    }
    else if (typeof step?.uses !== 'string') {
      fail(`${label} 既没有 run 也没有 uses`)
    }
  }

  return steps
}

function checkInputWiring(action, steps) {
  const inputs = Object.keys(action?.inputs ?? {})
  const declaredEnv = new Map()
  const withValues = []

  for (const step of steps) {
    for (const [key, value] of Object.entries(step?.env ?? {})) {
      if (key.startsWith('INPUT_')) {
        declaredEnv.set(key, String(value))
      }
    }
    for (const value of Object.values(step?.with ?? {})) {
      withValues.push(String(value))
    }
  }

  const referencesInput = (value, name) =>
    value.includes(`inputs.${name}`)
    || value.includes(`inputs['${name}']`)
    || value.includes(`inputs["${name}"]`)

  for (const name of inputs) {
    const envKey = toInputEnv(name)
    if (declaredEnv.has(envKey)) {
      if (!referencesInput(declaredEnv.get(envKey), name)) {
        warn(`input "${name}" 的 ${envKey} 没有引用 \${{ inputs.${name} }}，可能被写死`)
      }
      continue
    }

    // 也可以交给别的 action 消费，例如 node-version 由 actions/setup-node 读取
    if (withValues.some(value => referencesInput(value, name))) {
      continue
    }

    fail(`input "${name}" 没有接线：既没有步骤通过 ${envKey} 传给脚本，也没有通过 with: 传给其它 action`)
  }

  const expectedEnv = new Set(inputs.map(toInputEnv))
  for (const key of declaredEnv.keys()) {
    if (!expectedEnv.has(key)) {
      warn(`${key} 没有对应的 input 声明，可能是拼写错误`)
    }
  }

  for (const name of inputs) {
    const input = action.inputs[name]
    if (typeof input?.description !== 'string' || !input.description.trim()) {
      warn(`input "${name}" 缺少 description`)
    }
    if (input?.default !== undefined && typeof input.default !== 'string') {
      fail(`input "${name}" 的 default 必须是字符串，composite action 不支持布尔/数字字面量`)
    }
  }
}

const actionPathPattern = /\$\{\{\s*github\.action_path\s*\}\}\/?([^\s"'`]+)/g

function checkStepFileReferences(steps) {
  const actionDir = path.dirname(actionPath)
  for (const step of steps) {
    if (typeof step?.run !== 'string') {
      continue
    }

    for (const match of step.run.matchAll(actionPathPattern)) {
      const target = path.resolve(actionDir, match[1])
      if (!existsSync(target)) {
        fail(`步骤引用了不存在的文件：${match[1]}（解析为 ${target}）`)
      }
    }
  }
}

const action = readActionFile()
checkIdentity(action)
checkBranding(action)
const steps = checkSteps(action)
checkInputWiring(action, steps)
checkStepFileReferences(steps)

for (const message of warnings) {
  console.warn(`⚠ ${message}`)
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(`✖ ${message}`)
  }
  console.error(`\naction.yml 未通过 Marketplace 校验（${errors.length} 个问题）`)
  process.exit(1)
}

console.log(`✔ action.yml 通过校验：${action.name}（${Object.keys(action.inputs ?? {}).length} 个 input、${steps.length} 个步骤）`)
