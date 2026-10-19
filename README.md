# 云端档案 · 个人云盘

这是个人云盘的前端和 Cloudflare Worker 后端。前端通过 GitHub Pages 发布，后端使用 OSS 只读身份列目录、生成 5 分钟有效的 V4 签名下载链接。Bucket 保持私有；登录密码和 OSS 密钥只存为 Worker Secrets，不写入网页仓库。

## 当前部署状态

- 已创建私有 Bucket：`lonivxy-personal-cloud-20261019`，河源地域、标准存储、本地冗余，并保持阻止公共访问开启。
- GitHub Pages 发布工作流已放在 `.github/workflows/pages.yml`。
- 尚未上传大文件，尚未部署 Worker 或 GitHub Pages。
- 网站 API 地址仍为空；部署 Worker 后需更新 `config.js`。

## 后端配置

在 `worker/` 安装依赖并部署 Worker。部署前先配置以下机密：

- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `DRIVE_PASSWORD`
- `SESSION_SECRET`

`wrangler.jsonc` 仅包含 Bucket 名、地域和允许的网站来源，不含机密。Worker 只开放登录、列目录和签发短时下载地址。

## GitHub Pages

将本目录内容推送到新仓库的 `main` 分支，在 **Settings → Pages → Build and deployment** 选择 **GitHub Actions**。推送后工作流会发布静态前端。

## 安全与费用

Bucket 和文件保持私有。只有登录后的网站 API 可以列出文件，下载按钮即时生成短时 URL。请勿将密钥或签名 URL 写入前端或仓库。OSS 的实际存储和公网下载流量会按阿里云账号的当前计费规则收费。
