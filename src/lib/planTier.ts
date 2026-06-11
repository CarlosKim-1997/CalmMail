import type { SubscriptionTier } from '@shared/types';

/** i18n key for the active plan blurb in Settings. */
export function settingsPlanActiveKey(tier: SubscriptionTier): string {
  return `settings.planActive.${tier}`;
}
