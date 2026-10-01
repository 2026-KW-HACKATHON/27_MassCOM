import * as Application from 'expo-application';
import Constants from 'expo-constants';

/**
 * Every showcase/dev gate in this app keys off the installed Android package id. Web has no
 * installed package (`Application.applicationId` is always null there), so it falls back to the
 * variant's Android package baked into the bundle at build time by app.config.ts — the same
 * string the web build would have shipped as an APK under.
 */
export function getAppPackageId(): string | null | undefined {
  return Application.applicationId ?? Constants.expoConfig?.android?.package;
}
