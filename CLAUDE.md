# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Homecooking is a single-file PWA (German UI) for a vegetarian two-person household to manage pantry/fridge/freezer inventory, recipes, meal prep, and a grocery list, optimized for iPad. The entire app — markup, CSS, and JS — lives in [index.html](index.html). There is no build step, no bundler, no package.json, and no test suite. It's hosted on GitHub Pages and runs entirely client-side; the only persistence is `localStorage` plus manual JSON export/import (no server, no accounts).

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

Everything is plain JS using direct DOM manipulation (no framework, no modules, no build tooling).

- **State**: a single global `state` object (`items`, `recipes`, `grocery`, `profiles`, `currentStore`, `currentRecipeId`, `selectedProfiles`) is persisted to `localStorage` under the key `hc_state` via `loadState()` / `saveState()`. Every mutation calls `saveState()` immediately, then re-renders the affected view — there is no reactive framework, so renders must be triggered manually after state changes.
- **Views/Tabs**: four top-level views (`view-pantry`, `view-recipes`, `view-grocery`, `view-settings`) are toggled by `switchTab()`, which also triggers the corresponding `render*()` function. Each view is a full DOM subtree rendered via template-string `innerHTML` assignment (no diffing).
- **Modals**: bottom-sheet style modals (`modal-addItem`, `modal-editItem`, `modal-suggest`, `modal-recipe`, `modal-recipeDetail`, `modal-profile`) share generic `openModal(id)`/`closeModal(id)` helpers and close on backdrop click.
- **Pantry items**: have a `qtyType` of either `metric` (numeric qty + unit like kg/L/Stk) or `fill` (percentage-based fill level for jars, rendered as a visual jar bar). `setQtyType()`/`setFill()` toggle between these input modes in both the add and edit modals.
- **MHD (Mindesthaltbarkeitsdatum / best-before date)**: `daysUntil()` and `mhdBadge()` compute expiry badges (expired / expires today / warning within 7 days) shown on pantry cards and aggregated into the header's "Läuft ab" count.
- **Recipes**: stored with `ingredients`/`steps` as newline-separated lists (split/joined in the form), plus `tags`, `time`, `portions`, and an `aiGenerated` flag (currently unused — AI suggestion via Claude API is referenced in Settings as "planned" but not implemented).
- **Recipe suggestions**: `openSuggestModal()` does simple rule-based matching — for each recipe it checks how many ingredient lines loosely match (substring match) an item name in the pantry, scores recipes by match ratio, and sorts descending. This is the only "suggestion" logic that currently exists; there is no real AI integration yet despite the Settings UI text.
- **Grocery list**: flat list of `{id, text, checked}`; `exportToReminders()` uses the Web Share API when available, falling back to clipboard copy with a manual-paste instruction for Apple Reminders.
- **Data import/export**: `exportData()`/`importData()` serialize/deserialize `{items, recipes, grocery, profiles}` as a downloadable/uploadable JSON file — this is the only backup/sync mechanism (no server, no account system).
- **PWA install banner**: a manually-injected banner (`showInstallBanner()`) nudges iOS users to add the app to the home screen, dismissible via a localStorage flag (`hc_install_dismissed`). No actual `manifest.json` or service worker registration currently exists in this file.

## Conventions

- UI text, labels, and comments are in German; keep new user-facing strings consistent with this.
- IDs are generated with `uid()` (`Date.now().toString(36) + random base36 string`), not UUIDs.
- Category and unit option lists (Kategorie, Einheit) are duplicated between the add-item and edit-item modals — keep both in sync when changing the option sets.
- Fixed pantry categories: Aromaten, Asia Pantry, Backwaren, Dosenlebensmittel, Essig, Gewürz, Hülsenfrüchte, Öl, Sauce, Sättigungsbeilagen, Sonstiges.
- Both household members are vegetarian, with individual exceptions configurable per person via Ernährungsprofile (Settings).

## Design principles

- Minimalist/clean visual style; accent color is sage green `#4A7C59` (see `--accent` CSS variable).
- iPad-first: large tap targets, no hover-dependent interactions.
- No external dependencies — everything stays in the single HTML file (no CDN scripts, no npm packages).
