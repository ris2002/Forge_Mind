# ForgeMind Backend — Codebase Notes

A file-by-file breakdown of every function with full explanations, internal call chains, and what frontend action triggers each one.

---

## Overall App Working — Big Picture

Before reading individual files, understand how the whole app works end to end.

```
┌─────────────────────────────────────────────────────────────┐
│                    TAURI DESKTOP WINDOW                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              REACT FRONTEND (Vite)                    │  │
│  │  App.jsx → decides which page to show                 │  │
│  │    ↓                                                  │  │
│  │  LocationPicker → Setup wizard → Shell (main UI)      │  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │  HTTP requests to localhost:8000     │
└───────────────────────┼─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              FASTAPI BACKEND (Python)                        │
│                                                             │
│  main.py  →  mounts all routers                             │
│                                                             │
│  core/          →  config, settings, secrets, LLM dispatch  │
│  auth/          →  Gmail OAuth2                             │
│  providers/     →  Ollama, Claude, OpenAI, Gemini           │
│  modules/       →  module registry                          │
│    mailmind/    →  all email AI logic                       │
│                                                             │
│  Data on disk:                                              │
│    ~/Desktop/forgemind/                                     │
│      settings.json      ← all app + module settings         │
│      keys.enc           ← encrypted API keys + Gmail token  │
│      master.key         ← Fernet encryption key             │
│      client_secret.json ← Gmail OAuth credential            │
│      mailmind_emails.json ← all cached emails               │
│      mailmind_blocklist.json ← blocked senders              │
│      chromadb/MailMind/ ← vector embeddings                 │
└─────────────────────────────────────────────────────────────┘
```

### App startup sequence

1. Tauri launches the Python backend as a sidecar process
2. Python starts uvicorn on `127.0.0.1:8000`
3. React frontend loads in the Tauri webview
4. `App.jsx` calls `GET /api/setup/status`
5. If first run → show `LocationPicker` → user confirms workspace folder
6. Then → show Setup wizard (provider, Gmail, hours, profile)
7. Then → show main Shell with MailMind

### Request flow for every action

```
User clicks something in UI
      ↓
Frontend API function called (e.g. mailmindApi.fetchInbox())
      ↓
HTTP request sent to backend (e.g. POST /api/modules/mailmind/emails/fetch)
      ↓
FastAPI route handler in routes.py
      ↓
Service function in service.py (business logic)
      ↓
Reads/writes: Gmail API | LLM | store.py | chroma.py
      ↓
JSON response returned to frontend
      ↓
React state updated → UI re-renders
```

---

## main.py

The **entry point**. Creates the FastAPI app, adds CORS middleware, and mounts all routers. It knows nothing about specific modules.

---

### `root()`

**Route:** `GET /`

**Triggered by:** Nothing in normal app flow. Manual health check only.

**Calls internally:** Nothing.

Returns the app name, version, and `"running"` status. Used to confirm the backend is alive.

---

### Key lines

**`app = FastAPI(...)`** — Creates the FastAPI application instance that everything attaches to.

**`app.add_middleware(CORSMiddleware, ...)`** — Without this, the browser blocks every request from the frontend to the backend because they run on different ports. This middleware tells the browser to allow requests from the listed origins (localhost:5173, Tauri webview URLs).

**`app.include_router(...)`** — Attaches each router's endpoints to the app. Four calls: setup, auth, providers, meta.

**`mount_all(app)`** — Reads the module registry and attaches every module's router automatically. Adding a new module never requires touching main.py.

---

## core/config.py

Manages **where all app data lives on disk**. Every other file imports `DATA_DIR` from here instead of hardcoding paths.

---

### `default_data_dir()`

**Triggered by:** Two places — `_resolve()` at import time as fallback, and `setup_status()` to pre-fill the location picker input.

**Calls internally:** Nothing. Uses `Path.home()` and `Path.exists()`.

Returns `~/Desktop/forgemind` if Desktop exists, otherwise `~/forgemind`. Does not create anything — only computes the path.

---

### `_resolve()`

**Triggered by:** Automatically at import time to set the initial `DATA_DIR`. Never called again.

**Calls internally:** `default_data_dir()` — only if `~/.forgemind-location` does not exist.

Checks if `~/.forgemind-location` exists. If yes, reads and returns the saved path. If no, returns `default_data_dir()`. Sets the initial value of `DATA_DIR`.

---

### `is_first_run()`

**Triggered by:** `GET /api/setup/status` on every app start. Also called at the bottom of config.py at import time.

**Calls internally:** Nothing. Just checks `Path.exists()` on `~/.forgemind-location`.

Returns `True` if the bootstrap file does not exist (never set up), `False` if it does.

---

### `set_data_dir(path)`

**Triggered by:** `POST /api/setup/location` when the user clicks "Create my workspace" in `LocationPicker.jsx`.

**Calls internally:** `Path.mkdir()` and `Path.write_text()` — Python built-ins, nothing from this codebase.

Does three things in order:
1. Creates the workspace folder with `mkdir(parents=True, exist_ok=True)`
2. Writes the path to `~/.forgemind-location` so it survives restarts
3. Updates the global `DATA_DIR` variable in memory so the rest of the app uses it immediately

---

### Key Variables

**`_BOOTSTRAP`** — `~/.forgemind-location`. The only file ForgeMind writes outside the workspace.

**`DATA_DIR`** — The current workspace path. Set at import time by `_resolve()`, updated by `set_data_dir()`. Every other file uses this to build their paths.

---

## core/setup_routes.py

Two API endpoints for the **first-run flow**.

---

### `setup_status()`

**Route:** `GET /api/setup/status`

**Triggered by:** `App.jsx` calls this on every app startup to decide which page to show.

**Calls internally:**
- `config.is_first_run()` — checks bootstrap file existence
- `config.default_data_dir()` — for the `default_dir` field in response

Returns `{ first_run, data_dir, default_dir }`. Frontend uses `first_run` to decide: `true` → show LocationPicker, `false` → check Gmail auth.

---

### `set_location(body)`

**Route:** `POST /api/setup/location`

**Triggered by:** `LocationPicker.jsx` calls this when user clicks "Create my workspace →".

**Calls internally:**
- `config.set_data_dir(path)` — creates folder, saves bootstrap, updates DATA_DIR
- `mailmind_settings.load()` — checks if `chroma_path` is already set
- `mailmind_settings.save(s)` — saves default `chroma_path` if not already set

Creates the workspace folder, then auto-sets MailMind's ChromaDB path to `<workspace>/chromadb/MailMind` if not already configured. This happens here because the workspace location was just confirmed — only now is there a known place to put ChromaDB.

---

## core/settings.py

All app configuration in a **single `settings.json`** file. Scoped system keeps global and module settings separated.

---

### `_deep_merge(base, override)`

**Triggered by:** Called inside `load_all()` and `ModuleSettings.load()` — never from outside this file.

**Calls internally:** Itself recursively when nested dicts are found.

Merges two dicts where `override` wins on conflicts. Nested dicts are merged recursively instead of replaced. This is how the app always has complete settings even when `settings.json` only stores the user's changes from defaults.

---

### `load_all()`

**Triggered by:** On every single settings read anywhere in the app — every LLM call, every route that needs settings, every module settings read or write.

**Calls internally:** `_deep_merge(GLOBAL_DEFAULTS, stored)`.

Reads `settings.json` from disk, merges with `GLOBAL_DEFAULTS`, returns the full dict. If the file does not exist or is corrupt, returns just the defaults. Always reads fresh from disk — no caching.

---

### `save_all(data)`

**Triggered by:** `set_value()` and `ModuleSettings.save()` after updating their sections.

**Calls internally:** Nothing. Just `json.dumps()` and `Path.write_text()`.

Overwrites `settings.json` with the full settings dict. The only function that writes to this file.

---

### `get(key, default)`

**Triggered by:** `llm.py` on every LLM call to read `active_provider` and `models`. Provider routes. Daemon to read work hours.

**Calls internally:** `load_all()`.

Reads one top-level global setting by key.

---

### `set_value(key, value)`

**Triggered by:** Provider routes when user switches provider or changes a model in Settings.

**Calls internally:** `load_all()` then `save_all(data)`.

Writes one top-level global setting. Loads full file, updates the one key, saves everything back.

---

### `module_settings(module_id, defaults)`

**Triggered by:** Each module calls this once at import time (e.g. `modules/mailmind/settings.py`).

**Calls internally:** Creates and returns a `ModuleSettings` instance. No file reads.

Factory that creates a scoped settings object for a module.

---

### Class: `ModuleSettings`

Scoped settings view for one module. Module settings live under `modules.<id>` in `settings.json`.

---

#### `load()`

**Triggered by:** Any time a module reads its settings — opening Settings UI, before LLM calls that need user_name/work_hours, checking chroma_path.

**Calls internally:** `load_all()` then `_deep_merge(self.defaults, stored)`.

Reads `settings.json`, extracts `modules.<id>`, merges with module defaults. Returns just this module's settings.

---

#### `save(data)`

**Triggered by:** When user saves settings in UI (`POST /api/modules/mailmind/settings`). Also by `set_location()` to save default chroma_path. And by `_save_history_id()` to persist the Gmail historyId.

**Calls internally:** `load_all()` then `save_all(all_settings)`.

Loads full file, updates only `modules.<id>`, writes full file back. Other modules and global settings untouched.

---

#### `get(key, default)` and `set(key, value)`

Convenience wrappers. `get` calls `self.load()`. `set` calls `self.load()` then `self.save()`.

---

## core/secret_store.py

**Encrypted storage for API keys and the Gmail OAuth token**. Uses Fernet symmetric encryption. Gracefully falls back to plaintext if the `cryptography` package is not installed.

---

### `_keys_enc()`, `_keys_plain()`, `_master_key()`

**Triggered by:** Called inside `load_keys()`, `_write_keys()`, `_get_fernet()` to get file paths.

**Calls internally:** Nothing. Return `config.DATA_DIR / <filename>`.

These are functions (not variables) because `DATA_DIR` can change at runtime when the user sets a workspace location. Computing paths at call time ensures they always point to the right place.

---

### `_have_crypto()`

**Triggered by:** First check inside `load_keys()` and `_write_keys()` to decide encrypt vs plaintext path.

**Calls internally:** Nothing. Attempts to import `cryptography`, returns `True` or `False`.

---

### `_get_fernet()`

**Triggered by:** `load_keys()` when decrypting. `_write_keys()` when encrypting. Only called if `_have_crypto()` is True.

**Calls internally:**
- `_master_key()` — to get the key file path
- `Fernet.generate_key()` — only on first ever use to create the key
- `os.chmod()` — sets file to owner-only (600)

Creates and returns the Fernet encryption object. On first ever use, generates a random 32-byte key and writes it to `master.key` with `chmod 600`. After that, just reads the existing key and creates the Fernet object.

---

### `load_keys()`

**Triggered by:** `get_key()`, `save_key()`, `delete_key()` — so effectively every time an API key is read or written. Also indirectly by `llm.py` through `get_key()` before every cloud LLM request.

**Calls internally:** `_have_crypto()`, `_keys_enc()`, `_get_fernet()`, `_keys_plain()`.

Decrypts `keys.enc` and returns all stored keys as a plain dict like `{ "claude": "sk-ant-...", "openai": "sk-..." }`. Falls back to `keys.json` if not encrypted. Returns empty dict if nothing exists.

---

### `_write_keys(keys)`

**Triggered by:** `save_key()` and `delete_key()` after modifying the keys dict.

**Calls internally:** `_have_crypto()`, `_get_fernet()`, `_keys_enc()`, `_keys_plain()`, `os.chmod()`.

Encrypts the full keys dict and writes to `keys.enc`. Deletes `keys.json` if switching from plaintext to encrypted. Sets `chmod 600` on the written file. Always writes the complete dict — never just one key.

---

### `save_key(name, value)`

**Triggered by:** User saves an API key in Settings (`POST /api/providers/key`). Also in the Setup wizard when finishing first-run.

**Calls internally:** `load_keys()` → modify dict → `_write_keys(keys)`.

---

### `delete_key(name)`

**Triggered by:** User removes an API key in Settings (`DELETE /api/providers/key/<id>`).

**Calls internally:** `load_keys()` → remove entry → `_write_keys(keys)`.

---

### `get_key(name)`

**Triggered by:** `llm.py` before every cloud provider request. `providers/routes.py` to check if a key exists.

**Calls internally:** `load_keys()` — decrypts and returns dict, picks out the one key.

Returns the key value or `None`.

---

## core/llm.py

**Single entry point for all AI calls**. Every module goes through here. Never import a specific provider directly in a module — always use this.

---

### `_provider_class(pid)`

**Triggered by:** `llm_generate()` and `llm_stream()` internally.

**Calls internally:** Imports `PROVIDERS` from `providers/__init__.py`.

Looks up the provider class by ID. If the ID is not in the registry, raises HTTP 500.

---

### `llm_generate(prompt)`

**Triggered by:** Modules needing a complete response — `summarise()`, `draft_reply()`, `draft_compose()`, `summarise_contacts()`.

**Calls internally:**
- `app_settings.get("active_provider")` — which provider is selected
- `app_settings.get("models")` — which model for that provider
- `_provider_class(pid)` — checks `requires_api_key`
- `secret_store.get_key(pid)` — fetches API key if needed
- `get_provider(pid, api_key=api_key)` — creates provider instance
- `provider.generate(prompt, model=model)` — sends the request

Sends a prompt, waits for the full response, returns it as a string. If the provider needs a key and it is missing, raises HTTP 400.

---

### `llm_stream(prompt)`

**Triggered by:** Modules that stream responses token by token — `summarise_stream()` so the UI shows text appearing live.

**Calls internally:** Same as `llm_generate` but calls `provider.generate_stream()` instead of `provider.generate()`.

Yields tokens one by one using `yield from`. Providers that don't support streaming yield the full response as a single chunk.

---

## auth/gmail.py

All **Gmail OAuth2 and Gmail API operations**. This is the only file that talks to Google.

---

### `_client_secret_file()`

**Triggered by:** `_make_flow()` when building the OAuth flow.

**Calls internally:** `config.DATA_DIR` — function not variable, so it always uses the current workspace path.

Returns the path to `client_secret.json` inside the workspace folder. This file must be downloaded by the user from Google Cloud Console.

---

### `_load_credentials()`

**Triggered by:** `is_authenticated()` and `get_gmail_service()` on every operation that needs Gmail access.

**Calls internally:**
- `secret_store.get_key(_TOKEN_KEY)` — loads the saved OAuth token JSON
- `creds.refresh(Request())` — auto-refreshes the token if expired, saves the refreshed version

Loads the saved Gmail OAuth token from encrypted storage. If the token is expired but has a refresh token, automatically refreshes it and saves the new one. Returns `None` if not authenticated or if anything fails.

---

### `_save_credentials(creds)`

**Triggered by:** `handle_callback()` after the user completes the OAuth flow. Also by `_load_credentials()` after a token refresh.

**Calls internally:** `secret_store.save_key(_TOKEN_KEY, creds.to_json())`.

Serialises the OAuth credentials to JSON and saves them to encrypted storage under the key `"gmail_oauth_token"`.

---

### `_make_flow()`

**Triggered by:** `get_auth_url()` when the user initiates the Gmail sign-in.

**Calls internally:** `_client_secret_file()` — to locate `client_secret.json`.

Creates a Google OAuth2 `Flow` object from `client_secret.json`. Raises `RuntimeError` if the file does not exist, with a clear message explaining where to get it.

---

### `get_auth_url()`

**Triggered by:** `GET /api/auth/gmail/login` when user clicks "Sign in with Google" in the Setup wizard.

**Calls internally:** `_make_flow()` — creates and stores the flow in `_pending_flow`.

Creates the OAuth flow, stores it in a module-level variable `_pending_flow`, generates and returns the Google sign-in URL. The flow must be kept alive because `handle_callback()` needs to reuse the same object to exchange the code for a token. This is the fix for the PKCE `invalid_grant: Missing code verifier` bug.

---

### `handle_callback(code)`

**Triggered by:** `GET /api/auth/gmail/callback` when Google redirects back after the user signs in. This is a browser redirect — not called by the frontend directly.

**Calls internally:**
- `_pending_flow.fetch_token(code=code)` — exchanges the auth code for access + refresh tokens
- `_save_credentials(_pending_flow.credentials)` — saves tokens to encrypted storage

Completes the OAuth handshake. Uses the same `_pending_flow` object that `get_auth_url()` created — this is critical because the PKCE code verifier is stored inside that flow object. Clears `_pending_flow` after use.

---

### `is_authenticated()`

**Triggered by:** `GET /api/auth/status` — called by `App.jsx` on startup to decide whether to show the Setup wizard or the main Shell.

**Calls internally:** `_load_credentials()` — returns `True` if credentials load successfully.

---

### `get_gmail_service()`

**Triggered by:** Every function in `service.py` that needs to talk to Gmail — `fetch_inbox()`, `check_new_emails()`, `send_reply()`, `send_compose()`, `delete_contact_emails()`.

**Calls internally:** `_load_credentials()` — raises `RuntimeError` if not authenticated.

Creates and returns a Google API client for Gmail v1. This is the object that all Gmail API calls are made on.

---

### `clear_creds()`

**Triggered by:** `POST /api/auth/signout` when the user clicks sign out.

**Calls internally:** `secret_store.delete_key(_TOKEN_KEY)`.

Deletes the Gmail OAuth token from encrypted storage. The user will need to sign in again.

---

### `trash_message(message_id)`

**Triggered by:** `service.delete_contact_emails()` when `trash_in_gmail=True`.

**Calls internally:** `get_gmail_service()` then calls Gmail API `users.messages.trash`.

Moves one Gmail message to trash (recoverable for 30 days). Does not permanently delete.

---

### `send_mail(to_addr, subject, body, cc, in_reply_to, thread_id)`

**Triggered by:** `service.send_reply()` and `service.send_compose()`.

**Calls internally:** `get_gmail_service()` then calls Gmail API `users.messages.send`.

Constructs a MIME email, base64-encodes it, sends via Gmail API. When `in_reply_to` is provided, sets `In-Reply-To` and `References` headers so Gmail threads the reply correctly. When `thread_id` is provided, Gmail keeps it in the same thread.

---

## auth/routes.py

Four HTTP endpoints for **authentication**.

---

### `auth_status()`

**Route:** `GET /api/auth/status`

**Triggered by:** `App.jsx` on startup after the setup check, to decide whether to show Setup wizard or main Shell.

**Calls internally:** `gmail.is_authenticated()`.

---

### `gmail_login()`

**Route:** `GET /api/auth/gmail/login`

**Triggered by:** User clicks "Sign in with Google" button in the Setup wizard (`Setup.jsx → connectGmail()`).

**Calls internally:** `gmail.get_auth_url()`.

Returns the Google OAuth URL. The frontend opens this in the system browser (not the webview, because Google blocks OAuth in embedded webviews).

---

### `gmail_callback(code, error)`

**Route:** `GET /api/auth/gmail/callback`

**Triggered by:** Google redirects the browser here after the user completes sign-in. Not called by the frontend directly.

**Calls internally:** `gmail.handle_callback(code)`.

Completes the OAuth flow. Returns an HTML page with a success or error message. On success, the page auto-closes after 1.5 seconds. The frontend polls `GET /api/auth/status` every 2 seconds and detects the change.

---

### `signout()`

**Route:** `POST /api/auth/signout`

**Triggered by:** User clicks sign out (`App.jsx → handleSignOut()`).

**Calls internally:** `gmail.clear_creds()`.

Deletes only the Gmail OAuth token. All other data (API keys, emails, settings) is preserved.

---

### `_page(title, body, ok)`

**Triggered by:** `gmail_callback()` internally to build the HTML response page.

**Calls internally:** Nothing. Returns a formatted HTML string.

---

## providers/base.py

**Abstract base class** that every LLM provider must implement.

---

### `clean_llm_output(text)`

**Triggered by:** Each provider's `generate()` method after getting a response.

**Calls internally:** `re.sub()` — strips `<think>...</think>` blocks that some models (like DeepSeek, Qwen) emit as reasoning traces before their actual answer.

---

### Class: `BaseProvider`

Defines the interface every provider must follow.

**Class attributes:**
- `id` — string ID used in settings (e.g. `"ollama"`)
- `display_name` — shown in the UI
- `requires_api_key` — `True` for cloud providers, `False` for Ollama
- `is_local` — `True` for Ollama only

**`generate(prompt, model)`** — Abstract. Must return the full response as a string.

**`generate_stream(prompt, model)`** — Default implementation just calls `generate()` and yields it as one chunk. Providers that support real streaming override this.

**`test(api_key)`** — Abstract. Validates the API key and returns `(True/False, message)`.

**`list_models(api_key)`** — Abstract. Returns available models as `[{ name, label }]`.

---

## providers/__init__.py

**Provider registry**. Maps provider ID strings to their classes.

---

### `get_provider(provider_id, api_key)`

**Triggered by:** `llm.py → llm_generate()` and `llm_stream()` to instantiate the active provider.

**Calls internally:** Instantiates the provider class — passes `api_key` if `requires_api_key`, otherwise instantiates with no arguments.

Looks up the provider class from `PROVIDERS` dict and creates an instance.

---

### `PROVIDERS` dict

```python
{
  "ollama": OllamaProvider,
  "claude": ClaudeProvider,
  "openai": OpenAIProvider,
  "gemini": GeminiProvider,
}
```

To add a new provider: create a class, import it here, add it to this dict, and add a default model to `GLOBAL_DEFAULTS["models"]` in `settings.py`.

---

## providers/ollama.py, claude.py, openai.py, gemini.py

Each file is one provider implementing `BaseProvider`. They all follow the same pattern.

---

### `generate(prompt, model)` — all providers

**Triggered by:** `llm_generate()` in `core/llm.py`.

**Calls internally:** `clean_llm_output()` from `base.py` on the response. Makes an HTTP request to the provider's API.

Sends the prompt to the provider's API and returns the response text.

| Provider | API URL | Auth |
|----------|---------|------|
| Ollama | `http://localhost:11434/api/generate` | None (local) |
| Claude | `https://api.anthropic.com/v1/messages` | `x-api-key` header |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer` header |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models/...` | `?key=` query param |

---

### `generate_stream(prompt, model)` — Ollama only

**Triggered by:** `llm_stream()` in `core/llm.py`.

Ollama is the only provider with real streaming implemented. It calls the Ollama API with `stream=True` and yields each token as it arrives by reading the response line by line. Claude, OpenAI, and Gemini fall back to the base class implementation which yields the full response as one chunk.

---

### `test(api_key)` — all providers

**Triggered by:** `POST /api/providers/test` when user clicks "Test" on an API key in the Setup wizard or Settings.

Makes a minimal API call to verify the key works. Returns `(True, "Key is valid")` or `(False, "error message")`.

---

### `list_models(api_key)` — all providers

**Triggered by:** `GET /api/providers/<id>/models` when the provider card expands in the UI.

Ollama queries `http://localhost:11434/api/tags` to get actually installed models. Claude, OpenAI, and Gemini return hardcoded `DEFAULT_MODELS` lists — they don't call the API for this.

---

## providers/routes.py

API endpoints for **provider management**.

---

### `list_providers()`

**Route:** `GET /api/providers`

**Triggered by:** Setup wizard and Settings page load to show all providers and their state.

**Calls internally:** `secret_store.load_keys()`, `app_settings.get("active_provider")`, `app_settings.get("models")`.

Returns all providers with their configuration state: whether they have a key, whether they are active, what model is selected.

---

### `provider_models(provider_id)`

**Route:** `GET /api/providers/<id>/models`

**Triggered by:** When a provider card is selected/expanded in Setup or Settings.

**Calls internally:** `secret_store.get_key(provider_id)`, `get_provider()`, `provider.list_models()`.

---

### `set_provider_key(body)`

**Route:** `POST /api/providers/key`

**Triggered by:** User saves an API key in Setup wizard or Settings.

**Calls internally:** `secret_store.save_key(body.provider_id, body.api_key)`.

---

### `remove_provider_key(provider_id)`

**Route:** `DELETE /api/providers/key/<id>`

**Triggered by:** User removes an API key in Settings.

**Calls internally:** `secret_store.delete_key(provider_id)`.

---

### `test_provider(body)`

**Route:** `POST /api/providers/test`

**Triggered by:** User clicks "Test" button next to an API key.

**Calls internally:** `get_provider()`, `provider.test(api_key)`.

---

### `set_active_provider(body)`

**Route:** `POST /api/providers/active`

**Triggered by:** User selects a provider in Setup wizard finish (`finish()`) or Settings.

**Calls internally:** `secret_store.get_key()` — checks key exists before activating. `app_settings.set_value("active_provider", ...)`.

Will refuse to activate a cloud provider if no API key is saved for it.

---

### `set_provider_model(body)`

**Route:** `POST /api/providers/model`

**Triggered by:** User changes the model dropdown in Setup or Settings.

**Calls internally:** `app_settings.get("models")`, `app_settings.set_value("models", ...)`.

---

## modules/__init__.py

**Module registry**. All modules register here. `main.py` calls `mount_all()` from here.

---

### `mount_all(app)`

**Triggered by:** `main.py` at startup.

**Calls internally:** `app.include_router(m["router"])` for each module in `REGISTRY`.

Loops through `REGISTRY` and mounts each module's router on the FastAPI app. Adding a new module only requires importing it and adding it to `REGISTRY` — `main.py` is untouched.

---

### `list_modules()`

**Route:** `GET /api/modules`

**Triggered by:** Frontend module registry (`registry.jsx`) on app load to discover which modules exist.

**Calls internally:** Nothing. Just filters the `router` key out of each manifest (routers are not JSON-serialisable) and returns the rest.

---

## modules/mailmind/__init__.py

Exports the **MailMind manifest** — the dict that registers this module with the app.

```python
manifest = {
    "id": "mailmind",
    "name": "MailMind",
    "description": "Inbox triage with AI summaries and reply drafts",
    "router": router,   ← the FastAPI router from routes.py
}
```

---

## modules/mailmind/settings.py

Defines **MailMind's default settings** and creates its scoped settings object.

```python
DEFAULTS = {
    "user_name": "Your Name",
    "user_title": "Your Title",
    "work_start": "09:00",
    "work_end": "18:00",
    "check_interval": 30,
    "chroma_path": "",       ← set by set_location() on first run
    "system_prompt": "",     ← custom writing instructions from Settings
}
settings = module_settings("mailmind", DEFAULTS)
```

`settings` is a `ModuleSettings` instance used throughout `service.py` and `setup_routes.py`. Any module file that needs MailMind settings imports `settings` from here.

---

## modules/mailmind/store.py

**File-backed persistence** for emails and the blocklist. All file paths are computed at call time so they follow `DATA_DIR`.

---

### `_email_store_file()`, `_blocklist_file()`, `_email_lock()`

Path helpers computed at call time. `_email_lock()` returns a `FileLock` — a cross-process mutex that prevents two threads from reading/writing `mailmind_emails.json` simultaneously.

---

### `load_emails()`

**Triggered by:** Almost every function in `service.py` — listing, fetching, summarising, flagging, replying, blocking, contacts.

**Calls internally:** `_email_lock()`, `_email_store_file()`.

Acquires the file lock, reads `mailmind_emails.json`, returns it as a dict keyed by email ID. Returns empty dict if file does not exist or is corrupted. The file lock ensures no two simultaneous operations corrupt the file.

---

### `save_emails(store)`

**Triggered by:** After any operation that modifies emails — fetch, summarise, flag, dismiss, block, reply, compose.

**Calls internally:** `_email_lock()`, `_email_store_file()`.

Acquires the file lock and writes the full emails dict as formatted JSON. Always writes the complete dict.

---

### `load_blocklist()` and `save_blocklist(bl)`

**Triggered by:** `block_sender()`, `is_blocked()`, `add_to_blocklist()`, `remove_from_blocklist()`, `get_blocklist()`.

**Calls internally:** `_blocklist_file()`.

No file lock on the blocklist — it is only written by explicit user actions (not background threads), so contention is not a concern.

---

### `is_blocked(sender_email, sender_name)`

**Triggered by:** `fetch_inbox()` for every email being imported, to skip blocked senders before storing.

**Calls internally:** `load_blocklist()`.

Checks if any blocklist entry appears in the combined `sender_email + sender_name` string. Case-insensitive substring match.

---

### `is_promo(sender, subject)`

**Triggered by:** `fetch_inbox()` for every email being imported, to skip promotional emails before storing.

**Calls internally:** Nothing. Checks against the hardcoded `PROMO_KEYWORDS` list.

Checks if any promo keyword (e.g. `"noreply"`, `"newsletter"`, `"unsubscribe"`) appears in the combined sender + subject string.

---

## modules/mailmind/parsing.py

**Pure parsing functions**. No I/O, no state, no side effects. Takes raw email data and returns clean data.

---

### `format_email_time(date_str)`

**Triggered by:** `fetch_inbox()` for each email to produce the human-readable time shown in the inbox list.

Formats an RFC 2822 date string into a human-readable time. Today's emails show `HH:MM`, this year shows `DD Mon · HH:MM`, older shows `DD Mon YYYY`.

---

### `parse_date(date_str)`

**Triggered by:** `list_emails()` for date range filtering. `list_contacts()` to sort by most recent. `_time_key()` for sorting.

Parses an RFC 2822 date string into a `datetime` object. Returns `None` on failure.

---

### `decode_mime_header(header)`

**Triggered by:** `fetch_inbox()` for every email's Subject and From headers.

Decodes MIME-encoded email headers (e.g. `=?UTF-8?B?...?=` encoded subjects) into plain Unicode strings.

---

### `clean_html(html)`

**Triggered by:** `extract_body()` when an email has only an HTML part.

Strips style/script/head tags, converts block elements to newlines, decodes HTML entities. Returns clean plain text.

---

### `extract_body(msg)`

**Triggered by:** `fetch_inbox()` for every email to get the text content.

**Calls internally:** `clean_html()` when falling back to the HTML part.

Walks the MIME structure of an email. Tries to get `text/plain` first. Falls back to `text/html` if no plain text part exists. Skips attachments.

---

### `normalize_subject(subject)`

**Triggered by:** `fetch_inbox()` when storing `thread_subject`. Used throughout `service.py` for thread grouping.

Strips `Re:`, `Fwd:`, `Fw:`, `Aw:`, `Sv:` prefixes from a subject and lowercases it. This is how threads are grouped — `"Re: Meeting"` and `"Meeting"` get the same `thread_subject` so they are treated as one conversation.

---

### `extract_sender_name(sender_full)`

**Triggered by:** `extract_real_name()`.

Extracts the display name from a full sender string like `"John Smith <john@example.com>"`. Returns the part before the `<`.

---

### `extract_real_name(sender_full)`

**Triggered by:** `fetch_inbox()` for every email to get the sender's display name and first name.

**Calls internally:** `extract_sender_name()`.

Returns `(display_name, first_name)`. The first name is used in reply prompts (`"Hi {first_name}"`). Handles edge cases: titles (Dr, Mr, Mrs), single-word names, garbled addresses.

---

## modules/mailmind/prompts.py

**Prompt templates** for all AI operations. Optimised for small local models — short, direct, no ambiguity.

---

### `_rules(system_prompt, for_reply)`

**Triggered by:** `reply_prompt()` and `compose_prompt()` internally.

Builds the numbered rules block included in every reply/compose prompt. Three baseline rules always included. A fourth is added for replies (match sender's style). The user's custom `system_prompt` from Settings becomes rule 5 if set.

---

### `summary_prompt(sender, subject, body, user_name)`

**Triggered by:** `service.summarise()` and `service.summarise_stream()` for non-flagged emails.

Builds a prompt asking the LLM to summarise one email covering four points: what it is about, any requests/instructions, any dates/amounts, what the user needs to do next. Body is capped at 1500 chars.

---

### `conversation_summary_prompt(sender, thread_emails, user_name)`

**Triggered by:** `service.summarise_stream()` for flagged emails.

Builds a prompt for summarising a full thread (both incoming and sent). Takes the last 4 emails of the thread, each capped at 300 chars. The 4-email cap is intentional — small models lose track of who said what beyond that.

---

### `reply_prompt(user_name, user_title, sender_first, subject, context, user_intent, thread_context, system_prompt)`

**Triggered by:** `service.draft_reply()`.

**Calls internally:** `_rules(system_prompt, for_reply=True)`.

Builds a reply draft prompt. Ends with `"Hi {sender_first},"` — output priming so the model continues the email rather than deciding what format to use. Context is capped at 800 chars. Thread context from ChromaDB is appended if available.

---

### `contact_emails_prompt(sender, emails, user_name)`

**Triggered by:** `service.summarise_contacts()`.

Builds a prompt for bulk-summarising all emails from one sender. Uses the last 6 emails, each capped at 400 chars. Total cap 2000 chars.

---

### `compose_prompt(user_name, user_title, to_name, subject, user_intent, system_prompt)`

**Triggered by:** `service.draft_compose()`.

**Calls internally:** `_rules(system_prompt, for_reply=False)`.

Builds a new email compose prompt. Same structure as reply but without thread context or matching-sender-style rule.

---

## modules/mailmind/chroma.py

**Optional vector store** for flagged email context. Fails silently if `chromadb` is not installed.

---

### `_safe_resolve(chroma_path)`

**Triggered by:** `_get_collection()` before opening ChromaDB.

**Calls internally:** `Path.expanduser().resolve()`.

Resolves the path and checks it against `_BLOCKED_PREFIXES` (`/etc`, `/sys`, `/proc`, `/dev`, `/usr`, `/bin`, `/sbin`, `/boot`). Returns `None` if the path points to a system directory. This is a security check because `chroma_path` comes from user settings which can be manually edited.

---

### `_get_collection(chroma_path)`

**Triggered by:** `embed_email()`, `delete_embedding()`, `query_similar()`.

**Calls internally:** `_safe_resolve()`, then `chromadb.PersistentClient()` and `client.get_or_create_collection()`.

Lazy-imports `chromadb` so the module loads even without it installed. Creates the workspace folder if needed. Opens the ChromaDB collection `"email_threads"` with cosine similarity space. Returns `None` if anything fails — all callers handle `None` gracefully.

---

### `embed_email(email_data, chroma_path)`

**Triggered by:** `service.summarise_stream()` after generating a flagged email's summary. Also by `_background_resurface()` after background re-summarisation.

**Calls internally:** `_get_collection(chroma_path)`.

Stores a document in ChromaDB representing the flagged email. The document is a formatted string of sender, subject, summary, and body excerpt. Uses `upsert` so re-embedding an existing email updates it rather than duplicating it.

---

### `delete_embedding(email_id, chroma_path)`

**Triggered by:** `service.toggle_flag()` when unflagging. `service.dismiss()` when dismissing a flagged email. `service.block_sender()` for all emails from that sender. `service.delete_contact_emails()`.

**Calls internally:** `_get_collection(chroma_path)`.

Removes one email's embedding from ChromaDB by ID.

---

### `query_similar(sender, subject, chroma_path, n)`

**Triggered by:** `service.draft_reply()` for flagged emails to add thread context to the reply prompt.

**Calls internally:** `_get_collection(chroma_path)`.

Queries ChromaDB for the `n` most similar past emails to the given sender+subject. Returns a formatted string of matching documents prefixed with `"\n\nPast context from similar emails:\n"`. Returns empty string if nothing found or ChromaDB unavailable.

---

## modules/mailmind/routes.py

**Thin HTTP layer** for MailMind. Each route just validates the request and delegates to `service.py`. No business logic here.

Routes are grouped into: emails, reply, compose, contacts, blocklist, daemon, settings. See the API surface table in README.md for the full list.

The only route with logic beyond delegation is `summarise_stream` — it checks the email exists before starting the stream, then returns a `StreamingResponse` which calls `service.summarise_stream()` as a generator.

---

## modules/mailmind/service.py

**All MailMind business logic**. The largest file in the project.

---

### `_time_key(e)`

**Triggered by:** `sorted()` calls throughout the file for chronological ordering.

**Calls internally:** `parsing.parse_date()`.

Returns a float timestamp for sorting. Returns 0.0 if the date cannot be parsed (puts those emails at the bottom).

---

### `fetch_inbox(date_from, date_to)`

**Triggered by:** `POST /api/modules/mailmind/emails/fetch`. Also called by `check_new_emails()` when new emails are detected, and by the daemon when the history ID is stale.

**Calls internally:**
- `gmail.get_gmail_service()` — Gmail API client
- `store.load_emails()` — current local cache
- `store.is_promo()`, `store.is_blocked()` — filters
- `parsing.decode_mime_header()`, `parsing.format_email_time()`, `parsing.extract_body()`, `parsing.extract_real_name()`, `parsing.normalize_subject()` — email parsing
- `_invalidate_stale_thread_summaries()` — marks flagged threads needing re-summarisation
- `store.save_emails()` — persists merged result
- `threading.Thread(_background_resurface)` — spawns background re-summarise for each invalidated thread
- `_save_history_id()` — saves the new Gmail historyId for the daemon

Fetches up to 50 emails from Gmail. For each new email ID not already in the local store: fetches the raw RFC 2822 message, parses it, skips promos and blocked senders, stores it. After fetching, checks if any new emails belong to a flagged conversation and triggers background re-summarisation. Saves the Gmail historyId for the daemon to use next time.

---

### `_invalidate_stale_thread_summaries(emails, new_ids)`

**Triggered by:** `fetch_inbox()` after storing new emails.

**Calls internally:** `parsing.normalize_subject()`.

Builds an index of all flagged emails grouped by `(sender_email, thread_subject)`. For each new email, checks if it shares a sender+subject with a flagged email. If yes, marks that flagged email's summary as stale (`summarised=False, summary=""`). Returns the list of flagged IDs that need re-summarisation. Uses a set for deduplication so the same email is only re-summarised once even if multiple new emails arrive in the same thread.

---

### `_background_resurface(email_id)`

**Triggered by:** `fetch_inbox()` — spawns a daemon thread for each invalidated flagged email.

**Calls internally:** `summarise_stream(email_id)` — exhausts the generator. The `finally` block inside `summarise_stream` handles saving and ChromaDB re-embedding.

Background thread that re-generates a flagged conversation's summary after a new email arrives in its thread. By the time the user opens the email, the updated summary is already ready.

---

### `list_emails(date_from, date_to, flagged_only)`

**Triggered by:** `GET /api/modules/mailmind/emails` — called on every inbox load and after any mutation.

**Calls internally:** `store.load_emails()`, `parsing.parse_date()`.

Reads the local email store, filters out `direction=sent` records (those are for conversation context only), applies date range and flagged-only filters, sorts by date descending. All filtering happens locally — no Gmail API call.

---

### `summarise(email_id)`

**Triggered by:** `POST /api/modules/mailmind/emails/<id>/summarise` — non-streaming version.

**Calls internally:** `store.load_emails()`, `module_settings.get()`, `prompts.summary_prompt()`, `llm_generate()`, `store.save_emails()`.

Returns cached summary if already generated. Otherwise calls the LLM and caches the result. Only used for non-flagged emails (flagged emails always use `summarise_stream` for conversation-level summaries).

---

### `summarise_stream(email_id)`

**Triggered by:** `POST /api/modules/mailmind/emails/<id>/summarise/stream` — the main summarise path. Also called by `_background_resurface()`.

**Calls internally:** `store.load_emails()`, `module_settings.get()`, `parsing.normalize_subject()`, `prompts.conversation_summary_prompt()` or `prompts.summary_prompt()`, `llm_stream()`, `store.save_emails()`, `chroma.embed_email()`.

The most important function in MailMind. For flagged emails, gathers all emails from the same sender+thread (both incoming and sent replies), builds a conversation prompt, streams the result. For normal emails, builds a single-email prompt.

Has a `try/finally` block that always saves whatever was generated — even if the client disconnects mid-stream or the LLM errors out. If the LLM returns nothing, falls back to a plain excerpt from the email body. After saving, if the email is flagged, re-embeds into ChromaDB with the new summary.

---

### `get_thread(email_id)`

**Triggered by:** `GET /api/modules/mailmind/emails/<id>/thread` — called when a flagged email is opened to show the full conversation.

**Calls internally:** `store.load_emails()`, `parsing.normalize_subject()`.

Returns all emails in a thread chronologically: incoming emails from the same sender with the same thread_subject, plus sent replies (`direction=sent`) addressed to that sender with the same thread_subject. Excludes `composed_anchor` entries.

---

### `toggle_flag(email_id)`

**Triggered by:** `POST /api/modules/mailmind/emails/flag` — user clicks the flag button.

**Calls internally:** `store.load_emails()`, `store.save_emails()`, `module_settings.get()`, `chroma.delete_embedding()`.

Toggles `flagged` boolean. Always resets `summarised=False` and clears `summary` so the next open regenerates with the appropriate prompt type (conversation for flagged, single-email for unflagged). If unflagging, immediately removes the ChromaDB embedding. If flagging, embedding happens later after the conversation summary is generated.

---

### `dismiss(email_id, delete_embeddings)`

**Triggered by:** `POST /api/modules/mailmind/emails/dismiss` — user clicks dismiss.

**Calls internally:** `store.load_emails()`, `module_settings.get()`, `chroma.delete_embedding()`, `store.save_emails()`.

Two different behaviours depending on whether the email is flagged:
- **Flagged:** deletes ChromaDB embedding, unflags the email, clears summary. Email stays in the inbox.
- **Normal (unflagged):** deletes the email from the local store entirely.

---

### `block_sender(email_id)`

**Triggered by:** `POST /api/modules/mailmind/emails/<id>/block-sender`.

**Calls internally:** `store.load_emails()`, `store.load_blocklist()`, `store.save_blocklist()`, `chroma.delete_embedding()`, `store.save_emails()`.

Adds the sender's email to the blocklist. Then removes every email from that sender across all threads (not just the clicked one), deletes all their ChromaDB embeddings, and removes all sent reply records addressed to them.

---

### `draft_compose(to, cc, subject, user_intent, to_name)`

**Triggered by:** `POST /api/modules/mailmind/compose/draft`.

**Calls internally:** `module_settings.load()`, `_extract_display_name()`, `prompts.compose_prompt()`, `llm_generate()`.

Generates a new outgoing email draft from the user's intent. Uses `to_name` if provided; otherwise extracts it from the `to` address.

---

### `send_compose(to, cc, subject, draft, flag, to_name)`

**Triggered by:** `POST /api/modules/mailmind/compose/send`.

**Calls internally:** `_extract_email()`, `gmail.send_mail()`, `module_settings.load()`, `parsing.normalize_subject()`, `store.load_emails()`, `store.save_emails()`.

Sends the composed email via Gmail. If `flag=True`, creates two store entries: an `anchor` entry (appears in inbox as a flagged conversation with that contact) and a `sent` entry (appears in the thread view). This is how an outgoing email becomes a trackable conversation.

---

### `draft_reply(email_id, user_intent)`

**Triggered by:** `POST /api/modules/mailmind/reply/draft`.

**Calls internally:** `store.load_emails()`, `module_settings.load()`, `chroma.query_similar()` (for flagged), `prompts.reply_prompt()`, `llm_generate()`.

Generates a reply draft. For flagged emails, queries ChromaDB for similar past conversations to include as context in the prompt. Uses the email's existing summary as context if available, otherwise falls back to the raw body.

---

### `send_reply(email_id, draft)`

**Triggered by:** `POST /api/modules/mailmind/reply/send`.

**Calls internally:** `store.load_emails()`, `gmail.get_gmail_service()` (for backfill), `gmail.send_mail()`, `module_settings.load()`, `parsing.normalize_subject()`, `store.save_emails()`.

Sends the reply via Gmail with proper threading headers (`In-Reply-To`, `References`, `threadId`). If the email was stored before threading fields were added, backfills them live from the Gmail API. For flagged emails, creates a `sent` record in the store and resets the summary so the next open regenerates with the sent reply included in the conversation.

---

### `list_contacts()`

**Triggered by:** `GET /api/modules/mailmind/contacts` — user opens the Contacts panel.

**Calls internally:** `store.load_emails()`, `parsing.parse_date()`.

Groups all inbox emails by `sender_email`, counts messages per sender, tracks their most recent email date. Returns sorted by most recent.

---

### `summarise_contacts(sender_emails)`

**Triggered by:** `POST /api/modules/mailmind/contacts/summarise` — user clicks "Summarise selected".

**Calls internally:** `store.load_emails()`, `module_settings.get()`, `prompts.contact_emails_prompt()`, `llm_generate()`.

For each selected sender, collects all their emails, builds a contact summary prompt, calls the LLM. Processes one sender at a time. Returns a dict of summaries keyed by email address.

---

### `delete_contact_emails(sender_emails, trash_in_gmail)`

**Triggered by:** `POST /api/modules/mailmind/contacts/delete`.

**Calls internally:** `store.load_emails()`, `module_settings.get()`, `gmail.trash_message()` (if `trash_in_gmail=True`), `chroma.delete_embedding()`, `store.save_emails()`.

Deletes all emails from selected senders. If `trash_in_gmail=True`, moves each email to Gmail trash (recoverable for 30 days). Also deletes ChromaDB embeddings and sent reply records for those senders.

---

### `get_blocklist()`, `add_to_blocklist(entry)`, `remove_from_blocklist(entry)`

**Triggered by:** Blocklist management routes (`GET/POST /api/modules/mailmind/blocklist`).

**Calls internally:** `store.load_blocklist()`, `store.save_blocklist()`.

Simple CRUD on the blocklist JSON file.

---

### `check_new_emails()`

**Triggered by:** `_daemon_loop()` every 60 seconds during work hours.

**Calls internally:** `_stored_history_id()`, `gmail.get_gmail_service()`, `_save_history_id()`, `fetch_inbox()`.

Uses Gmail's History API to detect new emails cheaply. Sends the stored `historyId` to Gmail — Gmail returns only changes since that ID. If new messages are found in the inbox, calls `fetch_inbox()` for a full sync. Always advances the stored historyId. If the historyId is stale (>30 days), falls back to a full fetch to reset it.

---

### `_stored_history_id()` and `_save_history_id(history_id)`

**Triggered by:** `check_new_emails()` and `fetch_inbox()`.

**Calls internally:** `module_settings.get()` and `module_settings.load()/save()`.

Read and write the Gmail `historyId` from/to MailMind settings. The historyId is Gmail's cursor — it marks the last known state of the mailbox so the daemon can ask "what changed since here?"

---

### `_within_work_hours(work_start, work_end)`

**Triggered by:** `_daemon_loop()` on every tick.

**Calls internally:** Nothing. Uses `datetime.now().time()` and `datetime.strptime()`.

Returns `True` if the current time is within the configured work hours. Outside work hours, the daemon skips its check and waits for the next tick.

---

### `_daemon_loop(stop_event)`

**Triggered by:** `start_daemon()` — runs in a background thread named `"mailmind-daemon"`.

**Calls internally:** `module_settings.load()`, `_within_work_hours()`, `check_new_emails()`.

The daemon's main loop. Runs forever until `stop_event` is set. Each iteration: if paused, waits 2 seconds and loops. If within work hours, calls `check_new_emails()`. Then waits 60 seconds before the next check. When `stop_event` is set, exits cleanly and resets `_daemon_state`.

---

### `daemon_status()`, `start_daemon()`, `pause_daemon()`, `resume_daemon()`, `stop_daemon()`

**Triggered by:** Daemon control routes (`GET/POST /api/modules/mailmind/daemon/*`). The frontend polls `daemon_status` every 15 seconds to update the UI indicator.

`start_daemon()` — creates a new `threading.Event`, sets `running=True`, spawns the daemon thread.

`pause_daemon()` / `resume_daemon()` — flip `_daemon_state["paused"]`. The loop checks this every 2 seconds when paused.

`stop_daemon()` — calls `_stop_event.set()` which signals the daemon thread to exit at the top of its next iteration.

`daemon_status()` — returns `running`, `paused`, `last_check`, and `active_provider`. Frontend uses this to show the status pill and last-checked time.

---

## How It All Connects — End to End Example

**User opens a flagged email:**

```
User clicks flagged email in inbox
      ↓
Frontend calls POST /api/modules/mailmind/emails/<id>/summarise/stream
      ↓
routes.py → summarise_stream route → StreamingResponse(service.summarise_stream(id))
      ↓
service.summarise_stream():
  - load_emails() from store.py
  - email is flagged → gather all thread emails
  - build conversation_summary_prompt() from prompts.py
  - call llm_stream() from core/llm.py
      → reads active_provider from settings.py
      → gets API key from secret_store.py
      → calls OllamaProvider.generate_stream() or ClaudeProvider.generate()
  - yield each token → frontend appends to UI
  - finally: save_emails(), embed_email() into chroma.py
      ↓
Frontend shows summary appearing word by word
```

**Daemon detects a new email:**

```
60 seconds pass
      ↓
_daemon_loop() wakes up
      ↓
_within_work_hours() → True
      ↓
check_new_emails():
  - reads stored historyId from settings.py
  - calls Gmail History API → gets new message IDs
  - saves new historyId
  - calls fetch_inbox()
      ↓
fetch_inbox():
  - fetches new emails from Gmail
  - parses with parsing.py
  - skips promos (store.is_promo) and blocked (store.is_blocked)
  - stores in mailmind_emails.json
  - _invalidate_stale_thread_summaries() → finds flagged threads affected
  - saves emails
  - spawns _background_resurface() thread for each affected flagged thread
      ↓
_background_resurface():
  - calls summarise_stream() → re-generates conversation summary
  - saves result + re-embeds in ChromaDB
      ↓
15 seconds later, frontend polls daemon/status
  - last_check updated → frontend re-fetches email list
  - updated summary merged into UI without navigation
```
