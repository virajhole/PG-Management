/**
 * Public surface of the storage layer.
 *
 * UI code imports from here, never from an individual service module, so the
 * backend stays swappable and the test fake plugs in at one place.
 */
export * as customerService from './customerService.js';
export * as cycleService from './cycleService.js';
export * as lightBillService from './lightBillService.js';
export * as transactionService from './transactionService.js';
export * as settingsService from './settingsService.js';
export * as imageService from './imageService.js';
export * as authService from './authService.js';
export * as backupService from './backupService.js';
export * as roomService from './roomService.js';

export {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  DEFAULT_TERMS,
  DEFAULT_WHATSAPP_TEMPLATE,
  SHARING_TYPES,
  getRentForSharing,
} from './settingsService.js';
export { isConfigured } from './supabase.js';

// Pure helpers the pages need directly, not through a service namespace.
export {
  occupancyTotals,
  groupByFloor,
  freeBeds,
  effectiveRent,
  availableRooms,
  hasVacancy,
  attachOccupancy,
} from './roomService.js';
