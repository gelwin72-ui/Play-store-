import type { AppCategory, SupportedOS } from '../types';
import { APP_CATEGORIES } from '../types';

export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const FIELD_LIMITS = {
  idMax: 128,
  displayNameMin: 1,
  displayNameMax: 80,
  bioMax: 500,
  websiteMax: 300,
  appWebsiteMax: 500,
  developerNameMin: 1,
  developerNameMax: 100,
  appNameMin: 2,
  appNameMax: 80,
  shortDescMin: 10,
  shortDescMax: 180,
  fullDescMin: 20,
  fullDescMax: 4000,
  versionNumberMin: 1,
  versionNumberMax: 32,
  versionCodeMin: 1,
  versionCodeMax: 2147483647,
  releaseNotesMin: 1,
  releaseNotesMax: 2000,
  maxScreenshots: 8,
  maxPackagesPerVersion: 4,
  reportReasonMin: 2,
  reportReasonMax: 120,
  reportDetailsMin: 5,
  reportDetailsMax: 1000,
} as const;

export function generateSafeId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'id';
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${cleanPrefix}_${rand}`;
}

export function isValidSafeId(id: string): boolean {
  return id.length >= 1 && id.length <= FIELD_LIMITS.idMax && ID_PATTERN.test(id);
}

export function isValidHttpUrl(url: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function validateApplicationInput(input: {
  name: string;
  developerName: string;
  shortDescription: string;
  fullDescription: string;
  category: AppCategory;
  supportedOS: SupportedOS[];
  versionNumber: string;
  versionCode: number;
  releaseNotes: string;
  websiteUrl?: string;
  privacyPolicyUrl?: string;
}): string | null {
  const name = input.name.trim();
  if (name.length < FIELD_LIMITS.appNameMin || name.length > FIELD_LIMITS.appNameMax) {
    return `Application name must be between ${FIELD_LIMITS.appNameMin} and ${FIELD_LIMITS.appNameMax} characters.`;
  }
  const dev = input.developerName.trim();
  if (dev.length < FIELD_LIMITS.developerNameMin || dev.length > FIELD_LIMITS.developerNameMax) {
    return `Developer name must be between ${FIELD_LIMITS.developerNameMin} and ${FIELD_LIMITS.developerNameMax} characters.`;
  }
  const shortDesc = input.shortDescription.trim();
  if (shortDesc.length < FIELD_LIMITS.shortDescMin || shortDesc.length > FIELD_LIMITS.shortDescMax) {
    return `Short description must be between ${FIELD_LIMITS.shortDescMin} and ${FIELD_LIMITS.shortDescMax} characters.`;
  }
  const fullDesc = input.fullDescription.trim();
  if (fullDesc.length < FIELD_LIMITS.fullDescMin || fullDesc.length > FIELD_LIMITS.fullDescMax) {
    return `Full description must be between ${FIELD_LIMITS.fullDescMin} and ${FIELD_LIMITS.fullDescMax} characters.`;
  }
  if (!APP_CATEGORIES.includes(input.category)) {
    return 'Please select a valid category.';
  }
  if (input.supportedOS.length === 0 || input.supportedOS.length > 2) {
    return 'Select at least one supported operating system (Android or iOS).';
  }
  const verNum = input.versionNumber.trim();
  if (verNum.length < FIELD_LIMITS.versionNumberMin || verNum.length > FIELD_LIMITS.versionNumberMax) {
    return `Version number must be between ${FIELD_LIMITS.versionNumberMin} and ${FIELD_LIMITS.versionNumberMax} characters.`;
  }
  if (
    !Number.isInteger(input.versionCode) ||
    input.versionCode < FIELD_LIMITS.versionCodeMin ||
    input.versionCode > FIELD_LIMITS.versionCodeMax
  ) {
    return 'Version code must be a positive integer.';
  }
  const notes = input.releaseNotes.trim();
  if (notes.length < FIELD_LIMITS.releaseNotesMin || notes.length > FIELD_LIMITS.releaseNotesMax) {
    return `Release notes must be between ${FIELD_LIMITS.releaseNotesMin} and ${FIELD_LIMITS.releaseNotesMax} characters.`;
  }
  if (input.websiteUrl && !isValidHttpUrl(input.websiteUrl.trim())) {
    return 'Website URL must start with https:// or http://.';
  }
  if (input.privacyPolicyUrl && !isValidHttpUrl(input.privacyPolicyUrl.trim())) {
    return 'Privacy policy URL must start with https:// or http://.';
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toLocaleString();
  }
  if (typeof ts === 'string' || typeof ts === 'number') {
    return new Date(ts).toLocaleString();
  }
  return '—';
}
