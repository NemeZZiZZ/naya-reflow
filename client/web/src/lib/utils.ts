import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 0-padded 2-digit hex with 0x prefix: 0x3e, 0x0a, … */
export const hex2 = (n: number) => '0x' + n.toString(16).padStart(2, '0');

/** Snapshot schema version for everything this app writes (exports,
 * auto-backups). Bump when a format change needs a migration step;
 * importers reject files from the future via a peek-guard. */
export const SNAPSHOT_VERSION = 1;
