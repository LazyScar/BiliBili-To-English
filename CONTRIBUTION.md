# How to Contribute a New Language

We are thrilled that you want to contribute to BiliBili To English! Adding a new language is a great way to help users from all over the world.

Follow these steps to add a new language:

### Step 1: Fork the Repository

First, create a fork of the main repository on GitHub. This will create a copy of the project under your own GitHub account that you can freely edit.

### Step 2: Create a New Language File

1.  Navigate to the `languages/` directory in your forked repository.
2.  Create a new file. The file name should usually follow the [ISO 639-1 language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format. For example:
    - `es.js` for Spanish
    - `de.js` for German
    - `ja.js` for Japanese
3.  Copy the entire content of `languages/en.js` and paste it into your new language file.
4.  Rename the dictionary variable so it matches your language code. For example:

    ```javascript
    const esDictionary = {
      // ...
    };
    ```

### Step 3: Translate the Dictionary

1.  In your new file (for example, `es.js`), you will see a large JavaScript object.
2.  Your task is to **translate the English text (the value) into your target language**. Do not change the Chinese text (the key).
3.  Keep the same object structure, punctuation, and key names so the dictionary keeps working with the current code.
4.  Translate as many phrases as you can. It is okay if you cannot translate everything because the extension now falls back to the selected translation engine when a dictionary entry is missing.

    **Example:**

    ```javascript
    // Keep the Chinese key, translate only the value
    const esDictionary = {
      "example-key": "Translated text",
    };
    ```

### Step 4: Update the Language Manager

1.  Open the `languages/languageManager.js` file.
2.  Find the `availableLanguages` object.
3.  Add your new language to this object. You will need the language code, the language's native name, and a flag emoji.

    **Example (adding Spanish):**

    ```javascript
    this.availableLanguages = {
      en: { name: "English", flag: "FLAG" },
      fr: { name: "Francais", flag: "FLAG" },
      es: { name: "Espanol", flag: "FLAG" },
    };
    ```

4.  Next, in the `switchLanguage` method, add a `case` for your new language to load its dictionary.

    **Example (adding Spanish):**

    ```javascript
    switch (langCode) {
      case "es":
        this.dictionary = esDictionary;
        break;
    }
    ```

5.  This step is important because the popup language selector reads from `availableLanguages`, and the selected language is stored in extension settings as `targetLanguage`.

### Step 5: Update the Loaded Script Files

1.  Open the `manifest.json` file.
2.  Find the `content_scripts` section.
3.  Add the path to your new language file to the `js` array. Make sure to place it before `languages/languageManager.js`.

    **Example (adding Spanish):**

    ```json
    "js": [
      "languages/en.js",
      "languages/fr.js",
      "languages/es.js",
      "languages/languageManager.js",
      "settings/Settings.js",
      "main.js"
    ]
    ```

4.  Open `popup.html`.
5.  Add your new language file to the `<script>` list near the bottom of the file, also before `languages/languageManager.js`.

    **Example (adding Spanish):**

    ```html
    <script src="languages/en.js"></script>
    <script src="languages/fr.js"></script>
    <script src="languages/es.js"></script>
    <script src="languages/languageManager.js"></script>
    ```

6.  This is required because the page translator and the popup both load language files separately in the new code.

### Step 6: Check Translation Engine Support

1.  The dictionary handles common fixed text, but missing entries are translated by the selected engine (`Google`, `Microsoft`, or `DeepL`).
2.  In most cases, using a normal ISO 639-1 code is enough for Google and Microsoft.
3.  If your language needs a special DeepL target code, update `translation/engines/deepl.js` in the `toDeepLLang` mapping.
4.  If DeepL does not support your language, the language can still be added, but contributors should verify it works correctly with Google and Microsoft, and with DeepL fallback behavior if needed.

### Step 7: Test Your Language

1.  Reload the extension in your browser.
2.  Open the popup and make sure your language appears in the **Target language** dropdown.
3.  Select your language and confirm the choice is saved after reopening the popup.
4.  Visit a few BiliBili pages and check that:
    - dictionary-based UI text is translated correctly
    - comments, captions, or dynamic content still translate through the selected engine
    - nothing breaks in the popup or on the page

### Step 8: Submit a Pull Request

You are all done! Commit your changes and create a Pull Request from your forked repository to the main repository. If your language is fully ready for users, you can also update the supported language list in the README files.

We will review your contribution, merge it, and include it in the next release.

Thank you for making this extension better!
