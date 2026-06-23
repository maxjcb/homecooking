# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Homecooking is a single-file PWA (German UI) for a vegetarian two-person household to manage pantry/fridge/freezer inventory, recipes, meal prep, and a grocery list, optimized for iPad. The entire app — markup, CSS, and JS — lives in [index.html](index.html). There is no build step, no bundler, no package.json, and no test suite. It's hosted on GitHub Pages and runs client-side; data is persisted in a Supabase project (Postgres + Auth + Realtime), with a `supabase/schema.sql` reference file in this repo for manual setup (not auto-executed). Authentication uses Supabase Auth (email/password) for the two household members; the app requires an active internet connection — there is no offline mode.

Phase 2 (planned, not yet implemented):
- Meal-prep management (base sauces, frozen vegetables, grains/legumes, marinades)
- Claude API integration for AI-generated recipe suggestions (the Settings view already has a placeholder for this; only rule-based suggestions exist today)

## Development workflow

Development happens directly in this VS Code workspace via the Claude Code plugin, with the GitHub repo connected — edits go straight to `index.html` and are committed/pushed from here (no more manual file handoff). GitHub Pages deploys from this repo, so a push to the deployed branch goes live directly. Before any larger restructuring of the `state` schema or data migrations, recommend a JSON export as a backup first, since `localStorage` is the only data store and there's no server-side persistence to recover from.

## Development

There are no build/lint/test commands. To work on the app:
- Open `index.html` directly in a browser, or serve the directory with any static file server (e.g. `npx serve` or Python's `http.server`) so PWA features (manifest/service worker, if added later) behave correctly.
- All changes are made directly in `index.html`; there is nothing to compile.

## Architecture

Everything is plain JS using direct DOM manipulation (no framework, no modules, no build tooling), with `supabase-js` loaded via a CDN `<script>` tag as the one runtime dependency.

- **Auth/Login**: `#authScreen` (email/password form, calls `login()`) and `#appShell` (the whole existing app) are toggled by `sb.auth.onAuthStateChange()` → `showApp()` / `showAuthScreen()`. `showApp()` loads data and starts realtime subscriptions after a successful login; `logout()` calls `sb.auth.signOut()`. RLS policies on every table require `auth.role() = 'authenticated'` — no per-person data separation, since pantry/recipes/grocery/profiles are shared across the household.
- **State**: a single global `state` object (`items`, `recipes`, `grocery`, `profiles`, `currentStore`, `currentRecipeId`) mirrors four Supabase tables (`pantry_items`, `recipes`, `grocery_items`, `profiles`). `loadState()` bulk-fetches all four on login; there is no more localStorage persistence of app data. Each mutation function (`saveItem`, `updateItem`, `deleteItem`, `saveRecipe`, `addGroceryItem`, `toggleGrocery`, `removeGrocery`, `clearChecked`, `saveProfile`) is `async`, writes directly to its Supabase table, then updates the in-memory `state` and re-renders — there is no reactive framework, so renders must be triggered manually after state changes. `mapItemFromDb()`/`mapRecipeFromDb()`/`mapGroceryFromDb()` translate DB rows (snake_case columns) to the client's camelCase shape.
- **Realtime sync**: `subscribeRealtime()` opens one Supabase Realtime channel with `postgres_changes` listeners on all four tables; any change (from this device or the other household member's) re-fetches that table and re-renders the relevant view. This is what gives the two devices a shared, live-updated view of the data.
- **Views/Tabs**: four top-level views (`view-pantry`, `view-recipes`, `view-grocery`, `view-settings`) are toggled by `switchTab()`, which also triggers the corresponding `render*()` function. Each view is a full DOM subtree rendered via template-string `innerHTML` assignment (no diffing).
- **Modals**: bottom-sheet style modals (`modal-addItem`, `modal-editItem`, `modal-suggest`, `modal-recipe`, `modal-recipeDetail`, `modal-profile`) share generic `openModal(id)`/`closeModal(id)` helpers and close on backdrop click.
- **Pantry items**: have a `qtyType` of either `metric` (numeric qty + unit like kg/L/Stk) or `fill` (percentage-based fill level for jars, rendered as a visual jar bar). `setQtyType()`/`setFill()` toggle between these input modes in both the add and edit modals.
- **MHD (Mindesthaltbarkeitsdatum / best-before date)**: `daysUntil()` and `mhdBadge()` compute expiry badges (expired / expires today / warning within 7 days) shown on pantry cards and aggregated into the header's "Läuft ab" count.
- **Recipes**: stored with `ingredients`/`steps` as newline-separated lists (split/joined in the form), plus `tags`, `time`, `portions`, and an `aiGenerated` flag (currently unused — AI suggestion via Claude API is referenced in Settings as "planned" but not implemented).
- **Recipe suggestions**: `openSuggestModal()` does simple rule-based matching — for each recipe it checks how many ingredient lines loosely match (substring match) an item name in the pantry, scores recipes by match ratio, and sorts descending. This is the only "suggestion" logic that currently exists; there is no real AI integration yet despite the Settings UI text.
- **Grocery list**: flat list of `{id, text, checked}`; `exportToReminders()` uses the Web Share API when available, falling back to clipboard copy with a manual-paste instruction for Apple Reminders.
- **Data import/export**: `exportData()` serializes the current `state` (`{items, recipes, grocery, profiles}`) to a downloadable JSON file — still useful as a manual backup. `importData()` bulk-inserts/upserts the JSON contents into the four Supabase tables (existing rows are not matched/overwritten by id; imported items become new rows), then reloads `state` from Supabase.
- **PWA install banner**: a manually-injected banner (`showInstallBanner()`) nudges iOS users to add the app to the home screen, dismissible via a localStorage flag (`hc_install_dismissed`) — this is unrelated to app data and still uses localStorage directly. No actual `manifest.json` or service worker registration currently exists in this file.

## Conventions

- UI text, labels, and comments are in German; keep new user-facing strings consistent with this.
- IDs are UUIDs generated by Postgres (`gen_random_uuid()` default on each table), not client-generated.
- Category and unit option lists (Kategorie, Einheit) are duplicated between the add-item and edit-item modals — keep both in sync when changing the option sets.
- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` constants near the top of the `<script>` block hold the project URL and the publishable key (Supabase's current name for the old "anon" key) — the publishable key is meant to be public; access control is enforced via RLS, not key secrecy.
- Fixed pantry categories: Aromaten, Asia Pantry, Backwaren, Dosenlebensmittel, Essig, Gewürz, Hülsenfrüchte, Öl, Sauce, Sättigungsbeilagen, Sonstiges.
- Both household members are vegetarian, with individual exceptions configurable per person via Ernährungsprofile (Settings).

## Design principles

- Minimalist/clean visual style; accent color is sage green `#4A7C59` (see `--accent` CSS variable).
- iPad-first: large tap targets, no hover-dependent interactions.
- Minimal external dependencies — the app stays a single HTML file with no build step or npm packages; the one accepted exception is the `supabase-js` CDN script, needed for the Supabase backend.
