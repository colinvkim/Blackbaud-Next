import type { StorageArea } from '../shared/extension.ts';
import { FULL_DEFAULTS_VERSION, fullDefaults, hasFullDefaultsMigration, settingsPatch } from '../shared/settings.ts';

export async function migrateSettings(storage: StorageArea): Promise<void> {
  if (hasFullDefaultsMigration(await storage.get(null))) return;
  // Save the marker with the preset so a failed write can safely retry.
  // Account selection and explicit assignment view choices are separate keys.
  await storage.set({
    ...settingsPatch({ enabled: true, mode: 'full', ...fullDefaults() }),
    fullDefaultsVersion: FULL_DEFAULTS_VERSION,
  });
}
