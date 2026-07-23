# <img src="https://raw.githubusercontent.com/LazyScar/BiliBili-To-English/refs/heads/main/icon128.png" height="50"> BiliBili To English

在 B 站页面上直接显示英文（或其他语言）翻译，实时生效。

[![GitHub release](https://img.shields.io/github/v/release/LazyScar/BiliBili-To-English?label=最新版本&sort=semver)](https://github.com/LazyScar/BiliBili-To-English/releases)
[![GitHub release date](https://img.shields.io/github/release-date/LazyScar/BiliBili-To-English)](https://github.com/LazyScar/BiliBili-To-English/releases/latest)
[![GitHub issues](https://img.shields.io/github/issues/LazyScar/BiliBili-To-English?color=red)](https://github.com/LazyScar/BiliBili-To-English/issues)
[![GitHub license](https://img.shields.io/github/license/LazyScar/BiliBili-To-English?color=lightgrey)](https://github.com/LazyScar/BiliBili-To-English/blob/main/LICENSE)

<p align="left">
🇨🇳 简体中文 | 🇷🇺 <a href="./README.ru.md">Русский</a> | 🇺🇸 <a href="./README.md">English</a>
</p>

---

## 目录
- [简介](#简介)
- [安装](#安装)
- [截图](#截图)
- [功能](#功能)
- [支持的语言](#支持的语言)
- [原理](#原理)
- [常见问题](#常见问题)
- [参与贡献](#参与贡献)
- [致谢](#致谢)

---

## 简介

浏览器扩展，实时翻译 B 站的界面、评论、标题和字幕。支持 **Chrome、Firefox、Brave、Opera、Edge** 等。装好、选个语言，浏览时自动显示翻译。

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/firefox-addons.png" height="60">
  </a>
  <a href="https://chromewebstore.google.com/detail/bilibili-to-english/difagjkcpcpjmdopoijepnkflhiemcab">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/chrome-web-store.png" height="60">
  </a>
</p>

## 安装

### 浏览器商店
- **Firefox** – [Mozilla Add‑ons](https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/)
- **Chrome** – [Chrome 网上应用店](https://chromewebstore.google.com/detail/bilibili-to-english/difagjkcpcpjmdopoijepnkflhiemcab)

### 手动安装

**Chromium 浏览器（Chrome、Edge、Opera、Brave）**
1. 下载仓库 ZIP 文件并解压。
2. 打开 `chrome://extensions/`，启用开发者模式。
3. 点击加载已解压的扩展程序，选择解压后的文件夹。
4. 安装完成，可以关闭开发者模式。

**Firefox**
1. 下载仓库 ZIP 文件并解压。
2. 打开 Firefox，在地址栏输入 `about:debugging#/runtime/this-firefox`。
3. 点击临时载入附加组件…。
4. 选择解压文件夹内的任意文件（如 manifest.json）。
5. 扩展在 Firefox 重启前有效。如需永久安装，请使用 Mozilla Add‑ons 版本。

---

## 截图

| 主页 | 视频页 | 评论区 | UP 主/工作室页 |
| :--: | :--: | :--: | :--: |
| <img height="100" src="https://github.com/user-attachments/assets/75418edd-e1e4-4006-9db1-2c75c4328df7" /> | <img height="100" src="https://github.com/user-attachments/assets/05240571-4f36-4362-bc53-5ad8e86b70e8" /> | <img height="100" src="https://github.com/user-attachments/assets/f67bffbd-77ae-4b7c-a21f-b1ff3af3e6d0" /> | <img height="100" src="https://github.com/user-attachments/assets/fd405262-df4f-4f3e-955b-00e1856c6d64" /> |

---

## 功能

- 视频字幕实时翻译
- 整页界面翻译（按钮、菜单、视频信息、UP 主/工作室页面）
- 评论区翻译，直接在页面内阅读
- 工具栏弹出式语言选择器，带国旗图标
- 自动记住语言偏好

---

## 支持的语言

🇺🇸 英语 · 🇫🇷 法语 · 🇯🇵 日语 · 🇷🇺 俄语 · 🇻🇳 越南语 · 🇮🇩 印尼语

更多语言即将加入，欢迎贡献。

---

## 原理

扩展内置常用 B 站术语的本地词典，未匹配的文本会通过在线翻译接口（Google、Deepl、Microsoft）处理。页面文字实时替换，无需刷新。

---

## 常见问题

**翻译哪些内容？**  
界面、字幕、评论、标题等页面上可见的文字。

**为什么需要「访问所有网站」的权限？**  
扩展需要读取和修改 B 站页面上的文字才能显示翻译，权限仅在 B 站域名下生效。

**用了哪些翻译服务？**  
内置词典 + 在线翻译接口（如 Google Translate 等），无需额外设置。

**会收集数据吗？**  
不会收集任何个人信息。仅待翻译文本会发送给翻译接口，不存储也不追踪。

---

## 参与贡献

欢迎翻译志愿者和开发者参与。详见 [CONTRIBUTION.md](CONTRIBUTION.md)。

---

## 贡献者

<a href="https://github.com/LazyScar/BiliBili-To-English/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=LazyScar/BiliBili-To-English" />
</a>

## 致谢

由 **[LazyScar](https://github.com/LazyScar)** 开发 · 灵感来自 XilkyTofu 的项目 · 感谢所有贡献者。
