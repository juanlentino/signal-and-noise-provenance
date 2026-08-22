#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
/**
 * check-cron-liveness
 * -------------------
 * Fails when a SCHEDULED workflow has stopped firing.
 *
 * Why this exists: a cron cannot witness its own absence. When a scheduled
 * workflow stops — GitHub's 60-day inactivity disable, a cron expression that
 * never parsed, a file that never reached the default branch, a repo-level
 * Actions block — it produces NO run, and an absent run is indistinguishable
 * from a run that passed. Nothing here gated on a run EXISTING, so the six
 * crons below were unwatched in the one direction that matters.
 *
 * This repo publishes and re-verifies a public provenance ledger. verify.yml
 * is the daily full-ledger check: it walks every committed record, re-derives
 * the index, and confirms the live site still agrees with what was signed. A
 * dead cron here does not break anything visibly — it just means nobody is
 * checking the ledger any more, and the repo goes on looking exactly as
 * healthy as it did the day before it stopped.
 *
 * So the guard runs on a DIFFERENT trigger AND from a different FILE than the
 * thing it watches — .github/workflows/cron-liveness.yml, on push and
 * pull_request. Sharing verify.yml would mean a disable of verify.yml takes
 * its own watchdog down with it, silently, which is the whole failure again.
 *
 * Grace is PER-WORKFLOW and stated beside the cron it belongs to, so a cadence
 * change and its window move together — the likeliest future bug here is
 * someone editing a cron and leaving the grace behind.
 *
 * Five verdicts, three of them failures, kept distinct because the fix differs:
 *
 *   live            a scheduled run landed inside grace.
 *   not-yet-due     no run yet, but the workflow is younger than grace — it
 *                   CANNOT have fired. A check that reds the day it lands
 *                   teaches everyone to ignore it.
 *   stale     FAIL  it fired before and stopped → look at the 60-day
 *                   inactivity disable, or a repo-level Actions block.
 *   never-scheduled FAIL  it never registered at all → look at the cron
 *                   expression, and whether the file is on the default branch.
 *   indeterminate   FAIL  the workflow's age could not be read, so nothing can
 *                   be concluded. An instrument that cannot see must never
 *                   report health — reproducing the bug this file was written
 *                   against would be a poor joke.
 *
 * An unparseable timestamp counts as ABSENCE, not presence, for the same
 * reason: a malformed payload must not be able to assert liveness.
 *
 * Exit codes: 0 = every watched cron live or not-yet-due, 1 = at least one
 * stale/never-scheduled/indeterminate, 2 = cannot determine (no token, API
 * unreachable after retries).
 */

/** Daily cadence (24h) + 48h slack. GitHub does not promise punctual crons. */
export const DAILY_GRACE_H = 48;

/** Weekly cadence (168h) + 48h slack. */
export const WEEKLY_GRACE_H = 216;

/**
 * The scheduled workflows on main, with the cron they actually carry. Kept
 * beside the grace so a cadence change and its window move together — the
 * likeliest future bug here is someone editing a cron and leaving the grace.
 */
export const WATCHED = [
  { workflow: "verify.yml", cron: "17 6 * * *", graceHours: DAILY_GRACE_H },
];

const parse = (value) => {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
};

/**
 * Pure. Takes its clock as an argument so the whole decision table is
 * reachable offline.
 *
 * @param {unknown[]} scheduledRunTimes ISO stamps of runs with event=schedule.
 * @param {string|null} workflowCreatedAt ISO stamp, or null when unknown.
 * @param {number} now Epoch ms to judge against.
 * @param {number} graceHours How long silence is tolerated.
 * @returns {{ok: boolean, code: string, message: string, ageHours: number|null}}
 */
export function cronLivenessVerdict(scheduledRunTimes, workflowCreatedAt, now, graceHours) {
  const graceMs = graceHours * 3600_000;
  const stamps = (Array.isArray(scheduledRunTimes) ? scheduledRunTimes : [])
    .map(parse)
    .filter((t) => t !== null);

  if (stamps.length > 0) {
    // The NEWEST decides. The API promises no ordering, so never trust [0].
    const age = now - Math.max(...stamps);
    const ageH = Math.round((age / 3600_000) * 10) / 10;
    if (age <= graceMs) {
      return { ok: true, code: "live", ageHours: ageH,
        message: `live: a scheduled run landed ${ageH}h ago (grace ${graceHours}h).` };
    }
    return { ok: false, code: "stale", ageHours: ageH,
      message: `stale: the newest scheduled run is ${ageH}h old, past the ${graceHours}h grace. It fired before and stopped — check the 60-day inactivity disable, or whether Actions is blocked for this repo.` };
  }

  const created = parse(workflowCreatedAt);
  if (created === null) {
    return { ok: false, code: "indeterminate", ageHours: null,
      message: "indeterminate: no scheduled run, and the workflow age could not be read — nothing can be concluded, so this does not pass." };
  }

  const age = now - created;
  const ageH = Math.round((age / 3600_000) * 10) / 10;
  if (age <= graceMs) {
    return { ok: true, code: "not-yet-due", ageHours: ageH,
      message: `not-yet-due: the workflow is ${ageH}h old (grace ${graceHours}h) and cannot have fired on schedule yet.` };
  }
  return { ok: false, code: "never-scheduled", ageHours: ageH,
    message: `never-scheduled: the workflow has existed ${ageH}h and has NEVER produced a run with event=schedule. It never registered — check the cron expression, and that the file is on the default branch.` };
}

/* ------------------------------- CLI ------------------------------------ */

const api = async (path, token) => {
  // Retry, don't red on a hiccup. A flaky read reported as a finding is worse
  // than no check: it trains everyone to re-run and stop reading.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.github.com/${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      });
      if (res.ok) return await res.json();
    } catch {
      /* fall through to retry */
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
};

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error("check-cron-liveness: GITHUB_TOKEN and GITHUB_REPOSITORY are required. code=indeterminate");
    process.exit(2);
  }

  // An EMPTY watch list must never report health. With no rows the loop below
  // does nothing, no failure is counted, and the success line would cheerfully
  // print "all 0 scheduled workflows accounted for" and exit 0 — nothing
  // checked reading exactly like everything passing, which is the precise bug
  // this whole file exists to catch. Refuse instead.
  if (WATCHED.length === 0) {
    console.error("check-cron-liveness: the watch list is EMPTY. Nothing checked is not the same as nothing wrong. code=no-workflows");
    process.exit(1);
  }

  const now = Date.now();
  let failures = 0;
  let unreadable = 0;

  for (const { workflow, cron, graceHours } of WATCHED) {
    const meta = await api(`repos/${repo}/actions/workflows/${workflow}`, token);
    const runs = await api(`repos/${repo}/actions/workflows/${workflow}/runs?event=schedule&per_page=10`, token);
    if (meta === null && runs === null) {
      // The API itself is unreachable — a tooling failure, not a dead cron.
      // Counted separately so the exit code can say which.
      console.error(`  UNREADABLE  ${workflow.padEnd(28)} the API did not answer after 3 attempts`);
      unreadable++;
      continue;
    }
    const verdict = cronLivenessVerdict(
      (runs?.workflow_runs ?? []).map((r) => r.created_at),
      meta?.created_at ?? null,
      now,
      graceHours,
    );
    const label = verdict.ok ? "ok  " : "FAIL";
    console.log(`  ${label}  ${workflow.padEnd(28)} ${cron.padEnd(12)} ${verdict.message}`);
    if (!verdict.ok) failures++;
  }

  if (unreadable > 0 && failures === 0) {
    console.error(`check-cron-liveness: ${unreadable} workflow(s) unreadable; cannot determine.`);
    process.exit(2);
  }
  if (failures > 0) {
    console.error(`check-cron-liveness: ${failures} of ${WATCHED.length} scheduled workflows are not firing.`);
    process.exit(1);
  }
  console.log(`check-cron-liveness: all ${WATCHED.length} scheduled workflows accounted for.`);
}

/* ----------------------------- SELF TEST -------------------------------- */

/**
 * The decision table, driven offline against the REAL verdict function.
 *
 * Deliberately zero-dependency and built into the file rather than sitting in
 * a *.test.mjs: this guard is copied between repos that do not all carry a
 * test runner, and a check whose proof only runs in SOME of them is a check
 * whose proof will silently stop running in the others. CI runs `--selftest`
 * immediately before the live query, so the thing that proves the rule is
 * right runs in the same job as the thing that relies on it.
 */
function selftest() {
  const now = Date.parse("2026-08-25T12:00:00Z");
  const H = 3600_000;
  const at = (hoursAgo) => new Date(now - hoursAgo * H).toISOString();
  let pass = 0;
  const failures = [];
  const ok = (cond, what) => {
    if (cond) { pass++; } else { failures.push(what); }
  };
  const code = (runs, created, grace) => cronLivenessVerdict(runs, created, now, grace).code;

  ok(code([at(5)], at(500), 48) === "live", "a run 5h ago is live at 48h grace");
  ok(code([at(48)], at(500), 48) === "live", "the grace boundary is inclusive, so a cron delayed to the edge does not red");
  ok(code([at(500), at(5), at(200)], at(900), 48) === "live", "the NEWEST run decides — the API promises no ordering");
  ok(code([at(-1)], at(500), 48) === "live", "a run stamped slightly in the future is clock skew, not a dead cron");

  ok(code([at(100)], at(500), 48) === "stale", "runs exist but the newest is past grace: stale");
  ok(code([], at(500), 48) === "never-scheduled", "no scheduled run ever, on a workflow older than grace: never-scheduled");
  ok(code([at(100)], at(500), 48) !== code([], at(500), 48), "the two failures keep DISTINCT codes — a single red would send you to the wrong door");

  ok(code([], at(5), 48) === "not-yet-due", "younger than grace with no run yet cannot have fired — a check that reds on day one gets ignored");

  ok(code([], null, 48) === "indeterminate", "an unreadable workflow age is indeterminate, never a pass");
  ok(code([], "not-a-date", 48) === "indeterminate", "a garbage created_at is indeterminate, not not-yet-due");
  ok(cronLivenessVerdict([], null, now, 48).ok === false, "and indeterminate FAILS — an instrument that cannot see must not report health");

  ok(code(["not-a-date"], at(500), 48) === "never-scheduled", "an unparseable run stamp is ABSENCE, not presence");
  ok(code(["not-a-date", at(5)], at(500), 48) === "live", "but one bad stamp does not discard a good one beside it");

  ok(code([at(29)], at(500), 48) === "live" && code([at(29)], at(500), 6) === "stale",
     "the SAME age is live at 48h and stale at 6h — grace is per-workflow, which is why each row carries its own");

  // The watch list itself is an invariant: an empty one would make every
  // question above moot and the CLI would still exit 0 without this.
  ok(WATCHED.length > 0, "the watch list is not empty");
  ok(WATCHED.every((w) => w.workflow && w.cron && Number(w.graceHours) > 0),
     "every watched row names a workflow, its cron, and a positive grace");

  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.log(`check-cron-liveness --selftest: ${pass} passed, ${failures.length} failed.`);
  return failures.length === 0 ? 0 : 1;
}

// Only run as a CLI, never on import — a test file may import the pure function.
//
// The obvious form of this test, `import.meta.url === new URL(`file://` +
// process.argv[1]).href`, is SYMLINK-FRAGILE and fails open. Node resolves
// import.meta.url through symlinks; process.argv[1] keeps the path as typed.
// Run the file through any symlinked path — /tmp on macOS is itself a symlink
// to private/tmp — and the two never match, main() never runs, and the process
// exits 0 having checked NOTHING. A watchdog that silently does nothing and
// reports success is the exact failure this file was written against, so the
// comparison goes through realpath and a throw is treated as "not the CLI"
// rather than crashing an importer.
const invokedAsCli = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedAsCli) {
  if (process.argv.includes("--selftest")) {
    process.exit(selftest());
  }
  await main();
}
