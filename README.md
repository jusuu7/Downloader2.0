# 下载助手 2.0

`Downloader2.0` 是最终交付目录，保留了：

- 一个 React 前端
- 一个 Node 后端
- 一个 `data/` 运行目录

提交 Git 时只需要这个目录本身，不需要带上 `node_modules`、`dist`、下载结果和本地配置。

## 本地启动

开发模式：

```bash
npm install
npm run dev:server
npm run dev
```

访问：

- 前端开发页：`http://127.0.0.1:8080`
- 后端服务：`http://127.0.0.1:1027`

生产模式：

```bash
npm install
npm run build
npm run start
```

访问：

- `http://127.0.0.1:1027`

如果 `1027` 端口被占用，先结束旧的 Node 进程再重启。

## Git 提交前

推荐只保留这些内容：

- `src/`
- `server/`
- `data/.gitkeep`
- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `tsconfig*.json`
- `eslint.config.js`
- `index.html`
- `.gitignore`
- `README.md`

这些内容不要提交：

- `node_modules/`
- `dist/`
- `data/config.json`
- `data/downloads/`
- 本地日志文件

## 宝塔部署

最省事的是直接用 Node 跑单端口 `1027`。

服务器步骤：

```bash
cd /www/wwwroot/Downloader2.0
npm install
npm run build
npm run start
```

浏览器访问：

- `http://你的服务器IP:1027`

如果你用宝塔反向代理，建议：

1. Node 服务监听 `1027`
2. 宝塔站点反代到 `http://127.0.0.1:1027`
3. 不要让宝塔自己接管 `/api/*` 逻辑

Nginx 反代核心配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:1027;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

如果你要长期运行，建议再用 `pm2` 托管：

```bash
npm install -g pm2
pm2 start "node server/index.cjs --host 0.0.0.0 --port 1027 --no-open" --name downloader2
pm2 save
```
