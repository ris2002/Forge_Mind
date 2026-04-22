# OpenClaw

A local-first AI workspace. **Every feature is a module.** MailMind (inbox triage)
is the first one; the architecture exists so you can add more without touching the
core.

## Running it

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Data lives in `~/.openclaw/`.

## Architecture at a glance

### Backend (`backend/`)

```
main.py              # 30 lines. Mounts routers. Knows nothing module-specific.
core/
  config.py          # app constants
  settings.py        # global + module-scoped settings (ModuleSettings)
  secret_store.py    # encrypted API key storage (Fernet)
  llm.py             # llm_generate() — the ONLY entry point modules use for LLM calls
providers/
  base.py            # BaseProvider interface
  ollama.py          # each provider = one file
  claude.py
  openai.py
  gemini.py
  __init__.py        # PROVIDERS registry
  routes.py          # /api/providers/*
auth/
  gmail.py           # IMAP/SMTP adapter
  routes.py          # /api/auth/*
modules/
  __init__.py        # MODULE REGISTRY + meta router (/api/modules)
  mailmind/
    __init__.py      # manifest (id, name, description, router)
    routes.py        # /api/modules/mailmind/*
    service.py       # business logic
    parsing.py       # pure functions, no I/O
    store.py         # file-backed persistence
    chroma.py        # vector store (optional)
    prompts.py       # prompt templates
    settings.py      # module-scoped defaults
```

### Frontend (`frontend/src/`)

```
App.jsx              # module-agnostic. Reads the registry, renders active module.
main.jsx
index.css            # design tokens
api/
  client.js          # thin fetch wrapper
  auth.js            # global endpoints
  providers.js
  modules.js         # module catalogue (/api/modules)
core/
  Shell.jsx          # sidebar + layout. Reads modules from props.
  Logo.jsx
pages/
  Setup.jsx          # first-run onboarding
  Settings.jsx       # auto-renders tabs from registry (Providers + General + per-module)
modules/
  registry.jsx       # SINGLE SOURCE: what modules exist in the frontend
  mailmind/
    index.jsx        # { manifest, Component, SettingsTab, icon }
    MailMind.jsx
    MailMindSettings.jsx
    api.js           # module-scoped API client
```

## Adding a new module

Say you're adding **Notes**. Here's the complete change list.

### Backend (4 new files, 1 edit)

1. **Create `backend/modules/notes/__init__.py`**:
   ```python
   from .routes import router

   manifest = {
       "id": "notes",
       "name": "Notes",
       "description": "Quick AI-assisted notes",
       "router": router,
   }

   __all__ = ["manifest"]
   ```

2. **Create `backend/modules/notes/routes.py`** with your endpoints under an `APIRouter(prefix="/api/modules/notes")`.

3. **Create `backend/modules/notes/service.py`** with business logic. Call `core.llm.llm_generate(prompt)` for any AI work — you don't need to care which provider is active.

4. **Create `backend/modules/notes/settings.py`** (if needed):
   ```python
   from core.settings import module_settings

   DEFAULTS = {"autosave": True, "font_size": 14}
   settings = module_settings("notes", DEFAULTS)
   ```

5. **Edit `backend/modules/__init__.py`**: import and add to `REGISTRY`:
   ```python
   from .notes import manifest as notes_manifest
   REGISTRY = [mailmind_manifest, notes_manifest]
   ```

That's the whole backend. `main.py` is untouched.

### Frontend (3 new files, 1 edit)

1. **Create `frontend/src/modules/notes/Notes.jsx`** — the main component.

2. **Create `frontend/src/modules/notes/api.js`**:
   ```js
   import { get, post } from "../../api/client";
   const BASE = "/api/modules/notes";
   export const notesApi = {
     list: () => get(`${BASE}/notes`),
     create: (body) => post(`${BASE}/notes`, body),
     // etc.
   };
   ```

3. **Create `frontend/src/modules/notes/index.jsx`**:
   ```jsx
   import Notes from "./Notes";
   // import NotesSettings from "./NotesSettings"; // optional

   export const manifest = {
     id: "notes",
     name: "Notes",
     description: "Quick AI-assisted notes",
   };
   export const Component = Notes;
   // export const SettingsTab = NotesSettings; // optional

   export function icon({ size = 16, color = "currentColor" } = {}) {
     return (
       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
         <path d="M5 3h11l3 3v15H5z" />
         <path d="M9 9h6M9 13h6M9 17h4" />
       </svg>
     );
   }
   ```

4. **Edit `frontend/src/modules/registry.jsx`**: import and add:
   ```jsx
   import * as notes from "./notes";
   export const MODULES = [mailmind, notes];
   ```

Done. Shell renders the sidebar item, App routes to your component, Settings renders your tab (if you provided one).

## Core contracts

**Module manifest (backend):** every `modules/<id>/__init__.py` exports a `manifest` dict with `id`, `name`, `description`, `router`.

**Module registry entry (frontend):** every `modules/<id>/index.jsx` exports:
- `manifest` — `{ id, name, description }` (must match backend manifest id)
- `Component` — main React component
- `SettingsTab` — optional, auto-shown in Settings
- `icon({ size, color })` — optional, used in the sidebar

**LLM access:** backend modules call `core.llm.llm_generate(prompt)`. Never import a specific provider. Whatever the user selected in Settings is what runs.

**Module settings:** `core.settings.module_settings(id, defaults)` gives you a scoped view. Your settings live under `settings.json` → `modules.<id>` automatically.

## Design tokens

All styling uses CSS variables in `frontend/src/index.css`:
- **Display:** Fraunces (headings, wordmark)
- **Body:** DM Sans
- **Mono:** JetBrains Mono (metadata, keys, code)
- **Accent:** warm amber (`--accent: #d9a066`)

Retune the theme in one file.

## API surface

```
/api/auth/*                          Gmail connect/status/signout
/api/providers                       List all LLM providers
/api/providers/{id}/models           Available models
/api/providers/key                   POST: save + test key
/api/providers/active                POST: switch active provider
/api/providers/model                 POST: switch model for a provider
/api/modules                         List registered modules
/api/modules/{module_id}/*           Module-specific routes
```

## Privacy

- Ollama is default. With it installed and running, no prompts leave your machine.
- Cloud providers activate only when explicitly selected and a valid key is saved.
- API keys are Fernet-encrypted in `~/.openclaw/keys.enc`. Master key at `~/.openclaw/master.key` (`chmod 600`).
- Falls back to plaintext + warning if `cryptography` isn't installed.
