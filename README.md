# 云端档案 · 个人云盘

这是个人云盘的前端和 Cloudflare Worker 后端。GitHub Pages 前端地址：[https://lovx.me/personal-cloud-drive/](https://lovx.me/personal-cloud-drive/)。源码仓库：[Lonivxy/personal-cloud-drive](https://github.com/Lonivxy/personal-cloud-drive)。

## 当前状态

- 私有 Bucket `lonivxy-personal-cloud-20261019` 已创建于河源地域，标准存储、本地冗余，并开启阻止公共访问。
- GitHub Pages 前端已发布，自动部署工作流成功。
- ZIP `archive-2026-08-19T122438+0800.zip` 已原样上传，大小为 8,586,204,897 字节。
- GitHub Pages 前端已发布，Cloudflare Worker 后端也已部署；Worker Secrets 尚未配置，因此登录、列目录和下载暂不可用。
- Worker URL 已写入 `config.js`。完成专用 OSS 只读密钥配置后，需要验证登录、目录和下载流程。

## 安全设计

前端通过 GitHub Pages 发布。登录密码和 OSS AccessKey 只存于 Cloudflare Worker Secrets；网页仓库不保存密钥。Worker 登录后才列出文件，点击下载时生成 5 分钟有效的 OSS V4 私有签名链接。Bucket 不会公开读。

## 后端机密

在 `worker/` 使用 Wrangler 部署后配置以下机密：

- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `DRIVE_PASSWORD`
- `SESSION_SECRET`

`wrangler.jsonc` 仅保存 Bucket 名、地域和允许的网站来源。

## GitHub Pages

`.github/workflows/pages.yml` 在推送 `main` 后自动部署静态前端。

## 费用

OSS 存储和公网下载流量按阿里云账号的当前计费规则收取。生成短时签名链接本身不另计对象存储流量费用。
