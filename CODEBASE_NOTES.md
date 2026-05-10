# ForgeMind Backend — Codebase Notes

A file-by-file breakdown of every function with full explanations of what each one does, why it exists, and how data flows through it.

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

This is a simple health check endpoint. When called, it returns the app name, version, and a status of "running". The frontend or any monitoring tool can call this to confirm the backend is alive. It does nothing else.

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

This function computes what the workspace folder path *should* be if the user hasn't chosen one yet. It checks if a `Desktop` folder exists in the user's home directory. If it does, it returns `~/Desktop/forgemind`. If not (some Linux setups have no Desktop), it falls back to `~/forgemind`.

This function does **not** create any folder. It only returns a `Path` object representing where the folder would be. It is used in two places: to pre-fill the input box in `LocationPicker` on the frontend, and as the fallback in `_resolve()` if no location has been saved yet.

---

### `_resolve()`

This function runs once when the module is first imported (at app startup). Its job is to figure out what `DATA_DIR` should be set to.

It checks if `~/.forgemind-location` exists. This is a tiny text file that holds just one line — the path the user chose on their first run. If the file exists, `_resolve()` reads that path and returns it. If the file does not exist (meaning it is the first ever launch), it falls back to `default_data_dir()` and returns that instead.

The result of this function becomes the initial value of `DATA_DIR`.

---

### `is_first_run()`

This function answers a simple yes/no question: has the user ever confirmed a workspace location before?

It checks whether `~/.forgemind-location` exists. If the file does not exist, it means the user has never gone through the location picker, so this is a first run and the function returns `True`. If the file exists, the user has been through setup before and it returns `False`.

The frontend calls `GET /api/setup/status` which uses this function to decide whether to show the `LocationPicker` screen.

---

### `set_data_dir(path)`

This is the function that does the actual work when the user clicks "Create my workspace" in the frontend. It is called from `setup_routes.py` after the user submits their chosen path.

It does three things in sequence:

1. **Creates the folder on disk.** It calls `path.mkdir(parents=True, exist_ok=True)`. The `parents=True` means it will create any missing parent folders too (so if the user types a nested path, all folders in the chain are created). The `exist_ok=True` means it will not crash if the folder already exists.

2. **Writes the path to `~/.forgemind-location`.** This is what makes the app remember the location across restarts. The next time the app launches, `_resolve()` reads this file and knows exactly where the workspace is.

3. **Updates the in-memory `DATA_DIR` variable.** This is important because the rest of the app (settings, secret_store, etc.) reads `DATA_DIR` at runtime. By updating it here immediately, all other parts of the app switch to using the new path right away — without needing a restart.

---

### Key Variables

**`_BOOTSTRAP`**
This is the path `~/.forgemind-location`. It is a tiny file in the user's home directory containing a single line — the full path to the workspace folder. This is the only file ForgeMind writes outside the workspace folder itself.

**`DATA_DIR`**
This is the most important variable in the whole config file. It is a module-level variable that holds the current workspace path. Every other file imports this and uses it to construct their own paths — for example, `DATA_DIR / "settings.json"` or `DATA_DIR / "keys.enc"`. It starts with the value returned by `_resolve()` and gets updated when `set_data_dir()` is called.

---

### Overall Flow

1. App starts, Python imports `config.py`
2. `_resolve()` runs immediately and sets `DATA_DIR` to either the saved path or the default
3. If it is not a first run, the workspace folder is created if it somehow got deleted
4. Frontend calls `GET /api/setup/status` → `is_first_run()` tells it whether to show `LocationPicker`
5. User confirms a location → frontend calls `POST /api/setup/location` → `set_data_dir()` creates the folder, saves the path, updates `DATA_DIR`
6. From this point on, all files use `DATA_DIR` to know where to read and write data

---

## core/setup_routes.py

This file handles the **first-run setup flow**. It exposes two API endpoints that the frontend calls to check the setup state and confirm a workspace location.

---

### `setup_status()`

**Route:** `GET /api/setup/status`

The frontend calls this every time the app starts. It returns three pieces of information:

- `first_run` — whether this is the first ever launch (from `is_first_run()`)
- `data_dir` — the current workspace path (from `DATA_DIR`)
- `default_dir` — what the default path would be (from `default_data_dir()`)

The frontend uses `first_run` to decide which page to show. If it is `true`, it shows the `LocationPicker`. If it is `false`, it moves on to check Gmail auth status.

---

### `set_location(body)`

**Route:** `POST /api/setup/location`

This is called when the user clicks "Create my workspace" in the `LocationPicker`. The frontend sends the chosen path in the request body.

The function does two things:

1. Calls `config.set_data_dir(path)` which creates the folder and saves the path (explained above).

2. Sets the default `chroma_path` for the MailMind module. ChromaDB (the vector database used for email context) needs to know where to store its files. If the user has not already configured a custom path, this automatically sets it to `<workspace>/chromadb/MailMind`. This happens here because the workspace path was only just confirmed — before this point, there was nowhere to put the ChromaDB folder.

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

This is a helper function that merges two dictionaries together recursively. The `override` dict wins whenever there is a conflict on a key.

The reason this exists: every time settings are loaded from disk, they are merged with the hardcoded defaults. This means if a new version of the app adds a new setting key that the user's saved `settings.json` does not have yet, the default value is automatically filled in. The user's existing settings are preserved and the new key appears seamlessly. Without this, adding new settings would either crash old installs or require a migration script.

---

### `load_all()`

This function reads `settings.json` from disk and returns the full settings dictionary merged with the global defaults. If the file does not exist yet (first run) or is corrupted, it just returns the defaults.

Every read goes through this function. Settings are never cached in memory between requests — they are always read fresh from disk. This means if you change `settings.json` manually while the app is running, the change takes effect on the next request without a restart.

---

### `save_all(data)`

This function takes the full settings dictionary and writes it to `settings.json` as formatted JSON. It completely overwrites the file each time. This is the only function that writes to `settings.json`.

---

### `get(key, default)`

A convenience function for reading a single top-level setting. For example, `get("active_provider")` returns whichever provider is currently selected. It calls `load_all()` internally and picks out the one key you asked for.

---

### `set_value(key, value)`

A convenience function for writing a single top-level setting. It loads all settings, updates the one key, and saves everything back. For example, `set_value("active_provider", "claude")` switches the active provider.

---

### `module_settings(module_id, defaults)`

This is a factory function — it creates and returns a `ModuleSettings` object for a specific module. Each module calls this once on startup to get its own scoped settings view. For example, MailMind calls it with `module_id="mailmind"` and its own set of default values.

---

### Class: `ModuleSettings`

This class gives each module a scoped view of `settings.json`. The module only sees and touches its own section under `modules.<id>` and cannot accidentally read or write another module's settings.

**`__init__(module_id, defaults)`**
Stores the module's ID and its default settings. These defaults are used every time settings are loaded to fill in any missing keys — same merge pattern as the global defaults.

**`load()`**
Reads the full `settings.json`, navigates to `modules.<id>`, and merges that section with the module's own defaults. Returns the module's settings as a plain dictionary. If the module has never saved settings before, this just returns the defaults.

**`save(data)`**
Takes the module's settings dictionary and saves it back into `settings.json` under `modules.<id>`. It loads the full file first, updates just the module's section, and writes the whole file back. This ensures other modules' settings are not touched.

**`get(key, default)`**
Reads one specific key from this module's settings.

**`set(key, value)`**
Writes one specific key to this module's settings.

---

### Overall Flow

The `settings.json` file looks like this:

```json
{
  "active_provider": "ollama",
  "models": {
    "ollama": "qwen2.5:1.5b",
    "claude": "claude-haiku-4-5-20251001"
  },
  "modules": {
    "mailmind": {
      "chroma_path": "/Users/rishil/Desktop/forgemind/chromadb/MailMind",
      "work_start": "09:00",
      "work_end": "18:00"
    }
  }
}
```

- Global settings live at the top level
- Each module's settings live under `modules.<id>`
- Every read merges with defaults so the file never needs a manual migration when new keys are added
- Every write goes through `save_all()` which overwrites the whole file

---

## core/secret_store.py

This file handles **storing API keys and sensitive values securely on disk**. It uses Fernet symmetric encryption from the `cryptography` library. If that library is not installed, it falls back to storing keys in plaintext with a warning — the app still works, just less securely.

---

### `_keys_enc()`

Returns the path to `keys.enc` inside the workspace folder. This is the encrypted file where API keys are stored when the `cryptography` library is available.

This is a function (not a variable) because `DATA_DIR` might change after import if `set_data_dir()` is called. By computing the path at call time, it always reflects the current workspace location.

---

### `_keys_plain()`

Returns the path to `keys.json`. This file is only used as a fallback when the `cryptography` library is not installed. In that case, keys are stored here in plain JSON — readable by anyone who can access the file.

---

### `_master_key()`

Returns the path to `master.key`. This file contains the Fernet encryption key used to encrypt and decrypt `keys.enc`. It is generated once on first use and never changes. If this file is deleted, all encrypted keys in `keys.enc` become permanently unreadable.

---

### `_have_crypto()`

Checks whether the `cryptography` Python package is installed by attempting to import it. Returns `True` if it is available, `False` if not. This is checked before every encrypt/decrypt operation so the app degrades gracefully without the package.

---

### `_get_fernet()`

This function creates and returns the Fernet encryption object that does the actual encrypting and decrypting.

If `master.key` does not exist yet (first ever use), it generates a new random encryption key and writes it to `master.key`. It then sets the file permissions to `chmod 600` — meaning only the owner of the file (the logged-in user) can read or write it. Nobody else on the system can access it.

It then reads `master.key` and creates a `Fernet` object using that key. This object is used for all encryption operations.

---

### `load_keys()`

This function loads and returns all stored API keys as a plain dictionary. For example: `{ "claude": "sk-ant-...", "openai": "sk-..." }`.

If the `cryptography` library is available and `keys.enc` exists, it decrypts the file using `_get_fernet()` and parses the JSON. If decryption fails for any reason (corrupted file, wrong key), it returns an empty dictionary rather than crashing.

If `cryptography` is not available, it falls back to reading `keys.json` as plain text.

If neither file exists yet, it returns an empty dictionary.

---

### `_write_keys(keys)`

This function takes the full dictionary of keys and writes it to disk. It is always called with the complete dictionary — not just one key — because the encrypted file stores everything together.

If `cryptography` is available, it encrypts the JSON-encoded dictionary using Fernet and writes the result to `keys.enc`. It then sets `chmod 600` on the file. If a plaintext `keys.json` exists from before encryption was available, it deletes that file since the encrypted version now supersedes it.

If `cryptography` is not available, it writes the keys as plain JSON to `keys.json` and prints a warning.

---

### `save_key(name, value)`

The public function for saving one API key. For example, `save_key("claude", "sk-ant-...")`.

It loads all existing keys, adds or updates the one key, then writes everything back. It never writes just one key in isolation — it always rewrites the whole encrypted file with the full dictionary.

---

### `delete_key(name)`

Removes one key by name. Loads all keys, deletes the entry, writes everything back. If the key does not exist, nothing happens.

---

### `get_key(name)`

Returns the value of one key by name, or `None` if it does not exist. This is what `llm.py` calls to retrieve an API key before making a request to a cloud provider.

---

### Overall Flow

1. User enters an API key in Settings → `save_key("claude", "sk-ant-...")` is called
2. All existing keys are loaded, the new key is added to the dictionary
3. The whole dictionary is JSON-encoded, encrypted with Fernet, and written to `keys.enc`
4. Next time the LLM needs to make a request, it calls `get_key("claude")`
5. `keys.enc` is read, decrypted, parsed, and the value for `"claude"` is returned
6. The API key is used for the request and never logged or stored anywhere else

---

## core/llm.py

This file is the **single entry point for all AI model calls** in the app. Every module that needs to talk to an LLM calls a function from here. Modules never import a specific provider directly — they always go through `llm.py`. This is intentional: it means the user can switch providers in Settings and every module automatically uses the new one without any code changes.

---

### `_provider_class(pid)`

A private helper that looks up the provider class by its ID string (e.g. `"claude"`, `"ollama"`). It imports the `PROVIDERS` registry from `providers/__init__.py` and returns the class for that ID.

If the ID is not in the registry (e.g. a typo or a removed provider), it raises an HTTP 500 error. This function exists so `llm_generate` and `llm_stream` can check whether the provider requires an API key before trying to fetch one.

---

### `llm_generate(prompt)`

This is the standard function for sending a prompt to the AI and getting a complete response back as a string. You pass in the prompt, you get back the full generated text. It is used when you need the entire response before doing anything with it.

Here is exactly what it does step by step:

1. Reads `active_provider` from settings (e.g. `"ollama"`)
2. Reads the `models` dict from settings and picks the model for that provider (e.g. `"qwen2.5:1.5b"`)
3. Checks whether that provider requires an API key (local providers like Ollama do not; cloud providers like Claude do)
4. If an API key is needed, fetches it from `secret_store`. If it is missing, raises a 400 error telling the user to add a key in Settings
5. Instantiates the provider with the API key
6. Calls `provider.generate(prompt, model=model)` and returns whatever string comes back

If anything goes wrong (network error, model not loaded, bad API key), it raises an HTTP 500 error with the provider's error message.

---

### `llm_stream(prompt)`

This does the same thing as `llm_generate` but instead of waiting for the full response, it yields tokens one by one as they arrive. This is what makes text appear on screen word by word in the UI — the frontend receives each token as it is generated and appends it to what is already shown.

It uses Python's `yield from` which means it passes through every token the provider yields without buffering them. For providers that do not support streaming, it yields the entire response as a single chunk — so the interface still works, it just gets all the text at once.

---

### Overall Flow

1. A module (e.g. MailMind) calls `llm_generate(prompt)` or `llm_stream(prompt)`
2. `llm.py` reads the active provider and model from `settings.json`
3. If the provider needs a key, fetches it from `secret_store`
4. Creates the provider instance and calls its `generate` or `generate_stream` method
5. Returns the result to the module

The module never knows or cares which provider was used. If the user switches from Ollama to Claude in Settings, the exact same module code works with no changes.

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
