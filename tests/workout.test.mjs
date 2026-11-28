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
  assert.ok(cp.sets.filter(x => x.type === 'main').every(x => x.weight === 60), JSON.stringify(cp.sets));
  assert.ok(cp.sets.some(x => x.type === 'warmup'), '主力種目には準備セットを設計する');
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
  assert.equal(E.recommendPart(E.analyze(confirmed.slice(1, 2), '2026-11-25'), {}, '2026-11-25'), 'back');
});

test('comparison uses the same weight; calories use MET formula minus resting', () => {
  const before = E.analyze(confirmed, TODAY);
  const s = { store: 'shioda', exercises: [{ name: 'DBサイドレイズ', sets: [{ type: 'main', weight: 12, reps: 17, done: true }] }, { name: 'Hammer Strengthラテラルレイズ', sets: [{ type: 'main', weight: 40, reps: 14, done: true }] }, { name: 'フェイスプル', sets: [{ type: 'main', weight: 55, reps: 9, done: true }] }] };
  const rows = E.compareSession(s, before);
  assert.deepEqual(rows.map(r => [r.exercise, r.result]), [['DBサイドレイズ', '前回未満'], ['Hammer Strengthラテラルレイズ', '前回未満'], ['フェイスプル', '前回未満']]);
  assert.match(rows[2].detail, /55kgで前回10回 → 今回9回/);
  assert.ok(!rows.some(r => r.result === '低下'));
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
  const main = v.exercises[0].sets.filter(x => x.type === 'main');
  assert.deepEqual(main.map(x => x.weight), [67.5, 67.5, 60]); // 最新実績（11/25 67.5×12・67.5×11・60×13）基準に戻す
  assert.ok(v.fixes.some(f => /説明できない/.test(f)));
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
  assert.match(req.instructions, /時間が長い時は同じ種目のセットを増やさず、別の刺激/);
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

test('v23.1 investigation: newest 11/17 record wins over 9/1 even when stored without store or with name variants', () => {
  const sess = (date, store, ex) => ({ date, workoutSessions: [{ id: date, status: 'finished', store, part: 'legs', startedAt: date + 'T09:00:00Z', finishedAt: date + 'T10:00:00Z', exercises: ex }] });
  const M = (w, r) => ({ type: 'main', weight: w, reps: r, done: true });
  const sep = sess('2026-09-01', 'shioda', [{ name: 'レッグプレス', sets: [M(190, 10), M(190, 9)] }, { name: 'レッグカール', sets: [M(60, 12)] }]);
  const variants = {
    noStore: { date: '2026-11-17', workoutPlace: '', workoutPart: 'legs', workoutExercises: [{ name: 'レッグプレス', weight: 170, reps: 15, sets: 3 }, { name: 'レッグカール', weight: 80, reps: 15, sets: 3 }] },
    nameVariant: sess('2026-11-17', 'shioda', [{ name: 'レッグプレス（塩田）', sets: [M(170, 15), M(170, 12), M(150, 15)] }, { name: 'レッグカール ', sets: [M(80, 15), M(80, 12), M(70, 15)] }]),
    textOnly: { date: '2026-11-17', workoutPlace: '塩田店', strength: '脚 レッグプレス170kg×15、170kg×12、150kg×15 レッグカール80kg×15、80kg×12、70kg×15' },
    confirmed: toRecord(CONFIRMED_SESSIONS[0])
  };
  for (const [k, rec] of Object.entries(variants)) {
    const p = E.planSession({ store: 'shioda', part: 'legs', records: [sep, rec], today: TODAY });
    const lp = p.exercises.find(e => e.name === 'レッグプレス'), lc = p.exercises.find(e => e.name === 'レッグカール');
    assert.match(lp.reason, /基準：11\/17/, k);
    assert.ok(lp.sets.filter(x => x.type === 'main').every(x => x.weight <= 175), `${k}: ${E.formatSets(lp.sets)}`);
    assert.ok(lc.sets.filter(x => x.type === 'main').every(x => x.weight >= 70), `${k}: レッグカールを根拠なく下げない ${E.formatSets(lc.sets)}`);
    assert.ok(!lp.isNew && !lc.isNew, k);
  }
});

test('v23.1 confirmed 11/17: per-set progression and designed warm-ups (warm-ups never counted as main)', () => {
  const p = E.planSession({ store: 'shioda', part: 'legs', records: [toRecord(CONFIRMED_SESSIONS[0])], today: TODAY, minutes: 75 });
  const get = n => p.exercises.find(e => e.name === n);
  assert.deepEqual(get('レッグプレス').sets.filter(x => x.type === 'main').map(x => [x.weight, x.reps]), [[170, 15], [170, 13], [150, 15]]);
  assert.deepEqual(get('レッグカール').sets.filter(x => x.type === 'main').map(x => [x.weight, x.reps]), [[80, 15], [80, 13], [70, 15]]);
  assert.deepEqual(get('レッグプレス').sets.filter(x => x.type === 'warmup').map(x => [x.weight, x.reps]), [[100, 8], [145, 4]]);
  for (const n of ['レッグプレス', 'レッグカール', 'レッグエクステンション', 'アブダクション']) assert.equal(get(n).isNew, false, n);
  const base = ['レッグプレス', 'レッグカール', 'レッグエクステンション', 'アブダクション'];
  assert.deepEqual(p.exercises.map(e => e.name).filter(n => base.includes(n)), base); // 11/17の種目構成を土台にする
  p.exercises.filter(e => !base.includes(e.name)).forEach(e => assert.match(e.reason, /余裕があるため、別の刺激の種目として追加/, e.name)); // 追加は時間の余裕がある時だけ・理由つき
  assert.ok(p.estMinutes <= 78);
  assert.equal(E.canonicalName('カーフ'), 'カーフプレス');
  const s = E.newSession(p, TODAY, '2026-11-27T10:00:00Z'); s.exercises.forEach(e => e.sets.forEach(x => { x.done = true; }));
  const sum = E.summarizeSession(s, 118);
  assert.equal(sum.warmupSets, p.exercises.reduce((a, e) => a + e.sets.filter(x => x.type === 'warmup').length, 0));
  assert.ok(sum.warmupSets >= 3);
});

test('v23.1 AI weight not explained by the latest record (e.g. 190kg) is replaced; AI isNew flag is ignored', () => {
  const a = E.analyze([toRecord(CONFIRMED_SESSIONS[0])], TODAY);
  const local = E.planSession({ store: 'shioda', part: 'legs', analysis: a, today: TODAY });
  const v = E.validatePlan({ summary: '', warnings: [], exercises: [
    { name: 'レッグプレス', sets: [{ type: 'main', weight: 190, reps: 10 }], restSec: 135, reason: '9/1の実績', isNew: true, newReason: '' },
    { name: 'レッグカール', sets: [{ type: 'main', weight: 60, reps: 15 }], restSec: 105, reason: '', isNew: true, newReason: '' }] }, local, a, {}, {}, []);
  const lp = v.exercises.find(e => e.name === 'レッグプレス'), lc = v.exercises.find(e => e.name === 'レッグカール');
  assert.ok(lp.sets.filter(x => x.type === 'main').every(x => x.weight <= 170));
  assert.ok(lc.sets.filter(x => x.type === 'main').every(x => x.weight >= 70));
  assert.equal(lp.isNew, false); assert.equal(lc.isNew, false);
  assert.equal(v.fixes.length, 2);
});

test('v23.3 longer time adds different exercises, never just more sets of the same exercise', () => {
  const rec = toRecord(CONFIRMED_SESSIONS[0]);
  const plans = [45, 60, 75, 90].map(m => E.planSession({ store: 'shioda', part: 'legs', records: [rec], today: '2026-11-28', minutes: m, profile: E.DEFAULT_PROFILE }));
  const counts = plans.map(p => p.exercises.length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], counts.join());
  assert.ok(counts[3] > counts[0], counts.join());
  const mainsPerEx = plans.map(p => Math.max(...p.exercises.map(e => e.sets.filter(x => x.type === 'main').length)));
  assert.ok(mainsPerEx.every(n => n <= 3), '時間を延ばしても1種目のセット数は増やさない: ' + mainsPerEx.join());
  // 腰痛の既往がある本人には、腰に負担のある種目（スクワット）を自動では足さない
  assert.ok(!plans[3].exercises.some(e => e.name === 'スクワット'));
  // 保存済み（AI）メニューを延ばす場合も、セットではなく種目を足す
  const a = E.analyze([rec], '2026-11-28');
  const ai = { store: 'shioda', part: 'legs', minutes: 60, exercises: plans[0].exercises };
  const longer = E.fitPlanToTime(ai, 90, a, { profile: E.DEFAULT_PROFILE });
  assert.ok(longer.exercises.length > ai.exercises.length);
  ai.exercises.forEach(e => assert.equal(longer.exercises.find(x => x.name === e.name).sets.length, e.sets.length));
});

test('v23.4 deleted exercises never come back (edited plan is not auto-refilled; removals remembered when time changes)', () => {
  const rec = toRecord(CONFIRMED_SESSIONS[0]);
  const a = E.analyze([rec], '2026-11-28');
  const p = E.planSession({ store: 'shioda', part: 'legs', analysis: a, today: '2026-11-28', minutes: 90, profile: E.DEFAULT_PROFILE });
  const victim = p.exercises.find(e => e.name === 'ブルガリアンスクワット') || p.exercises[p.exercises.length - 1];
  const edited = { ...p, edited: true, exercises: p.exercises.filter(e => e !== victim), removed: [victim.name] };
  const again = E.fitPlanToTime(edited, 90, a, { profile: E.DEFAULT_PROFILE });
  assert.ok(!again.exercises.some(e => e.name === victim.name), '同じ時間なら編集したメニューをそのまま使う');
  assert.equal(again.exercises.length, edited.exercises.length);
  const longer = E.fitPlanToTime({ ...edited, minutes: 75 }, 120, a, { profile: E.DEFAULT_PROFILE });
  assert.ok(!longer.exercises.some(e => e.name === victim.name), '時間を変えても削除した種目は戻さない');
});

const mk = (w, r, pw = w, pr = r) => ({ type: 'main', weight: w, reps: r, plannedWeight: pw, plannedReps: pr, done: true });
test('user report: 100kg×10 after 90kg×13 is 更新（重量）, never 低下', () => {
  const before = E.analyze(confirmed, TODAY);
  const s = { store: 'shioda', exercises: [{ name: 'レッグエクステンション', reason: '', sets: [mk(80, 12), mk(90, 10), mk(100, 10), mk(80, 15)] }] };
  const [r] = E.compareSession(s, before);
  assert.equal(r.result, '更新');
  assert.equal(r.prev, '80×14、90×13、70×15');
  assert.equal(r.planned, '80×12、90×10、100×10、80×15');
  assert.match(r.detail, /重量更新：前回最大90×13 → 今回100×10/);
  assert.match(r.note, /100kgに挑戦する予定.*回数を抑えています/);
});
test('following the app plan that targets fewer reps is 予定どおり with its reason; missing it is 予定未達', () => {
  const before = E.analyze(confirmed, TODAY);
  const ex = (reps) => ({ name: 'レッグプレス', reason: '基準：11/17の170×15（最新の実績）。丁寧なフォームで可動域を確保するため回数を抑える', sets: [mk(170, reps, 170, 12), mk(170, 12), mk(150, 15)] });
  const [ok] = E.compareSession({ store: 'shioda', exercises: [ex(12)] }, before);
  assert.equal(ok.result, '予定どおり');
  assert.match(ok.note, /回数を抑えた予定.*丁寧なフォーム/);
  const [miss] = E.compareSession({ store: 'shioda', exercises: [ex(10)] }, before);
  assert.equal(miss.result, '予定未達');
  const text = E.localReview({ pain: '' }, [ok, miss]);
  assert.match(text, /予定どおり：レッグプレス/);
  assert.doesNotMatch(text, /低下/);
});
test('AI plan that cuts reps without a heavier set is rejected; heavier-day plan keeps its intent', () => {
  const recs = confirmed;
  const a = E.analyze(recs, TODAY);
  const local = E.planSession({ store: 'shioda', part: 'legs', analysis: a, today: TODAY, minutes: 60 });
  const lp = local.exercises.find(e => e.name === 'レッグプレス');
  const cut = E.validatePlan({ exercises: [{ name: 'レッグプレス', sets: lp.sets.map(x => x.type === 'main' ? { ...x, reps: Math.max(1, x.reps - 4) } : x) }] }, local, a, {}, null, null);
  assert.deepEqual(cut.exercises[0].sets.map(x => x.reps), lp.sets.map(x => x.reps));
  assert.match(cut.fixes.join(), /理由なく回数を下げていた/);
  const heavy = E.validatePlan({ exercises: [{ name: 'レッグエクステンション', reason: '95kgに挑戦', sets: [{ type: 'main', weight: 80, reps: 12 }, { type: 'main', weight: 90, reps: 10 }, { type: 'main', weight: 95, reps: 10 }] }] }, local, a, {}, null, null);
  assert.equal(heavy.exercises[0].sets.find(x => x.weight === 95).reps, 10);
  assert.match(heavy.exercises[0].reason, /95kgに挑戦する予定.*回数を抑えています/);
});
test('sessions with 0 completed sets are excluded from history', () => {
  const recs = [...confirmed, { date: '2026-11-27', workoutSessions: [{ id: 'z', status: 'finished', store: 'shioda', part: 'legs', exercises: [{ name: 'レッグプレス', sets: [{ type: 'main', weight: 170, reps: 15, done: false }] }] }] }];
  const a = E.analyze(recs, TODAY);
  assert.ok(!a.sessions.some(s => s.date === '2026-11-27'));
});
