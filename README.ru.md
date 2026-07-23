# <img src="https://raw.githubusercontent.com/LazyScar/BiliBili-To-English/refs/heads/main/icon128.png" height="50"> BiliBili To English

Переводите BiliBili на русский (или другой язык) прямо на странице, в реальном времени.

[![GitHub release](https://img.shields.io/github/v/release/LazyScar/BiliBili-To-English?label=latest&sort=semver)](https://github.com/LazyScar/BiliBili-To-English/releases)
[![GitHub release date](https://img.shields.io/github/release-date/LazyScar/BiliBili-To-English)](https://github.com/LazyScar/BiliBili-To-English/releases/latest)
[![GitHub issues](https://img.shields.io/github/issues/LazyScar/BiliBili-To-English?color=red)](https://github.com/LazyScar/BiliBili-To-English/issues)
[![GitHub license](https://img.shields.io/github/license/LazyScar/BiliBili-To-English?color=lightgrey)](https://github.com/LazyScar/BiliBili-To-English/blob/main/LICENSE)

<p align="left">
🇨🇳 <a href="./README.zh-CN.md">简体中文</a> | 🇷🇺 Русский | 🇺🇸 <a href="./README.md">English</a>
</p>

---

## Содержание
- [Что это делает](#что-это-делает)
- [Установка](#установка)
- [Скриншоты](#скриншоты)
- [Возможности](#возможности)
- [Поддерживаемые языки](#поддерживаемые-языки)
- [Как это работает](#как-это-работает)
- [Часто задаваемые вопросы](#часто-задаваемые-вопросы)
- [Содействие](#содействие)
- [Благодарности](#благодарности)

---

## Что это делает

Расширение для браузера, переводящее интерфейс, комментарии, названия видео и субтитры BiliBili. Работает в **Chrome, Firefox, Brave, Opera, Edge** и других браузерах на базе Chromium. Установите, выберите язык — переводы появятся автоматически.

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/firefox-addons.png" height="60">
  </a>
  <a href="https://chromewebstore.google.com/detail/bilibili-to-english/difagjkcpcpjmdopoijepnkflhiemcab">
    <img src="https://github.com/material-extensions/material-icons-browser-extension/raw/main/assets/chrome-web-store.png" height="60">
  </a>
</p>

## Установка

### Магазины браузеров
- **Firefox** – [Mozilla Add‑ons](https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/)
- **Chrome** – [Chrome Web Store](https://chromewebstore.google.com/detail/bilibili-to-english/difagjkcpcpjmdopoijepnkflhiemcab)

### Ручная установка

**Браузеры Chromium (Chrome, Edge, Opera, Brave)**
1. Скачайте репозиторий как ZIP и распакуйте.
2. Откройте `chrome://extensions/`, включите режим разработчика.
3. Нажмите Загрузить распакованное расширение и выберите папку.
4. После установки режим разработчика можно отключить.

**Firefox**
1. Скачайте репозиторий как ZIP и распакуйте.
2. Откройте Firefox и перейдите на `about:debugging#/runtime/this-firefox`.
3. Нажмите Загрузить временное дополнение….
4. Выберите любой файл внутри распакованной папки (например, manifest.json).
5. Расширение останется активным до перезапуска Firefox. Для постоянной установки используйте версию из Mozilla Add‑ons.

---

## Скриншоты

| Главная | Страница видео | Комментарии | Страница автора/студии |
| :--: | :--: | :--: | :--: |
| <img height="100" src="https://github.com/user-attachments/assets/75418edd-e1e4-4006-9db1-2c75c4328df7" /> | <img height="100" src="https://github.com/user-attachments/assets/05240571-4f36-4362-bc53-5ad8e86b70e8" /> | <img height="100" src="https://github.com/user-attachments/assets/f67bffbd-77ae-4b7c-a21f-b1ff3af3e6d0" /> | <img height="100" src="https://github.com/user-attachments/assets/fd405262-df4f-4f3e-955b-00e1856c6d64" /> |

---

## Возможности

- Перевод субтитров в реальном времени при просмотре видео
- Полный перевод интерфейса (кнопки, меню, информация о видео, страницы авторов/студий)
- Перевод комментариев — читайте, не покидая страницу
- Всплывающее окно выбора языка с флагами, доступное из панели инструментов
- Выбранный язык запоминается автоматически

---

## Поддерживаемые языки

🇺🇸 Английский · 🇫🇷 Французский · 🇯🇵 Японский · 🇷🇺 Русский · 🇻🇳 Вьетнамский · 🇮🇩 Индонезийский

Другие языки в планах. Будем рады помощи.

---

## Как это работает

В расширение встроен локальный словарь распространённых терминов BiliBili. Если перевода в словаре нет, текст отправляется в онлайн‑сервис перевода (Google, Deepl, Microsoft). Страница обновляется мгновенно, без перезагрузки.

---

## Часто задаваемые вопросы

**Что именно переводится?**  
Элементы интерфейса, субтитры, комментарии, заголовки — практически всё видимое на странице.

**Почему нужен доступ «ко всем сайтам»?**  
Расширение должно читать и изменять текст на страницах BiliBili. Разрешение действует только на доменах BiliBili.

**Какие сервисы перевода используются?**  
Встроенный словарь и публичные API перевода (Google Translate и др.). Настройка не требуется.

**Собираются ли данные?**  
Личные данные не собираются. Только переводимый текст отправляется в API перевода, он не сохраняется и не отслеживается.

---

## Содействие

Приглашаем переводчиков и разработчиков. Подробнее в [CONTRIBUTION.md](CONTRIBUTION.md).

---

## Участники

<a href="https://github.com/LazyScar/BiliBili-To-English/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=LazyScar/BiliBili-To-English" />
</a>

## Благодарности

Разработано **[LazyScar](https://github.com/LazyScar)** · Вдохновлено работой XilkyTofu · Спасибо всем участникам.
