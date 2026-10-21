#!/usr/bin/env node
// Work folder and state CLI. Usage: node work.mjs <command> [args]. Run with no command for help.
import { existsSync, readdirSync, mkdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  APPROVAL_OPTIONS, BATCH_OPTIONS, HOME_DIR, ROLE_AGENT, modelAdvice, workDirFromPath, factoryDir, loadState, saveState,
  writeJson, readJson, sessionFile, specGate, fileHash, tryGit, now, config, batchDir, batchFile,
} from './lib.mjs';

const HELP = `work.mjs commands:
  detect <TICKET> --workspace <dir>           find branches and work folders for a ticket
  init <TICKET> --workspace <dir> --type feat|fix --title <t> [--mode single|phased] [--epic <KEY>] [--url <jira url>]
  add-repo <repo> [--branch <name>]            make a worktree for <repo> on the work branch
  attach --session <id>                        mark a session as a factory session
  attach --session <id> --batch <id> --workspace <dir>   attach a session to a batch
  status                                       short state summary
  set <dotted.key> <value>                     set a state value (not approvals or pending)
  request-approval spec|push|release           record what the next approval question covers
  request-approval fixnote|push --batch <id> --workspace <dir> --keys K1,K2   approval for batch items
Batch mode:
  batch-init --workspace <dir> [--session <id>]                       make a new batch and attach the session
  batch-add <KEY> --kind fix|investigation --title <t> [--url <jira url>] --batch <id> --workspace <dir>
  batch-set <KEY> <field> <value> --batch <id> --workspace <dir>       set stage, note or jiraComment of an item
  batch-status [--batch <id>] --workspace <dir>                       show the board (default: the newest batch)
  spec-published --page-id <id> --url <u> --version <n> --space <key> [--parent-id <id>]
  spec-version <n>                             record a new Confluence version of the spec
  spec-cache --version <n> --from <file>       replace spec.cache.md with a fresh copy of the Confluence page
  gate                                         show if code edits are allowed
  models                                       model and effort for each stage and subagent role
Options: --work <dir> selects the work folder. The default is the current directory.`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const pos = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  else pos.push(argv[i]);
}

function die(msg) { console.error(msg); process.exit(1); }

function currentWork() {
  const dir = workDirFromPath(opt.work || process.cwd());
  if (!dir) die('No work folder found. Use --work <dir> or run inside worktrees/<TICKET>/.');
  return dir;
}

function repoDirs(workspace) {
  return readdirSync(workspace).filter((d) => {
    if (d === 'worktrees' || d.startsWith('.')) return false;
    const p = join(workspace, d);
    return statSync(p).isDirectory() && existsSync(join(p, '.git'));
  });
}

// A new Confluence version closes the spec gate until the user approves that version.
function setSpecVersion(work, version) {
  const s = loadState(work);
  if (!s.spec?.confluence) die('The spec is not on Confluence yet.');
  s.spec.confluence.version = version;
  saveState(work, s);
  const gate = specGate(work, s);
  console.log(`spec is v${version}. code edits: ${gate.open ? 'allowed' : `blocked (${gate.why}) Ask for approval again.`}`);
}

function createWork(ws, ticket, f) {
  const work = join(ws, 'worktrees', ticket);
  if (existsSync(join(work, '.factory', 'state.json'))) return { work, created: false };
  mkdirSync(join(work, '.factory'), { recursive: true });
  saveState(work, {
    ticket, type: f.type, title: f.title || '', workspace: ws,
    epic: f.epic ? { key: f.epic } : null, jiraUrl: f.url || null,
    mode: f.mode, batch: f.batch || null,
    stage: f.mode === 'batch' ? 'note' : 'context', phase: 1, phases: 1,
    repos: {}, spec: {}, approvals: {}, pending: null,
    release: {}, testPlan: {}, created: now(),
  });
  return { work, created: true };
}

function batchArgs() {
  const ws = resolve(opt.workspace || die('--workspace is required'));
  let id = opt.batch;
  if (!id) {
    const dir = join(ws, 'worktrees', '.batches');
    id = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'batch.json'))).sort().at(-1) : null;
    if (!id) die('No batch found. Run batch-init first.');
  }
  const file = batchFile(ws, id);
  const batch = readJson(file) || die(`No batch file: ${file}`);
  return { ws, id, file, batch };
}

function attachBatch(sessionId, file) {
  writeJson(sessionFile(sessionId), { workDir: null, batchFile: file, at: now() });
  writeJson(join(HOME_DIR, 'last.json'), { batchFile: file, at: now() });
}

const commands = {
  detect() {
    const [ticket] = pos;
    const ws = resolve(opt.workspace || die('--workspace is required'));
    if (!ticket) die('Ticket is required.');
    const work = join(ws, 'worktrees', ticket);
    console.log(`work folder: ${existsSync(join(work, '.factory', 'state.json')) ? `${work} (factory state exists)` : existsSync(work) ? `${work} (no factory state)` : 'none'}`);
    let hits = 0;
    for (const repo of repoDirs(ws)) {
      const r = tryGit(join(ws, repo), ['branch', '-a', '--list', `*${ticket}*`, '--format=%(refname:short)']);
      if (r.ok && r.out) { hits++; console.log(`${repo}: ${r.out.split('\n').join(', ')}`); }
    }
    if (!hits) console.log('branches: none in local refs (run git fetch in a repo to see newer remote branches)');
  },

  init() {
    const [ticket] = pos;
    const ws = resolve(opt.workspace || die('--workspace is required'));
    if (!ticket || !/^[A-Z][A-Z0-9]+-\d+$/.test(ticket)) die('Ticket must look like SH-123456.');
    const type = opt.type || die('--type feat|fix is required');
    if (!['feat', 'fix'].includes(type)) die('--type must be feat or fix.');
    const mode = opt.mode === 'phased' ? 'phased' : 'single';
    const { work, created } = createWork(ws, ticket, { type, title: opt.title, epic: opt.epic, url: opt.url, mode });
    if (!created) { console.log(`exists: ${work}`); return commands.status(work); }
    console.log(`created: ${work}`);
  },

  'add-repo'() {
    const work = currentWork();
    const s = loadState(work);
    const [repo] = pos;
    if (!repo) die('Repo name is required.');
    const src = join(s.workspace, repo);
    if (!existsSync(join(src, '.git'))) die(`Not a git repo: ${src}`);
    const branch = opt.branch || `${s.type}/${s.ticket}`;
    const dest = join(work, repo);
    if (existsSync(dest)) die(`Exists: ${dest}`);
    const fetch = tryGit(src, ['fetch', 'origin', 'main']);
    if (!fetch.ok) die(`git fetch failed in ${repo}:\n${fetch.out}`);
    const local = tryGit(src, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
    const remote = tryGit(src, ['ls-remote', '--exit-code', '--heads', 'origin', branch]).ok;
    let r;
    if (local) r = tryGit(src, ['worktree', 'add', dest, branch]);
    else if (remote) {
      tryGit(src, ['fetch', 'origin', branch]);
      r = tryGit(src, ['worktree', 'add', '--track', '-b', branch, dest, `origin/${branch}`]);
    } else r = tryGit(src, ['worktree', 'add', '-b', branch, dest, 'origin/main']);
    if (!r.ok) die(`git worktree add failed:\n${r.out}`);
    s.repos[repo] = { path: dest, branch, base: local ? 'local branch' : remote ? 'remote branch' : 'origin/main' };
    saveState(work, s);
    console.log(`${repo}: ${dest} on ${branch} (from ${s.repos[repo].base})`);
  },

  attach() {
    const id = opt.session || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID;
    if (!id) die('Session ID is required: --session <id>.');
    if (opt.batch) {
      const { file } = batchArgs();
      attachBatch(id, file);
      return console.log(`attached session ${id} to batch ${opt.batch}`);
    }
    const work = currentWork();
    writeJson(sessionFile(id), { workDir: work, at: now() });
    writeJson(join(HOME_DIR, 'last.json'), { workDir: work, at: now() });
    console.log(`attached session ${id} to ${work}`);
  },

  status(workArg) {
    const work = typeof workArg === 'string' ? workArg : currentWork();
    const s = loadState(work);
    const gate = specGate(work, s);
    const page = s.spec?.confluence;
    const specLine = s.mode === 'batch'
      ? `fix note: ${existsSync(join(factoryDir(work), 'fix-note.md')) ? '.factory/fix-note.md' : 'not written'}${s.batch ? ` (batch ${s.batch})` : ''}`
      : `spec: ${page?.url ? `Confluence v${page.version} ${page.url}` : existsSync(join(factoryDir(work), 'spec.html')) ? 'draft .factory/spec.html' : 'not started'}`;
    const lines = [
      `${s.ticket} (${s.type}, ${s.mode}${s.mode === 'phased' ? `, phase ${s.phase}/${s.phases}` : ''}) - ${s.title || 'no title'}`,
      `stage: ${s.stage}. work folder: ${work}`,
      `repos: ${Object.entries(s.repos).map(([k, v]) => `${k} (${v.branch})`).join(', ') || 'none'}`,
      `${specLine}. code edits: ${gate.open ? 'allowed' : `blocked (${gate.why})`}`,
    ];
    if (s.pending) lines.push(`waiting for your answer: "${s.pending.label || APPROVAL_OPTIONS[s.pending.kind]}"`);
    lines.push(`handoff files: ${['context.md', 'facts.md', 'spec.cache.md', 'test-plan.html', 'release-notes.md'].filter((f) => existsSync(join(factoryDir(work), f))).join(', ') || 'none'}`);
    console.log(lines.join('\n'));
  },

  set() {
    const work = currentWork();
    const [key, raw] = pos;
    if (!key || raw === undefined) die('Usage: set <dotted.key> <value>');
    const top = key.split('.')[0];
    if (['approvals', 'pending'].includes(top)) die('Approvals come only from your answer to an approval question.');
    let value; try { value = JSON.parse(raw); } catch { value = raw; }
    const s = loadState(work);
    const parts = key.split('.');
    let o = s;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = value;
    saveState(work, s);
    console.log(`${key} = ${JSON.stringify(value)}`);
    if (key === 'stage') console.log(`Next session: ${modelAdvice(value)}`);
  },

  'request-approval'() {
    const [kind] = pos;
    if (opt.batch || opt.keys) return requestBatchApproval(kind);
    const work = currentWork();
    if (!APPROVAL_OPTIONS[kind]) die('Kind must be spec, push or release.');
    const s = loadState(work);
    const pending = { kind, label: APPROVAL_OPTIONS[kind], phase: s.phase, at: now() };
    if (kind === 'spec') {
      const page = s.spec?.confluence;
      if (page?.version) pending.version = page.version;
      else {
        pending.draftHash = fileHash(join(factoryDir(work), 'spec.html'));
        if (!pending.draftHash) die('No .factory/spec.html to approve.');
      }
    }
    s.pending = pending;
    saveState(work, s);
    console.log(`Ask with AskUserQuestion. Use the option label "${pending.label}" and a second option "Discuss changes".`);
  },

  'spec-published'() {
    const work = currentWork();
    const s = loadState(work);
    const version = Number(opt.version);
    if (!opt['page-id'] || !opt.url || !version) die('--page-id, --url and --version are required.');
    const a = s.approvals?.spec;
    const hash = fileHash(join(factoryDir(work), 'spec.html'));
    s.spec = { ...s.spec, confluence: { pageId: opt['page-id'], url: opt.url, version, spaceKey: opt.space, parentId: opt['parent-id'] } };
    // The approval moves from the draft to the published page only when the draft did not change.
    if (a?.draftHash && a.draftHash === hash && !a.version) a.version = version;
    saveState(work, s);
    const gate = specGate(work, s);
    console.log(`spec published as v${version}. code edits: ${gate.open ? 'allowed' : `blocked (${gate.why})`}`);
  },

  'spec-version'() {
    const version = Number(pos[0]);
    if (!version) die('Usage: spec-version <n>');
    setSpecVersion(currentWork(), version);
  },

  'spec-cache'() {
    const work = currentWork();
    const version = Number(opt.version);
    if (!version || !opt.from || !existsSync(opt.from)) die('Usage: spec-cache --version <n> --from <file>');
    const s = loadState(work);
    const page = s.spec?.confluence;
    if (!page) die('The spec is not on Confluence yet. Run spec-published first.');
    const body = readFileSync(opt.from, 'utf8');
    writeFileSync(join(factoryDir(work), 'spec.cache.md'), `<!-- Read-only copy of Confluence page ${page.pageId} v${version}. Change the page, not this file. -->\n${body}`);
    rmSync(opt.from, { force: true });
    console.log(`spec.cache.md is v${version}`);
    if (version !== page.version) setSpecVersion(work, version);
  },

  gate() {
    const work = currentWork();
    const g = specGate(work, loadState(work));
    console.log(g.open ? 'code edits: allowed' : `code edits: blocked (${g.why})`);
  },

  config() { console.log(JSON.stringify({ ...config(), home: HOME_DIR })); },

  models() {
    const c = config();
    console.log('Main session (you select it with /model and /effort):');
    for (const [stage, m] of Object.entries(c.stages)) console.log(`  ${stage}: ${m.model}, ${m.effort}`);
    console.log('Subagents (pass model and effort in each Agent call; a hook blocks other values):');
    for (const [role, m] of Object.entries(c.agents)) console.log(`  ${role}: subagent_type factory:${ROLE_AGENT[role]}, model ${m.model}, effort ${m.effort}`);
  },
};

// Batch approvals: one pending record in each work. One question can hold four options at most.
function requestBatchApproval(kind) {
  if (!BATCH_OPTIONS[kind]) die('Batch kind must be fixnote or push.');
  const { ws } = batchArgs();
  const keys = String(opt.keys || die('--keys K1,K2 is required')).split(',').map((k) => k.trim()).filter(Boolean);
  const labels = [];
  for (const key of keys) {
    const work = join(ws, 'worktrees', key);
    const s = loadState(work) || die(`No work folder for ${key}.`);
    const pending = { kind, label: BATCH_OPTIONS[kind](key), phase: s.phase, at: now() };
    if (kind === 'fixnote') {
      pending.hash = fileHash(join(factoryDir(work), 'fix-note.md'));
      if (!pending.hash) die(`No .factory/fix-note.md for ${key}.`);
    }
    s.pending = pending;
    saveState(work, s);
    labels.push(pending.label);
  }
  const groups = [];
  for (let i = 0; i < labels.length; i += 3) groups.push(labels.slice(i, i + 3));
  console.log('Ask with AskUserQuestion, multiSelect true. Each question holds at most 3 item options plus "Discuss changes".');
  groups.forEach((g, i) => console.log(`question ${i + 1}: ${g.map((l) => `"${l}"`).join(', ')}, "Discuss changes"`));
}

Object.assign(commands, {
  'batch-init'() {
    const ws = resolve(opt.workspace || die('--workspace is required'));
    const day = now().slice(0, 10);
    const dir = join(ws, 'worktrees', '.batches');
    let id;
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') { id = `${day}-${letter}`; if (!existsSync(join(dir, id))) break; }
    const file = batchFile(ws, id);
    writeJson(file, { id, workspace: ws, created: now(), items: [] });
    mkdirSync(join(batchDir(ws, id), 'reports'), { recursive: true });
    if (opt.session) attachBatch(opt.session, file);
    console.log(`batch ${id}: ${batchDir(ws, id)}${opt.session ? ` (session ${opt.session} attached)` : ''}`);
  },

  'batch-add'() {
    const { ws, id, file, batch } = batchArgs();
    const [key] = pos;
    if (!key || !/^[A-Z][A-Z0-9]+-\d+$/.test(key)) die('Ticket must look like SH-123456. Make the Jira ticket first.');
    const kind = opt.kind;
    if (!['fix', 'investigation'].includes(kind)) die('--kind must be fix or investigation.');
    let item = batch.items.find((i) => i.key === key);
    if (!item) { item = { key, kind, title: opt.title || '', url: opt.url || null, stage: kind === 'fix' ? 'note' : 'investigate', work: null, jiraComment: false }; batch.items.push(item); }
    else Object.assign(item, { kind, title: opt.title || item.title, url: opt.url || item.url });
    if (kind === 'fix' && !item.work) {
      const { work } = createWork(ws, key, { type: 'fix', title: item.title, url: item.url, mode: 'batch', batch: id });
      item.work = work;
    }
    writeJson(file, batch);
    console.log(`${key}: ${kind}${item.work ? `, work folder ${item.work}` : ''}`);
  },

  'batch-set'() {
    const { file, batch } = batchArgs();
    const [key, field, raw] = pos;
    if (!['stage', 'note', 'jiraComment', 'title', 'url'].includes(field)) die('Field must be stage, note, jiraComment, title or url.');
    const item = batch.items.find((i) => i.key === key) || die(`No item ${key} in the batch.`);
    let value; try { value = JSON.parse(raw); } catch { value = raw; }
    item[field] = value;
    writeJson(file, batch);
    console.log(`${key}.${field} = ${JSON.stringify(value)}`);
  },

  'batch-status'() {
    const { id, batch, ws } = batchArgs();
    console.log(`batch ${id} (${batchDir(ws, id)})`);
    for (const item of batch.items) {
      if (item.kind === 'investigation') {
        console.log(`${item.key}  investigation  stage ${item.stage}  Jira comment: ${item.jiraComment ? 'yes' : 'no'}  ${item.title}`);
        continue;
      }
      const s = loadState(item.work);
      const repos = Object.keys(s?.repos || {}).join(',') || '-';
      const prs = Object.values(s?.repos || {}).filter((r) => r.mainPr).length;
      const gate = s ? specGate(item.work, s) : { open: false };
      console.log(`${item.key}  fix  ${repos}  stage ${s?.stage}  note ${gate.open ? 'approved' : 'not approved'}  PRs ${prs}  ${item.title}`);
    }
  },
});

if (!cmd || !commands[cmd]) { console.log(HELP); process.exit(cmd ? 1 : 0); }
commands[cmd]();
