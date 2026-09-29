/**
 * Public surface of the storage layer.
 *
 * UI code should import from here, never from an individual service module, so
 * that swapping the local backend for Firebase / a REST API is a one-file
 * change. See README -> "Moving to a real backend".
 */
export * as customerService from './customerService.js';
export * as cycleService from './cycleService.js';
export * as lightBillService from './lightBillService.js';
export * as transactionService from './transactionService.js';
export * as migrationService from './migrationService.js';
export * as settingsService from './settingsService.js';
export * as imageService from './imageService.js';
export * as authService from './authService.js';
export * as seedService from './seedService.js';

export { loadSettings, saveSettings, resetSettings, DEFAULT_SETTINGS, DEFAULT_TERMS, SHARING_TYPES, getRentForSharing } from './settingsService.js';
export { readJSON, writeJSON, removeKey, KEYS, SCHEMA_VERSION } from './localStore.js';
export { runMigration, needsMigration } from './migrationService.js';
