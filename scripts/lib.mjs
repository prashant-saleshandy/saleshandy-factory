// Shared helpers for the factory scripts and hooks. Node built-ins only.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';

export const HOME_DIR = join(homedir(), '.claude', 'factory');
export const SESSIONS_DIR = join(HOME_DIR, 'sessions');

// Option labels that count as approval when the user selects them in AskUserQuestion.
export const APPROVAL_OPTIONS = {
  spec: 'Approve the spec',
  push: 'Push and open PRs',
  release: 'Approve the release doc',
};

const DEFAULT_CONFIG = { maxSubagents: 3, contextLimitTokens: 100000 };

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
}

export function config() {
  return { ...DEFAULT_CONFIG, ...readJson(join(HOME_DIR, 'config.json'), {}) };
}

export function now() { return new Date().toISOString(); }

export function sha256(text) { return createHash('sha256').update(text).digest('hex'); }

export function fileHash(file) {
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}

// A work folder is <workspace>/worktrees/<TICKET>/ and holds .factory/state.json.
export function workDirFromPath(p) {
  if (!p) return null;
  let dir = resolve(p);
  while (true) {
    if (existsSync(join(dir, '.factory', 'state.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function factoryDir(workDir) { return join(workDir, '.factory'); }
export function statePath(workDir) { return join(workDir, '.factory', 'state.json'); }
export function loadState(workDir) { return readJson(statePath(workDir)); }

export function saveState(workDir, state) {
  state.updated = now();
  writeJson(statePath(workDir), state);
}

export function isInside(child, parent) {
  const c = resolve(child), p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

// The spec gate is open only when the current spec has a matching approval.
// Before publish, the draft hash must match. After publish, the Confluence version must match.
export function specGate(workDir, state) {
  const a = state.approvals?.spec;
  if (!a) return { open: false, why: 'The spec has no approval.' };
  const page = state.spec?.confluence;
  if (page?.version) {
    if (a.version === page.version) return { open: true };
    return { open: false, why: `The approved spec is Confluence v${a.version ?? '-'}, but the current spec is v${page.version}.` };
  }
  const hash = fileHash(join(factoryDir(workDir), 'spec.html'));
  if (hash && a.draftHash === hash) return { open: true };
  return { open: false, why: 'spec.html changed after the approval.' };
}

export function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

export function tryGit(cwd, args) {
  try { return { ok: true, out: git(cwd, args) }; } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() }; }
}

// Session registry: a session that /factory attached to a work folder.
export function sessionFile(sessionId) { return join(SESSIONS_DIR, `${sessionId}.json`); }
export function sessionWork(sessionId) {
  if (!sessionId) return null;
  return readJson(sessionFile(sessionId))?.workDir ?? null;
}

export function readStdinJson() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}
