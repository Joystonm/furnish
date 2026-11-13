#!/usr/bin/env node
/**
 * The verification run.
 *
 * This is the script that turns the flows into a ledger. It runs every flow
 * with kane-cli against the running app, records what each run found, and
 * writes the result to `public/runs.json` — which the app reads and shows on
 * its Ledger tab, next to the plan it just drew.
 *
 * Two things it is careful about:
 *
 *   - the failures are kept. A ledger that only holds the passes is a
 *     certificate, not a record, and the one run that failed is the most
 *     interesting thing in it;
 *   - the app's own findings are computed by the app's own code. The report
 *     module is bundled and run here, so the number in the ledger is the
 *     number the browser showed, not a number written by hand.
 *
 * Usage:
 *   node scripts/verify.mjs                  run every flow
 *   node scripts/verify.mjs --only <slug>   run one flow
 *   node scripts/verify.mjs --dry-run       list the flows and stop
 *   node scripts/verify.mjs --rebuild       rebuild the ledger from the
 *                                            recorded results, spending
 *                                            nothing
 *
 * The app has to be running on port 5199 (`npm run dev`, or `npm run build`
 * and then `npm run preview`) for the flows to have anything to look at.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLOWS_DIR = join(ROOT, 'flows');
const RESULTS_DIR = join(ROOT, '.testmuai', 'results');
const MEASUREMENTS_DIR = join(ROOT, 'measurements');
const LEDGER = join(ROOT, 'public', 'runs.json');
const APP_URL = process.env.FURNISH_URL ?? 'http://localhost:5199';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

// ---------------------------------------------------------------- the flows

/**
 * Read the flows.
 *
 * A flow is a markdown file with a title, the acceptance criteria it covers
 * and an objective. The objective is what kane-cli is asked to do, in plain
 * English — the same words a person would use.
 */
function readFlows() {
  if (!existsSync(FLOWS_DIR)) return [];
  return readdirSync(FLOWS_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const text = readFileSync(join(FLOWS_DIR, name), 'utf8');
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
      const covers = text.match(/\*\*Covers:\*\*\s*(.+)$/m)?.[1]?.trim() ?? '';
      const objective = text.split(/^##\s+Objective\s*$/m)[1]?.trim() ?? '';
      return { slug: name.replace(/\.md$/, ''), name: title, covers, objective };
    })
    .filter((flow) => flow.objective.length > 0);
}

// -------------------------------------------------- the app's own findings

/**
 * The app's own checker, run here.
 *
 * The report module is the same one the browser imports, so the findings in
 * the ledger are the findings the app showed. It is bundled with esbuild
 * because Node cannot import the TypeScript sources directly.
 */
async function appFindings() {
  const cache = join(ROOT, 'node_modules', '.cache', 'furnish-report.mjs');
  mkdirSync(dirname(cache), { recursive: true });
  // esbuild is a dependency of vite, so it is in the project's own bin folder
  // rather than on the machine's PATH.
  const esbuild = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  const bundled = spawnSync(
    esbuild,
    [
      join(ROOT, 'src', 'model', 'report.ts'),
      '--bundle',
      '--format=esm',
      '--platform=node',
      '--outfile=' + cache,
      '--log-level=error',
    ],
    { stdio: 'inherit', shell: true },
  );
  if (bundled.status !== 0) return null;
  const module = await import(pathToFileURL(cache).href + '?t=' + process.pid);
  const report = module.report();
  if (report.plan !== 'drawn' || !report.summary) return null;
  return {
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    notes: report.summary.notes,
    reachable: report.summary.reachable,
    total: report.summary.total,
    issues: report.summary.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      title: issue.title,
      rooms: issue.rooms,
    })),
  };
}

// --------------------------------------------------------------- the commit

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

// ------------------------------------------------------------------- kane

/**
 * Run one flow with kane-cli and read what it says.
 *
 * kane-cli writes NDJSON on stdout: a stream of events, and at the end a
 * `run_end` event with the verdict, the duration and the credits it cost.
 *
 * The stream is read as it arrives rather than collected into one buffer. A
 * browser run produces a lot of output, and a fixed buffer would cut the run
 * off before it finished.
 */
function runFlow(flow) {
  return new Promise((resolve) => {
    const child = spawn('kane-cli', ['run', flow.objective, '--agent', '--name', flow.slug], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { KANE_CLI_USER_AGENT: 'claude-code' }),
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      resolve(didNotRun('kane-cli could not be started: ' + error.message));
    });

    child.on('close', (code) => {
      const events = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          events.push(JSON.parse(trimmed));
        } catch {
          // not an event — the CLI prints other things too
        }
      }

      const end = events.find((event) => event.type === 'run_end');
      const steps = events.filter(
        (event) => !event.type && (event.status === 'done' || event.status === 'failed'),
      );
      const failures = events
        .filter((event) => event.type === 'error')
        .map((event) => event.message ?? JSON.stringify(event));

      if (!end) {
        const tail = stderr.trim().split('\n').filter(Boolean).pop();
        resolve(
          didNotRun(
            failures[0] ??
              'kane-cli exited with code ' + code + ' and produced no result' +
                (tail ? ': ' + tail : ''),
          ),
        );
        return;
      }

      const failedStep = steps.find((event) => event.status === 'failed');
      resolve({
        status: end.status === 'passed' ? 'passed' : 'failed',
        summary: end.summary ?? end.one_liner ?? '',
        durationS: Math.round(end.duration ?? 0),
        credits: typeof end.credits_consumed === 'number' ? end.credits_consumed : null,
        testUrl: end.test_url ?? null,
        evidence: findEvidence(),
        tests: [
          {
            name: flow.name,
            status: end.status === 'passed' ? 'passed' : 'failed',
            detail: failedStep?.remark ? String(failedStep.remark).slice(0, 240) : '',
          },
        ],
      });
    });
  });
}

/** A run that never happened. It is recorded as a failure, not hidden. */
function didNotRun(reason) {
  return {
    status: 'failed',
    summary: reason,
    durationS: 0,
    credits: null,
    testUrl: null,
    evidence: null,
    tests: [{ name: 'The run', status: 'failed', detail: reason.slice(0, 240) }],
  };
}

/** The newest sealed evidence pack, if there is one. */
function findEvidence() {
  const dir = join(ROOT, '.testmuai', 'evidence');
  if (!existsSync(dir)) return null;
  const packs = readdirSync(dir).filter((name) => name.endsWith('.evidence'));
  if (packs.length === 0) return null;
  const newest = packs
    .map((name) => {
      const path = join(dir, name);
      return { name, when: readFileSync(path).mtimeMs };
    })
    .sort((a, b) => a.when - b.when);
  return '.testmuai/evidence/' + newest[newest.length - 1].name;
}

// ------------------------------------------------------- the recorded past

/**
 * The runs that already happened, read from kane-cli's own result files.
 *
 * kane-cli writes a result file per run. Those files are the record of what
 * really happened, so the ledger is built from them rather than from
 * anything written by hand.
 *
 * The file's name carries the commit the app was at when the run happened
 * (`<date>-<flow>-run<n>-<commit>.md`). That commit is what the ledger uses
 * to find what the app's own checker said at the time — the measurement
 * `scripts/measure.mjs` took at that commit, not a number typed here.
 */
function readRecordedRuns() {
  if (!existsSync(RESULTS_DIR)) return [];
  const runs = [];
  for (const name of readdirSync(RESULTS_DIR).sort()) {
    if (!name.endsWith('.md')) continue;
    const id = name.replace(/\.md$/, '');
    const text = readFileSync(join(RESULTS_DIR, name), 'utf8');
    const front = text.match(/^---\n([\s\S]*?)\n---/);
    const field = (key) =>
      front?.[1]?.match(new RegExp('^' + key + ':\s*(.+)$', 'm'))?.[1]?.trim();
    const status = field('status');
    if (!status) continue;
    const reason = text.match(/^Reason:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const step = text.match(/^##\s+Step\s+(\d+)/m);

    const commit = id.match(/-([0-9a-f]{7})$/)?.[1] ?? '';
    const measurement = readMeasurement(commit);
    const agent = readAgentRun(id, field('session_id'));

    runs.push({
      id,
      name: flowName(id) ?? agent?.one_liner ?? id,
      startedAt: field('started') ?? '',
      status: status === 'passed' ? 'passed' : 'failed',
      durationS: Number(field('duration_s') ?? 0),
      credits: agent?.credits_consumed ?? null,
      commit,
      summary: agent?.summary ?? reason ?? 'The run ' + status + '.',
      tests: [
        {
          name: step ? 'Step ' + step[1] : 'The run',
          status: status === 'passed' ? 'passed' : 'failed',
          detail: (reason || agent?.one_liner || '').slice(0, 240),
        },
      ],
      appFindings: measurement
        ? {
            errors: measurement.errors,
            warnings: measurement.warnings,
            notes: measurement.notes,
            reachable: measurement.reachable,
            total: measurement.total,
            issues: measurement.issues ?? [],
          }
        : null,
      evidence: agent?.evidence ?? null,
      source: 'kane-cli result file',
    });
  }
  return runs;
}

/** What the app's own checker said at a commit. */
/**
 * The flow a recorded run belongs to.
 *
 * The run file is named <date>-<flow>-run<n>-<commit>, so the flow is the
 * part in the middle. It is the name of the test the agent ran, which is
 * what belongs on screen.
 */
function flowName(id) {
  const match = id.match(/^\d{4}-\d{2}-\d{2}-(.+)-run\d+-[0-9a-f]{7}$/);
  return match?.[1] ?? null;
}


function readMeasurement(commit) {
  if (!commit) return null;
  const path = join(MEASUREMENTS_DIR, commit + '.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The agent's own account of a run.
 *
 * kane-cli's result file records whether the run passed and why it failed,
 * but the agent's summary, what the run cost and where its sealed evidence
 * pack is live in the event stream. That stream is read from the run's own
 * session folder, and a copy is kept next to the result file so the ledger
 * can be rebuilt without the local Kane installation.
 */
function readAgentRun(id, sessionId) {
  const local = join(RESULTS_DIR, id + '.ndjson');
  const session = sessionId
    ? join(homedir(), '.testmuai', 'kaneai', 'sessions', sessionId, 'events.ndjson')
    : null;

  let source = null;
  if (existsSync(local)) source = local;
  else if (session && existsSync(session)) source = session;
  if (!source) return null;

  let end = null;
  for (const line of readFileSync(source, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === 'run_end') end = event;
    } catch {
      // not an event
    }
  }

  const folder = sessionId
    ? join(homedir(), '.testmuai', 'kaneai', 'sessions', sessionId, 'evidence')
    : null;
  let evidence = null;
  if (folder && existsSync(folder)) {
    const packs = readdirSync(folder).filter((name) => name.endsWith('.evidence'));
    if (packs.length > 0) evidence = '.testmuai/evidence/' + packs.sort().slice(-1)[0];
  }

  if (!end) return { summary: '', one_liner: '', credits_consumed: null, evidence };

  return {
    summary: end.summary ?? end.one_liner ?? '',
    one_liner: end.one_liner ?? '',
    credits_consumed:
      typeof end.credits_consumed === 'number' ? end.credits_consumed : null,
    duration: end.duration ?? null,
    evidence,
  };
}

/**
 * Put the runs together without repeating one.
 *
 * A recorded run keeps the same id every time the ledger is rebuilt, so
 * rebuilding must replace it rather than pile a second copy on top.
 */
function mergeRuns(runs) {
  const byId = new Map();
  for (const run of runs) {
    const known = byId.get(run.id);
    if (!known) {
      byId.set(run.id, run);
      continue;
    }
    // Keep whatever is already known. A rebuild that happens on a machine
    // without the agent's event stream must not wipe the credits and the
    // summary that were read from it the first time.
    byId.set(run.id, {
      ...known,
      ...Object.fromEntries(
        Object.entries(run).filter(([, value]) => value !== null && value !== undefined),
      ),
      appFindings: known.appFindings ?? run.appFindings,
      evidence: known.evidence ?? run.evidence,
      credits: known.credits ?? run.credits,
      commit: known.commit || run.commit,
      summary: known.summary || run.summary,
    });
  }
  return [...byId.values()];
}
// ----------------------------------------------------------------- writing

function readLedger() {
  if (!existsSync(LEDGER)) return { runs: [] };
  try {
    const file = JSON.parse(readFileSync(LEDGER, 'utf8'));
    return { runs: Array.isArray(file.runs) ? file.runs : [] };
  } catch {
    return { runs: [] };
  }
}

function writeLedger(runs) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  const ordered = [...runs].sort((a, b) =>
    String(b.startedAt).localeCompare(String(a.startedAt)),
  );
  const body = JSON.stringify({ runs: ordered }, null, 2) + '\n';
  writeFileSync(LEDGER, body, 'utf8');
  // The built app is served from dist/, so the copy the browser reads has to
  // be updated too.
  const built = join(ROOT, 'dist', 'runs.json');
  if (existsSync(dirname(built))) writeFileSync(built, body, 'utf8');
  return ordered;
}

// -------------------------------------------------------------------- main

async function main() {
  const flows = readFlows();
  const only = option('--only');

  if (flag('--dry-run')) {
    console.log(flows.length + ' flows, the app at ' + APP_URL);
    for (const flow of flows) {
      console.log('  ' + flow.slug + ' — ' + flow.name + (flow.covers ? ' (' + flow.covers + ')' : ''));
    }
    return;
  }

  if (flag('--rebuild')) {
    const runs = mergeRuns([...readLedger().runs, ...readRecordedRuns()]);
    const ordered = writeLedger(runs);
    console.log('The ledger now holds ' + ordered.length + ' run(s).');
    return;
  }

  const chosen = only ? flows.filter((flow) => flow.slug === only) : flows;
  if (chosen.length === 0) {
    console.error('No flow called "' + only + '".');
    process.exitCode = 1;
    return;
  }

  const commit = currentCommit();
  const findings = await appFindings();

  for (const flow of chosen) {
    console.log('\n> ' + flow.name);
    const outcome = await runFlow(flow);
    console.log('  ' + outcome.status + ' — ' + outcome.summary);

    const record = {
      id: new Date().toISOString() + '-' + flow.slug,
      name: flow.name,
      startedAt: new Date().toISOString(),
      status: outcome.status,
      durationS: outcome.durationS,
      credits: outcome.credits,
      commit,
      summary: outcome.summary,
      tests: outcome.tests,
      appFindings: findings,
      evidence: outcome.evidence,
      testUrl: outcome.testUrl,
      source: 'kane-cli run',
    };

    // The ledger is written as the suite goes, so a run that reads the ledger
    // sees the runs that came before it.
    const merged = mergeRuns([...readLedger().runs, ...readRecordedRuns(), record]);
    writeLedger(merged);
  }

  const ledger = readLedger();
  const passed = ledger.runs.filter((run) => run.status === 'passed').length;
  console.log(
    '\n' + passed + '/' + ledger.runs.length +
      ' recorded runs passed. The ledger is at public/runs.json.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
