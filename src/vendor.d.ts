/*
 * @Author: weisheng
 * @Date: 2026-04-15 15:49:58
 * @LastEditTime: 2026-04-15 17:50:15
 * @LastEditors: weisheng
 * @Description:
 * @FilePath: /ci/src/vendor.d.ts
 * 记得注释
 */
// declare module 'minidev' {
//   export const minidev: {
//     app: {
//       getUploadedVersion: (options: {
//         appId: string
//         clientType: string
//       }) => Promise<string>
//     }
//     upload: (options: {
//       project: string
//       appId: string
//       version?: string
//       clientType: string
//       experience: boolean
//     }) => Promise<{
//       version?: string
//     }>
//   }

//   export function useDefaults(options: {
//     config: {
//       defaults: Record<string, string>
//     }
//   }): void
// }

declare module 'dingtalk-miniapp-opensdk' {
  export const sdk: {
    setConfig: (options: {
      appKey: string
      appSecret: string
      accessToken: string
      host: string
    }) => void
    miniUpload: (options: {
      project: string
      miniAppId: string
      packageVersion?: string
      onProgressUpdate?: (info: {
        status?: string
        data?: {
          log?: string
          version?: string
        }
      }) => void
    }) => Promise<{
      packageVersion?: string
    }>
  }
}
