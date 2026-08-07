# Contributing

## Running it locally

**Chrome** — `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.

**Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select
`manifest.json`. 
## Layout

```
background.js              service worker; performs all network requests
main.js                    entry point, wiring, on-page status badge
popup.html / popup.js      extension popup
settings/Settings.js       defaults, validation, storage
translation/
  TranslationManager.js    batching, caching, fallback chain, text post-processing
  properNouns.js           Wikidata name lookup (opt-in)
  engines/                 one file per service + throttle.js (shared pacing)
dom/DomTranslator.js       page scanning and text replacement
captions/
  CaptionManager.js        subtitle translation
  subtitleBridge.js        runs in the page world to find subtitle URLs
languages/                 dictionaries + popup interface strings
```

## Things that will break if you miss them

**All network goes through the background worker.** MV3 content scripts do not inherit the
extension's cross-origin privileges, so a direct `fetch()` from any content script or engine will be
CORS-blocked. Send `{ type: "bte:bgFetch", payload: { url, method, headers, body } }` instead. 

**Every host you call needs an entry in `host_permissions`.** Missing one fails the same way.

## Adding a language

1. Create `languages/<code>.js` using the ISO 639-1 code. Copy `languages/en.js`, keep the Chinese
   keys, and translate the English values — not the Chinese. Values should be short: they end up on
   buttons and in menus, so a long sentence breaks the layout.

   ```js
   const esDictionary = {
     "关注": "Seguir",
   };

   if (typeof window !== "undefined") {
     window.esDictionary = esDictionary;
   }
   ```

2. Register it in `languages/languageManager.js` — add it to `availableLanguages` with its native
   name and flag, and add a `case` in `switchLanguage` that assigns the dictionary.

3. Load it in **both** places, before `languages/languageManager.js`:
   - `manifest.json` → `content_scripts[0].js`
   - `popup.html` → the `<script>` list at the bottom

4. Add the popup interface strings to `languages/popupI18n.js`. Every key present in `en` must exist
   for your language, and `{v}` / `{name}` placeholders must survive translation.

5. Check the engines map your code correctly. Google, Microsoft and Yandex accept plain ISO codes.
   The others use their own: `toDeepLLang` (`PT-PT`), `toBaiduLang` (`spa`), `toYoudaoLang`
   (`zh-CHS`), `toPapagoLang`.

## Adding an engine

Create `translation/engines/<name>.js` exporting a class on `window.BTE`:

- `translate(texts, options)` → array the same length as `texts`, `null` where nothing was returned
- Route requests through `bte:bgFetch`, and add the host to `host_permissions`
- Pace requests with `ROOT.RateGovernor.schedule(this, task, priority)` so captions keep priority
- Guard messaging with `ROOT.isExtensionAlive()`
- Set `this.lastError` (`"missing-key"`, `"missing-credentials"`, …) so the popup can explain itself
- Throw on failure so the manager falls back instead of caching an empty result

Then register it in `TranslationManager`'s `engines` map, `resolveEngineChain`, the popup's engine
list and icons, and `manifest.json`.

## Before opening a pull request

- Reload the extension and refresh an open BiliBili tab
- Check a video page and a feed page: page text, comments, and subtitles
- Switch language and confirm the page and popup both follow
- Check the console, and the service worker's console via **Inspect views: service worker** — every
  engine except Google logs there, not in the page
- Keep the change focused, and say what you tested
