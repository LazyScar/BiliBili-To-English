# BiliBili-To-English
BiliBili is a video platform that only has a Chinese version. To translate its content into English, you can use a Chrome extension. This extension works on browsers like Chrome, Bing, Firefox, Brave, Opera, and many more.

## Using FireFox?
<p align="left">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/"><img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/firefox-addons.png"></a>
</p>

# Features

- Real-time translation of captions
- Comprehensive translation for the entire page, including buttons and menus
- Real-time translation of comments on **manga.bilibili.com** (note: does not function on **bilibili.com**)
- Instant translation of video titles, views, and likes

### Screenshot:
![image](https://github.com/user-attachments/assets/594ffde2-3be6-4e05-8a40-51bc9b1cbf54)


## How it works
It starts by checking a file called `dictionary.js` to switch Chinese words to English. If it finds a word/sentence not in the file, it uses Google Translate for the translation. This whole process is quick, usually taking just 0.5 seconds to translate what's on your screen. Moreover, it can translate text even if you don't refresh the page.

## Installation Instructions:

To install this Chrome extension, follow these steps:
1. Download this repository as a ZIP file and extract it.
2. Open Chrome and go to the extension menu from Settings or by typing `chrome://extensions/` in the address bar.
3. Turn on `Developer mode` by clicking the switch.
4. Click on `Load unpacked` and select the extracted folder. Ensure you choose the entire folder.
5. You can click the refresh icon optionally (recommended but not mandatory).
6. Turn off `Developer mode` once the installation is complete.

## Todo List
- Fix the issue that it doesn't transalte the comments of videos on `bilibili.com`
- Improve the efficiency of the translation code to reduce loading times.
- Optimize the dictionary.js file with more comprehensive entries to minimize reliance on Google Translate.

## Credits
Made By **WavaDev**,
and the `dictionary.js` file was taken from [XilkyTofu](https://github.com/XilkyTofu/bilibili_translate_chrome_extension).
