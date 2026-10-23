import { pool } from '@workspace/db';
import { initialiseRfsCache, refreshRfsIfDue } from './cache';
import { logger } from '../lib/logger';

try {
  await initialiseRfsCache();
  const success = await refreshRfsIfDue(process.argv.includes('--force'));
  if (!success) process.exitCode = 1;
} catch (err) {
  logger.error({ err }, 'RFS refresh command failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
