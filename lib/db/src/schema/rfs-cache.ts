import { date, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod/v4';

export const rfsCacheTable = pgTable('rfs_permit_cache', {
  id: text('id').primaryKey(),
  records: jsonb('records').$type<{ lga: string; required: boolean }[]>().notNull(),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastRunDate: date('last_run_date', { mode: 'string' }),
  lastError: text('last_error'),
});
export const insertRfsCacheSchema = createInsertSchema(rfsCacheTable);
export type InsertRfsCache = z.infer<typeof insertRfsCacheSchema>;
export type RfsCache = typeof rfsCacheTable.$inferSelect;
