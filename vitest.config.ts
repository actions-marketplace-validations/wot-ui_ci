/*
 * @Author: weisheng
 * @Date: 2026-04-15 13:22:39
 * @LastEditTime: 2026-04-15 21:54:50
 * @LastEditors: weisheng
 * @Description:
 * @FilePath: /ci/vitest.config.ts
 * 记得注释
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'playground/**',
        'src/types.ts',
        'test/**',
        '**/*.d.ts',
        '**/*.d.mts',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'lcov', 'html'],
    },
    server: {
      deps: {
        inline: ['vitest-package-exports'],
      },
    },
  },
})
