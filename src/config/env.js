import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

/**
 * Parses integer configuration values with fallback defaults.
 * @param {string|undefined} val
 * @param {number} fallback
 * @returns {number}
 */
function parseIntSafe(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = Number.parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Resolved application environment configuration.
 * Zero hardcoded secrets, safe defaults for local offline execution.
 */
export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseIntSafe(process.env.PORT, 3000),
  STORAGE_DIR: path.resolve(projectRoot, process.env.STORAGE_DIR || './data'),
  BACKUP_RETENTION_COUNT: parseIntSafe(process.env.BACKUP_RETENTION_COUNT, 5),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || 'INR',
  COMPANY_NAME: process.env.COMPANY_NAME || 'StockPulse Enterprises',
  COMPANY_GSTIN: process.env.COMPANY_GSTIN || '27AAAAA0000A1Z5',
  COMPANY_STATE_CODE: process.env.COMPANY_STATE_CODE || '27',
  RATE_LIMIT_WINDOW_MS: parseIntSafe(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  RATE_LIMIT_MAX: parseIntSafe(process.env.RATE_LIMIT_MAX, 120),
  PROJECT_ROOT: projectRoot
});
