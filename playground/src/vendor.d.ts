declare module 'dingtalk-miniapp-opensdk' {
  export const sdk: {
    setConfig: (options: {
      accessToken: string
      appKey?: string
      appSecret?: string
      host?: string
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

declare module 'tsx/esm/api' {
  export function tsImport(specifier: string, parentURL?: string): Promise<unknown>
}
