function normalizeVersion(version: string): number[] {
  const trimmed = version.trim()
  if (!/^\d+(?:\.\d+)*$/.test(trimmed))
    throw new TypeError(`Invalid version string: ${version}`)
  return trimmed.split('.').map(segment => Number.parseInt(segment, 10))
}

export function compareVersion(left: string, right: string): -1 | 0 | 1 {
  const leftParts = normalizeVersion(left)
  const rightParts = normalizeVersion(right)
  const size = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < size; index++) {
    const currentLeft = leftParts[index] ?? 0
    const currentRight = rightParts[index] ?? 0

    if (currentLeft > currentRight)
      return 1
    if (currentLeft < currentRight)
      return -1
  }

  return 0
}
