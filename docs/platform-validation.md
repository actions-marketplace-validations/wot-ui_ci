# 真实平台验收指南

本指南复用 [Upload Playground 工作流](../.github/workflows/upload-playground.yml)。能力范围和当前证据见 [支持矩阵](support-matrix.md)。一次验收只记录当前平台、项目类型、CLI / SDK、Node 和系统组合。

## 1. 准备

1. 使用测试小程序，准备当前平台的凭证，并确认目标应用及可用版本号。上传会生成平台版本；本指南不要求删除现有版本或更改体验版。
2. 在仓库 Actions Secrets 配置对应项，保留完整 PEM 换行：

   | 平台 | 必需 secrets | 本工作流范围 |
   | --- | --- | --- |
   | 微信 | WEIXIN_APPID、WEIXIN_PRIVATE_KEY | 普通 miniProgram，robot 输入 1～30 |
   | 支付宝 | ALIPAY_APPID、ALIPAY_TOOL_ID、ALIPAY_PRIVATE_KEY | 默认 alipay 终端 |
   | 钉钉 | DINGTALK_APPID、DINGTALK_TOKEN | upload；复用 mp-alipay 构建产物，平台适配需实测 |

3. 微信确保 Runner 出口 IP 满足平台白名单要求；需要稳定出口时使用相应 Runner。不要把 `doctor --network` 的跳过结果当作上传权限验证。
4. 确认 Actions 的工作流定义已在默认分支可用，再选择待验收分支的 ref 执行。新分支的本地测试只能证明脚本接线，未运行的远端任务标为待验证。
5. artifact 默认保留 7 天。及时把脱敏结果和运行链接归档到验收记录；二维码属于有时效的预览入口，按项目可见性保存。

## 2. 工作流执行顺序

进入 Actions → Upload Playground → Run workflow，选择分支、`platform` 和 `command`：

1. **先本地校验**：选择 `dry_run=true`。构建 CLI 与小程序产物，执行 doctor 和所选命令的 dry-run，不调用上传 / 预览 SDK。微信缺凭证时可用占位 appid 和临时测试私钥；支付宝、钉钉的当前工作流即使 dry-run 也要求对应 secrets。
2. **真实上传**：选择 `command=upload`、`dry_run=false`，填写可用版本和描述（建议包含验收标识）。核对 Upload 步骤和 JSON 中的 `ok` / 平台结果，再到平台后台核对版本、描述及微信 robot。
3. **真实预览**：微信或支付宝选择 `command=preview`、`dry_run=false`。从 artifact 取得 `preview.png`，使用对应客户端扫码，确认页面可以加载并记录客户端版本、设备和结果。钉钉 preview 在输入解析时拒绝。
4. **补充专项验收**：页面参数、terminal / base64、插件类型版本查询、IDE 或 SourceMap 等不在上述默认工作流覆盖范围内，需单独执行对应 CLI / JS API 并保存结果。

push 到 main 仍仅触发微信 upload dry-run。手动任务使用队列，不因后续 push 自动取消；不同 ref 的任务仍可能并发使用同一个应用或 robot，验收时需协调这些资源。

artifact `playground-upload-<run_id>` 按实际执行步骤和已生成文件包含以下内容：

- `validation-context.json`：commit、CLI / 三个 SDK 精确版本、Node、系统、Runner 镜像、项目类型、命令、模式、run URL / attempt 和各步骤 outcome。
- `plan.json` / `plan-summary.md`：本地校验结果。
- `upload.json` / `upload-summary.md` 或 `preview.json` / `preview-summary.md`：真实调用结果。
- 预览成功并写出文件时的 `preview.png`；构建产物中的 project.config.json。

构建、凭证准备或 doctor 提前失败时，后续文件可能不会生成；未选择的 upload / preview 分支也不会生成结果。缺少 `plan.json` 或所选命令的结果文件，表示对应步骤未执行或未完成结果写出，应结合步骤 outcome 和日志判断。文件存在也不代表执行成功，应检查退出状态及 JSON 内容；没有任何匹配文件时不会创建 artifact。

元数据使用字段白名单，不保存私钥、token 或环境变量全集。SDK 尚未安装时精确版本为 null，该运行不能用作对应 SDK 组合的通过证据。微信项目类型记录为 playground 固定配置的 miniProgram；其它项目类型需独立记录。

## 3. 本地复跑

使用项目已授权的凭证环境变量，路径相对于 playground 或传绝对路径。不要把凭证值复制进记录。以下命令在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --dir playground build:mp-weixin
node dist/bin.mjs doctor --cwd playground --config wotci.config.ts
node dist/bin.mjs upload --cwd playground --config wotci.config.ts -p weixin --dry-run --json
# 确认应用和版本后真实上传
node dist/bin.mjs upload --cwd playground --config wotci.config.ts -p weixin --json
node dist/bin.mjs preview --cwd playground --config wotci.config.ts -p weixin --qr-output .wotci/preview/weixin.png --json
```

支付宝将构建目标改为 `build:mp-alipay`、平台改为 `alipay`；钉钉也使用该构建目标、平台改为 `dingtalk`，只执行 upload。本地预览的相对输出路径基于 `--cwd playground`，例如上述二维码在 `playground/.wotci/preview/`。JS API 或已发布包的验证需另记入口和实际安装版本；工作流使用仓库构建的 CLI，不证明 npm 包或 Marketplace 状态。

本地离线基线可运行：

```sh
pnpm test:run
pnpm typecheck:all
pnpm verify:capabilities
```

`verify:capabilities` 的 SDK 调用由夹具或 mock 替代，不能登记为真实平台通过。

## 4. 判定与记录

- **通过**：退出码、平台结果和平台后台一致；预览需另外记录二维码生成与客户端扫码是否通过。
- **失败**：保留阶段、错误码、脱敏原因和复现命令。预算超限需确认是否已经上传成功；不要直接把失败任务全部重发。
- **结果未知**：超时 / 中断后无法确认远端结果时，先去平台后台核对，避免重复提交。
- **待验证**：没有凭证、平台不可用、缺人工扫码或缺结果文件时说明缺项；工作流绿色不自动代表所有人工项目通过。
- **受限**：当前未接入的组合，例如钉钉预览、普通微信小程序版本查询，不计为平台可用性失败。

复制以下模板到 `docs/verification/YYYY-MM-DD-<platform>-<scenario>.md`，完成后把链接加入支持矩阵。失败与待验证也可归档。

```markdown
# <平台 / 场景> 验收记录

- 日期 / 执行人：
- 状态：离线通过 / 真实通过 / 失败 / 结果未知 / 待验证 / 受限
- commit / 工作区是否有未提交改动：
- CLI 版本与入口：仓库 dist / npm 包 / JS API / Action
- SDK 精确版本：
- Node / 系统 / 架构 / Runner 镜像：
- 平台 / 项目类型 / clientType：
- 应用标识：使用不含凭证的内部代号
- 目标版本 / robot：
- 命令 / 模式：
- workflow run URL / attempt / artifact 或本地证据位置：

| 检查 | 结果 | 证据 / 原因 |
| --- | --- | --- |
| 构建与本地检查 | 待验证 | |
| SDK 实际调用与 JSON | 待验证 | |
| 平台后台版本 / 描述 | 待验证 | |
| 二维码文件与客户端扫码 | 待验证或不适用 | 设备、客户端版本、页面和参数 |
| 凭证清理 | 待验证 | |

## 问题与范围

- 错误阶段、错误码与脱敏原因：
- 远端是否已产生版本；再次执行前的核对结果：
- 未覆盖的组合、专项能力和后续工作：
```
