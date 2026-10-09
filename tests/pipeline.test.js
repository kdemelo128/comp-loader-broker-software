/* The Home screen's arithmetic: deals by stage, tasks by due date, what needs attention. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineSummary, taskBuckets, attention, findContacts, stageOf, applyStageConfig, STAGES, STAGE_LABEL, stageChoices, upcomingDates } from '../app/pipeline.js';

const day = 86400000;
const today = '2026-10-09';
const t0 = Date.parse('2026-10-09T00:00:00Z');

test('deals by stage, with active value and unpriced deals counted apart', () => {
  const deals = [
    { id: 'a', stage: 'underwriting', figures: { price: 6450000 }, updatedAt: 2 },
    { id: 'b', figures: { price: 1000000 }, updatedAt: 3 },
    { id: 'c', stage: 'offer', figures: {} },
    { id: 'd', stage: 'closed', figures: { price: 9e6 } },
    { id: 'e', stage: 'bogus', figures: { price: -5 } },
  ];
  const p = pipelineSummary(deals);
  const uw = p.stages.find((s) => s.key === 'underwriting');
  assert.equal(uw.count, 3, 'a deal with no stage or an unknown one is being underwritten');
  assert.equal(uw.value, 7450000);
  assert.deepEqual(uw.deals.map((d) => d.id), ['b', 'a', 'e'], 'newest first');
  assert.equal(p.activeCount, 4);
  assert.equal(p.activeValue, 7450000, 'closed deals are not in the active pipeline');
  assert.equal(p.activeUnpriced, 2);
  assert.equal(stageOf(null), 'underwriting');
});

test('tasks by when they are due', () => {
  const tasks = [
    { id: 1, title: 'late', due: '2026-10-01' }, { id: 2, title: 'today', due: '2026-10-09' },
    { id: 3, title: 'in a week', due: '2026-10-16' }, { id: 4, title: 'later', due: '2026-10-17' },
    { id: 5, title: 'no date', due: null }, { id: 6, title: 'done', due: '2026-10-01', done: true, doneAt: 5 },
    { id: 7, title: 'earlier late', due: '2026-09-20' },
  ];
  const b = taskBuckets(tasks, today);
  assert.deepEqual(b.overdue.map((t) => t.id), [7, 1]);
  assert.deepEqual(b.today.map((t) => t.id), [2]);
  assert.deepEqual(b.week.map((t) => t.id), [3], 'seven days ahead is this week; the eighth is later');
  assert.deepEqual(b.later.map((t) => t.id), [4]);
  assert.deepEqual(b.undated.map((t) => t.id), [5]);
  assert.deepEqual(b.done.map((t) => t.id), [6], 'a done task is never overdue');
});

test('attention: overdue tasks, deals with no next step, stale deals', () => {
  const deals = [
    { id: 'a', name: 'Alpha', stage: 'offer', updatedAt: t0 - 2 * day },
    { id: 'b', name: 'Beta', updatedAt: t0 - 40 * day },
    { id: 'c', name: 'Gamma', stage: 'closed', updatedAt: t0 - 400 * day },
  ];
  const tasks = [{ id: 1, title: 'Call', dealId: 'a', due: '2026-10-01' }];
  const a = attention(deals, tasks, { today });
  assert.deepEqual(a.map((x) => x.kind), ['overdue', 'no-task', 'stale']);
  assert.match(a[2].text, /Beta: untouched for 40 days/);
  assert.ok(!a.some((x) => x.dealId === 'c'), 'closed deals need nothing');
});

test('contact search', () => {
  const cs = [{ name: 'Zoe Park', company: 'Harbor Law', role: 'Attorney' }, { name: 'Al Moss', company: 'First Bank', role: 'Lender', email: 'al@firstbank.com' }];
  assert.deepEqual(findContacts(cs, '').map((c) => c.name), ['Al Moss', 'Zoe Park']);
  assert.deepEqual(findContacts(cs, 'lender').map((c) => c.name), ['Al Moss']);
  assert.deepEqual(findContacts(cs, 'harbor').map((c) => c.name), ['Zoe Park']);
});

test('stages can be renamed and hidden; a deal keeps its own stage in the menu', () => {
  applyStageConfig({ listing: { label: 'Exclusive listing' }, marketing: { hidden: true }, bogus: { label: 'x' } });
  assert.equal(STAGE_LABEL.listing, 'Exclusive listing');
  assert.equal(STAGES.length, 9);
  assert.ok(!stageChoices().some(([k]) => k === 'marketing'));
  assert.ok(stageChoices('marketing').some(([k]) => k === 'marketing'), 'a deal in a hidden stage still shows it');
  applyStageConfig({});
  assert.equal(STAGE_LABEL.listing, 'Listing');
});

test('key dates: overdue and within the window, active deals only, soonest first', () => {
  const deals = [
    { id: 'a', name: 'Alpha', stage: 'contract', keyDates: [{ id: 1, label: 'Closing', date: '2026-11-20' }, { id: 2, label: 'Due diligence expires', date: '2026-10-12' }, { id: 3, label: 'Deposit goes hard', date: '2026-10-01' }, { id: 4, label: 'Done one', date: '2026-10-10', done: true }] },
    { id: 'b', name: 'Beta', stage: 'closed', keyDates: [{ id: 5, label: 'Closing', date: '2026-10-10' }] },
  ];
  const u = upcomingDates(deals, { today, days: 30 });
  assert.deepEqual(u.map((x) => [x.label, x.daysLeft]), [['Deposit goes hard', -8], ['Due diligence expires', 3]]);
});
