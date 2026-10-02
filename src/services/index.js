/**
 * Public surface of the storage layer.
 *
 * UI code should import from here, never from an individual service module, so
 * that swapping the backend (or mocking it in tests) is a one-file change.
 * See README -> "Data & backend".
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
export * as backupService from './backupService.js';
export * as roomService from './roomService.js';

export { loadSettings, saveSettings, resetSettings, DEFAULT_SETTINGS, DEFAULT_TERMS, SHARING_TYPES, getRentForSharing } from './settingsService.js';
export { runMigration, needsMigration } from './migrationService.js';
export { isConfigured } from './supabase.js';
// Pure helpers the pages need directly, not through the service namespace.
export { occupancyTotals, groupByFloor, freeBeds, effectiveRent, calculateRefund, ROOM_STATUS, TENANT_STATUS } from './roomService.js';