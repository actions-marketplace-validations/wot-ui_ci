import type { CIConfig, PlatformUploadResult, UploadContext } from '../types'
import process from 'node:process'
import { sdk as opensdk } from 'dingtalk-miniapp-opensdk'
import { UploadError } from '../errors'
import { resolveFromCwd } from '../utils/path'

interface DingTalkUploadProgress {
  status?: string
  data?: {
    log?: string
    version?: string
  }
}

interface DingTalkUploadRawResult {
  packageVersion?: string
}

export async function uploadDingTalk(config: CIConfig, options: UploadContext = {}): Promise<PlatformUploadResult<DingTalkUploadRawResult>> {
  if (!config.dingtalk)
    throw new UploadError('Missing dingtalk config')
  if (!config.dingtalk.autoincrement && !config.version)
    throw new UploadError('A version is required when DingTalk autoincrement is disabled')

  const cwd = options.cwd ?? process.cwd()
  const projectPath = resolveFromCwd(cwd, config.dingtalk.projectPath)
  let progressVersion: string | undefined

  try {
    opensdk.setConfig({
      accessToken: config.dingtalk.token,
      appKey: '',
      appSecret: '',
      host: 'https://oapi.dingtalk.com',
    })

    const raw = await opensdk.miniUpload({
      miniAppId: config.dingtalk.appid,
      onProgressUpdate: (progress: DingTalkUploadProgress) => {
        progressVersion = progress.data?.version ?? progressVersion
        if (progress.status === 'failed')
          throw new UploadError(progress.data?.log ?? 'DingTalk build failed')
      },
      packageVersion: config.dingtalk.autoincrement ? '' : config.version,
      project: projectPath,
    }) as DingTalkUploadRawResult

    const version = raw.packageVersion ?? progressVersion ?? config.version ?? 'auto'

    return {
      desc: config.desc,
      message: `Uploaded DingTalk mini program ${version}`,
      platform: 'dingtalk',
      raw,
      version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('Failed to upload DingTalk mini program', error)
  }
}
