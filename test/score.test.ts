import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, passedBrs } from '../src/engine/score.ts';
import { requirement } from './fixtures.ts';

const base = { brs: 10, passed: 10, rework: 0, scope_violations: 0, blockers: 0, rating: 10, effective: 1_000_000, minutes: 100, planned: 5, merged: 5 };

test('perfect run scores 100', () => {
  assert.equal(computeScore(base).score, 100);
});

test('orcs-1 inputs score 71.3 once the budget penalty is gone (v1 gave 65.3)', () => {
  const r = computeScore({ ...base, rework: 2, scope_violations: 3, rating: 9, effective: 60_695_540, minutes: 1475.9, planned: 74, merged: 74 });
  assert.equal(r.factors.quality, 0.6);
  assert.equal(r.factors.tokens, 0.025);
  assert.equal(r.factors.speed, 0.102);
  assert.equal(r.score, 71.3);
});

test('a failing requirement caps the score at 60', () => {
  const r = computeScore({ ...base, passed: 9 });
  assert.equal(r.capped, true);
  assert.equal(r.score, 60);
});

test('untested runs are scored without correctness', () => {
  const r = computeScore({ ...base, passed: null });
  assert.equal(r.factors.correctness, null);
  assert.equal(r.points.correctness, null);
  assert.equal(r.score, 100);
});

test('open high or medium bugs fail their requirement', () => {
  const report = {
    round: 1,
    results: [{ case: 'tc-1', status: 'fail' as const }],
    bugs: [{ id: 'bug-1', risk: 'low' as const, br: 'br-2', status: 'open' as const } as never],
  };
  assert.equal(passedBrs(requirement(), report, [{ id: 'tc-1', br: 'br-1' }]), 1);
});
