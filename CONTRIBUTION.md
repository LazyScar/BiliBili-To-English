# How to Contribute a New Language

We are thrilled that you want to contribute to the BiliBili To English! Adding a new language is a great way to help users from all over the world.

Follow these steps to add a new language:

### Step 1: Fork the Repository

First, create a fork of the main repository on GitHub. This will create a copy of the project under your own GitHub account that you can freely edit.

### Step 2: Create a New Language File

1.  Navigate to the `languages/` directory in your forked repository.
2.  Create a new file. The file name should follow the [ISO 639-1 language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format. For example:
    - `es.js` for Spanish
    - `de.js` for German
    - `ja.js` for Japanese
3.  Copy the entire content of `languages/en.js` and paste it into your new language file.

### Step 3: Translate the Dictionary

1.  In your new file (e.g., `es.js`), you will see a large JavaScript object. The variable name should match your language (e.g., `const esDictionary = { ... };`).
2.  Your task is to **translate the English text (the "value") into your target language**. Do not change the Chinese text (the "key").

    **Example:**

    ```javascript
    // Original (in en.js)
    "我关注的主播": "Followed",

    // Translated (in es.js)
    "我关注的主播": "Seguidos",
    ```

3.  Translate as many phrases as you can. It's okay if you can't translate everything; the Google Translate API will handle the rest.

### Step 4: Update the Language Manager

1.  Open the `languages/languageManager.js` file.
2.  Find the `availableLanguages` object.
3.  Add your new language to this object. You'll need the language code, the language's native name, and a flag emoji.

    **Example (adding Spanish):**

    ```javascript
    this.availableLanguages = {
      en: { name: "English", flag: "🇺🇸" },
      fr: { name: "Français", flag: "🇫🇷" },
      ru: { name: 'Русский', flag: '🇷🇺' }
      es: { name: "Español", flag: "🇪🇸" }, // Add your new language here
    };
    ```

4.  Next, in the `switchLanguage` method, add a `case` for your new language to load its dictionary.

    **Example (adding Spanish):**

    ```javascript
    switch (langCode) {
      // ... existing cases
      case "es":
        this.dictionary = esDictionary;
        break;
      // ...
    }
    ```

### Step 5: Update the Manifest File

1.  Open the `manifest.json` file.
2.  Find the `content_scripts` section.
3.  Add the path to your new language file to the `js` array. Make sure to place it before `languageManager.js`.

    **Example (adding Spanish):**

    ```json
    "js": [
      "languages/en.js",
      "languages/fr.js",
      "languages/es.js", // Add your new language file here
      "languages/languageManager.js",
      "main.js"
    ],
    ```

### Step 6: Submit a Pull Request

You're all done! Commit your changes and create a Pull Request from your forked repository to the main repository. We will review your contribution, merge it, and it will be included in the next release.

Thank you for making this extension better!
