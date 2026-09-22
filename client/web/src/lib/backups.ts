/* Auto-backups: rolling pre-flash snapshots kept in localStorage (UHK
 * Agent pattern — the compensation half for a device with no staging
 * buffer: every flash starts from a known-good restore point).
 * Storage-swappable so the node smoke can drive it with a Map-backed
 * fake; a missing storage (node, private mode, quota) degrades to
 * skipped, never throws into the flash path. */

import { buildKeymapExport, buildLedmapExport } from './exporters';
import { parseSnapshotFile } from './importers';
import type { SnapMaps } from './importers';
import type { KeyRec, LedRec } from './naya';
import { SNAPSHOT_VERSION } from './utils';

export const BACKUP_KIND = 'naya-full-backup';
const STORAGE_KEY = 'naya-auto-backups';
const MAX_BACKUPS = 20;

export interface BackupMeta {
  id: string;
  ts: string; // ISO
  hash: string; // content hash, dedupe
  bytes: number; // sum of live blob totals
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

interface StoredBackup {
  meta: BackupMeta;
  doc: Record<string, unknown>;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** djb2 — dedupe-only, not cryptographic. */
export function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function readAll(st: StorageLike | null): StoredBackup[] {
  if (!st) return [];
  try {
    const raw = st.getItem(STORAGE_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as StoredBackup[]) : [];
  } catch {
    return [];
  }
}

function writeAll(st: StorageLike | null, all: StoredBackup[]): boolean {
  if (!st) return false;
  try {
    st.setItem(STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export type SaveBackupResult =
  | { status: 'saved'; meta: BackupMeta }
  | { status: 'skipped'; reason: 'empty' | 'unchanged' | 'storage' };

export function saveAutoBackup(
  keys: KeyRec[][],
  leds: LedRec[][],
  blobKeys: number[],
  blobLeds: number[],
  storage?: StorageLike,
): SaveBackupResult {
  const kExp = buildKeymapExport(keys, blobKeys, 0, true);
  const lExp = buildLedmapExport(leds, blobLeds, 0, true);
  if (!kExp || !lExp) return { status: 'skipped', reason: 'empty' };
  const doc = {
    tool: 'naya-reflow',
    kind: BACKUP_KIND,
    v: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    keys: kExp.data,
    leds: lExp.data,
  } as unknown as Record<string, unknown>;
  // Content hash only — exportedAt must NOT participate (top-level AND the
  // nested export docs each carry one), or every save looks changed and
  // the dedupe never fires.
  const stripTs = (d: unknown): Record<string, unknown> => ({
    ...(d as Record<string, unknown>),
    exportedAt: '',
  });
  const hash = hashStr(JSON.stringify({ ...stripTs(doc), keys: stripTs(doc.keys), leds: stripTs(doc.leds) }));
  const st = storage ?? defaultStorage();
  const all = readAll(st);
  if (all[0] && all[0].meta.hash === hash) return { status: 'skipped', reason: 'unchanged' };
  const bytes =
    blobKeys.reduce((a, b) => a + b, 0) + blobLeds.reduce((a, b) => a + b, 0);
  const meta: BackupMeta = {
    id: `${Date.now().toString(36)}-${hash.slice(0, 4)}`,
    ts: doc.exportedAt as string,
    hash,
    bytes,
  };
  all.unshift({ meta, doc });
  if (!writeAll(st, all.slice(0, MAX_BACKUPS))) return { status: 'skipped', reason: 'storage' };
  return { status: 'saved', meta };
}

export function listAutoBackups(storage?: StorageLike): BackupMeta[] {
  return readAll(storage ?? defaultStorage()).map((b) => b.meta);
}

export function loadAutoBackup(
  id: string,
  storage?: StorageLike,
): SnapMaps | { error: string } {
  const all = readAll(storage ?? defaultStorage());
  const e = all.find((b) => b.meta.id === id);
  if (!e) return { error: `no backup with id ${id}` };
  return parseSnapshotFile(e.doc);
}

export function deleteAutoBackup(id: string, storage?: StorageLike): boolean {
  const st = storage ?? defaultStorage();
  const all = readAll(st);
  const next = all.filter((b) => b.meta.id !== id);
  if (next.length === all.length) return false;
  return writeAll(st, next);
}
