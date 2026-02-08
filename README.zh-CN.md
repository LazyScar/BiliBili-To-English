# <img src="https://raw.githubusercontent.com/LazyScar/BiliBili-To-English/refs/heads/main/icon128.png" height="50"> BiliBili To English

实时翻译并畅享 BiliBili —— 直接在页面中将内容翻译为英语或其他语言。

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/LazyScar/BiliBili-To-English?label=最新版本&sort=semver)](https://github.com/LazyScar/BiliBili-To-English/releases)
[![GitHub release date](https://img.shields.io/github/release-date/LazyScar/BiliBili-To-English)](https://github.com/LazyScar/BiliBili-To-English/releases/latest)
[![GitHub issues](https://img.shields.io/github/issues/LazyScar/BiliBili-To-English?color=red)](https://github.com/LazyScar/BiliBili-To-English/issues)
[![GitHub license](https://img.shields.io/github/license/LazyScar/BiliBili-To-English?color=lightgrey)](https://github.com/LazyScar/BiliBili-To-English/blob/main/LICENSE)

<p align="left">
🇨🇳 简体中文 | 🇷🇺 <a href="./README.ru.md">Русский</a> | 🇺🇸 <a href="./README.md">English</a>
</p>

---

## 概述

**BiliBili To English** 是一款浏览器扩展，用于将 **BiliBili 的界面、视频内容和字幕** 翻译为英语或多种其他语言。  
支持 **Chrome、Firefox、Brave、Opera、Edge** 以及其他基于 Chromium / Firefox 的浏览器。

该扩展可让用户以自己偏好的语言无缝浏览 BiliBili 内容，**即时** 翻译界面元素、评论和视频信息，无需打开新标签页或刷新页面。

---

## 安装

### Firefox
<p align="left">
  <a href="https://addons.mozilla.org/zh-CN/firefox/addon/bilibili-to-english/">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/firefox-addons.png" height="60">
  </a>
</p>

### Chrome、Brave、Opera 和 Edge
- 目前处于手动安装阶段。
- 手动安装步骤：
  1. 将此仓库下载为 ZIP 文件。
  2. 解压到一个文件夹。
  3. 打开浏览器并访问 `chrome://extensions/`。
  4. 启用 **开发者模式**（右上角）。
  5. 点击 **加载已解压的扩展程序**，选择解压后的文件夹。
  6. 加载完成后，可关闭 **开发者模式**。

---

## 功能特性

- **多语言支持** —— 可翻译为英语、法语、俄语、日语等（更多语言即将推出）。  
- **美观的语言选择界面** —— 简洁的弹窗菜单，包含国旗图标和语言名称。  
- **字幕实时翻译** —— 自动翻译视频字幕。  
- **整页翻译** —— 翻译按钮、菜单和界面元素（包括创作者 / 工作室页面）。  
- **语言记忆** —— 自动保存你选择的语言。

| 首页 | 视频 | 评论 | 创作者 / 工作室 |
| :--: | :--: | :--: | :--: |
| <img height="100" src="https://github.com/user-attachments/assets/75418edd-e1e4-4006-9db1-2c75c4328df7" /> | <img height="100" src="https://github.com/user-attachments/assets/05240571-4f36-4362-bc53-5ad8e86b70e8" /> | <img height="100" src="https://github.com/user-attachments/assets/f67bffbd-77ae-4b7c-a21f-b1ff3af3e6d0" /> | <img height="100" src="https://github.com/user-attachments/assets/fd405262-df4f-4f3e-955b-00e1856c6d64" /> |

---

## 工作原理

该扩展结合使用 **基于词典的匹配** 与 **自动翻译引擎**。

1. 页面加载时，首先在本地词典中查找常见中文词条。
2. 若未找到对应词条，则使用 **翻译引擎** 进行动态翻译。
3. 翻译结果会实时更新并显示在页面中。

---

## 支持的语言

- 英语 🇺🇸  
- 法语 🇫🇷  
- 日语 🇯🇵  
- 俄语 🇷🇺  
- 更多语言即将推出！

---

## 使用方法

1. 为你的浏览器安装该扩展。  
2. 打开任意 BiliBili 页面。  
3. 点击工具栏中的 **BiliBili To English** 图标。  
4. 选择你偏好的语言。  
5. 即可立即享受自动翻译。

---

## 参与贡献

想要帮助改进翻译或新增语言支持？  
请查看 [CONTRIBUTION.md](CONTRIBUTION.md) 了解如何开始。

欢迎开发者和翻译人员共同参与。

---

## 常见问题（FAQ）

**这个扩展的作用是什么？**  
它可以实时翻译 BiliBili 的界面、字幕、评论和视频信息。

**为什么需要访问所有网站的权限？**  
为了执行翻译操作，扩展需要修改和替换网页中的文本内容，因此必须访问页面内容。

**支持哪些翻译引擎？**  
目前使用基于词典的翻译，以及 Google 翻译、DeepL、微软翻译（后续将增加更多选项）。

**是否会收集数据？**  
不会收集任何个人数据。但为了完成翻译，部分文本可能会被发送到翻译服务器（例如 Google、DeepL、Bing）。

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=LazyScar/BiliBili-To-English&type=Date)](https://star-history.com/#LazyScar/BiliBili-To-English&Date)

---

## 致谢

由 **[LazyScar](https://github.com/LazyScar)** 开发 · 灵感来源于 **[XilkyTofu](https://github.com/XilkyTofu/bilibili_translate_chrome_extension)** · 感谢所有开源贡献者以及 BiliBili 社区
