# 足迹板 TravelBoard（Cloudflare Edition）

这是「足迹板 TravelBoard」的 Cloudflare Workers 全栈版本，保留原站的地图、地点、评分、好友、照片、轨迹和路线功能。

## 架构

- Cloudflare Workers：API 与静态站点托管
- Cloudflare D1：用户、地点、评价、轨迹、路线等结构化数据
- Cloudflare Workers KV：照片与头像原文件，不做二次压缩
- GitHub：源码仓库与自动部署

## 本地开发

```bash
npm install
npx wrangler d1 execute travel-board --local --file=schema.sql
npm run dev
```

浏览器打开 Wrangler 输出的本地地址。

## 首次部署

1. 在 Cloudflare 创建 D1 数据库 `travel-board`，把数据库 ID 写入 `wrangler.toml`。
2. 在 Cloudflare 创建 Workers KV 命名空间 `travel-board-media`，把命名空间 ID 写入 `wrangler.toml`。
3. 执行远程数据库初始化：

   ```bash
   npx wrangler d1 execute travel-board --remote --file=schema.sql
   ```

4. 执行部署：

   ```bash
   npm run deploy
   ```

Worker 首次收到 API 请求时也会自动创建缺失的数据表，重复执行初始化是安全的。

## 数据说明

原本地版的 `data/` 目录不会进入 Git，也不会自动上传。新部署默认是一块全新的共享足迹板；如需迁移旧账号和照片，应单独确认后进行。
