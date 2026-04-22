/**
 * Frontend module registry.
 *
 * ── How to add a new module ──
 * 1. Create src/modules/<your_id>/ with:
 *     - index.jsx  exporting { manifest, Component, SettingsTab, icon }
 *     - api.js     module-scoped API calls
 *     - your actual UI components
 * 2. Import its index here and append to MODULES.
 *
 * That's the whole change. Shell renders the sidebar item, App routes to the
 * component, Settings auto-renders the tab.
 */

import * as mailmind from "./mailmind";

export const MODULES = [
  mailmind,
  // Future modules go here.
];

/** Helper: find a module entry by id. */
export function getModule(id) {
  return MODULES.find(m => m.manifest.id === id);
}

/** Helper: sidebar-ready list. */
export function moduleNavItems() {
  return MODULES.map(m => ({
    id: m.manifest.id,
    name: m.manifest.name,
    icon: m.icon,
    available: true,
  }));
}

/** Helper: modules that expose a SettingsTab. */
export function modulesWithSettings() {
  return MODULES.filter(m => m.SettingsTab);
}
