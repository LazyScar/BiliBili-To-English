# <img src="https://raw.githubusercontent.com/LazyScar/BiliBili-To-English/refs/heads/main/icon128.png" height="50"> 哔哩哔哩多语言翻译器（BiliBili To English）

在网页上实时翻译并享受哔哩哔哩（BiliBili）内容的多语言体验。

[![GitHub 发布（最新版本）](https://img.shields.io/github/v/release/LazyScar/BiliBili-To-English?label=最新版本&sort=semver)](https://github.com/LazyScar/BiliBili-To-English/releases)
[![GitHub 发布日期](https://img.shields.io/github/release-date/LazyScar/BiliBili-To-English)](https://github.com/LazyScar/BiliBili-To-English/releases/latest)
[![GitHub 问题](https://img.shields.io/github/issues/LazyScar/BiliBili-To-English?color=red)](https://github.com/LazyScar/BiliBili-To-English/issues)
[![GitHub 许可证](https://img.shields.io/github/license/LazyScar/BiliBili-To-English?color=lightgrey)](https://github.com/LazyScar/BiliBili-To-English/blob/main/LICENSE)

<p align="left">
🇨🇳 简体中文 | 🇷🇺 <a href="./README.ru.md">Русский</a> | 🇺🇸 <a href="./README.md">English</a>
</p>

---

## 概述

**BiliBili 多语言翻译器** 是一款浏览器扩展，旨在将 **哔哩哔哩的界面、视频和字幕** 实时翻译为多种语言（包括英语）。  
它支持 **Chrome、Firefox、Brave、Opera、Edge** 等主流浏览器。

该扩展让用户无需刷新页面或打开新标签页，即可实时翻译 UI 元素、评论、视频信息等内容，畅享多语言哔哩哔哩体验。

---

## 安装方法

### Firefox
<p align="left">
  <a href="https://addons.mozilla.org/zh-CN/firefox/addon/bilibili-to-english/">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/firefox-addons.png" height="60">
  </a>
</p>

### Chrome、Brave、Opera 与 Edge
- 目前处于手动安装阶段。
- 手动安装步骤：
  1. 下载此项目的 ZIP 压缩包。  
  2. 将其解压到一个文件夹。  
  3. 打开浏览器并进入 `chrome://extensions/`。  
  4. 启用右上角的 **开发者模式**。  
  5. 点击 **加载已解压的扩展程序**，选择刚刚解压的文件夹。  
  6. 安装完成后，可以关闭开发者模式。

---

## 功能特点

- **多语言支持** —— 可翻译为英语、法语、俄语等多种语言（更多语言即将推出）。  
- **优雅的语言选择界面** —— 带有国旗图标和语言名称的简洁菜单。  
- **实时字幕翻译** —— 自动翻译视频字幕。  
- **整页翻译** —— 翻译按钮、菜单及界面元素。  
- **评论翻译** —— 支持 `manga.bilibili.com` 及其他子域。  
- **即时内容翻译** —— 标题、播放量、点赞数等即时翻译。  
- **语言记忆功能** —— 自动保存用户上次选择的语言。

| 预览图 |
| :--: |
| <img src="https://github.com/user-attachments/assets/4c1f9051-a5b1-4e5e-ba06-933dc95b85fa" height="200"> |

---

## 工作原理

该扩展结合了 **本地词典匹配** 与 **自动翻译引擎**。

1. 页面加载时，会先在本地词典中查找常见中文词汇。  
2. 若未匹配到，则调用 **Google 翻译 API**（或其他支持的引擎）进行动态翻译。  
3. 更新实时显示 —— 通常在 **0.5 秒** 内完成，无需刷新页面。

---

## 支持语言

- 中文 🇨🇳  
- 英语 🇺🇸  
- 法语 🇫🇷  
- 俄语 🇷🇺  
- 更多语言即将上线！

---

## 使用方法

1. 为浏览器安装此扩展程序。  
2. 打开任意哔哩哔哩页面。  
3. 点击浏览器工具栏中的 **BiliBili 多语言翻译器** 图标。  
4. 在弹出窗口中选择你想要的语言。  
5. 即刻享受自动翻译体验。

---

## 参与贡献

想要帮助改进翻译或添加新语言支持？  
请参阅 [CONTRIBUTION.md](CONTRIBUTION.md) 获取贡献指南。

我们欢迎开发者与翻译者共同协作。

---

## 常见问题（FAQ）

**此扩展的作用是什么？**  
它会实时翻译哔哩哔哩的界面、字幕、评论及视频信息。

**为什么需要访问所有网站的权限？**  
为了执行翻译操作，扩展需要读取并修改网页上的文字内容。

**目前支持哪些翻译引擎？**  
当前使用本地词典与 Google 翻译，未来会支持更多翻译服务。

**是否会收集用户数据？**  
不会收集任何个人数据。但为执行翻译，部分文本可能会被发送至翻译服务器（例如 Google）。

---

## Star 历史

[![Star 历史图表](https://api.star-history.com/svg?repos=LazyScar/BiliBili-To-English&type=Date)](https://star-history.com/#LazyScar/BiliBili-To-English&Date)

---

## 致谢

由 **[LazyScar](https://github.com/LazyScar)** 开发与维护 · 翻译逻辑参考自 **[XilkyTofu](https://github.com/XilkyTofu/bilibili_translate_chrome_extension)**  
特别感谢所有开源贡献者、测试人员以及 **BiliBili 社区** 的持续支持。
