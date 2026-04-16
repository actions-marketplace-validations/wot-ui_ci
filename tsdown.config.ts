/*
 * @Author: weisheng
 * @Date: 2026-04-15 13:22:39
 * @LastEditTime: 2026-04-16 11:06:09
 * @LastEditors: weisheng
 * @Description:
 * @FilePath: /ci/tsdown.config.ts
 * 记得注释
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/bin.ts',
    'src/index.ts',
    'src/cli.ts',
  ],
  dts: true,
  exports: true,
  publint: true,
})
