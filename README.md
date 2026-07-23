# <img src="https://raw.githubusercontent.com/LazyScar/BiliBili-To-English/refs/heads/main/icon128.png" height="50"> BiliBili To English

Translate BiliBili into English (or another language) right on the page, in real time.

[![GitHub release](https://img.shields.io/github/v/release/LazyScar/BiliBili-To-English?label=latest&sort=semver)](https://github.com/LazyScar/BiliBili-To-English/releases)
[![GitHub release date](https://img.shields.io/github/release-date/LazyScar/BiliBili-To-English)](https://github.com/LazyScar/BiliBili-To-English/releases/latest)
[![GitHub issues](https://img.shields.io/github/issues/LazyScar/BiliBili-To-English?color=red)](https://github.com/LazyScar/BiliBili-To-English/issues)
[![GitHub license](https://img.shields.io/github/license/LazyScar/BiliBili-To-English?color=lightgrey)](https://github.com/LazyScar/BiliBili-To-English/blob/main/LICENSE)

<p align="left">
🇨🇳 <a href="./README.zh-CN.md">简体中文</a> | 🇷🇺 <a href="./README.ru.md">Русский</a> | 🇺🇸 English
</p>

---

## Contents
- [What it does](#what-it-does)
- [Installation](#installation)
- [Screenshots](#screenshots)
- [Features](#features)
- [Supported languages](#supported-languages)
- [How it works](#how-it-works)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Credits](#credits)

---

## What it does

Browser extension that translates the BiliBili interface, comments, video titles, and subtitles. Works on **Chrome, Firefox, Brave, Opera, Edge** and other Chromium‑based browsers. Install, choose a language, and browse — translations appear automatically.

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/firefox-addons.png" height="60">
  </a>
  <a href="https://chromewebstore.google.com/detail/bilibili-to-english/difagjkcpcpjmdopoijepnkflhiemcab">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/chrome-web-store.png" height="60">
  </a>
</p>

## Installation

### Browser stores
- **Firefox** – [Mozilla Add‑ons](https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/)
- **Chrome** – [Chrome Web Store](https://chromewebstore.google.com/detail/bilibili-to-english/difagjkcpcpjmdopoijepnkflhiemcab)

### Manual

**Chromium browsers (Chrome, Edge, Opera, Brave)**
1. Download the repository as a ZIP and extract it.
2. Go to `chrome://extensions/`, enable Developer mode.
3. Click Load unpacked and select the extracted folder.
4. You can disable Developer mode afterwards.

**Firefox**
1. Download the repository as a ZIP and extract it.
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
3. Click Load Temporary Add‑on….
4. Select any file inside the extracted folder (e.g. manifest.json).
5. The extension will remain active until you restart Firefox. For permanent installation, use the Mozilla Add‑ons version.

---

## Screenshots

| Homepage | Video page | Comments | Creator/Studio |
| :--: | :--: | :--: | :--: |
| <img height="100" src="https://github.com/user-attachments/assets/75418edd-e1e4-4006-9db1-2c75c4328df7" /> | <img height="100" src="https://github.com/user-attachments/assets/05240571-4f36-4362-bc53-5ad8e86b70e8" /> | <img height="100" src="https://github.com/user-attachments/assets/f67bffbd-77ae-4b7c-a21f-b1ff3af3e6d0" /> | <img height="100" src="https://github.com/user-attachments/assets/fd405262-df4f-4f3e-955b-00e1856c6d64" /> |

---

## Features

- Real‑time subtitle translation while watching videos
- Full interface translation (buttons, menus, video info, creator/studio pages)
- Comment area translation — read without leaving the page
- Popup language picker with flag icons, accessible from the toolbar
- Language preference remembered automatically

---

## Supported languages

🇺🇸 English · 🇫🇷 French · 🇯🇵 Japanese · 🇷🇺 Russian · 🇻🇳 Vietnamese · 🇮🇩 Indonesian

More languages planned. Contributions welcome.

---

## How it works

The extension uses a local dictionary for frequent BiliBili terms. If a term isn’t found, it sends the text to an online translation API (Google, Deepl, Microsoft). The page updates in real time — no reload required.

---

## FAQ

**What is translated?**  
UI elements, video subtitles, comments, titles — basically everything visible on the page.

**Why “access to all sites”?**  
It needs to read and modify BiliBili pages to replace text. Permission is only active on BiliBili domains.

**Which translation services are used?**  
A built‑in dictionary plus public translation APIs (Google Translate, etc.). No setup needed.

**Is data collected?**  
No personal data is ever collected. Only the text you translate is sent to the translation API; it isn’t stored or tracked.

---

## Contributing

Translators and developers are welcome. See [CONTRIBUTION.md](CONTRIBUTION.md).

---

## Contributors

<a href="https://github.com/LazyScar/BiliBili-To-English/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=LazyScar/BiliBili-To-English" />
</a>

## Credits

Developed by **[LazyScar](https://github.com/LazyScar)** · Inspired by XilkyTofu’s work · Thanks to all contributors.
