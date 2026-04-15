import type { CIConfig, PlatformUploadResult, UploadContext } from '../types'
import process from 'node:process'
import { sdk as opensdk } from 'dingtalk-miniapp-opensdk'
import { UploadError } from '../errors'
import { appendDesc } from '../messages'
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
    throw new UploadError('缺少钉钉小程序上传配置（dingtalk）')
  if (!config.dingtalk.autoincrement && !config.version)
    throw new UploadError('钉钉小程序关闭自动递增时必须提供 version')

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
          throw new UploadError(progress.data?.log ?? '钉钉小程序构建失败')
      },
      packageVersion: config.dingtalk.autoincrement ? '' : config.version,
      project: projectPath,
    }) as DingTalkUploadRawResult

    const version = raw.packageVersion ?? progressVersion ?? config.version ?? 'auto'

    return {
      desc: config.desc,
      message: appendDesc(`钉钉小程序上传成功，版本：${version}`, config.desc),
      platform: 'dingtalk',
      raw,
      version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('钉钉小程序上传失败', error)
  }
}
