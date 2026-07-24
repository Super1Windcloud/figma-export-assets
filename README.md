# Figma Asset Exporter

项目包含一个本地导出控制台和一个 Figma 插件，所有业务代码均使用 TypeScript：

- Web 控制台解析 Figma 链接中的 `fileName` 和 `fileKey`，提交配置后启动后台下载进程。
- 下载进程遍历所有页面，仅导出没有子节点的基础节点，并保留页面和节点目录层级。
- Figma 插件可同步文件内的 `exportSettings`：基础节点添加 export，非基础节点移除 export。

## 配置

复制 `.env.example` 为 `.env`，按需修改：

```dotenv
VITE_EXPORT_FORMAT=PNG
VITE_EXPORT_SCALE=1
VITE_EXPORT_SUFFIX=

FIGMA_TOKEN=
FIGMA_URL=
FIGMA_FILE_KEY=
EXPORT_OUTPUT_DIR=./exports
```

`VITE_EXPORT_FORMAT` 支持 `PNG`、`JPG`、`SVG` 和 `PDF`。`VITE_EXPORT_SCALE` 只对 `PNG` 和 `JPG` 生效。

`EXPORT_OUTPUT_DIR` 是资源下载根目录。相对路径以项目目录为基准，也可以填写绝对路径。启动 Web 控制台时，`.env` 中非空的链接、token、目录和导出规格会自动显示在对应表单中。`FIGMA_TOKEN` 不会进入前端 bundle，配置接口也禁止缓存。

## Web 控制台

```shell
npm install
npm run app
```

浏览器访问 `http://127.0.0.1:4173`。控制台中的配置会传给本地后台进程，不会写回 `.env`，token 也不会进入前端 bundle。

界面会跟随系统浅色/暗色模式。下载目录右侧的文件夹按钮会调用系统文件资源管理器选择目录。

也可以完全使用 `.env` 直接下载：

```shell
npm run download
```

## Figma 插件

执行 `npm run build`，然后在 Figma Desktop 中选择 `Plugins > Development > Import plugin from manifest...`，导入本目录的 `manifest.json`。插件运行后会自动同步整个文件的 export 配置。
