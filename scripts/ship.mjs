#!/usr/bin/env node
// Approver git flow. Usage: node ship.mjs <command> [options]. Run with no command for help.
// Rules: no rebase, no force push, staging branches change only by a merge of the work branch.
// A merge conflict stops the flow and stays in place for a human.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { workDirFromPath, factoryDir, loadState, saveState, readJson, writeJson, tryGit, now } from './lib.mjs';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const HELP = `ship.mjs commands (inside a work folder):
  plan                         show branches, PR titles and what the next steps do
  push                         push the work branch of each repo (needs the push approval)
  staging                      make or update the staging branch and merge the work branch into it
  prs --summary-file <f>       open or update the draft PR to main and the PR to staging
  share-test-plan              share .factory/test-plan.html with a password, or update the share
Options: --work <dir>, --repo <name> (one repo only)`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;

function die(msg) { console.error(msg); process.exit(1); }

const work = workDirFromPath(opt.work || process.cwd()) || die('No work folder found.');
const s = loadState(work);
const repos = Object.entries(s.repos).filter(([name]) => !opt.repo || name === opt.repo);
if (!repos.length) die('No repos in this work.');

const phaseTag = `P${String(s.phase).padStart(2, '0')}`;
const stagingBranch = s.mode === 'phased' ? `${s.type}/staging/${s.ticket}/p${s.phase}` : `${s.type}/staging/${s.ticket}`;
const mainTitle = `${s.type}(${s.ticket}) - ${s.title}`;
const stagingTitle = `[STAGING] ${s.type}(${s.ticket}${s.mode === 'phased' ? `/${phaseTag}` : ''}) - ${s.title}`;

function requirePushApproval() {
  const a = s.approvals?.push;
  if (!a || a.phase !== s.phase) die(`No push approval for phase ${s.phase}. Run "work.mjs request-approval push" and ask the user.`);
}

function gh(cwd, args) {
  try { return { ok: true, out: execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() }; }
}

function fill(template, values) {
  return readFileSync(join(TEMPLATES, template), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `(no ${k})`);
}

function prFor(cwd, head, base) {
  const r = gh(cwd, ['pr', 'list', '--head', head, '--base', base, '--state', 'open', '--json', 'url,number', '--jq', '.[0]']);
  return r.ok && r.out ? JSON.parse(r.out) : null;
}

const commands = {
  plan() {
    console.log(`ticket ${s.ticket}, ${s.mode}${s.mode === 'phased' ? ` phase ${s.phase}` : ''}`);
    console.log(`main PR title:    ${mainTitle} (draft)`);
    console.log(`staging PR title: ${stagingTitle} (open)`);
    for (const [name, r] of repos) {
      const ahead = tryGit(r.path, ['rev-list', '--count', 'origin/main..HEAD']).out;
      const dirty = tryGit(r.path, ['status', '--porcelain']).out;
      console.log(`- ${name}: ${r.branch} -> main (${ahead} commits ahead${dirty ? ', UNCOMMITTED CHANGES' : ''}); ${stagingBranch} -> staging`);
    }
    console.log(`push approval for this phase: ${s.approvals?.push?.phase === s.phase ? 'yes' : 'no'}`);
  },

  push() {
    requirePushApproval();
    for (const [name, r] of repos) {
      const res = tryGit(r.path, ['push', '-u', 'origin', r.branch]);
      if (!res.ok) die(`${name}: push failed. Stop and tell the user.\n${res.out}`);
      console.log(`${name}: pushed ${r.branch}`);
    }
  },

  staging() {
    requirePushApproval();
    for (const [name, r] of repos) {
      const src = join(s.workspace, name);
      const dest = join(work, '.staging', name);
      if (!tryGit(src, ['fetch', 'origin', 'staging']).ok) die(`${name}: git fetch origin staging failed.`);
      if (!existsSync(dest)) {
        const exists = tryGit(src, ['rev-parse', '--verify', '--quiet', `refs/heads/${stagingBranch}`]).ok;
        const remote = tryGit(src, ['ls-remote', '--exit-code', '--heads', 'origin', stagingBranch]).ok;
        mkdirSync(dirname(dest), { recursive: true });
        let res;
        if (exists) res = tryGit(src, ['worktree', 'add', dest, stagingBranch]);
        else if (remote) { tryGit(src, ['fetch', 'origin', stagingBranch]); res = tryGit(src, ['worktree', 'add', '--track', '-b', stagingBranch, dest, `origin/${stagingBranch}`]); }
        else res = tryGit(src, ['worktree', 'add', '-b', stagingBranch, dest, 'origin/staging']);
        if (!res.ok) die(`${name}: could not make ${stagingBranch}.\n${res.out}`);
      } else {
        const pull = tryGit(dest, ['pull', '--ff-only', 'origin', stagingBranch]);
        if (!pull.ok && !/couldn't find remote ref/i.test(pull.out)) die(`${name}: could not update ${stagingBranch}. Stop and tell the user.\n${pull.out}`);
      }
      const merge = tryGit(dest, ['merge', '--ff', '--no-edit', r.branch]);
      if (!merge.ok) {
        const files = tryGit(dest, ['diff', '--name-only', '--diff-filter=U']).out;
        die(`MERGE CONFLICT in ${name} (${stagingBranch} <- ${r.branch}). The merge stays in place at ${dest}.\nConflicting files:\n${files || merge.out}\nStop. Tell the user. Do not resolve the conflict unless the user asks.`);
      }
      const push = tryGit(dest, ['push', '-u', 'origin', stagingBranch]);
      if (!push.ok) die(`${name}: push of ${stagingBranch} failed.\n${push.out}`);
      r.staging = { ...(r.staging || {}), [`p${s.phase}`]: { branch: stagingBranch } };
      console.log(`${name}: merged ${r.branch} into ${stagingBranch} and pushed`);
    }
    saveState(work, s);
  },

  prs() {
    requirePushApproval();
    const summary = opt['summary-file'] ? readFileSync(opt['summary-file'], 'utf8').trim() : die('--summary-file is required (short points).');
    const specUrl = s.spec?.confluence?.url;
    const testPlanUrl = s.testPlan?.url;
    for (const [name, r] of repos) {
      let main = prFor(r.path, r.branch, 'main');
      const mainBody = fill('pr-main.md', { specUrl, summary, testPlanUrl });
      if (main) gh(r.path, ['pr', 'edit', String(main.number), '--title', mainTitle, '--body', mainBody]);
      else {
        const c = gh(r.path, ['pr', 'create', '--draft', '--base', 'main', '--head', r.branch, '--title', mainTitle, '--body', mainBody]);
        if (!c.ok) die(`${name}: could not open the main PR.\n${c.out}`);
        main = { url: c.out.split('\n').pop() };
      }
      r.mainPr = main.url;
      const stage = r.staging?.[`p${s.phase}`];
      if (!stage) { console.log(`${name}: main PR ${main.url}. No staging branch for this phase yet.`); continue; }
      let st = prFor(r.path, stage.branch, 'staging');
      const stBody = fill('pr-staging.md', { specUrl, mainPrUrl: main.url, summary, testPlanUrl });
      if (st) gh(r.path, ['pr', 'edit', String(st.number), '--title', stagingTitle, '--body', stBody]);
      else {
        const c = gh(r.path, ['pr', 'create', '--base', 'staging', '--head', stage.branch, '--title', stagingTitle, '--body', stBody]);
        if (!c.ok) die(`${name}: could not open the staging PR.\n${c.out}`);
        st = { url: c.out.split('\n').pop() };
      }
      stage.pr = st.url;
      console.log(`${name}: main PR ${main.url}, staging PR ${st.url}`);
    }
    saveState(work, s);
  },

  'share-test-plan'() {
    const file = join(factoryDir(work), 'test-plan.html');
    if (!existsSync(file)) die('No .factory/test-plan.html.');
    const secretsFile = join(factoryDir(work), 'secrets.json');
    const secrets = readJson(secretsFile, {});
    const prev = secrets.testPlanShare;
    const args = ['-y', 'lavish-axi', 'share', file];
    if (prev?.siteId && prev?.updateKey) args.push('--site', prev.siteId, '--update-key', prev.updateKey);
    else args.push('--private');
    let out;
    try { out = execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { die(`Share failed.\n${e.stdout || ''}${e.stderr || ''}`); }
    const pick = (re) => out.match(re)?.[1]?.trim().replace(/^"|"$/g, '');
    const share = {
      ...prev,
      url: pick(/url:\s*(\S+)/i) || prev?.url,
      siteId: pick(/site(?:_id)?:\s*(\S+)/i) || prev?.siteId,
      updateKey: pick(/update_key:\s*(\S+)/i) || prev?.updateKey,
      password: pick(/password:\s*(\S+)/i) || prev?.password,
      at: now(),
      raw: prev ? prev.raw : out,
    };
    secrets.testPlanShare = share;
    writeJson(secretsFile, secrets);
    s.testPlan = { url: share.url };
    saveState(work, s);
    console.log(`test plan: ${share.url}${prev ? ' (updated in place)' : ''}\nThe password and update key are in .factory/secrets.json. Do not print the password unless the user asks.`);
  },
};

if (!cmd || !commands[cmd]) { console.log(HELP); process.exit(cmd ? 1 : 0); }
commands[cmd]();
