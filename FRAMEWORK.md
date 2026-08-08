# 本地 Web 软件通用框架

项目现在按文件夹管理成“通用外壳 + 可替换业务 API + Vue 前端源码 + 静态发布资源”。

## 目录结构

```text
.
├─ main.go                         # 应用入口，只负责装配框架和业务
├─ business_ble.go                 # 当前业务接入点
├─ app.config.json                 # 应用配置
├─ internal/
│  ├─ framework/                   # 通用本地软件外壳
│  └─ business/
│     └─ ble/                      # 当前 BLE 业务 API
├─ frontend/                       # Vue/Vite 前端源码
│  ├─ src/
│  ├─ public/
│  └─ vite.config.ts
├─ web/                            # 前端构建产物，Go 静态托管目录
│  ├─ index.html
│  ├─ gps.html
│  ├─ site.webmanifest
│  └─ assets/
└─ scripts/
   └─ build_frontend.ps1           # 前端构建脚本
```

## 各层职责

`internal/framework` 是通用框架层，和业务无关。它负责：

- 固定端口和本地 HTTP 服务
- 单实例探测和“程序已打开”提示
- 版本号注入和展示
- 自动打开浏览器
- Windows 托盘图标、右键菜单、退出
- 静态资源服务
- `site.webmanifest` 的正确 MIME 类型
- Windows GUI 模式下的弹窗提示

`internal/business/ble` 是当前 BLE 业务层。它只负责：

- BLE 扫描
- 连接和断开
- 写入特征
- SSE 通知转发
- 注册 `/api/ble/*` 路由

`frontend` 是前端源码层。这里放 Vue/Vite 源码、开发配置和需要原样复制的 public 资源。

`web` 是前端发布资源层。这里放 `npm run build` 生成的 HTML、JS、manifest 和图标资源，Go 后端只负责静态托管。

`scripts` 是工程脚本层。当前包含前端构建脚本。

## 新软件怎么复用

做一个新类型的软件时，通常只动这些地方：

1. 复制项目骨架
2. 修改 `app.config.json`
3. 新增或替换 `internal/business/<your-business>/`
4. 修改 `business_ble.go`，让它调用你的业务注册函数
5. 替换或扩展 `frontend/src` 和 `frontend/public`
6. 替换 `frontend/public/assets/app.ico` 和网页图标
7. 运行 `npm --prefix frontend run build` 或 `scripts/build_frontend.ps1`

业务接入点示例：

```go
package main

import (
    "net/http"

    "localweb/internal/business/yourbusiness"
)

func registerBusinessRoutes(mux *http.ServeMux) error {
    yourbusiness.RegisterRoutes(mux)
    return nil
}
```

## 配置说明

`app.config.json` 里常用字段：

- `id`：应用唯一 ID，用于单实例识别
- `name`：应用名称
- `host` / `port`：本地监听地址
- `startPage`：启动后打开的页面，相对于 `staticDir`
- `staticDir`：静态网页目录，当前是 `web`
- `manifestPath`：manifest 的网页路径，相对于 `staticDir`
- `iconPath`：托盘图标磁盘路径，相对于项目根目录
- `probePath` / `probeHeader` / `probeValue`：单实例探测接口
- `windowClassName` / `windowTitle`：Windows 托盘隐藏窗口信息
- `trayTooltip`：鼠标悬停托盘图标时的提示
- `openMenuText` / `exitMenuText`：托盘右键菜单文案
- `autoOpenBrowser`：启动后是否自动打开浏览器

## 框架边界

框架层不依赖 BLE，也不依赖任何具体业务。业务只需要暴露一个：

```go
func RegisterRoutes(mux *http.ServeMux) error
```

然后入口层把它传给框架即可。

## 版本号

框架提供 `internal/framework/version.go` 管理版本号。

默认值是 `dev`。构建时通过 Go `ldflags` 注入：

```powershell
go build -ldflags "-X localweb/internal/framework.buildVersion=<version>" .
```

VS Code 的默认 `build` task 会自动执行：

```powershell
scripts/build_frontend.ps1
```

然后执行：

```powershell
git describe --tags --always --dirty
```

并把结果写入程序。托盘右键菜单会显示：

```text
版本：<version>
```

`/api/app-info` 也会返回响应头：

```text
X-App-Version: <version>
```
