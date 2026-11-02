function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isModuleNamespace(value: Record<string, unknown>): boolean {
  return Object.prototype.toString.call(value) === '[object Module]'
}

/**
 * 归一化 ESM / CJS / tsx 的模块导出。
 *
 * 常见的三种形态：
 * - ESM 模块：`{ default: config }`
 * - 通过 `import()` 读取的 CJS 模块：`{ default: module.exports }`
 * - tsx 在 CJS 项目中加载 TS 模块：`{ default: { __esModule: true, default: config } }`
 *
 * 只解开命名空间和 `__esModule` 包装，避免误伤配置对象自身的 `default` 字段。
 */
export function unwrapModuleExport(moduleExports: unknown): unknown {
  let value = moduleExports

  for (let depth = 0; depth < 5; depth++) {
    if (!isRecord(value) || !('default' in value))
      break

    const isNamespace = isModuleNamespace(value)
      || value.__esModule === true
      || Object.keys(value).length === 1

    if (!isNamespace)
      break

    value = value.default
  }

  return value
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype
}
