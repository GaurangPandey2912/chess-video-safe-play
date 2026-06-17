# AGENTS.md — Chess Video (Safe Play)

## Project Overview

A Chrome extension (Manifest V3) that adds 1-on-1 video chat to chess.com with
automatic skin-tone and chat-content monitoring. The backend is a Node.js/Express
server with MongoDB for auth, friends, and WebSocket-based signaling.

---

## Build / Lint / Test Commands

There is no build system, bundler, linter, or test runner configured.

- **Start server**  
  `npm start` (from `server/`) — runs `node index.js`

- **Dev server (auto-restart)**  
  `npm run dev` (from `server/`) — runs `node --watch index.js`

- **Load extension in Chrome**  
  Open `chrome://extensions` → Enable Developer mode → Load unpacked →
  select the repo root

- **Tests**  
  None exist. Do not add a test framework without asking.

---

## Code Style Guidelines

### Imports / Module System

- **Server (Node.js)**: CommonJS (`require` / `module.exports`).  
  Order: standard lib → npm packages → local modules (with blank-line separators).

- **Extension content script**: IIFE wrapping the entire file, `'use strict'` at
  top. No imports — PeerJS is loaded via `manifest.json`.

- **Extension background / popup**: Inline `<script>` or standalone `.js` files
  using the Chrome extension API (`chrome.*`). No module imports except the
  service-worker `"type": "module"` in manifest (though currently unused).

### Formatting

- 2-space indentation throughout.
- No semicolons in extension files (server uses semicolons — follow the existing
  style of the file you edit).
- Single quotes for strings (both server and extension).
- Trailing commas on multi-line object/array literals.
- `catch` without parameters when error is unused: `catch { ... }`.

### Naming Conventions

- **Variables / functions**: camelCase
- **Classes / constructors**: PascalCase
- **DB models**: PascalCase singular (e.g. `User`, `FriendRequest`)
- **Route files**: lowercase kebab-case (`auth.js`, `friends.js`)
- **CSS classes**: `cv-` prefix for extension UI (`cv-btn`, `cv-status`)
- **CSS IDs**: `cv-` prefix for extension (`cv-start`, `cv-stop`)
- **Constants**: UPPER_SNAKE_CASE for blocklist, thresholds, config values
  (e.g. `BLOCKLIST`, `STUN`, `SKIN_THRESHOLD`)
- **Console prefixes**: `[CV]` in content script logs

### TypeScript

Not used. All code is plain JavaScript.

### Error Handling

- **Express routes**: Every async handler is wrapped in try/catch. Catch blocks
  return `res.status(500).json({ error: 'Server error' })`. Early returns for
  validation failures with appropriate 4xx codes.
- **WebSocket messages**: JSON.parse is wrapped in try/catch; invalid messages
  get `{ type: 'error', message: '...' }` responses.
- **Extension**: Errors are logged with `console.warn`/`console.error` and
  surfaced to the UI via `setStatus()`. No global error handler.
- Guard `await` calls with try/catch when the rejection is handled locally.

### Async / Await

Prefer `async/await` over raw promises. Avoid `.then()` chains.

### CSS / Styling

- Dark theme: backgrounds `#0f0f1a` / `#1a1a2e`, borders `#30305a`, text
  `#e0e0e0`, muted `#6b7280`.
- Primary accent: `#4a6cf7`.
- Danger: `#dc3545`.
- The extension uses a `position: fixed` floating bar at `bottom: 20px; right:
  20px` with `z-index: 999999`.
- Server public pages use a nav + container layout.

### Chrome Extension Patterns

- **Content script** (`content.js`): IIFE with module-level state variables
  (strings, nulls). DOM queries cached at init via `$()` helper. Event handlers
  attached via `onclick` property or `addEventListener`.
- **Background service worker** (`background.js`): Message-passing via
  `chrome.runtime.onMessage.addListener`. Use `return true` for async
  `sendResponse`.
- **Storage**: `chrome.storage.local` for token/user data under keys
  `cv_token` and `cv_user`.
- **Web-accessible resources**: declared in `manifest.json` under
  `web_accessible_resources`.
- **PeerJS**: loaded from `lib/peerjs.min.js` as a web-accessible resource and
  injected in the content script via the manifest `js` array.

### HTML

- Inline `<style>` blocks in HTML files (no external CSS for popup/auth pages).
- `<!DOCTYPE html>` with `<html lang="en">`.
- Dark-theme reset: `* { margin: 0; padding: 0; box-sizing: border-box; }`.

### State Machine (content.js)

The extension uses a simple `state` variable with values `'idle'` /
`'starting'`. The `state` guard prevents concurrent connection attempts.

### Git Conventions

- `.gitignore` excludes `node_modules/`, `.env`, `.DS_Store`, `*.log`.
- `.env` is used for `MONGODB_URI`, `JWT_SECRET`, `PORT`.
