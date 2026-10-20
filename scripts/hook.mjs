#!/usr/bin/env node
// One entry point for all factory hooks: node hook.mjs <event>.
// A hook must never break a session, so each handler fails open, except for the rules it enforces.
import { existsSync, openSync, readSync, fstatSync, closeSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  APPROVAL_OPTIONS, HOME_DIR, readJson, writeJson, readStdinJson, config, now, workDirFromPath,
  loadState, saveState, specGate, fileHash, factoryDir, sessionFile, sessionWork,
} from './lib.mjs';

const event = process.argv[2];
const input = readStdinJson();
const sid = input.session_id;
const LAST_FILE = join(HOME_DIR, 'last.json');

function out(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }
function deny(reason) {
  out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[factory] ${reason}` } });
}
function context(eventName, text) { out({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }); }

function isFactorySession() { return !!sid && existsSync(sessionFile(sid)); }

function statusText(workDir) {
  try {
    return execFileSync(process.execPath, [join(import.meta.dirname, 'work.mjs'), 'status', '--work', workDir], { encoding: 'utf8' }).trim();
  } catch { return null; }
}

function attach(workDir) {
  writeJson(sessionFile(sid), { workDir, at: now() });
  if (workDir) writeJson(LAST_FILE, { workDir, at: now() });
}

// ---------- session events ----------

function onSessionStart() {
  if (!sid) return;
  let work = sessionWork(sid);
  if (!work && input.source === 'clear') {
    // /clear starts a new session ID. Continue the work of the last factory session if it is recent.
    const last = readJson(LAST_FILE);
    if (last?.workDir && Date.now() - Date.parse(last.at) < 12 * 3600e3 && existsSync(last.workDir)) { attach(last.workDir); work = last.workDir; }
  }
  if (!work) {
    const here = workDirFromPath(input.cwd);
    if (!here) return;
    const s = loadState(here);
    context('SessionStart', `This directory belongs to factory work ${s?.ticket}. If the user wants to continue it, they type /factory.`);
  }
  const status = statusText(work);
  if (status) context('SessionStart', `Factory session (id ${sid}). Current state:\n${status}\nRead only the handoff files that the current stage needs. Continue with the factory skill for this stage.`);
}

function onUserPromptSubmit() {
  const prompt = (input.prompt || '').trim();
  if (!/^\/(factory:)?factory(\s|$)/.test(prompt)) return;
  if (!isFactorySession()) writeJson(sessionFile(sid), { workDir: null, at: now() });
  context('UserPromptSubmit', `Factory session id: ${sid}. Use it with "work.mjs attach --session ${sid}".`);
}

// ---------- edit gate ----------

function onEdit() {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const work = workDirFromPath(file);
  if (!work) return;
  const rel = relative(work, file);
  const top = rel.split(sep)[0];
  if (top === '.factory') {
    const name = rel.split(sep).slice(1).join('/');
    if (name === 'state.json') deny('state.json changes only through work.mjs.');
    if (name === 'spec.cache.md') deny('spec.cache.md is a read-only copy of Confluence. Change the Confluence page, then run "work.mjs spec-cache".');
    if (name === 'secrets.json') deny('secrets.json changes only through ship.mjs.');
    return;
  }
  if (top === '.staging') deny('Staging branches are never edited. Change the work branch, then merge it with "ship.mjs staging".');
  const state = loadState(work);
  if (!state?.repos?.[top]) return;
  const gate = specGate(work, state);
  if (!gate.open) deny(`Code edits are blocked: ${gate.why} Update the spec and get approval first.`);
}

// ---------- bash rules ----------

function onBash() {
  const cmd = input.tool_input?.command || '';
  const factory = isFactorySession();
  const touchesWork = /\/worktrees\/[A-Z][A-Z0-9]+-\d+/.test(cmd) || !!workDirFromPath(input.cwd);
  if (!factory && !touchesWork) return;
  const viaScript = /\b(work|ship)\.mjs\b/.test(cmd);
  if (/\bgit\b[^|;&]*\brebase\b/.test(cmd)) deny('git rebase is not allowed. Use a merge with --ff.');
  if (/\bgit\b[^|;&]*\bpush\b[^|;&]*(--force\b|--force-with-lease|\s-f\b|\s\+\S)/.test(cmd)) deny('Force push is not allowed.');
  if (!viaScript && /\.staging\//.test(cmd)) deny('Staging worktrees change only through "ship.mjs staging". On a merge conflict, stop and tell the user.');
  if (!viaScript && /\bgit\b[^|;&]*\bpush\b/.test(cmd)) deny('Push with "ship.mjs push" after the user approves the push.');
  if (!viaScript && /\bgh\s+pr\s+(create|edit|ready|merge)\b/.test(cmd)) deny('Open and update PRs with "ship.mjs prs".');
  if (!viaScript && /(state|secrets)\.json|spec\.cache\.md/.test(cmd) && /(>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|writeFile)/.test(cmd)) deny('Factory state files change only through work.mjs and ship.mjs.');
}

// ---------- approvals ----------

function onAskUserQuestion() {
  const work = sessionWork(sid);
  if (!work) return;
  const s = loadState(work);
  if (!s?.pending) return;
  const answers = Object.values(input.tool_response?.answers || {}).map((a) => String(a).trim());
  const label = APPROVAL_OPTIONS[s.pending.kind];
  const pending = s.pending;
  s.pending = null;
  if (!answers.includes(label)) { saveState(work, s); return; }
  if (pending.kind === 'spec') {
    const page = s.spec?.confluence;
    const stillSame = pending.version ? page?.version === pending.version : fileHash(join(factoryDir(work), 'spec.html')) === pending.draftHash;
    if (!stillSame) {
      saveState(work, s);
      context('PostToolUse', '[factory] The spec changed after the approval question. The approval is NOT recorded. Ask again.');
    }
  }
  s.approvals = { ...s.approvals, [pending.kind]: { ...pending, at: now() } };
  saveState(work, s);
  context('PostToolUse', `[factory] Recorded: ${label}.`);
}

// ---------- subagent limit ----------

const AGENTS_DIR = join(HOME_DIR, 'agents');

function withAgents(fn) {
  mkdirSync(AGENTS_DIR, { recursive: true });
  const lock = join(AGENTS_DIR, `${sid}.lock`);
  for (let i = 0; i < 200; i++) {
    try { mkdirSync(lock); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 10e3) rmSync(lock, { recursive: true, force: true }); } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const file = join(AGENTS_DIR, `${sid}.json`);
    const st = readJson(file, { res: {}, stopped: [] });
    for (const [k, v] of Object.entries(st.res)) if (Date.now() - Date.parse(v.at) > 3 * 3600e3) delete st.res[k];
    const result = fn(st);
    writeJson(file, st);
    return result;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

function onAgentPre() {
  if (!isFactorySession()) return;
  const max = config().maxSubagents;
  const verdict = withAgents((st) => {
    const running = Object.keys(st.res).length;
    if (running >= max) return `running ${running}`;
    st.res[input.tool_use_id] = { at: now(), agentId: null, type: input.tool_input?.subagent_type };
    return null;
  });
  if (verdict) deny(`Subagent limit reached (${verdict} of ${max}). Wait for a subagent to finish, or do the task yourself.`);
}

function onAgentPost() {
  if (!isFactorySession()) return;
  const resp = input.tool_response || {};
  withAgents((st) => {
    const r = st.res[input.tool_use_id];
    if (!r) return;
    r.agentId = resp.agentId || null;
    const done = resp.status === 'completed' || (r.agentId && st.stopped.includes(r.agentId));
    if (done) { delete st.res[input.tool_use_id]; st.stopped = st.stopped.filter((a) => a !== r.agentId); }
  });
}

function onAgentFailure() {
  if (!isFactorySession()) return;
  withAgents((st) => { delete st.res[input.tool_use_id]; });
}

function onSubagentStop() {
  if (!isFactorySession() || !input.agent_id) return;
  withAgents((st) => {
    const key = Object.keys(st.res).find((k) => st.res[k].agentId === input.agent_id);
    if (key) delete st.res[key];
    else st.stopped = [...st.stopped.slice(-50), input.agent_id];
  });
}

// ---------- context limit ----------

function lastContextTokens(transcript) {
  const fd = openSync(transcript, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"usage"')) continue;
      try {
        const d = JSON.parse(line);
        const u = d?.message?.usage;
        if (d.type === 'assistant' && !d.isSidechain && u) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      } catch {}
    }
  } finally { closeSync(fd); }
  return 0;
}

function onStop() {
  if (input.stop_hook_active || !isFactorySession() || !input.transcript_path) return;
  const tokens = lastContextTokens(input.transcript_path);
  const limit = config().contextLimitTokens;
  if (tokens < limit) return;
  const sess = readJson(sessionFile(sid), {});
  // Warn once at the limit, then again for each 50,000 more tokens.
  if (sess.warnedAt && tokens < sess.warnedAt + 50000) return;
  writeJson(sessionFile(sid), { ...sess, warnedAt: tokens });
  out({
    decision: 'block',
    reason: `[factory] The context is ${tokens} tokens, above the limit of ${limit}. Finish only the current task. Update the state with work.mjs and write the handoff in the .factory files. Then tell the user, in one sentence, to type /clear. The factory continues after /clear with the saved state.`,
  });
}

const handlers = {
  SessionStart: onSessionStart,
  UserPromptSubmit: onUserPromptSubmit,
  Edit: onEdit,
  Bash: onBash,
  AskUserQuestion: onAskUserQuestion,
  AgentPre: onAgentPre,
  AgentPost: onAgentPost,
  AgentFailure: onAgentFailure,
  SubagentStop: onSubagentStop,
  Stop: onStop,
};

try { handlers[event]?.(); } catch (e) {
  // Fail open: report the problem in the debug log, never block the user because of a hook bug.
  process.stderr.write(`[factory hook ${event}] ${e.stack || e}\n`);
}
process.exit(0);
