import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const E = require('../workout-engine.js');
const evidence = JSON.parse(readFileSync(new URL('../science/evidence.json', import.meta.url), 'utf8'));
const TODAY = '2026-11-24';

const legacy = [
  { date: '2026-11-03', workoutPlace: '本店', workoutPart: 'chest', workoutExercises: [{ name: 'チェストプレス', weight: 45, reps: 12, sets: 3 }] },
  { date: '2026-11-10', workoutPlace: 'ジム本店', workoutPart: 'chest', workoutExercises: [{ name: 'マシンチェストプレス', weight: 50, reps: 12, sets: 3 }, { name: 'ペックフライ', weight: 40, reps: '10', sets: 3 }], workoutFeedback: '50kgは余裕' },
  { date: '2026-11-14', workoutPlace: '塩田店', workoutPart: 'chest', workoutExercises: [{ name: 'チェストプレス（Life Fitness）', weight: 35, reps: 10, sets: 3 }] }
];
const session = (date, store, part, exercises, overall = 'ok', pain = '') => ({ date, workoutSessions: [{ id: date + store, status: 'finished', store, part, startedAt: `${date}T10:00:00Z`, finishedAt: `${date}T11:00:00Z`, feedback: { overall, pain, note: '' }, exercises }] });
const sets = (w, ...reps) => reps.map(r => ({ weight: w, reps: r, done: true }));

test('store names from legacy free text are normalized', () => {
  assert.equal(E.normalizeStore('本店'), 'honten');
  assert.equal(E.normalizeStore('ジム本店'), 'honten');
  assert.equal(E.normalizeStore('塩田店'), 'shioda');
  assert.equal(E.normalizeStore('エニタイム'), '');
  assert.equal(E.canonicalName('チェストプレス（Life Fitness）'), 'チェストプレス');
  assert.equal(E.canonicalName('ラットプル'), 'ラットプルダウン');
});

test('analysis reads all history (legacy + set-level sessions), not just the last 20', () => {
  const many = Array.from({ length: 40 }, (_, i) => session(`2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`, 'honten', 'back', [{ name: 'ラットプルダウン', sets: sets(30 + i, 10, 10) }]));
  const a = E.analyze([...many, ...legacy], TODAY);
  assert.equal(a.totalSessions, 43);
  assert.equal(a.byKey['honten|ラットプルダウン'].count, 40);
  assert.ok(a.byKey['honten|ラットプルダウン'].growthPctPerWeek > 0);
  assert.equal(a.byKey['honten|チェストプレス'].count, 2);
  assert.equal(a.byKey['shioda|チェストプレス'].count, 1);
});

test('weights are never transferred between stores', () => {
  const a = E.analyze(legacy, TODAY);
  const shioda = E.planSession({ store: 'shioda', part: 'chest', analysis: a, today: TODAY });
  const fly = shioda.exercises.find(e => e.name === 'ペックフライ');
  assert.ok(fly, 'fly is a candidate at shioda');
  assert.equal(fly.weight, null);
  assert.match(fly.reference, /本店では40kg/);
  const press = shioda.exercises.find(e => e.name === 'チェストプレス');
  assert.equal(press.weight, 35); // 塩田店自身の実績
});

test('progression integrates rating, rep completion and stall rather than adding reps mechanically', () => {
  const easy = E.analyze([session('2026-11-20', 'honten', 'chest', [{ name: 'チェストプレス', sets: sets(50, 12, 12, 12) }], 'easy')], TODAY);
  const up = E.planSession({ store: 'honten', part: 'chest', analysis: easy, today: TODAY }).exercises.find(e => e.name === 'チェストプレス');
  assert.equal(up.weight, 52.5); assert.equal(up.reps, 8);

  const hard = E.analyze([session('2026-11-20', 'honten', 'chest', [{ name: 'チェストプレス', rating: 'hard', sets: sets(50, 9, 7, 6) }], 'hard')], TODAY);
  const hold = E.planSession({ store: 'honten', part: 'chest', analysis: hard, today: TODAY }).exercises.find(e => e.name === 'チェストプレス');
  assert.equal(hold.weight, 50); assert.equal(hold.reps, 8);

  const stall = E.analyze(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'].map(d => session(d, 'honten', 'chest', [{ name: 'チェストプレス', sets: sets(50, 9, 9, 9) }])), TODAY);
  const reset = E.planSession({ store: 'honten', part: 'chest', analysis: stall, today: TODAY }).exercises.find(e => e.name === 'チェストプレス');
  assert.ok(reset.weight < 50, 'stalled lift is reset');
  assert.match(reset.reason, /伸びていない/);
});

test('pain and fatigue reduce load and volume; newer pain-free session clears old pain', () => {
  const recs = [session('2026-11-22', 'honten', 'chest', [{ name: 'チェストプレス', sets: sets(50, 10, 10, 10) }], 'ok', '右肩4/10'), { date: TODAY, fatigue: 5 }];
  const plan = E.planSession({ store: 'honten', part: 'chest', records: recs, today: TODAY });
  const press = plan.exercises.find(e => e.name === 'チェストプレス');
  assert.equal(press.weight, 40);
  assert.ok(plan.warnings.some(w => /肩の痛み4\/10/.test(w)));
  assert.ok(plan.warnings.some(w => /疲労感5/.test(w)));
  const cleared = E.analyze([...recs.slice(0, 1), session('2026-11-23', 'honten', 'back', [{ name: 'ラットプルダウン', sets: sets(40, 10) }])], TODAY);
  assert.deepEqual(cleared.pain, {});
  assert.equal(E.parsePain('右二頭３／10、腰5/10').腰, 5);
});

test('every store and part yields a usable plan even with no history', () => {
  for (const store of Object.keys(E.STORES)) for (const part of Object.keys(E.PARTS)) {
    const plan = E.planSession({ store, part, records: [], today: TODAY, minutes: 60 });
    assert.ok(plan.exercises.length >= 2, `${store}/${part}`);
    plan.exercises.forEach(e => { assert.equal(e.weight, null); assert.ok(e.sets >= 2 && e.reps > 0); });
  }
});

test('permanent preferences exclude equipment and exercises per store', () => {
  let prefs = E.applyPreferenceChanges({}, [{ action: 'add', type: 'missing_equipment', value: 'ペクトラルフライ', store: 'shioda' }, { action: 'add', type: 'avoid', value: 'スクワット', store: null }]);
  assert.deepEqual(prefs.stores.shioda.missing, ['ペックフライ']);
  const shioda = E.planSession({ store: 'shioda', part: 'chest', records: [], prefs, today: TODAY });
  const honten = E.planSession({ store: 'honten', part: 'chest', records: [], prefs, today: TODAY, minutes: 120 });
  assert.ok(!shioda.exercises.some(e => e.name === 'ペックフライ'));
  assert.ok(honten.exercises.some(e => e.name === 'ペックフライ'));
  assert.ok(!E.planSession({ store: 'honten', part: 'legs', records: [], prefs, today: TODAY }).exercises.some(e => e.name === 'スクワット'));
  prefs = E.applyPreferenceChanges(prefs, [{ action: 'remove', type: 'missing_equipment', value: 'ペックフライ', store: 'shioda' }]);
  assert.deepEqual(prefs.stores.shioda.missing, []);
});

test('AI plans are validated: no cross-store weights, no >10% jumps, no excluded exercises', () => {
  const a = E.analyze(legacy, TODAY);
  const prefs = { stores: { shioda: { missing: ['ペックフライ'] } } };
  const local = E.planSession({ store: 'shioda', part: 'chest', analysis: a, prefs, today: TODAY });
  const v = E.validateAiPlan({ summary: 'AI', warnings: [], evidence: ['volume-dose'], exercises: [
    { name: 'チェストプレス', weight: 60, reps: 10, repsMin: 8, repsMax: 12, sets: 3, restSec: 150, rir: 2, reason: 'x', evidence: [] },
    { name: 'インクラインチェストプレス', weight: 40, reps: 10, repsMin: 8, repsMax: 12, sets: 3, restSec: 150, rir: 2, reason: 'x', evidence: [] },
    { name: 'ペックフライ', weight: 30, reps: 12, repsMin: 10, repsMax: 15, sets: 3, restSec: 90, rir: 2, reason: 'x', evidence: [] }
  ] }, local, a, prefs);
  assert.equal(v.source, 'ai');
  assert.equal(v.exercises.find(e => e.name === 'チェストプレス').weight, 38.5);
  assert.equal(v.exercises.find(e => e.name === 'インクラインチェストプレス').weight, null);
  assert.ok(!v.exercises.some(e => e.name === 'ペックフライ'));
  assert.equal(E.validateAiPlan({ exercises: [] }, local, a, prefs), null);
});

test('offline conversation updates plan and permanent settings', () => {
  const plan = E.planSession({ store: 'shioda', part: 'legs', records: [], today: TODAY });
  const r1 = E.localChat('今後スクワットは外して', plan, {});
  assert.ok(!r1.plan.exercises.some(e => e.name === 'スクワット'));
  assert.deepEqual(r1.preferenceChanges, [{ action: 'add', type: 'avoid', value: 'スクワット', store: null }]);
  const r2 = E.localChat('塩田店にはレッグカールがない', plan, {});
  assert.deepEqual(r2.preferenceChanges[0], { action: 'add', type: 'missing_equipment', value: 'レッグカール', store: 'shioda' });
  const r3 = E.localChat('今日は軽めで', plan, {});
  assert.equal(r3.plan.exercises[0].sets, plan.exercises[0].sets - 1);
  assert.equal(r3.preferenceChanges.length, 0);
});

test('finished session summarizes into legacy record fields and feeds the next plan', () => {
  const plan = E.planSession({ store: 'honten', part: 'back', records: [], today: TODAY });
  const s = E.newSession(plan, TODAY, '2026-11-24T09:00:00.000Z');
  s.exercises[0].sets.forEach((x, i) => { x.weight = 40; x.reps = 12; x.done = i < 2; });
  s.finishedAt = '2026-11-24T09:52:00.000Z'; s.status = 'finished'; s.feedback = { overall: 'easy', pain: '', note: '' };
  const f = E.sessionRecordFields(s);
  assert.equal(f.workoutPlace, '本店'); assert.equal(f.workoutMinutes, 52); assert.equal(f.workoutCompletion, 'partial');
  assert.equal(f.workoutExercises[0].sets, 2);
  const next = E.planSession({ store: 'honten', part: 'back', records: [{ date: TODAY, workoutSessions: [s] }], today: TODAY });
  const lat = next.exercises.find(e => e.name === s.exercises[0].name);
  assert.equal(lat.weight, 40 + 2.5);
  assert.equal(E.recommendPart(E.analyze([{ date: TODAY, workoutSessions: [s] }], TODAY), {}, TODAY), 'chest');
});

test('evidence file is verified and every rule id used by the engine exists', () => {
  const ids = new Set(evidence.items.filter(x => x.verified && x.pmid && x.doi).map(x => x.id));
  const src = readFileSync(new URL('../workout-engine.js', import.meta.url), 'utf8');
  for (const id of src.match(/'(volume-dose|dose-diminishing|load-range|progression-reps-or-load|rir-near-failure|failure-fatigue|rir-scale|rest-strength|rest-hypertrophy|frequency)'/g)) assert.ok(ids.has(id.slice(1, -1)), id);
});

/* ---------- Worker（OpenAI・Supabaseはモック） ---------- */
async function callWorker(body, openaiReply, env = {}) {
  const { default: worker } = await import('../api/analyze-meal.js');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'test-user' }), { status: 200 });
    return openaiReply(calls[calls.length - 1]);
  };
  try {
    const res = await worker.fetch(new Request('https://w/', { method: 'POST', headers: { Origin: 'http://localhost:8000', Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { OPENAI_API_KEY: 'k', SUPABASE_URL: 'https://s', SUPABASE_PUBLISHABLE_KEY: 'p', AI_CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, PHOTO_RATE_LIMITER: { limit: async () => ({ success: true }) }, ...env });
    return { status: res.status, json: await res.json(), calls };
  } finally { globalThis.fetch = realFetch; }
}
const okOutput = obj => () => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(obj) }] }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });

test('worker workout_plan uses strict json_schema, verified evidence and returns the model used', async () => {
  const out = { summary: 's', warnings: [], evidence: ['volume-dose'], exercises: [{ name: 'チェストプレス', loadType: 'total', weight: null, reps: 10, repsMin: 8, repsMax: 12, sets: 3, restSec: 150, rir: 2, reason: 'r', evidence: ['rir-scale'] }] };
  const r = await callWorker({ kind: 'workout_plan', store: 'shioda', part: 'chest', minutes: 60, context: { a: 1 }, baseline: [] }, okOutput(out));
  assert.equal(r.status, 200);
  assert.equal(r.json.exercises[0].name, 'チェストプレス');
  assert.equal(r.json.model, 'gpt-5.4-mini');
  const req = r.calls.find(c => c.url.includes('openai')).body;
  assert.equal(req.text.format.type, 'json_schema'); assert.equal(req.text.format.strict, true);
  assert.match(req.instructions, /PMID 27433992/);
  assert.match(req.input[0].content[0].text, /塩田店/);
});

test('worker workout model can be switched by env and falls back on 5xx', async () => {
  let n = 0;
  const r = await callWorker({ kind: 'workout_chat', message: '肩が痛い', store: 'honten', part: 'chest', plan: {}, context: {} }, call => {
    n++; if (n === 1) { assert.equal(call.body.model, 'gpt-5.5'); return new Response(JSON.stringify({ error: { code: 'server_error' } }), { status: 500 }); }
    return okOutput({ reply: '了解', exercises: null, preferenceChanges: [] })();
  }, { WORKOUT_AI_MODEL: 'gpt-5.5' });
  assert.equal(r.status, 200); assert.equal(r.json.model, 'gpt-5.4-mini'); assert.equal(r.json.exercises, null);
});

test('worker reports billing problems without retrying and rejects empty chat', async () => {
  const r = await callWorker({ kind: 'workout_plan', store: 'honten', part: 'legs' }, () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }));
  assert.equal(r.status, 502); assert.match(r.json.error, /利用残高/); assert.equal(r.calls.filter(c => c.url.includes('openai')).length, 1);
  const e = await callWorker({ kind: 'workout_chat', message: ' ' }, okOutput({}));
  assert.equal(e.status, 400);
});

test('v22.1 reads free-text workout history from older versions', () => {
  assert.deepEqual(E.parseFreeText('胸25セット　1時間').partSets, { chest: 25 });
  assert.equal(E.parseFreeText('胸25セット　1時間').minutes, 60);
  const ex = E.parseFreeText('チェストプレス50kg 10回3セット、ペックフライ35kg×12×3').exercises;
  assert.deepEqual(ex.map(e => [e.name, e.sets.length, e.sets[0].weight, e.sets[0].reps]), [['チェストプレス', 3, 50, 10], ['ペックフライ', 3, 35, 12]]);
  assert.equal(E.parseFreeText('今日は完全休養日'), null);
  const recs = [{ date: '2026-11-20', strength: '胸25セット　1時間' }, { date: '2026-11-22', strength: '背中20セット' }, { date: '2026-11-23', strength: '今日は完全休養日', restDay: true }];
  const a = E.analyze(recs, TODAY);
  assert.equal(a.counts.total, 2); assert.equal(a.counts.textOnly, 2);
  assert.equal(a.partLast.chest, '2026-11-20'); assert.equal(a.partLast.back, '2026-11-22');
  assert.equal(a.weekSets.chest, 25);
  assert.notEqual(E.recommendPart(a, {}, TODAY), 'back');
});

test('v22.1 records with unknown store are used only after the user assigns a store', () => {
  const recs = [{ date: '2026-11-20', workoutPlace: '', strength: 'チェストプレス50kg×12×3' }];
  const before = E.planSession({ store: 'honten', part: 'chest', records: recs, today: TODAY }).exercises.find(e => e.name === 'チェストプレス');
  assert.equal(before.weight, null);
  assert.match(before.reference, /店舗不明では50kg/);
  const after = E.planSession({ store: 'honten', part: 'chest', records: recs, today: TODAY, prefs: { unknownStoreAs: 'honten' } }).exercises.find(e => e.name === 'チェストプレス');
  assert.equal(after.weight, 52.5);
  assert.equal(E.analyze(recs, TODAY, { unknownStoreAs: 'honten' }).counts.unknownStore, 0);
});
