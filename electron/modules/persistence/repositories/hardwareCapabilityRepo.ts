import { getDb } from '../db';
import type { CachedHardwareCapability, HardwareCapability } from '@shared/types';

const KEY = 'hardware.capability.v1';

export const hardwareCapabilityRepo = {
  get(): CachedHardwareCapability | null {
    const row = getDb()
      .prepare<[string], { value: string } | undefined>(
        'SELECT value FROM meta WHERE key = ?',
      )
      .get(KEY);
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as CachedHardwareCapability;
      if (!parsed?.capability?.verdict || typeof parsed.analyzedAt !== 'number') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  set(capability: HardwareCapability, analyzedAt: number): CachedHardwareCapability {
    const entry: CachedHardwareCapability = { capability, analyzedAt };
    getDb()
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(KEY, JSON.stringify(entry));
    return entry;
  },
};
