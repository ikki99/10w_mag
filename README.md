# 🧲 10W Magnet Parser (v0.1.0)

[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat-square&logo=go)](https://golang.org/)
[![React Version](https://img.shields.io/badge/React-18.3+-61DAFB?style=flat-square&logo=react)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25-blueviolet?style=flat-square)](https://github.com/ikki99/10w_mag)

**10W Magnet Parser** 是一款专注于隐私保护、极简绿色、节省服务器资源的磁力解析工具。它采用“前端优先”的架构，尽可能在用户本地浏览器完成解析任务。

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
