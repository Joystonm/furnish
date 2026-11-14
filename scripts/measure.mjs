#!/usr/bin/env node
/**
 * Measure the app's own checker at a given commit.
 *
 * The ledger has to say what the app's checker said at the time of each
 * verification run — not what it says now, and not a number written by hand.
 * So this script checks the sources out at that commit, runs the same
 * checker the browser runs, and writes the answer down.
 *
 *   node scripts/measure.mjs 4061d79
 *   node scripts/measure.mjs HEAD
 *
 * The measurement lands in `measurements/<commit>.json`.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEASUREMENTS = join(ROOT, 'measurements');
const WORKTREE = join(ROOT, 'node_modules', '.cache', 'measure-worktree');
const BUNDLE = join(ROOT, 'node_modules', '.cache', 'measure-report.mjs');
const ESBUILD = join(ROOT, 'node_modules', '.bin', 'esbuild');
const PROBE = join(ROOT, 'scripts', 'probe-entry.ts');

function git(args, cwd = ROOT) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Run the checker at a commit.
 *
 * The probe in `scripts/probe-entry.ts` is the entry point: it builds the
 * sample house, runs the app's own validator and circulation graph over it,
 * and reports the numbers the browser showed. It imports the model from the
 * root of the tree, so it is copied to the root of the worktree before it is
 * bundled.
 */
async function measure(commit) {
  rmSync(WORKTREE, { recursive: true, force: true });
  const added = git(['worktree', 'add', '--detach', WORKTREE, commit]);
  if (added.status !== 0) {
    console.error('Could not check out ' + commit + ': ' + added.stderr.trim());
    rmSync(WORKTREE, { recursive: true, force: true });
    return null;
  }

  try {
    const hasReport = existsSync(join(WORKTREE, 'src', 'model', 'report.ts'));
    let source;
    if (hasReport) {
      source = join(WORKTREE, 'src', 'model', 'report.ts');
    } else {
      copyFileSync(PROBE, join(WORKTREE, 'probe.ts'));
      source = join(WORKTREE, 'probe.ts');
    }

    const bundled = spawnSync(
      ESBUILD,
      [
        source,
        '--bundle',
        '--format=esm',
        '--platform=node',
        '--outfile=' + BUNDLE,
        '--log-level=error',
      ],
      { stdio: 'inherit', shell: true },
    );
    if (bundled.status !== 0) return null;

    const module = await import(pathToFileURL(BUNDLE).href + '?t=' + process.pid);
    const report = module.report();
    if (!report || report.plan !== 'drawn' || !report.summary) {
      return { commit, plan: 'refused', errors: null, warnings: null, notes: null, reachable: null, total: null, issues: [] };
    }

    return {
      commit,
      plan: 'drawn',
      errors: report.summary.errors,
      warnings: report.summary.warnings,
      notes: report.summary.notes,
      reachable: report.summary.reachable,
      total: report.summary.total,
      issues: report.summary.issues ?? [],
    };
  } finally {
    git(['worktree', 'remove', '--force', WORKTREE]);
    rmSync(WORKTREE, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------------- main

const commit = process.argv[2];
if (!commit) {
  console.error('Usage: node scripts/measure.mjs <commit>');
  process.exitCode = 1;
} else {
  const short = git(['rev-parse', '--short', commit]).stdout.trim() || commit;
  const result = await measure(commit);
  if (!result) {
    console.error('Could not measure ' + commit + '.');
    process.exitCode = 1;
  } else {
    mkdirSync(MEASUREMENTS, { recursive: true });
    const body = {
      ...result,
      commit: short,
      measuredAt: new Date().toISOString(),
    };
    writeFileSync(
      join(MEASUREMENTS, short + '.json'),
      JSON.stringify(body, null, 2) + '\n',
      'utf8',
    );
    console.log(
      short +
        ': ' +
        body.errors +
        ' errors, ' +
        body.warnings +
        ' warnings, ' +
        body.reachable +
        '/' +
        body.total +
        ' rooms reachable',
    );
  }
}
