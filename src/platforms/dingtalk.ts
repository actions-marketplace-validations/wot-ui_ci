import type { DingtalkUploadRawResult, UploadOptions, UploadResult, WotciConfig } from '../types'
import process from 'node:process'
import { sdk as opensdk } from 'dingtalk-miniapp-opensdk'
import { UploadError } from '../errors'
import { appendDesc } from '../messages'
import { isDirectory, resolveFromCwd } from '../utils/path'

interface DingTalkUploadProgress {
  status?: string
  data?: {
    log?: string
    version?: string
  }
}

export async function uploadDingTalk(
  config: WotciConfig,
  options: UploadOptions = {},
): Promise<UploadResult<'dingtalk', DingtalkUploadRawResult>> {
  const dingtalk = config.dingtalk
  if (!dingtalk)
    throw new UploadError('缺少钉钉小程序上传配置（dingtalk）')
  if (!dingtalk.autoincrement && !config.version)
    throw new UploadError('钉钉小程序关闭自动递增时必须提供 version')

  const cwd = options.cwd ?? process.cwd()
  const projectPath = resolveFromCwd(cwd, dingtalk.projectPath)

  if (!await isDirectory(projectPath))
    throw new UploadError(`钉钉小程序产物目录不存在：${projectPath}`)

  let progressVersion: string | undefined
  let progressError: string | undefined

  try {
    opensdk.setConfig({
      accessToken: dingtalk.token,
      appKey: '',
      appSecret: '',
      host: 'https://oapi.dingtalk.com',
    })

    const raw = await opensdk.miniUpload({
      miniAppId: dingtalk.appid,
      onProgressUpdate: (progress: DingTalkUploadProgress) => {
        progressVersion = progress.data?.version ?? progressVersion
        if (progress.status === 'failed')
          progressError = progress.data?.log ?? '钉钉小程序构建失败'
      },
      packageVersion: dingtalk.autoincrement ? '' : config.version,
      project: projectPath,
    }) as DingtalkUploadRawResult

    if (progressError)
      throw new UploadError(progressError)

    const version = raw?.packageVersion ?? progressVersion ?? config.version ?? 'auto'

    return {
      desc: config.desc,
      message: appendDesc(`钉钉小程序上传成功，版本：${version}`, config.desc),
      platform: 'dingtalk',
      raw: raw ?? {},
      version,
    }
  }
  catch (error) {
    if (error instanceof UploadError)
      throw error
    throw new UploadError('钉钉小程序上传失败', error)
  }
}
