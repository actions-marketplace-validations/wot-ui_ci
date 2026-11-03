import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'playground/**',
        // 进程入口依赖 process.exit，无法在单元测试中安全执行
        'src/bin.ts',
        'src/types.ts',
        'test/**',
        '**/*.d.ts',
        '**/*.d.mts',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'lcov', 'html'],
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
    server: {
      deps: {
        inline: ['vitest-package-exports'],
      },
    },
  },
})
