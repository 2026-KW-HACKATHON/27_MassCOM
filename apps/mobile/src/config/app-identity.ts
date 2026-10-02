import * as Application from 'expo-application';
import Constants from 'expo-constants';

import { packageIdFromScheme } from './package-id-from-scheme';

/**
 * Every showcase/dev gate in this app keys off the installed Android package id. Web has no
 * installed package (`Application.applicationId` is always null there), so it falls back to the
 * variant's scheme (app.config.ts sets both from the same APP_VARIANT at build time).
 */
export function getAppPackageId(): string | null | undefined {
  return Application.applicationId ?? packageIdFromScheme(Constants.expoConfig?.scheme);
}
