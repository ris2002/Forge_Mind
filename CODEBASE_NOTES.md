# ForgeMind Backend — Codebase Notes

A file-by-file breakdown of every function with full explanations of what each one does, which other functions it calls internally, and what frontend action triggers it.

---

## Overview

The backend is a **FastAPI** app. It is structured into:

```
backend/
├── main.py               ← entry point, wires everything together
├── core/                 ← shared foundation (config, settings, secrets, LLM)
├── auth/                 ← Gmail OAuth
├── providers/            ← LLM providers (Claude, OpenAI, Gemini, Ollama)
└── modules/
    └── mailmind/         ← the email AI feature
```

**Data flow at the highest level:**

User confirms workspace folder → app stores settings and secrets locally → Gmail OAuth → emails fetched → LLM processes them → results stored locally on disk. Nothing leaves the machine unless a cloud LLM provider is selected.

---

## main.py

This is the **entry point** of the entire backend. Its only job is to create the FastAPI app, add middleware, and register all the routers. It deliberately knows nothing about specific modules — it just wires everything together in one place.

---

### `root()`

**Route:** `GET /`

**Triggered by:** Nothing in the normal app flow. This is a health check endpoint. It could be called manually in a browser or by a monitoring tool to confirm the backend is alive.

**Calls internally:** Nothing. It just returns a plain dictionary with the app name, version, and status string.

This is a simple health check endpoint. When called, it returns the app name, version, and a status of "running". It does nothing else.

---

### Key lines worth understanding

**`app = FastAPI(...)`**
This creates the FastAPI application instance. Everything — middleware, routes, modules — is attached to this single object. FastAPI is a Python web framework that handles incoming HTTP requests and routes them to the correct function.

**`app.add_middleware(CORSMiddleware, ...)`**
CORS (Cross-Origin Resource Sharing) is a browser security rule. When the frontend (running at `localhost:5173` or inside the Tauri webview) makes a request to the backend (running at `localhost:8000`), the browser blocks it by default because the two have different origins. This middleware tells the browser "it is okay, allow requests from these specific origins." Without this, every API call from the frontend would fail.

**`app.include_router(...)`**
FastAPI lets you split routes across multiple files using "routers." Each router is a group of related endpoints. These four lines attach the setup, auth, providers, and meta routers to the main app so their endpoints become available.

**`mount_all(app)`**
This is how modules are dynamically registered. Instead of hardcoding every module in main.py, `mount_all` reads the module registry and attaches each module's router automatically. This means adding a new module never requires touching main.py.

---

### Overall Flow

1. Python imports main.py and runs it
2. A FastAPI app object is created
3. CORS middleware is added so the frontend can communicate with the backend
4. All routers are attached — setup, auth, providers, meta, and all modules
5. The app is now ready to receive HTTP requests from the frontend

---

## core/config.py

This file has one responsibility: **deciding where all app data lives on disk**. It manages the workspace folder path and makes sure every other part of the app uses the same path. No other file should hardcode a path like `~/Desktop/forgemind` — they all import `DATA_DIR` from here.

---

### `default_data_dir()`

**Triggered by:** Two places. First, when `_resolve()` calls it at import time if no bootstrap file exists. Second, when the frontend calls `GET /api/setup/status` — the response includes `default_dir` which is the return value of this function, used to pre-fill the input box in `LocationPicker`.

**Calls internally:** Nothing. It only uses Python's `Path` to check if the Desktop folder exists and return the appropriate path.

This function computes what the workspace folder path *should* be if the user has not chosen one yet. It checks if a `Desktop` folder exists in the user's home directory. If it does, it returns `~/Desktop/forgemind`. If not (some Linux setups have no Desktop), it falls back to `~/forgemind`.

This function does **not** create any folder. It only returns a `Path` object representing where the folder would be.

---

### `_resolve()`

**Triggered by:** Automatically at import time — when Python first loads `config.py`, this function runs immediately to set the initial value of `DATA_DIR`. It is never called again after that.

**Calls internally:** `default_data_dir()` — only if `~/.forgemind-location` does not exist, as a fallback.

This function runs once when the module is first imported at app startup. Its job is to figure out what `DATA_DIR` should be set to initially.

It checks if `~/.forgemind-location` exists. This is a tiny text file that holds just one line — the path the user chose on their first run. If the file exists, `_resolve()` reads that path and returns it. If the file does not exist (meaning it is the first ever launch), it falls back to `default_data_dir()`.

---

### `is_first_run()`

**Triggered by:** The frontend calling `GET /api/setup/status` on every app startup. `setup_routes.py` calls this function to build the response. Also called once at the bottom of `config.py` itself at import time to decide whether to create the data directory.

**Calls internally:** Nothing. It just checks whether `~/.forgemind-location` exists using `Path.exists()`.

This function answers a simple yes/no question: has the user ever confirmed a workspace location before? If `~/.forgemind-location` does not exist, this is a first run and it returns `True`. If the file exists, the user has been through setup before and it returns `False`.

---

### `set_data_dir(path)`

**Triggered by:** The frontend calling `POST /api/setup/location` when the user clicks "Create my workspace" in the `LocationPicker`. `setup_routes.py → set_location()` calls this function with the path the user chose.

**Calls internally:** Nothing from this codebase. It uses Python's built-in `Path.mkdir()` and `Path.write_text()` directly.

This is the function that does the actual work when the user confirms a location. It does three things in sequence:

1. **Creates the folder on disk** using `path.mkdir(parents=True, exist_ok=True)`. `parents=True` means it creates any missing parent folders too. `exist_ok=True` means it does not crash if the folder already exists.

2. **Writes the path to `~/.forgemind-location`** so the app remembers the location across restarts. The next time the app launches, `_resolve()` reads this file.

3. **Updates the in-memory `DATA_DIR` variable** immediately. This is important because the rest of the app reads `DATA_DIR` at runtime. By updating it here, all other parts of the app switch to the new path right away without needing a restart.

---

### Key Variables

**`_BOOTSTRAP`**
`~/.forgemind-location` — a tiny file in the user's home directory containing a single line: the full path to the workspace folder. This is the only file ForgeMind writes outside the workspace folder itself. It is what `is_first_run()` and `_resolve()` both check.

**`DATA_DIR`**
The most important variable in the whole config file. It holds the current workspace path. Every other file imports this and uses it to construct their own paths — for example `DATA_DIR / "settings.json"` or `DATA_DIR / "keys.enc"`. It starts with the value returned by `_resolve()` and gets updated when `set_data_dir()` is called.

---

### Overall Flow

1. App starts, Python imports `config.py`
2. `_resolve()` runs immediately and sets `DATA_DIR` to either the saved path or the default
3. `is_first_run()` is checked — if not first run, the workspace folder is created if it somehow got deleted
4. Frontend calls `GET /api/setup/status` → `is_first_run()` tells it whether to show `LocationPicker`
5. User confirms a location → frontend calls `POST /api/setup/location` → `set_data_dir()` creates the folder, saves the path, updates `DATA_DIR`
6. From this point on, all files use `DATA_DIR` to know where to read and write data

---

## core/setup_routes.py

This file handles the **first-run setup flow**. It exposes two API endpoints that the frontend calls to check the setup state and confirm a workspace location.

---

### `setup_status()`

**Route:** `GET /api/setup/status`

**Triggered by:** The frontend (`App.jsx`) calls this automatically every time the app starts, before deciding which page to show the user.

**Calls internally:**
- `config.is_first_run()` — to check if this is the first ever launch
- `config.default_data_dir()` — to get the default path for the `default_dir` field in the response

This function returns three pieces of information to the frontend:
- `first_run` — whether this is the first ever launch
- `data_dir` — the current workspace path
- `default_dir` — what the default path would be (used to pre-fill the input box)

The frontend uses `first_run` to decide which page to show. If `true`, it shows `LocationPicker`. If `false`, it checks Gmail auth status and goes to the main shell.

---

### `set_location(body)`

**Route:** `POST /api/setup/location`

**Triggered by:** The frontend (`LocationPicker.jsx`) calls this when the user clicks "Create my workspace →". The chosen path is sent in the request body.

**Calls internally:**
- `config.set_data_dir(path)` — creates the folder, saves bootstrap file, updates `DATA_DIR`
- `mailmind_settings.load()` — reads current mailmind settings to check if `chroma_path` is already set
- `mailmind_settings.save(s)` — saves the updated mailmind settings with the default `chroma_path`

This function does two things. First, it calls `set_data_dir()` to physically create the workspace folder and remember its location. Second, it checks if MailMind's `chroma_path` has been set — if not, it automatically sets it to `<workspace>/chromadb/MailMind`. This happens here because the workspace path was only just confirmed and ChromaDB needs somewhere to store its files.

---

### Overall Flow

1. App starts → frontend calls `GET /api/setup/status`
2. If `first_run: true` → frontend shows `LocationPicker`
3. User types or accepts the default path and confirms
4. Frontend calls `POST /api/setup/location` with the path
5. Backend creates the workspace folder, saves the location, sets mailmind's chroma path
6. Frontend moves on to the Setup wizard (provider, Gmail, hours, profile)

---

## core/settings.py

This file manages **all app configuration** in a single `settings.json` file inside the workspace folder. It uses a scoped system so global settings (like which AI provider is active) and module settings (like MailMind's working hours) are kept cleanly separated and never overwrite each other.

---

### `_deep_merge(base, override)`

**Triggered by:** Called internally by `load_all()` and `ModuleSettings.load()` — never called directly from outside this file.

**Calls internally:** Calls itself recursively when it encounters a nested dictionary inside the settings.

This is a helper function that merges two dictionaries together. The `override` dict wins whenever there is a conflict on a key. If both dicts have the same key and both values are dictionaries, it merges those nested dicts too instead of just replacing one with the other.

The reason this exists: every time settings are loaded from disk, they are merged with the hardcoded defaults. This means if a new version of the app adds a new setting key that the user's saved `settings.json` does not have yet, the default value is automatically filled in. Without this, adding new settings would require a migration script.

---

### `load_all()`

**Triggered by:** Called every single time any setting is read anywhere in the app. Specifically called by:
- `setup_status()` indirectly when it reads `DATA_DIR`
- `ModuleSettings.load()` to get the full file before extracting the module's section
- `ModuleSettings.save()` to get the full file before updating the module's section
- `get()` and `set_value()` for global settings reads and writes
- `llm.py` when reading `active_provider` and `models`

**Calls internally:** `_deep_merge(GLOBAL_DEFAULTS, stored)` — to merge the saved file with defaults.

This function reads `settings.json` from disk and returns the full settings dictionary merged with `GLOBAL_DEFAULTS`. If the file does not exist yet or is corrupted, it just returns the defaults. Settings are always read fresh from disk — never cached — so manual edits to `settings.json` take effect on the next request without a restart.

---

### `save_all(data)`

**Triggered by:** Never called directly from outside this file. Called internally by `set_value()` and `ModuleSettings.save()` after they update their respective sections.

**Calls internally:** Nothing. It just calls Python's built-in `json.dumps()` and `Path.write_text()` to write the file.

Takes the full settings dictionary and writes it to `settings.json` as formatted JSON. Completely overwrites the file each time. This is the only function that writes to `settings.json`.

---

### `get(key, default)`

**Triggered by:** Called by `llm.py` to read `active_provider` and `models` before every LLM call. Also called by any route that needs a global setting.

**Calls internally:** `load_all()` — reads the full settings file, then picks out the one key requested.

A convenience function for reading a single top-level global setting. For example, `get("active_provider")` returns whichever provider is currently selected (`"ollama"`, `"claude"`, etc.).

---

### `set_value(key, value)`

**Triggered by:** Called by provider routes when the user switches the active provider or changes a model in Settings.

**Calls internally:**
- `load_all()` — to get the current full settings before modifying
- `save_all(data)` — to write the updated settings back to disk

A convenience function for writing a single top-level global setting. It loads all settings, updates the one key, and saves everything back. Other keys are untouched.

---

### `module_settings(module_id, defaults)`

**Triggered by:** Called once by each module at import time to create its scoped settings object. For example, `modules/mailmind/settings.py` calls this with `module_id="mailmind"` when the module is first loaded.

**Calls internally:** Just creates and returns a new `ModuleSettings` instance — no file reads happen here.

A factory function that creates a `ModuleSettings` object for a specific module. Each module calls this once to get its own scoped view of `settings.json`.

---

### Class: `ModuleSettings`

This class gives each module a scoped view of `settings.json`. The module only sees and touches its own section under `modules.<id>`.

---

#### `__init__(module_id, defaults)`

**Triggered by:** Called when `module_settings()` factory function is called at module import time.

**Calls internally:** Nothing. Just stores the module ID and defaults on `self`.

Stores the module's ID and its default settings. These defaults are used every time settings are loaded to fill in any missing keys.

---

#### `load()`

**Triggered by:** Called whenever a module needs to read its settings. For example, when the frontend opens Settings and the backend needs to return MailMind's current config. Also called in `set_location()` to check if `chroma_path` is already set.

**Calls internally:**
- `load_all()` — reads the full `settings.json` from disk
- `_deep_merge(self.defaults, stored)` — merges the module's saved section with its own defaults

Reads the full `settings.json`, navigates to `modules.<id>`, and merges that section with the module's own defaults. Returns just the module's settings as a plain dictionary. If the module has never saved settings before, returns the defaults.

---

#### `save(data)`

**Triggered by:** Called when a module needs to persist its settings. For example, when the user changes MailMind settings in the UI and hits Save. Also called in `set_location()` to save the default `chroma_path`.

**Calls internally:**
- `load_all()` — reads the full file first so other sections are not lost
- `save_all(all_settings)` — writes the full file back after updating just this module's section

Takes the module's settings dictionary and saves it into `settings.json` under `modules.<id>`. It loads the full file first, updates only the module's section, and writes everything back. Other modules' settings and global settings are untouched.

---

#### `get(key, default)` and `set(key, value)`

**Triggered by:** Convenience wrappers used by modules to read or write a single key without loading and saving manually.

**Calls internally:**
- `get` calls `self.load()`
- `set` calls `self.load()` then `self.save()`

---

### Overall Flow

```
settings.json structure:
{
  "active_provider": "ollama",       ← global, read by llm.py
  "models": { ... },                 ← global, read by llm.py
  "modules": {
    "mailmind": { ... }              ← module-scoped, only MailMind reads/writes this
  }
}
```

- Every read goes through `load_all()` which merges with defaults via `_deep_merge`
- Global settings are read with `get()` and written with `set_value()`
- Module settings are read with `ModuleSettings.load()` and written with `ModuleSettings.save()`
- A module can never accidentally touch another module's section or the global section

---

## core/secret_store.py

This file handles **storing API keys and sensitive values securely on disk**. It uses Fernet symmetric encryption. If the `cryptography` library is not installed, it falls back to storing keys in plaintext with a warning.

---

### `_keys_enc()`

**Triggered by:** Called inside `load_keys()` and `_write_keys()` to get the path for the encrypted file.

**Calls internally:** Nothing. Returns `config.DATA_DIR / "keys.enc"`.

Returns the path to `keys.enc`. This is a function (not a variable) because `DATA_DIR` might change after import when `set_data_dir()` is called. By computing the path at call time it always reflects the current workspace.

---

### `_keys_plain()`

**Triggered by:** Called inside `load_keys()` and `_write_keys()` as the fallback path when encryption is unavailable.

**Calls internally:** Nothing. Returns `config.DATA_DIR / "keys.json"`.

Returns the path to `keys.json`. Only used when the `cryptography` library is not installed.

---

### `_master_key()`

**Triggered by:** Called inside `_get_fernet()` to locate the encryption key file.

**Calls internally:** Nothing. Returns `config.DATA_DIR / "master.key"`.

Returns the path to `master.key` — the file containing the Fernet encryption key. If this file is deleted, all keys in `keys.enc` become permanently unreadable.

---

### `_have_crypto()`

**Triggered by:** Called at the start of `load_keys()` and `_write_keys()` to decide which path to take — encrypted or plaintext.

**Calls internally:** Nothing. Just attempts to import the `cryptography` package and returns `True` or `False`.

Checks whether the `cryptography` Python package is installed. Returns `True` if available, `False` if not.

---

### `_get_fernet()`

**Triggered by:** Called inside `load_keys()` when decrypting and inside `_write_keys()` when encrypting. Only called if `_have_crypto()` returned `True`.

**Calls internally:**
- `_master_key()` — to get the path to the key file
- Python's `Fernet.generate_key()` — only on first ever use, to create a new random encryption key
- `os.chmod()` — to set file permissions to owner-only (600)

Gets the Fernet encryption object. If `master.key` does not exist yet, it generates a new random encryption key and writes it to `master.key` with `chmod 600`. Then reads `master.key` and creates a `Fernet` object using that key.

---

### `load_keys()`

**Triggered by:** Called by `get_key()`, `save_key()`, and `delete_key()` every time they need the current set of keys. Also called by `llm.py` indirectly through `get_key()` before every LLM API call.

**Calls internally:**
- `_have_crypto()` — to decide whether to use encrypted or plaintext path
- `_keys_enc()` — to get the encrypted file path
- `_get_fernet()` — to get the decryption object
- `_keys_plain()` — as fallback if no encryption

Loads and returns all stored API keys as a plain dictionary, for example `{ "claude": "sk-ant-...", "openai": "sk-..." }`. Decrypts `keys.enc` if available, falls back to reading `keys.json`, returns an empty dict if neither exists.

---

### `_write_keys(keys)`

**Triggered by:** Called by `save_key()` and `delete_key()` after they modify the keys dictionary.

**Calls internally:**
- `_have_crypto()` — to decide encrypt or plaintext
- `_get_fernet()` — to get the encryption object
- `_keys_enc()` — to get the encrypted file path
- `_keys_plain()` — to delete the plaintext file if switching to encrypted
- `os.chmod()` — to set file permissions to 600

Takes the full dictionary of keys and writes it to disk. Always writes the complete dictionary — never just one key — because the encrypted file stores everything together. Sets `chmod 600` on the written file.

---

### `save_key(name, value)`

**Triggered by:** Called when the user enters an API key in Settings and hits Save. Also called in `Setup.jsx → finish()` when the user completes the first-run wizard.

**Calls internally:**
- `load_keys()` — to get all existing keys first
- `_write_keys(keys)` — to write the updated dictionary back to disk

Saves one API key by name. Loads all existing keys, adds or updates the one key, writes everything back. Never writes just one key in isolation — always rewrites the whole encrypted file.

---

### `delete_key(name)`

**Triggered by:** Called when the user removes an API key from Settings.

**Calls internally:**
- `load_keys()` — to get current keys
- `_write_keys(keys)` — to write back without the deleted key

Removes one key by name. If the key does not exist, nothing happens.

---

### `get_key(name)`

**Triggered by:** Called by `llm.py → llm_generate()` and `llm_stream()` before every cloud LLM request to fetch the API key for the active provider.

**Calls internally:** `load_keys()` — decrypts the file and returns the full dict, then picks out the requested key.

Returns the value of one key by name, or `None` if it does not exist.

---

### Overall Flow

```
User enters API key in Settings UI
      ↓
Frontend calls POST /api/providers/key
      ↓
save_key("claude", "sk-ant-...") is called
      ↓
load_keys() → decrypts keys.enc → returns current dict
      ↓
New key added to dict
      ↓
_write_keys() → encrypts full dict → writes to keys.enc (chmod 600)

────────────────────────────────────────────

User triggers an LLM call (e.g. summarise email)
      ↓
llm_generate() calls get_key("claude")
      ↓
load_keys() → decrypts keys.enc → picks "claude" key
      ↓
Key returned to llm_generate() → used in API request
```

---

## core/llm.py

This file is the **single entry point for all AI model calls** in the app. Every module that needs to talk to an LLM calls a function from here. Modules never import a specific provider directly — they always go through `llm.py`. This means the user can switch providers in Settings and every module automatically uses the new one.

---

### `_provider_class(pid)`

**Triggered by:** Called internally by both `llm_generate()` and `llm_stream()` before making a request, to check whether the provider requires an API key.

**Calls internally:** Imports `PROVIDERS` registry from `providers/__init__.py` and looks up the class by ID.

A private helper that looks up the provider class by its ID string (e.g. `"claude"`, `"ollama"`). If the ID is not in the registry, raises an HTTP 500 error. This function exists so `llm_generate` and `llm_stream` can check `cls.requires_api_key` before trying to fetch one from the secret store.

---

### `llm_generate(prompt)`

**Triggered by:** Called by modules whenever they need a complete AI response as a string. For example, MailMind calls this for contact summarisation, compose drafting, and reply drafting in non-streaming mode.

**Calls internally:**
- `app_settings.get("active_provider")` — reads which provider is active from `settings.json`
- `app_settings.get("models")` — reads the model name for that provider
- `_provider_class(pid)` — checks if an API key is required
- `secret_store.get_key(pid)` — fetches the API key if needed
- `get_provider(pid, api_key=api_key)` — instantiates the provider
- `provider.generate(prompt, model=model)` — sends the prompt and returns the full response

Sends a prompt to the active AI provider and returns the complete response as a string. The module calling this never knows which provider ran — it just gets back text.

Step by step:
1. Reads `active_provider` from settings
2. Gets the model name for that provider
3. Checks if the provider needs an API key — if yes, fetches it from `secret_store`. If the key is missing, raises a 400 error
4. Creates the provider instance
5. Calls `provider.generate()` and returns the string result

---

### `llm_stream(prompt)`

**Triggered by:** Called by modules when they want to stream the response token by token so the UI can show text appearing word by word. MailMind calls this for email summarisation so the summary streams in live.

**Calls internally:** Same as `llm_generate` — `app_settings.get()`, `_provider_class()`, `secret_store.get_key()`, `get_provider()` — but then calls `provider.generate_stream()` instead of `provider.generate()`.

Does the same thing as `llm_generate` but instead of waiting for the full response, it yields tokens one by one as they arrive using Python's `yield from`. The frontend receives each token as it is generated and appends it to what is already shown on screen. For providers that do not support streaming, it yields the entire response as a single chunk so the interface still works.

---

### Overall Flow

```
Module calls llm_generate(prompt) or llm_stream(prompt)
      ↓
Reads active_provider from settings.json  (e.g. "ollama")
      ↓
Reads model for that provider  (e.g. "qwen2.5:1.5b")
      ↓
Checks if provider requires API key
  → Yes: fetches from secret_store → missing key = 400 error
  → No (Ollama): skips key fetch
      ↓
Instantiates provider
      ↓
Calls provider.generate() or provider.generate_stream()
      ↓
Returns result to the module that called it
```

The module never knows or cares which provider ran. Switching from Ollama to Claude in Settings requires zero code changes in any module.

---

## What's Next

| File | Folder |
|------|--------|
| `gmail.py` | `auth/` |
| `routes.py` | `auth/` |
| `settings.py` | `modules/mailmind/` |
| `store.py` | `modules/mailmind/` |
| `chroma.py` | `modules/mailmind/` |
| `parsing.py` | `modules/mailmind/` |
| `prompts.py` | `modules/mailmind/` |
| `service.py` | `modules/mailmind/` |
| `routes.py` | `modules/mailmind/` |
| `base.py` | `providers/` |
| `claude.py` | `providers/` |
| `openai.py` | `providers/` |
| `gemini.py` | `providers/` |
| `ollama.py` | `providers/` |
| `routes.py` | `providers/` |
