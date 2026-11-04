// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    // 路线图里的伪代码片段不是完整可解析的 TypeScript
    ignores: ['docs/**', '**/.pnpm-store/**'],
  },
)
