// extract-outcome.js
//
// Did the system actually finish? Cost without outcome is misleading
// — a cell that returned $0 with no result is not "cheaper" than a
// cell that returned the full feature for a real bill.
//
// As of the 2026-04-16 completion-source reconciliation, benchmark
// completion counts should prefer independently judged `outcome.json`
// and otherwise report "not independently judged". The older
// objectives/scorecard fallbacks are preserved as explicit legacy
// helpers only.

const fs = require('fs');
const path = require('path');

const TASK_FRAC_RE = /(\d+)\s*\/\s*(\d+)\s+tasks?\s*(?:complete|done|verified|pass|implemented|finished|delivered)/i;

function fromOutcomeJson(cellDir) {
  const p = path.join(cellDir, 'outcome.json');
  if (!fs.existsSync(p)) return null;
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    const total = Number(o.total_tasks ?? o?.totals?.total_tasks);
    const verified = Number(o.verified ?? o?.totals?.verified);
    if (!total) return null;
    return { verified, total, finished: verified === total, source: 'outcome.json', judge: o.judge };
  } catch (e) {
    return null;
  }
}

function fromObjectives(cellDir) {
  const p = path.join(cellDir, 'objectives.json');
  if (!fs.existsSync(p)) return null;
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    const total = Number(o.total_tasks);
    const verified = Number(o.verified);
    if (!total) return null;
    return { verified, total, finished: verified === total, source: 'objectives' };
  } catch (e) {
    return null;
  }
}

function fromScorecard(cellDir) {
  const p = path.join(cellDir, 'scorecard.json');
  if (!fs.existsSync(p)) return null;
  try {
    const sc = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const f of sc.findings || []) {
      const m = String(f).match(TASK_FRAC_RE);
      if (m) {
        const verified = +m[1];
        const total = +m[2];
        return { verified, total, finished: verified === total, source: 'scorecard' };
      }
    }
  } catch (e) {}
  return null;
}

function readOutcome(cellDir) {
  return fromOutcomeJson(cellDir);
}

function readLegacyOutcome(cellDir) {
  return fromOutcomeJson(cellDir) || fromObjectives(cellDir) || fromScorecard(cellDir);
}

module.exports = { readOutcome, readLegacyOutcome, fromOutcomeJson, fromObjectives, fromScorecard };
