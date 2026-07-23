# Contributing to BiliBili To English

Thank you for your interest! This guide explains how to add a new language to the extension.  
Before you begin, make sure you have a [GitHub](https://github.com) account and are comfortable with basic Git (fork, commit, pull request).

---

## How the Extension Works – Quick Overview

The extension uses a **hybrid translation system**:

1. **Local dictionary** – Pre‑translated common UI strings (stored in `languages/*.js`).  
2. **Automatic translation engines** – For any term not in the dictionary, the extension falls back to **Google Translate**, **DeepL**, or **Microsoft Translator** (configurable).  
3. **Real‑time injection** – Translations are inserted into the page immediately, without reloading.

Your contribution improves the **first layer** – making translations faster and more accurate for your language.

---

## Step‑by‑Step Guide

### 1. Fork the Repository

- Go to [github.com/LazyScar/BiliBili-To-English](https://github.com/LazyScar/BiliBili-To-English) and click **Fork**.
- Clone your fork locally:

```bash
git clone https://github.com/YOUR_USERNAME/BiliBili-To-English.git
cd BiliBili-To-English
```

### 2. Create a New Language File

- Navigate to the `languages/` folder.
- Create a new file named after the **ISO 639‑1** code of your language (e.g. `es.js` for Spanish, `de.js` for German, `ko.js` for Korean).
- Copy the entire content of `languages/en.js` into your new file.
- **Rename the dictionary variable** to match your language code. For example, if your file is `es.js`:

```javascript
// languages/es.js
const esDictionary = {
  // ... (all keys and values)
};
```

> The variable name must match the language code exactly (e.g., `esDictionary`, `deDictionary`).

### 3. Translate the Dictionary

- In your new file, you will see a large JavaScript object.
- **Keys** are Chinese text (do **not** change them).
- **Values** are the English translations – replace them with your target language translations.

**Example:**

```javascript
// Before (from en.js):
"首页": "Home",

// After (in es.js):
"首页": "Inicio",
```

- Translate as many entries as you can. Missing entries will be handled by the automatic translation engines.

### 4. Update the Language Manager (`languages/languageManager.js`)

This file controls which languages appear in the popup and loads the correct dictionary.

- Locate the `availableLanguages` object and add your language:

```javascript
this.availableLanguages = {
  'en': { name: 'English', flag: '🇺🇸' },
  // ... existing languages ...
  'es': { name: 'Español', flag: '🇪🇸' },   // <-- Add yours
};
```

- Then, inside the `switchLanguage` method, add a `case` for your language:

```javascript
switch (langCode) {
  // ... existing cases ...
  case 'es':
    this.dictionary = esDictionary;   // use your variable name
    break;
}
```

### 5. Update the Extension Manifests

The language file must be loaded in **two places** – for the content script and for the popup.

#### a) `manifest.json`

- In the `content_scripts` section, find the `"js"` array.
- Add your new language file **before** `languages/languageManager.js`:

```json
"js": [
  "languages/en.js",
  "languages/fr.js",
  // ... all existing language files ...
  "languages/es.js",          // <-- Add yours
  "languages/languageManager.js",
  "settings/Settings.js",
  "main.js"
]
```

#### b) `popup.html`

- Near the bottom of the file, find the `<script>` list.
- Add your new file **before** `languages/languageManager.js`:

```html
<script src="languages/en.js"></script>
<script src="languages/fr.js"></script>
<!-- ... other languages ... -->
<script src="languages/es.js"></script>
<script src="languages/languageManager.js"></script>
```

### 6. (Optional) Verify Translation Engine Support

- Most languages work out‑of‑the‑box with Google and Microsoft.
- If you want to support **DeepL** and your language uses a non‑standard target code, update the mapping in `translation/engines/deepl.js`.  
  Look for the `toDeepLLang` object and add your language code if needed.

> If DeepL does not support your language, the extension will fall back to Google/Microsoft automatically.

### 7. Test Your Changes

1. **Load the extension** in your browser:
   - Chromium: go to `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the project folder.
   - Firefox: go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add‑on**, and select `manifest.json`.

2. **Reload** the extension after any changes.

3. Open the **popup** (click the extension icon) and verify:
   - Your language appears in the **Target language** dropdown with the correct flag.
   - Selecting it saves your preference.

4. Visit a few Bilibili pages and check:
   - UI text (from the dictionary) is translated correctly.
   - Comments / captions are still translated (fallback engines work).
   - No errors appear in the browser console (F12 → Console).

### 8. Submit a Pull Request

- Commit your changes:

```bash
git add .
git commit -m "Add [LANGUAGE_NAME] language support"
git push origin main
```

- On GitHub, open a Pull Request from your fork to the main repository (`LazyScar/BiliBili-To-English`, branch `main`).
- Describe your changes clearly.

---

## Contribution Checklist

Before submitting, ensure you have:

- [ ] Created a language file with the correct ISO code (e.g., `es.js`).
- [ ] Renamed the dictionary variable (e.g., `esDictionary`).
- [ ] Translated all (or most) English values into your target language.
- [ ] Added your language to `availableLanguages` in `languageManager.js`.
- [ ] Added a `case` for your language in `switchLanguage`.
- [ ] Added your file to the `"js"` array in `manifest.json` (content_scripts).
- [ ] Added your file to the `<script>` list in `popup.html`.
- [ ] Tested the extension on Bilibili pages with your language selected.
- [ ] No console errors.

---
