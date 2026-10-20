#!/usr/bin/env node
// Work folder and state CLI. Usage: node work.mjs <command> [args]. Run with no command for help.
import { existsSync, readdirSync, mkdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  APPROVAL_OPTIONS, HOME_DIR, workDirFromPath, factoryDir, loadState, saveState, writeJson,
  sessionFile, specGate, fileHash, tryGit, now, config,
} from './lib.mjs';

const HELP = `work.mjs commands:
  detect <TICKET> --workspace <dir>           find branches and work folders for a ticket
  init <TICKET> --workspace <dir> --type feat|fix --title <t> [--mode single|phased] [--epic <KEY>]
  add-repo <repo> [--branch <name>]            make a worktree for <repo> on the work branch
  attach --session <id>                        mark a session as a factory session
  status                                       short state summary
  set <dotted.key> <value>                     set a state value (not approvals or pending)
  request-approval spec|push|release           record what the next approval question covers
  spec-published --page-id <id> --url <u> --version <n> --space <key> [--parent-id <id>]
  spec-version <n>                             record a new Confluence version of the spec
  spec-cache --version <n> --from <file>       replace spec.cache.md with a fresh copy of the Confluence page
  gate                                         show if code edits are allowed
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
    const work = join(ws, 'worktrees', ticket);
    if (existsSync(join(work, '.factory', 'state.json'))) { console.log(`exists: ${work}`); return commands.status(work); }
    mkdirSync(join(work, '.factory'), { recursive: true });
    saveState(work, {
      ticket, type, title: opt.title || '', workspace: ws,
      epic: opt.epic ? { key: opt.epic } : null,
      mode: opt.mode === 'phased' ? 'phased' : 'single',
      stage: 'context', phase: 1, phases: 1,
      repos: {}, spec: {}, approvals: {}, pending: null,
      release: {}, testPlan: {}, created: now(),
    });
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
    const work = currentWork();
    const id = opt.session || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID;
    if (!id) die('Session ID is required: --session <id>.');
    writeJson(sessionFile(id), { workDir: work, at: now() });
    writeJson(join(HOME_DIR, 'last.json'), { workDir: work, at: now() });
    console.log(`attached session ${id} to ${work}`);
  },

  status(workArg) {
    const work = typeof workArg === 'string' ? workArg : currentWork();
    const s = loadState(work);
    const gate = specGate(work, s);
    const page = s.spec?.confluence;
    const lines = [
      `${s.ticket} (${s.type}, ${s.mode}${s.mode === 'phased' ? `, phase ${s.phase}/${s.phases}` : ''}) - ${s.title || 'no title'}`,
      `stage: ${s.stage}. work folder: ${work}`,
      `repos: ${Object.entries(s.repos).map(([k, v]) => `${k} (${v.branch})`).join(', ') || 'none'}`,
      `spec: ${page?.url ? `Confluence v${page.version} ${page.url}` : existsSync(join(factoryDir(work), 'spec.html')) ? 'draft .factory/spec.html' : 'not started'}. code edits: ${gate.open ? 'allowed' : `blocked (${gate.why})`}`,
    ];
    if (s.pending) lines.push(`waiting for your answer: "${APPROVAL_OPTIONS[s.pending.kind]}"`);
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
  },

  'request-approval'() {
    const work = currentWork();
    const [kind] = pos;
    if (!APPROVAL_OPTIONS[kind]) die('Kind must be spec, push or release.');
    const s = loadState(work);
    const pending = { kind, phase: s.phase, at: now() };
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
    console.log(`Ask with AskUserQuestion. Use the option label "${APPROVAL_OPTIONS[kind]}" and a second option "Discuss changes".`);
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
};

if (!cmd || !commands[cmd]) { console.log(HELP); process.exit(cmd ? 1 : 0); }
commands[cmd]();
