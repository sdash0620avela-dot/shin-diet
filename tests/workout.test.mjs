import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const E = require('../workout-engine.js');
const { CONFIRMED_SESSIONS } = require('../history-seed.js');
const evidence = JSON.parse(readFileSync(new URL('../science/evidence.json', import.meta.url), 'utf8'));
const TODAY = '2026-11-27';

// 確定実績（仕様書17）を日別記録の形にする
const toRecord = c => ({ date: c.date, weight: 118.4, workoutSessions: [{ id: c.id, status: 'finished', store: c.store, part: c.part, startedAt: new Date(c.startedAt).toISOString(), finishedAt: new Date(c.finishedAt).toISOString(), fatigue: c.fatigue, pain: c.pain,
  exercises: c.exercises.map(e => ({ name: e.name, sets: e.sets.map(s => ({ ...s })) })) }] });
const confirmed = CONFIRMED_SESSIONS.map(toRecord);

test('confirmed 11/24-26 sessions: program totals match the user-confirmed numbers exactly', () => {
  for (const c of CONFIRMED_SESSIONS) {
    const s = E.summarizeSession({ ...c, exercises: c.exercises.map(e => ({ ...e, restSec: 90 })) }, 118.4);
    assert.deepEqual({ minutes: s.minutes, totalSets: s.totalSets, warmupSets: s.warmupSets, mainSets: s.mainSets, totalReps: s.totalReps }, c.expect, c.id);
  }
});

test('different machines with similar names are never merged; dumbbells are shared across stores', () => {
  assert.equal(E.canonicalName('ラットプルダウン・ワイド'), 'ラットプルダウン・ワイド');
  assert.equal(E.canonicalName('ワイドラットプルダウン・プレート式'), 'ワイドラットプルダウン・プレート式');
  assert.notEqual(E.canonicalName('ベンチインクライン・ケーブルフライ'), E.canonicalName('ケーブルフライ'));
  assert.equal(E.canonicalName('インクラインダンベルプレス'), 'インクラインDBプレス');
  assert.equal(E.equipOf('DBサイドレイズ'), 'dumbbell');
  assert.equal(E.equipOf('ISOデクラインプレス'), 'plate');
  assert.equal(E.weightKey('honten', 'DBサイドレイズ'), E.weightKey('shioda', 'DBサイドレイズ'));
  assert.notEqual(E.weightKey('honten', 'チェストプレス'), E.weightKey('shioda', 'チェストプレス'));
});

test('plan for 塩田店・肩 starts from the 11/26 session with per-set targets and keeps warm-ups', () => {
  const p = E.planSession({ store: 'shioda', part: 'shoulders', records: confirmed, today: TODAY, minutes: 60 });
  const sp = p.exercises.find(e => e.name === 'マシンショルダープレス');
  assert.deepEqual(sp.sets.map(s => [s.type, s.weight, s.reps]), [['warmup', 20, 12], ['main', 40, 10], ['main', 50, 10], ['main', 40, 12]]);
  assert.match(sp.reason, /2セット目だけ\+1回/);
  // 機械的な全セット+1回ではない：変更されたのは1セットだけ
  const changed = sp.sets.filter((s, i) => s.type === 'main' && s.reps !== [null, 10, 9, 12][i]).length;
  assert.equal(changed, 1);
  assert.match(sp.last, /準20×12、40×10、50×9、40×12/);
  assert.equal(p.exercises[0].restSec, 135); // 塩田店の主力は135秒
});

test('ダンベル実績は他店舗でも重量を使い、マシンは店舗別のまま空欄（換算しない）', () => {
  const p = E.planSession({ store: 'honten', part: 'shoulders', records: confirmed, today: TODAY, minutes: 75 });
  const db = p.exercises.find(e => e.name === 'DBサイドレイズ');
  assert.ok(db.sets.filter(s => s.type === 'main').every(s => s.weight !== null));
  const machine = p.exercises.find(e => e.name === 'マシンショルダープレス');
  assert.ok(machine.sets.every(s => s.weight === null));
  assert.match(machine.reason, /換算しません/);
});

test('塩田店はマシンプルオーバーなし→ケーブルプルオーバーで代替、除外種目は入らない', () => {
  const p = E.planSession({ store: 'shioda', part: 'back', records: [], today: TODAY, minutes: 60 });
  const names = p.exercises.map(e => e.name);
  assert.ok(!names.includes('マシンプルオーバー'));
  assert.ok(names.includes('ケーブルプルオーバー'));
  assert.ok(!E.planSession({ store: 'honten', part: 'back', records: [], today: TODAY, prefs: {}, profile: { excluded: ['ニュートラルグリッププルダウン'] } }).exercises.some(e => e.name === 'ニュートラルグリッププルダウン'));
});

test('learning: actual 60kg (planned 50kg) is used for the next plan, not the planned value', () => {
  const plan = { id: 'p', source: 'local', store: 'honten', part: 'chest', minutes: 60, exercises: [{ name: 'チェストプレス', restSec: 120, sets: [{ type: 'main', weight: 50, reps: 10 }, { type: 'main', weight: 50, reps: 10 }] }] };
  const s = E.newSession(plan, '2026-11-27', '2026-11-27T10:00:00.000Z');
  s.exercises[0].sets.forEach(x => { x.weight = 60; x.done = true; });
  assert.equal(s.exercises[0].sets[0].plannedWeight, 50); // 予定値は残る
  s.status = 'finished'; s.finishedAt = '2026-11-27T11:00:00.000Z';
  const next = E.planSession({ store: 'honten', part: 'chest', records: [{ date: '2026-11-27', workoutSessions: [s] }], today: '2026-11-28', minutes: 60 });
  const cp = next.exercises.find(e => e.name === 'チェストプレス');
  assert.ok(cp.sets.every(x => x.weight === 60), JSON.stringify(cp.sets));
});

test('unchecked sets are not counted as actual results', () => {
  const plan = { id: 'p', store: 'shioda', part: 'legs', minutes: 60, exercises: [{ name: 'レッグプレス', sets: [{ type: 'main', weight: 170, reps: 15 }, { type: 'main', weight: 170, reps: 12 }] }] };
  const s = E.newSession(plan, TODAY, '2026-11-27T10:00:00.000Z');
  s.exercises[0].sets[0].done = true; s.status = 'finished'; s.finishedAt = '2026-11-27T10:30:00.000Z';
  const sum = E.summarizeSession(s, 118);
  assert.equal(sum.totalSets, 1); assert.equal(sum.incompleteSets, 1);
  const a = E.analyze([{ date: TODAY, workoutSessions: [s] }], TODAY);
  assert.equal(a.byKey[E.weightKey('shioda', 'レッグプレス')].last.main.length, 1);
});

test('rating "インクラインケーブルフライの方が効く" is stored and changes later exercise choice', () => {
  let ratings = E.applyRatings([], [{ exercise: 'ケーブルフライ', aspect: 'priority', value: 'low', note: '' }]);
  const r = E.localChat('これよりインクラインケーブルフライの方が効く', null, {});
  assert.equal(r.ratings[0].exercise, 'ベンチインクライン・ケーブルフライ');
  ratings = E.applyRatings(ratings, r.ratings);
  assert.equal(ratings.find(x => x.exercise === 'ベンチインクライン・ケーブルフライ').value, 'good');
  const p = E.planSession({ store: 'honten', part: 'chest', records: [], today: TODAY, ratings });
  assert.ok(p.exercises.some(e => e.name === 'ベンチインクライン・ケーブルフライ'));
  assert.ok(!p.exercises.some(e => e.name === 'ケーブルフライ'));
});

test('next part follows rotation 胸→背中→肩→脚→腕 from the last trained part', () => {
  assert.equal(E.recommendPart(E.analyze(confirmed, TODAY), {}, TODAY), 'legs');
  assert.equal(E.recommendPart(E.analyze(confirmed.slice(0, 1), '2026-11-25'), {}, '2026-11-25'), 'back');
});

test('comparison uses the same weight; calories use MET formula minus resting', () => {
  const before = E.analyze(confirmed, TODAY);
  const s = { store: 'shioda', exercises: [{ name: 'DBサイドレイズ', sets: [{ type: 'main', weight: 12, reps: 17, done: true }] }, { name: 'Hammer Strengthラテラルレイズ', sets: [{ type: 'main', weight: 40, reps: 14, done: true }] }, { name: 'フェイスプル', sets: [{ type: 'main', weight: 55, reps: 9, done: true }] }] };
  const rows = E.compareSession(s, before);
  assert.deepEqual(rows.map(r => [r.exercise, r.prev, r.now, r.result]), [['DBサイドレイズ', '12×17', '12×17', '維持'], ['Hammer Strengthラテラルレイズ', '40×14', '40×14', '維持'], ['フェイスプル', '55×10', '55×9', '低下']]);
  const k = E.caloriesFor(53, 118.4, 20, 100);
  assert.equal(k.met, 4.5);
  assert.equal(k.extra, Math.round(4.5 * 3.5 * 118.4 / 200 * 53 - 3.5 * 118.4 / 200 * 53));
});

test('pain ≥6 removes related exercises; fatigue 4 holds progression and trims sets', () => {
  const pain = E.planSession({ store: 'shioda', part: 'shoulders', records: confirmed, today: TODAY, pain: '右肩7/10' });
  assert.ok(!pain.exercises.some(e => e.name === 'マシンショルダープレス'));
  const tired = E.planSession({ store: 'shioda', part: 'shoulders', records: confirmed, today: TODAY, fatigue: 4 });
  const sp = tired.exercises.find(e => e.name === 'DBサイドレイズ');
  assert.equal(sp.sets.filter(s => s.type === 'main').length, 3);
  assert.match(sp.reason, /維持/);
});

test('塩田店のケーブル連続ブロックは15分を超えないよう並べ替える', () => {
  const ex = ['ケーブルカール', 'ケーブルプレスダウン', 'オーバーヘッドエクステンション', 'EZバーカール'].map(n => ({ name: n, restSec: 105, sets: Array.from({ length: 4 }, () => ({ type: 'main', weight: 20, reps: 12 })) }));
  const ordered = E.orderForFlow(ex, 'shioda', {});
  let block = 0, max = 0; ordered.forEach(e => { if (E.equipOf(e.name) === 'cable') { block += E.estimateSeconds([e]) / 60; max = Math.max(max, block); } else block = 0; });
  assert.ok(max <= 15 || ordered.findIndex(e => e.name === 'EZバーカール') < 3, ordered.map(e => e.name).join());
});

test('AI output validation: excluded/missing removed, absurd weights corrected, sets normalized', () => {
  const a = E.analyze(confirmed, TODAY);
  const local = E.planSession({ store: 'shioda', part: 'back', analysis: a, today: TODAY });
  const v = E.validatePlan({ summary: 's', warnings: [], exercises: [
    { name: 'マシンプルオーバー', sets: [{ type: 'main', weight: 40, reps: 12 }], restSec: 90, reason: '', isNew: false, newReason: '' },
    { name: 'バーベルベントオーバーロウ', sets: [{ type: 'main', weight: 60, reps: 8 }], restSec: 120, reason: '', isNew: false, newReason: '' },
    { name: 'シーテッドロー', sets: [{ type: 'warmup', weight: 45, reps: 8 }, { type: 'main', weight: 200, reps: 12 }], restSec: 135, reason: 'x', isNew: false, newReason: '' }
  ] }, local, a, {}, {}, []);
  assert.deepEqual(v.exercises.map(e => e.name), ['シーテッドロー']);
  assert.equal(v.exercises[0].sets[1].weight, 67.5);
  assert.equal(E.validatePlan({ exercises: [] }, local, a), null);
});

test('evidence file: verified items carry the required fields; unknown fields are null, not invented', () => {
  for (const it of evidence.items.filter(x => x.verified)) {
    for (const k of ['title', 'authors', 'published', 'doi', 'url', 'finding', 'applicability', 'reflection']) assert.ok(it[k], `${it.id}.${k}`);
    for (const k of ['design', 'subjects', 'strength', 'limitations']) assert.ok(k in it, `${it.id}.${k}`);
  }
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

test('worker workout_plan: set-level strict schema, judgement order, user prompt included as priority 1', async () => {
  const out = { summary: 's', warnings: [], exercises: [{ name: 'レッグプレス', sets: [{ type: 'warmup', weight: 100, reps: 8 }, { type: 'main', weight: 170, reps: 15 }], restSec: 135, reason: 'r', isNew: false, newReason: '' }] };
  const r = await callWorker({ kind: 'workout_plan', store: 'shioda', part: 'legs', minutes: 60, brief: '本人ルール：脚はレッグプレスから', context: {}, baseline: [] }, okOutput(out));
  assert.equal(r.status, 200); assert.equal(r.json.exercises[0].sets[1].weight, 170);
  const req = r.calls.find(c => c.url.includes('openai')).body;
  assert.equal(req.text.format.strict, true);
  assert.deepEqual(req.text.format.schema.properties.exercises.items.properties.sets.items.properties.type.enum, ['warmup', 'main']);
  assert.match(req.instructions, /1\.本人の最新指示 2\.身体の安全性と痛み/);
  assert.match(req.instructions, /ダンベルは片手で店舗共通/);
  assert.match(req.instructions, /本人ルール：脚はレッグプレスから/);
});

test('worker workout_chat returns a proposal and ratings; workout_review returns evaluation', async () => {
  const chat = await callWorker({ kind: 'workout_chat', message: 'ケーブルが空いてない', active: true, plan: {}, context: {} }, okOutput({ reply: '順番を変えます', proposal: { target: 'current', summary: 'ケーブルを後半へ', exercises: [] }, ratings: [], preferenceChanges: [] }));
  assert.equal(chat.status, 200); assert.equal(chat.json.proposal.target, 'current');
  assert.match(chat.calls.find(c => c.url.includes('openai')).body.input[0].content[0].text, /完了済み。変更・消去しない/);
  const rev = await callWorker({ kind: 'workout_review', summary: { totalSets: 24 }, comparison: [], session: [], context: {} }, okOutput({ evaluation: '維持', nextTargets: [{ exercise: 'A', target: '50×10' }] }));
  assert.equal(rev.status, 200); assert.equal(rev.json.nextTargets[0].target, '50×10');
  assert.match(rev.calls.find(c => c.url.includes('openai')).body.input[0].content[0].text, /集計はアプリが計算済み（再計算しない）/);
});

test('worker reports billing problems without retrying; model switchable by env with fallback', async () => {
  const r = await callWorker({ kind: 'workout_plan', store: 'honten', part: 'legs' }, () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }));
  assert.equal(r.status, 502); assert.match(r.json.error, /利用残高/); assert.equal(r.calls.filter(c => c.url.includes('openai')).length, 1);
  let n = 0;
  const f = await callWorker({ kind: 'workout_chat', message: 'x', plan: {}, context: {} }, call => { n++; if (n === 1) { assert.equal(call.body.model, 'gpt-5.5'); return new Response('{}', { status: 500 }); } return okOutput({ reply: 'ok', proposal: null, ratings: [], preferenceChanges: [] })(); }, { WORKOUT_AI_MODEL: 'gpt-5.5' });
  assert.equal(f.status, 200); assert.equal(f.json.model, 'gpt-5.4-mini');
});

test('pasted previous-coach menu import still works (names kept as written)', () => {
  const { entries } = E.parseImport('【塩田店】背中\n- ラットプルダウン・ワイド：60kg×12回×3set\n- アシスト懸垂 補助20kg 8回 3セット\nルール：前回全セット12回できたら2.5kg上げる', '');
  assert.deepEqual(entries.map(e => [e.store, e.name, e.weight, e.reps, e.sets]), [['shioda', 'ラットプルダウン・ワイド', 60, 12, 3], ['shioda', 'アシスト懸垂', 20, 8, 3]]);
});
