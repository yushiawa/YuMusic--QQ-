# YuMusic · 明日方舟风格桌面音乐播放器

> “直到大地变成一颗酸橙”

基于 **Electron + Three.js** 的桌面音乐播放器，同时接入 **网易云音乐** 与 **QQ音乐**。
暗色沉浸式 3D 粒子舞台、歌词与特效互相交融，以明日方舟为主题的全局 UI。

## 功能

- **双平台曲库**：网易云音乐 + QQ音乐统一搜索、按热度混合排序并标注曲源；各自平台的「我的喜欢」与推荐均可切换展示。
- **私人FM**：网易云私人 FM 连播，自动加载更多推荐。
- **歌词多源智能匹配**：
  - 优先级：AMLL 数据库（逐字）→ 同源官方逐字（网易云 YRC / QQ QRC）→ 行级 LRC 兜底
  - 播放时左上角角标提示当前实际使用的歌词来源，减少曲词不对应。
- **歌词特效**：
  - `商籁`：镜头运镜 + 段落编排的逐字歌词引擎，歌词随镜头流动、鼓点卡点、极光背景透出。
  - `星海`：3D 歌词舞台，封面粒子背景、多行发光歌词、可调预设与参数，跟随封面取色。
- **可视化背景**：内置多套背景预设，并支持接入 **Wallpaper Engine** 壁纸作为舞台背景。
- **AI 助手**：设置中自定义 AI 服务地址与 API Key（支持连接测试），AI 可读取已登录账号的喜欢歌单、热曲排行与每日推荐，提供个性化推荐。
- **明日方舟主题**：角色主题切换（莫斯提马 / 能天使等）贯穿全局按钮风格与播放页特效；官方 GIF 素材跟随歌词行动态漂移。
- **桌面歌词**：置顶迷你窗口，卡拉 OK 逐字填充 + 封面，平滑插值不卡顿。
- **系统托盘 + 全局快捷键**：媒体键、`Alt+Shift+Space`（播放/暂停）、`Alt+Shift+←/→`（切歌）、`Alt+Shift+L`（桌面歌词）。
- **无边框窗口**：自绘标题栏与最小化 / 最大化 / 关闭按钮，顶栏拖拽移动。
- **帧数选择**：设置中可选 30 / 60 / 120 FPS，粒子速度按帧率归一化。
- **加载体验**：歌曲加载时显示加载提示动画，播放地址缓存 + 下一首预取。

## 运行

需要 Node.js 18+。

```bash
# 首次安装依赖（国内网络较慢时先设置镜像）：
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:npm_config_registry = "https://registry.npmmirror.com"
npm install

# 开发启动（自动构建渲染器）
npm start

# 打包版便携启动
npm run app
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm start` | 构建渲染器并启动应用 |
| `npm run build` | esbuild 打包渲染器（`renderer/src/app.js` → `renderer/app.js`） |
| `npm run smoke` | 无头冒烟测试，窗口加载成功打印 `SMOKE OK` 后自动退出 |
| `npm run app` | 使用打包版 Electron 直接运行当前目录 |


## 打包安装版（Windows）

```bash
npm run dist
```

产物输出到 `release/`：

- `YuMusic-Setup-1.0.0.exe` — NSIS 安装程序，用户下载后双击即可安装部署
- `win-unpacked/` — 免安装绿色版目录

安装程序支持：可选安装目录、桌面 / 开始菜单快捷方式、自带卸载程序。

## 目录结构

```
main.js                主进程：窗口 + 网易云 / QQ 音乐 API + 网页登录抓 Cookie + IPC
preload.js             渲染进程安全桥接（contextBridge）
qq-lyric-crypto.js     QQ 逐字歌词（QRC）解密
renderer/index.html    界面骨架
renderer/style.css     暗色毛玻璃主题样式
renderer/app.js        esbuild 打包产物（npm run build 生成）
renderer/sonnet.js     商籁特效打包产物
renderer/src/app.js    渲染逻辑源码（3D 舞台 + 歌词联动 + 播放控制）
renderer/src/sonnet-entry.js  商籁特效入口
renderer/src/wallpaper.js     Wallpaper Engine 背景桥接
renderer/assets/arknights/    明日方舟素材（角色头像 / 立绘 / GIF / 标题贴图）
renderer/vendor/sonic-workshop/  Wallpaper Engine 壁纸预设（音频可视化）
```

## 常见问题

- **搜索 / 播放失败**：多为网络或平台风控，稍后重试；VIP 歌曲请先登录对应平台，无权限歌曲会给出对应 UI 提示。
- **歌词来源**：歌词优先 AMLL 数据库逐字，其次同源官方逐字（网易云 YRC / QQ QRC），最后行级 LRC；左上角角标标明实际来源。
- **GPU 报错**：控制台的 `GPU state invalid` 等是 Chromium 的无害提示，不影响使用。
- **文字显示乱码**：请确保文件以 UTF-8（无 BOM）编码保存。