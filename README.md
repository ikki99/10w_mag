# 🧲 10W Magnet Parser (v1.0.0)

[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat-square&logo=go)](https://golang.org/)
[![React Version](https://img.shields.io/badge/React-19+-61DAFB?style=flat-square&logo=react)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25-blueviolet?style=flat-square)](https://github.com/ikki99/10w_mag)

**10W Magnet Parser** 是一款专注于隐私保护、极简绿色、节省服务器资源的磁力解析工具。前端 WebTorrent 优先解析，网络受限时自动切换至 Go 后端深度解析，支持完整的管理后台。

---

## ✨ 核心特性

- 🛡️ **零隐私侵犯**：不记录访问者 IP / User-Agent，仅统计 info_hash 查询频次。
- 🍃 **前端优先**：浏览器端 WebTorrent 直接解析，后端仅在前端失败时兜底。
- 📦 **.torrent 导出**：解析成功后可一键下载标准种子文件。
- 🔄 **多源 Tracker 自动同步**：内置 4 个 tracker 列表源（ngosang + XIU2），自动去重合并。
- 🔒 **Tracker 数量限制**：可设定上限（默认 200），防止列表无限膨胀。
- ⚙️ **动态管理后台**：
  - 分 Tab 的管理界面（统计 / Trackers / 设置）
  - 热门 Hash 统计，点击直接跳转查询
  - Tracker 增删 / 启停 / 一键清理 / 导出
  - 修改管理员用户名 + 密码（无需重启即生效）
  - DHT 并发数在线调整
  - 蜜罐路径 `/admin` 防扫描
- 🎨 **精致 UI**：Framer Motion 动画、磨砂玻璃效果。

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| Frontend | React 19, Vite, Framer Motion, WebTorrent, Lucide Icons |
| Backend | Go, Gin v1.12, anacrolix/torrent v1.61, modernc.org/sqlite |
| Storage | SQLite (`mag.db`) — trackers / settings / 查询统计 |

---

## 🚀 快速开始

### 一键编译（推荐）

```bash
# Windows
./build.ps1

# Linux / macOS
./build.sh
```

编译产物在 `bin/` 目录：

```
bin/10w_mag-win64.exe    # Windows 64-bit
bin/10w_mag-linux64      # Linux 64-bit (amd64)
```

直接运行即可，前端静态资源已内嵌到二进制中：

```bash
./10w_mag-linux64        # 默认监听 :6467
```

### 开发环境

```bash
# 后端（端口 6467）
cd backend && go run main.go

# 前端（端口 5173）
cd frontend && npm install && npm run dev
```

---

## ⚙️ 默认配置

| 项目 | 默认值 |
|---|---|
| 监听端口 | `6467` |
| 管理路径 | `/10w_gl888` |
| 蜜罐路径 | `/admin` |
| 管理用户名 | `admin` |
| 管理密码 | `10w_gl888` |
| DHT 并发数 | `15` |
| Tracker 上限 | `200` |

> 所有配置均可在管理后台在线修改，无需重启服务。

---

## 🛡️ 管理后台

访问 `http://your-host:6467/10w_gl888`，使用默认账号 `admin` / `10w_gl888` 登录。

**统计 Tab** — 查看热门 Hash 及查询次数，点击行可跳转解析。

**Trackers Tab** — 查看当前 Tracker 数量（含上限），一键导出 `trackers.txt`，添加 / 批量粘贴 / 清理失效 Tracker。

**设置 Tab** — 修改管理路径、Tracker 同步源（换行分隔多个 URL）、Tracker 上限、DHT 并发数；独立表单修改用户名 + 密码。

---

## 📡 Tracker 同步源（默认内置）

```
https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt
https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_udp.txt
https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/best.txt
https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/all.txt
```

可在管理后台「设置 Tab」自定义替换或追加。

---

## 📊 VPS 推荐配置参考

| VPS 配置 | 推荐并发数 | 预计日增 Hash |
|---|---|---|
| 1 核 512M | 3–5 | 1K–2K |
| 1 核 1G | 10 | 5K–8K |
| 2 核 2G | 20 | 1.5 万 |
| 4 核 4G | 40 | 3 万+ |
| 8 核 8G+ | 80–100 | 不受并发限制 |

> 并发数 > 10 时，建议在启动脚本中加 `ulimit -n 65535`。

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源。

---

## 👤 作者

**ikki99** — [GitHub](https://github.com/ikki99)

> *"Built for a cleaner, safer, and faster web."*


---

## ✨ 核心特性

- 🛡️ **0 隐私侵犯**：不存储任何文件，不保留访问者个人信息（如 IP、User-Agent 等）。
- 🍃 **绿色省资源**：默认采用浏览器端解析，极大地节省了服务器的带宽和 CPU。
- ⚡ **前端优先解析**：使用 WebTorrent 技术在浏览器中直接通过 DHT 和 Tracker 获取元数据。
- 🔄 **智能后端回退**：当浏览器由于网络限制无法解析时，自动切换至高性能 Go 后端进行深度解析。
- 📦 **.torrent 导出**：支持将解析后的结果直接导出并下载为标准种子文件。
- 📊 **匿名统计**：仅使用 SQLite 记录 info_hash 的查询频次，用于展示热门资源，完全去中心化。
- 🎨 **顶级审美 UI**：深色模式、毛玻璃特效 (Glassmorphism)、流畅的 Framer Motion 动画。

---

## 🛠️ 技术栈

- **Frontend**: React 18, Vite, Framer Motion, WebTorrent, Lucide Icons.
- **Backend**: Go (Gin Framework), anacrolix/torrent, SQLite.
- **Design**: Vanilla CSS with modern aesthetics.

---

## 🚀 快速开始

### 开发环境运行

#### 1. 启动后端 (默认端口: 6467)
```bash
cd backend
go run main.go
```

#### 2. 启动前端
```bash
cd frontend
npm install
npm run dev
```

### 编译部署

项目提供了一键编译脚本，支持生成 Windows 和 Linux 二进制文件。

- **Windows**: 运行 `./build.ps1`
- **Linux**: 运行 `./build.sh`

编译后的文件将存放在 `bin/` 目录下。

---

## ⚙️ 默认端口

- **API 端口**: `6467`
- **前端开发端口**: `5173` (Vite 默认)

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。

---

## 👤 作者

**ikki99** - [GitHub](https://github.com/ikki99)

> **"Built for a cleaner, safer, and faster web."**
