# ForgeMind Backend — Codebase Notes

A file-by-file breakdown of every function and the overall flow. Written to help understand the backend fully.

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

Data flow at the highest level:
**User confirms data dir → app stores settings/secrets locally → Gmail auth → emails fetched → LLM processes them → results stored locally**

---

## main.py

The **composition root**. It creates the FastAPI app and registers all routers. It knows nothing about specific modules — it just mounts them.

### Functions

| Function | Description |
|----------|-------------|
| `root()` | GET `/` — health check, returns app name, version, and status |

### Key Lines (not functions but important)

| Line | What it does |
|------|-------------|
| `app = FastAPI(...)` | Creates the FastAPI application |
| `app.add_middleware(CORSMiddleware, ...)` | Allows the frontend (Tauri/browser) to talk to the backend |
| `app.include_router(setup_router)` | Mounts `/api/setup` routes |
| `app.include_router(auth_router)` | Mounts `/api/auth` routes |
| `app.include_router(providers_router)` | Mounts `/api/providers` routes |
| `app.include_router(meta_router)` | Mounts module discovery endpoint |
| `mount_all(app)` | Registers all module routers dynamically |

### Overall Flow
1. App starts
2. CORS middleware added so Tauri frontend can make requests
3. Core routers mounted (setup, auth, providers, meta)
4. All module routers mounted via `mount_all()`
5. App is ready to serve requests

---

## core/config.py

The **path configuration** file. Decides where all app data lives on disk. Nothing else should hardcode paths.

### Functions

| Function | Description |
|----------|-------------|
| `default_data_dir()` | Returns `~/Desktop/forgemind` as the default data directory (falls back to `~/forgemind` if Desktop doesn't exist) |
| `_resolve()` | Reads the bootstrap file (`~/.forgemind-location`) to get the user's chosen data dir. If not set, returns the default |
| `is_first_run()` | Returns `True` if the user has never confirmed a data directory (bootstrap file doesn't exist yet) |
| `set_data_dir(path)` | Creates the data directory on disk, writes its path to the bootstrap file, updates the global `DATA_DIR` variable |

### Key Variables

| Variable | Description |
|----------|-------------|
| `_BOOTSTRAP` | `~/.forgemind-location` — tiny file that stores the chosen data directory path |
| `DATA_DIR` | Module-level variable holding the current data directory path. Updated by `set_data_dir()` |

### Overall Flow
1. On import, `_resolve()` runs and sets `DATA_DIR`
2. If it's not the first run, the data directory is created if it doesn't exist
3. When the user confirms a location via the setup screen, `set_data_dir()` is called — it creates the folder and writes the path to the bootstrap file
4. All other files use `DATA_DIR` to build their paths

---

## core/setup_routes.py

Handles the **first-run setup** flow. The user picks a data directory and the app initialises everything.

### Functions

| Function | Description |
|----------|-------------|
| `setup_status()` | GET `/api/setup/status` — tells the frontend whether it's a first run, what the current data dir is, and what the default would be |
| `set_location(body)` | POST `/api/setup/location` — takes a path, calls `set_data_dir()`, then auto-sets the mailmind `chroma_path` if not already set |

### Overall Flow
1. Frontend calls `GET /api/setup/status` on startup
2. If `first_run: true`, frontend shows setup screen
3. User confirms or changes the path
4. Frontend calls `POST /api/setup/location` with the chosen path
5. Backend creates the data directory and sets the default `chroma_path` for mailmind
6. App is now ready to use

---

## core/settings.py

The **settings store**. Manages all app configuration in a single `settings.json` file inside the data directory. Uses a scoped system so modules don't accidentally overwrite each other's settings.

### Functions

| Function | Description |
|----------|-------------|
| `_deep_merge(base, override)` | Recursively merges two dicts. `override` wins on conflicts. Used so new default keys don't break existing installs |
| `load_all()` | Reads `settings.json` from disk and merges it with global defaults. Returns the full settings dict |
| `save_all(data)` | Writes the full settings dict to `settings.json` |
| `get(key, default)` | Reads a single top-level setting (e.g. `active_provider`) |
| `set_value(key, value)` | Writes a single top-level setting |
| `module_settings(module_id, defaults)` | Factory — creates a `ModuleSettings` instance scoped to a specific module |

### Class: `ModuleSettings`

A scoped settings view for a single module. The module's settings live under `modules.<id>` in `settings.json`.

| Method | Description |
|--------|-------------|
| `__init__(module_id, defaults)` | Stores the module ID and its default settings |
| `load()` | Loads this module's settings merged with its defaults |
| `save(data)` | Saves this module's settings back into the global `settings.json` |
| `get(key, default)` | Reads one key from this module's settings |
| `set(key, value)` | Writes one key to this module's settings |

### Overall Flow
- `settings.json` is a single file with this structure:
```json
{
  "active_provider": "ollama",
  "models": { ... },
  "modules": {
    "mailmind": { "chroma_path": "...", ... }
  }
}
```
- Global settings (provider, models) live at the top level
- Module settings live under `modules.<id>`
- Every read merges defaults so new keys added in future versions work automatically

---

## core/secret_store.py

Stores **API keys and sensitive values** encrypted on disk. Uses Fernet symmetric encryption. Falls back to plaintext with a warning if the `cryptography` package isn't installed.

### Functions

| Function | Description |
|----------|-------------|
| `_keys_enc()` | Returns path to `keys.enc` — the encrypted keys file |
| `_keys_plain()` | Returns path to `keys.json` — used only if encryption unavailable |
| `_master_key()` | Returns path to `master.key` — the encryption key file |
| `_have_crypto()` | Returns `True` if the `cryptography` package is installed |
| `_get_fernet()` | Gets the Fernet encryption object. Creates `master.key` if it doesn't exist yet. Sets file permissions to owner-only (chmod 600) |
| `load_keys()` | Loads and decrypts all stored keys. Falls back to plaintext if needed |
| `_write_keys(keys)` | Encrypts and writes all keys to disk. Deletes plaintext file if switching to encrypted. Sets chmod 600 |
| `save_key(name, value)` | Saves a single key by name (e.g. `"claude"` → `"sk-ant-..."`) |
| `delete_key(name)` | Removes a key by name |
| `get_key(name)` | Returns a single key by name, or `None` if not found |

### Overall Flow
1. When user adds an API key in settings, `save_key("claude", "sk-ant-...")` is called
2. All existing keys are loaded, the new one is added, and the whole dict is re-encrypted and written
3. When the LLM needs an API key, it calls `get_key("claude")` which decrypts and returns it
4. All key files are chmod 600 — only the OS user can read them

---

## core/llm.py

The **LLM dispatch layer**. Every module calls this to talk to an AI model. Modules never import providers directly — they go through here. This keeps the provider completely swappable.

### Functions

| Function | Description |
|----------|-------------|
| `_provider_class(pid)` | Looks up the provider class by ID (e.g. `"claude"`) from the provider registry. Raises 500 if unknown |
| `llm_generate(prompt)` | Sends a prompt to the active provider and returns the full response as a string |
| `llm_stream(prompt)` | Sends a prompt and yields response tokens one by one (streaming). Falls back to a single chunk for providers that don't support streaming |

### Overall Flow
1. Module calls `llm_generate(prompt)` or `llm_stream(prompt)`
2. `llm.py` reads the active provider from settings (e.g. `"ollama"`)
3. Gets the model for that provider (e.g. `"qwen2.5:1.5b"`)
4. If the provider needs an API key, fetches it from `secret_store`
5. Instantiates the provider and calls `generate()` or `generate_stream()`
6. Returns the result to the module

### Why this design?
Modules don't need to know which AI provider is active. If the user switches from Ollama to Claude, no module code changes — only `settings.json` changes.

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
