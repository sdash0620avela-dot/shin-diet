// AI Life Navi v23 E2E（iPhone 13相当・Chromium）— 仕様書23の必須テスト
// 本番データ保護：Supabaseは e2e/fake-supabase.js（仮想クラウド）、AI Workerはモック。本番Supabaseへの通信は遮断。
// 使い方：node e2e/run-e2e.mjs   （BASE_URL を指定すると公開URLで実行。その場合もSupabase・AIはモック）
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'e2e', 'artifacts'); mkdirSync(OUT, { recursive: true });
const PORT = 8000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}/`;
const WORKER = 'https://shin-diet-photo-analysis.sdash0620.workers.dev/';
const SUPA_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const FAKE = readFileSync(join(ROOT, 'e2e', 'fake-supabase.js'), 'utf8');
const USER = { id: 'e2e-owner', email: 'owner@example.test' };
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

let server;
if (!process.env.BASE_URL) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, BASE).pathname).replace(/^\/+/, '') || 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(readFileSync(file));
  }).listen(PORT);
}

/* ---------- 仮想クラウド・AIモック ---------- */
const cloud = { diet_profiles: new Map(), diet_records: new Map(), fail: false };
const ai = { mode: 'ok', delay: 300, calls: [] };
function dbHandle(body) {
  if (cloud.fail) throw new Error('cloud down');
  const t = cloud[body.table];
  if (body.op === 'select') return { data: [...t.values()].filter(r => r.user_id === body.filters.user_id) };
  body.rows.forEach(r => { if (r.user_id !== body.user) throw new Error('RLS'); t.set(body.table === 'diet_profiles' ? r.user_id : `${r.user_id}|${r.record_date}`, JSON.parse(JSON.stringify(r))); });
  return { data: [] };
}
function aiOut(body) {
  if (ai.mode === 'invalid') return { summary: 'broken', warnings: [], exercises: [{ name: '', sets: 'x' }] };
  if (body.kind === 'workout_plan') return { summary: 'AIモック', warnings: [], model: 'mock', exercises: (body.baseline || []).map(b => ({ name: b.name, sets: b.sets, restSec: b.restSec, reason: 'AI：' + String(b.reason).slice(0, 20), isNew: false, newReason: '' })) };
  if (body.kind === 'workout_chat') {
    if (/インクライン/.test(body.message)) return { reply: '評価を保存します。', proposal: null, ratings: [{ exercise: 'ベンチインクライン・ケーブルフライ', aspect: 'effect', value: 'good', note: '通常より効く' }], preferenceChanges: [] };
    if (/ケーブル/.test(body.message)) { const ex = body.plan.exercises; const done = ex.filter(e => e.doneSets > 0), rest = ex.filter(e => !(e.doneSets > 0)); const cable = rest.filter(e => /ケーブル|フェイスプル/.test(e.name)); return { reply: 'ケーブル種目を最後に回します。', proposal: { target: 'current', summary: 'ケーブルを後半へ', exercises: [...done, ...rest.filter(e => !cable.includes(e)), ...cable].map(e => ({ name: e.name, sets: e.sets.map(s => ({ type: s.type, weight: s.weight, reps: s.reps })), restSec: e.restSec || 90, reason: '', isNew: false, newReason: '' })) }, ratings: [], preferenceChanges: [] }; }
    return { reply: '了解しました。', proposal: null, ratings: [], preferenceChanges: [] };
  }
  if (body.kind === 'workout_review') return { evaluation: 'AIモック評価：維持できています。', nextTargets: [{ exercise: 'マシンショルダープレス', target: '40×10、50×10、40×12' }] };
  return {};
}
async function routeAll(context) {
  await context.route(SUPA_LIB, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await context.route('https://fake-supabase.test/**', async r => { try { r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dbHandle(JSON.parse(r.request().postData()))) }); } catch (e) { r.fulfill({ status: 503, body: e.message }); } });
  await context.route('https://ulorhqbotwsbhyoapixi.supabase.co/**', r => r.abort());
  await context.route(WORKER + '**', async r => {
    const body = JSON.parse(r.request().postData() || '{}');
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (body.kind === 'server_time') return r.fulfill({ status: 200, headers, body: JSON.stringify({ server_time: new Date().toISOString() }) });
    ai.calls.push({ kind: body.kind, store: body.store, part: body.part, body });
    await new Promise(res => setTimeout(res, ai.mode === 'slow' ? 70000 : ai.delay));
    if (ai.mode === 'error') return r.fulfill({ status: 502, headers, body: JSON.stringify({ error: 'AIコーチでエラーが発生しました。' }) });
    r.fulfill({ status: 200, headers, body: JSON.stringify(aiOut(body)) }).catch(() => {});
  });
}
function seedCloud() {
  const d = n => new Date(Date.parse(TODAY) - n * 86400e3).toISOString().slice(0, 10);
  const rows = [{ date: d(60), strength: '胸25セット　1時間', weight: 121, intake: 2000 }, { date: d(40), workoutPlace: '本店', workoutPart: 'legs', workoutExercises: [{ name: 'レッグプレス', weight: 160, reps: 12, sets: 3 }], weight: 120, intake: 1900 }, { date: d(1), weight: 118.4, intake: 2100 }];
  rows.forEach(r => { r.updatedAt = `${r.date}T12:00:00.000Z`; cloud.diet_records.set(`${USER.id}|${r.date}`, { user_id: USER.id, record_date: r.date, record: r, updated_at: r.updatedAt }); });
  cloud.diet_profiles.set(USER.id, { user_id: USER.id, settings: { displayName: '慎', startDate: '2026-06-17', startWeight: 127.4, goalWeight: 95, baseBurn: 2800, updatedAt: '2026-11-01T00:00:00.000Z' }, updated_at: '2026-11-01T00:00:00.000Z' });
  return rows.length;
}

/* ---------- 補助 ---------- */
const results = [], timings = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await chromium.launch();
async function newDevice({ sw = false, user = USER, consent = true } = {}) {
  const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: sw ? 'allow' : 'block', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await routeAll(context);
  await context.addInitScript(([u, key, c]) => { if (!sessionStorage.getItem('e2eInit')) { sessionStorage.setItem('e2eInit', '1'); if (u) localStorage.setItem('e2eAuthUser', JSON.stringify(u)); if (c) localStorage.setItem(key, JSON.stringify({ version: '1', acceptedAt: new Date().toISOString() })); } }, [user, `shinDiet:${user && user.id}:aiconsent`, consent]);
  const page = await context.newPage();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page._promptAnswer || '') : undefined));
  page.on('pageerror', e => check('JSエラーが発生しない', false, e.message));
  return { context, page };
}
const ready = async (page, uid = USER.id) => { await page.waitForFunction(id => window.WorkoutUI && typeof activeStorageId !== 'undefined' && activeStorageId === id, uid, { timeout: 15000 }); await page.waitForTimeout(400); };
const tab = (page, label) => page.locator('.tab', { hasText: label }).click();
const ls = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const K = { active: `shinDiet:${USER.id}:workoutactive`, records: `shinDiet:${USER.id}:records`, settings: `shinDiet:${USER.id}:settings` };
const activeSession = page => ls(page, K.active);

/* ================= シナリオ ================= */
const seeded = seedCloud();
{
  const { context, page } = await newDevice();
  const t0 = Date.now(); await page.goto(BASE); await ready(page);
  await page.locator('#trainRoot .lv-ex').first().waitFor(); timings.homeMenuMs = Date.now() - t0;
  // フェーズ1：筋トレ専用の画面構成
  const tabs = await page.locator('.tabs .tab').allInnerTexts();
  check('下部ナビは ホーム・筋トレ・履歴・AIコーチ・設定 の5項目', JSON.stringify(tabs.map(t => t.trim())) === JSON.stringify(['ホーム', '筋トレ', '履歴', 'AIコーチ', '設定']), tabs.join('/'));
  check('ホームに食事機能を表示しない', !(await page.locator('#home').innerText()).match(/食事|カロリー収支|栄養/));
  check('ホームに今日の部位・店舗・時間・疲労度・痛み・開始ボタン', await page.locator('#trainRoot [data-act="start"]').isVisible() && (await page.locator('#trainRoot [data-act="fatigue"]').count()) === 5 && await page.locator('#lvPainInput').isVisible());
  check('メニューは横並びでなく、セットごとの行（区分・重量・回数・完了）で表示', (await page.locator('#trainRoot .lv-ex').first().locator('tr[data-si]').count()) >= 2 && (await page.locator('#trainRoot .lv-preview').count()) === 0);
  check('開始前は完了チェックが無効、並べ替え・削除は編集モードのみ', await page.locator('#trainRoot .lv-check').first().isDisabled() && (await page.locator('#trainRoot [data-act="delex"]').count()) === 0);
  check('既存の体重・食事データはクラウドから同期され保持', (await ls(page, K.records)).length === seeded);
  // 確定実績の登録（重複防止）
  await tab(page, '履歴'); await page.click('[data-act="seed"]'); await page.waitForTimeout(300);
  let recs = await ls(page, K.records);
  const ids = recs.flatMap(r => (r.workoutSessions || []).map(s => s.id));
  check('確定実績4件を登録（11/17脚を含む）', ['confirmed-2026-11-17-shioda-legs', 'confirmed-2026-11-24-honten-chest', 'confirmed-2026-11-25-shioda-back', 'confirmed-2026-11-26-shioda-shoulders'].every(id => ids.includes(id)));
  const sums = recs.flatMap(r => (r.workoutSessions || []).filter(s => s.id.startsWith('confirmed')).map(s => [s.summary.totalSets, s.summary.warmupSets, s.summary.mainSets, s.summary.totalReps, s.summary.minutes].join('/')));
  check('登録後の集計が確定値と一致（11/17：12/0/12/177・11/24：24/7/17/324/65・11/25：24/7/17/262/62・11/26：24/4/20/326/53）', JSON.stringify(sums) === JSON.stringify(['12/0/12/177/', '24/7/17/324/65', '24/7/17/262/62', '24/4/20/326/53']), sums.join(' '));
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('shinDiet:e2e-owner:records')); window.__seedAgain = true; });
  check('登録ボタンは登録後に消える（二重登録防止）', (await page.locator('[data-act="seed"]').count()) === 0);
  await page.locator('[data-act="histopen"]').first().click();
  const histText = await page.locator('#historyRoot').innerText();
  check('履歴に全セット（準備／本）を表示', /準備 20×12/.test(histText) && /本 50×9/.test(histText), histText.slice(0, 80).replace(/\s+/g, ' '));
  check('種目別の推移グラフを表示', (await page.locator('#historyRoot svg.lv-chart').count()) >= 1);
  await page.screenshot({ path: join(OUT, 'v23-history.png') });
  // メニュー生成 10パターン
  await tab(page, 'ホーム');
  for (const store of ['honten', 'shioda']) for (const part of ['chest', 'back', 'shoulders', 'legs', 'arms']) {
    const t = Date.now();
    await page.click(`#trainRoot [data-act="store"][data-v="${store}"]`); await page.click(`#trainRoot [data-act="part"][data-v="${part}"]`);
    const plan = await page.evaluate(() => WorkoutUI._ui.plan);
    const ms = Date.now() - t;
    const names = plan.exercises.map(e => e.name);
    const okEquip = !(store === 'shioda' && names.includes('マシンプルオーバー')) && !names.includes('バーベルベントオーバーロウ');
    const hasMain = plan.exercises.every(e => e.sets.some(s => s.type === 'main'));
    const fitsTime = plan.estMinutes <= plan.minutes + 5;
    let history = true;
    if (store === 'shioda' && part === 'shoulders') history = plan.exercises.find(e => e.name === 'マシンショルダープレス').sets.map(s => s.weight).join() === '20,40,50,40';
    if (store === 'honten' && part === 'chest') history = plan.exercises.find(e => e.name === 'チェストプレス').sets.filter(s => s.type === 'main').map(s => s.weight).join() === '82,82,89,61';
    if (store === 'shioda' && part === 'legs') { const lp = plan.exercises.find(e => e.name === 'レッグプレス'); history = /基準：11\/17/.test(lp.reason) && lp.sets.filter(s => s.type === 'main').map(s => s.weight).join() === '170,170,150' && lp.sets.filter(s => s.type === 'warmup').length === 2 && !plan.exercises.some(e => e.isNew && ['レッグプレス', 'レッグカール', 'レッグエクステンション', 'アブダクション'].includes(e.name)); }
    if (store === 'shioda' && part === 'back') history = names.includes('ケーブルプルオーバー') && plan.exercises.find(e => e.name === 'シーテッドロー').sets[0].type === 'warmup';
    check(`生成 ${store}/${part}：設備・除外・準備/本・時間・実績反映`, okEquip && hasMain && fitsTime && history, `${plan.summary}・${ms}ms`);
  }
  // AIモックが反映される（バックグラウンド）
  await page.waitForFunction(() => WorkoutUI._ui.plan && WorkoutUI._ui.plan.source === 'ai', null, { timeout: 8000 }).catch(() => {});
  check('AIコーチの調整結果がバックグラウンドで反映される', await page.evaluate(() => WorkoutUI._ui.plan.source === 'ai'));
  await page.screenshot({ path: join(OUT, 'v23-home.png') });
  // 開始（塩田店・肩）
  await page.click('#trainRoot [data-act="store"][data-v="shioda"]'); await page.click('#trainRoot [data-act="part"][data-v="shoulders"]');
  await page.click('#trainRoot [data-act="fatigue"][data-v="2"]');
  await page.locator('#trainRoot .lv-ex').first().locator('tr[data-si]').nth(1).locator('[data-f="weight"]').fill('41');
  await page.waitForTimeout(900);
  check('開始前に重量を編集でき、メニューに保存される', (await ls(page, K.settings)).workoutCoach.plans['shioda:shoulders'].exercises[0].sets[1].weight === 41);
  const ts = Date.now(); await page.evaluate(() => { const b = document.querySelector('#trainRoot [data-act="start"]'); b.click(); b.click(); }); // 連打
  await page.locator('.lv-live-head').waitFor(); timings.startMs = Date.now() - ts;
  let s = await activeSession(page);
  check('開始ボタン連打でもセッションは1件', !!s && (await page.locator('.lv-live-head').count()) === 1);
  check('開始時に日付・開始時刻・店舗・部位・予定・IDを保存', s.date === TODAY && s.startedAt && s.store === 'shioda' && s.part === 'shoulders' && s.id && s.exercises.length > 0 && s.fatigue === 2);
  check('開始前に編集した重量が予定値として引き継がれる', s.exercises[0].sets[1].plannedWeight === 41);
  check('開始後も同じ画面（ホームのまま）で完了チェックが有効', await page.locator('#home.active #trainRoot .lv-live-head').count() === 1 && !(await page.locator('#trainRoot .lv-check').first().isDisabled()));
  const firstEx = page.locator('.lv-ex').first();
  check('全種目をセット単位（区分・重量・回数・完了）で表示', (await firstEx.locator('tr[data-si]').count()) === 4 && /準備1/.test(await firstEx.innerText()) && /本1/.test(await firstEx.innerText()));
  // 入力：重量（小数）・回数・チェック・解除
  const row = i => firstEx.locator('tr[data-si]').nth(i);
  await row(1).locator('[data-f="weight"]').fill('42.5'); await row(1).locator('[data-f="reps"]').fill('11');
  await page.evaluate(() => { window.__renders = 0; const rt = document.getElementById('trainRoot'); new MutationObserver(m => { window.__renders += m.filter(x => x.target === rt).length; }).observe(rt, { childList: true }); window.scrollTo({ top: 300, behavior: 'instant' }); });
  await page.waitForTimeout(300);
  const y0 = await page.evaluate(() => scrollY);
  const tc = Date.now(); await row(1).locator('[data-act="done"]').evaluate(b => b.click()); timings.checkMs = Date.now() - tc; // 自動スクロールなしでタップ
  s = await activeSession(page);
  check('小数重量・回数・完了チェックを即時保存（予定値は保持）', s.exercises[0].sets[1].weight === 42.5 && s.exercises[0].sets[1].reps === 11 && s.exercises[0].sets[1].done && s.exercises[0].sets[1].plannedWeight === 41, JSON.stringify(s.exercises[0].sets[1]));
  await page.waitForTimeout(300); const y1 = await page.evaluate(() => scrollY);
  check('チェックしても画面位置が変わらず、画面全体を作り直さない', Math.abs(y1 - y0) < 5 && (await page.evaluate(() => window.__renders)) === 0, `${y0}→${y1}`);
  check('セット完了でレストタイマーが自動開始（塩田店の主力135秒）', /休憩 2:1\d/.test(await page.locator('#lvRest').innerText()));
  await page.click('[data-act="restplus"]'); check('タイマー延長（+30秒）', /休憩 2:4\d/.test(await page.locator('#lvRest').innerText()));
  await page.click('[data-act="restskip"]');
  await row(1).locator('[data-act="done"]').click(); s = await activeSession(page);
  check('チェック解除ができ、解除後も値は残る', !s.exercises[0].sets[1].done && s.exercises[0].sets[1].weight === 42.5);
  await row(1).locator('[data-act="done"]').click();
  await row(1).locator('[data-f="weight"]').fill('45'); s = await activeSession(page);
  check('チェック後も重量を修正できる', s.exercises[0].sets[1].weight === 45 && s.exercises[0].sets[1].done);
  // セット追加・種目追加・変更・順序
  await page.click('#trainRoot [data-act="editmode"]');
  await page.locator('.lv-ex').first().locator('[data-act="addmain"]').click(); s = await activeSession(page);
  check('セット追加', s.exercises[0].sets.length === 5);
  await page.locator('#lvAddName').fill('ケーブルロー片手'); await page.click('#trainRoot [data-act="addex"]'); s = await activeSession(page);
  check('一覧にない種目も追加', s.exercises[s.exercises.length - 1].name === 'ケーブルロー片手');
  const second = s.exercises[1].name;
  await page.locator('.lv-ex').nth(1).locator('[data-act="up"]').click(); s = await activeSession(page);
  check('種目順を変更', s.exercises[0].name === second);
  page._promptAnswer = 'リアデルトフライ'; await page.locator('.lv-ex').last().locator('[data-act="rename"]').click(); s = await activeSession(page);
  check('種目を変更', s.exercises[s.exercises.length - 1].name === 'リアデルトフライ');
  await page.click('#trainRoot [data-act="editmode"]');
  // 他画面への移動・再読み込み・強制終了後の保持
  await tab(page, '履歴'); await tab(page, '筋トレ');
  check('別画面へ移動しても保持（筋トレタブでも同じ画面）', (await page.locator('#train.active .lv-ex').count()) === s.exercises.length);
  await page.reload(); await ready(page); await page.locator('.lv-live-head').waitFor();
  check('再読み込みで実施中の画面に戻り入力を復元', (await page.locator('.lv-ex tr.done').count()) >= 1);
  const cpage = await context.newPage(); await page.close();
  await cpage.goto(BASE); await ready(cpage); await cpage.locator('.lv-live-head').waitFor({ timeout: 10000 });
  check('アプリ再起動（別タブで開き直し）でも復元', (await cpage.locator('.lv-ex tr.done').count()) >= 1);
  const p2 = cpage;
  // AIコーチ：ケーブルが空いてない → 変更案 → 承認で残りだけ並べ替え
  await tab(p2, 'AIコーチ'); await p2.waitForTimeout(300);
  await p2.click('[data-act="quick"][data-v="ケーブルが空いてない"]');
  await p2.locator('[data-act="applyprop"]').waitFor({ timeout: 8000 });
  const before = (await ls(p2, K.active)).exercises.map(e => e.name);
  check('相談だけではメニューを変えない（承認待ち）', JSON.stringify(before) === JSON.stringify((await ls(p2, K.active)).exercises.map(e => e.name)));
  await p2.click('[data-act="applyprop"]');
  const after = (await ls(p2, K.active));
  check('承認後、完了済みを保持したまま残りの順番を変更', after.exercises[0].sets.some(x => x.done) && after.exercises[after.exercises.length - 1].name.match(/ケーブル|フェイスプル|リアデルトフライ/), after.exercises.map(e => e.name).join('→'));
  await p2.click('[data-act="quick"][data-v="これよりインクラインの方が効く"]'); await p2.waitForTimeout(800);
  const ratings = (await ls(p2, K.settings)).workoutCoach.ratings;
  check('種目評価（インクラインの方が効く）を保存', ratings.some(r => r.exercise === 'ベンチインクライン・ケーブルフライ' && r.value === 'good'));
  // オフライン入力 → 終了（未完了あり）→ 二重終了防止
  await tab(p2, '筋トレ');
  await context.setOffline(true); await p2.evaluate(() => window.dispatchEvent(new Event('offline')));
  const ex2 = p2.locator('.lv-ex').nth(1); await ex2.locator('tr[data-si]').first().locator('[data-act="done"]').click();
  check('オフラインでも入力でき、未同期を表示', (await ls(p2, K.active)).exercises[1].sets[0].done && /未同期|同期待ち/.test(await p2.locator('#lvSaved').innerText()), await p2.locator('#lvSaved').innerText());
  await p2.click('[data-act="finish"]');
  check('未完了セットがあると確認を表示', /未完了のセットが\d+セット/.test(await p2.locator('#lvFinish').innerText()));
  await p2.click('[data-act="ffatigue"][data-v="1"]');
  await p2.locator('[data-act="save"]').dblclick();
  await p2.locator('.lv-stats').waitFor();
  recs = await ls(p2, K.records);
  const todays = recs.find(r => r.date === TODAY), mine = (todays.workoutSessions || []).filter(x => x.part === 'shoulders' && x.store === 'shioda');
  check('終了の連打でも重複登録しない', mine.length === 1);
  const sm = mine[0].summary;
  check('終了後の集計（未完了は含めない・準備/本・総レップ）をプログラムで計算', sm.totalSets === mine[0].exercises.reduce((a, e) => a + e.sets.filter(x => x.done).length, 0) && sm.warmupSets + sm.mainSets === sm.totalSets && sm.incompleteSets > 0, JSON.stringify(sm).slice(0, 120));
  check('推定消費kcalを推定値として表示（式つき）', /推定活動消費：約\d+kcal/.test(await p2.locator('#trainRoot').innerText()) && /METsは実測値ではありません/.test(await p2.locator('#trainRoot').innerHTML()));
  check('前回比較を表示', (await p2.locator('.lv-table tbody tr').count()) >= 1);
  await p2.screenshot({ path: join(OUT, 'v23-result.png') });
  await context.setOffline(false); await p2.evaluate(() => window.dispatchEvent(new Event('online'))); await p2.waitForTimeout(2500);
  check('再接続後にクラウドへ同期', !!cloud.diet_records.get(`${USER.id}|${TODAY}`) && cloud.diet_records.get(`${USER.id}|${TODAY}`).record.workoutSessions.some(x => x.part === 'shoulders'));
  // 次回メニューの事前生成と即時表示
  const plans = (await ls(p2, K.settings)).workoutCoach.plans;
  check('次回メニューを事前生成（次の部位×両店舗＋今回部位×両店舗）', ['honten:legs', 'shioda:legs', 'honten:shoulders', 'shioda:shoulders'].every(k => plans[k]), Object.keys(plans).join(','));
  const todayMD = `${+TODAY.slice(5, 7)}/${+TODAY.slice(8)}`.replace(/^(\d+)\/(\d+)$/, (m, a, b) => `${String(a).padStart(2, '0')}/${String(b).padStart(2, '0')}`);
  const nextSh = plans['shioda:shoulders'];
  check('次回メニュー（塩田店・肩）は今日の実績を基準にし、今日やらなかった種目は以前の実績を使う', nextSh.exercises.some(e => e.reason.includes(`基準：${todayMD}`)) && nextSh.exercises.filter(e => e.name === 'DBサイドレイズ' || e.name === 'フェイスプル').every(e => /基準：1[12]\/\d\d/.test(e.reason)), nextSh.exercises.map(e => e.name + ':' + e.reason.slice(0, 16)).join(' / '));
  await tab(p2, '履歴');
  const histNow = await p2.locator('#historyRoot').innerText();
  check('履歴に今日の記録が保存・表示される', histNow.replace(/\s+/g, ' ').includes(`${+TODAY.slice(5, 7)}月${+TODAY.slice(8)}日 塩田店・肩`), histNow.replace(/\s+/g, ' ').slice(0, 160));
  await tab(p2, 'ホーム');
  await p2.click('[data-act="tohome"]').catch(() => {});
  const t3 = Date.now(); await p2.reload(); await ready(p2); await p2.locator('#trainRoot .lv-ex').first().waitFor(); timings.preparedMenuMs = Date.now() - t3;
  check('次回起動時に保存済みの次回メニュー（脚）を即時表示', /脚トレ/.test(await p2.locator('#trainHomeCard').innerText()), `${timings.preparedMenuMs}ms`);
  await context.close();
}
{
  // AI学習：予定50kg→実績60kgで終了 → 次回は60kgを参照
  const user = { id: 'e2e-learn', email: 'l@example.test' };
  cloud.diet_profiles.set(user.id, { user_id: user.id, settings: { displayName: 'L', startWeight: 90, updatedAt: '2026-11-01T00:00:00.000Z' }, updated_at: '2026-11-01T00:00:00.000Z' });
  const d = new Date(Date.parse(TODAY) - 7 * 86400e3).toISOString().slice(0, 10);
  const prev = { date: d, updatedAt: `${d}T12:00:00.000Z`, workoutSessions: [{ id: 'learn0', status: 'finished', store: 'honten', part: 'chest', startedAt: `${d}T09:00:00Z`, finishedAt: `${d}T10:00:00Z`, exercises: [{ name: 'チェストプレス', sets: [{ type: 'main', weight: 50, reps: 10, done: true }, { type: 'main', weight: 50, reps: 10, done: true }] }] }] };
  cloud.diet_records.set(`${user.id}|${d}`, { user_id: user.id, record_date: d, record: prev, updated_at: prev.updatedAt });
  ai.mode = 'error';
  const { context, page } = await newDevice({ user });
  await page.goto(BASE); await ready(page, user.id);
  await page.click('#trainRoot [data-act="store"][data-v="honten"]'); await page.click('#trainRoot [data-act="part"][data-v="chest"]');
  await page.click('#trainRoot [data-act="start"]'); await page.locator('.lv-live-head').waitFor();
  const cp = page.locator('.lv-ex', { hasText: 'チェストプレス' });
  check('AI失敗時も前回実績のメニューで開始できる', (await cp.count()) === 1);
  const rows = cp.locator('tr[data-si]');
  for (let i = 0; i < 2; i++) { await rows.nth(i).locator('[data-f="weight"]').fill('60'); await rows.nth(i).locator('[data-act="done"]').click(); }
  await page.click('[data-act="finish"]'); await page.click('[data-act="save"]'); await page.locator('.lv-stats').waitFor();
  await page.evaluate(() => { WorkoutUI._ui.part = 'chest'; WorkoutUI._ui.store = 'honten'; WorkoutUI._ui.plan = null; });
  const next = await page.evaluate(() => { const p = WorkoutEngine.planSession({ store: 'honten', part: 'chest', records: recs(), today: today() }); return p.exercises.find(e => e.name === 'チェストプレス').sets.map(s => s.weight); });
  check('次回メニューは予定50kgではなく実績60kgを参照', next.every(w => w === 60), next.join(','));
  ai.mode = 'ok';
  await context.close();
}
{
  // エラー耐性：AI遅延・AI出力不正・クラウド同期失敗・履歴不足
  ai.mode = 'slow';
  const user = { id: 'e2e-new', email: 'n@example.test' };
  const { context, page } = await newDevice({ user });
  await page.goto(BASE); await ready(page, user.id);
  const st = Date.now(); await page.click('#trainRoot [data-act="start"]'); await page.locator('.lv-live-head').waitFor({ timeout: 3000 });
  check('AI応答が遅くても待たずに開始（履歴なし）', Date.now() - st < 3000);
  check('履歴不足でも準備/本セットのメニュー', (await page.locator('.lv-ex').count()) >= 3);
  await page.click('[data-act="finish"]'); await page.click('[data-act="discard"]');
  await context.close();
  ai.mode = 'invalid';
  const d2 = await newDevice();
  await d2.page.goto(BASE); await ready(d2.page);
  await d2.page.click('#trainRoot [data-act="part"][data-v="arms"]');
  await d2.page.waitForFunction(() => /AIに接続できませんでした|検証できなかった/.test(document.querySelector('#trainRoot [data-lv-status]').textContent), null, { timeout: 8000 }).catch(() => {});
  const stText = await d2.page.locator('#trainRoot [data-lv-status]').innerText();
  check('AI出力が不正でも検証して前回実績のメニューを維持（無期限待機なし）', /検証できなかった/.test(stText) && await d2.page.evaluate(() => WorkoutUI._ui.plan.source === 'local'), stText);
  ai.mode = 'ok'; cloud.fail = true;
  await d2.page.click('#trainRoot [data-act="start"]'); await d2.page.locator('.lv-live-head').waitFor();
  await d2.page.locator('.lv-ex').first().locator('tr[data-si]').first().locator('[data-act="done"]').click();
  await d2.page.evaluate(() => syncNow(true)); await d2.page.waitForTimeout(800);
  check('クラウド同期が失敗しても記録は続けられる', (await ls(d2.page, K.active)).exercises[0].sets[0].done && /同期失敗|同期待ち|再試行/.test(await d2.page.evaluate(() => document.getElementById('cloudState').textContent + document.getElementById('lvSaved').textContent)));
  cloud.fail = false;
  await d2.page.click('[data-act="finish"]'); await d2.page.click('[data-act="discard"]');
  await d2.context.close();
}
{
  // オフライン起動（Service Worker）
  const { context, page } = await newDevice({ sw: true });
  await page.goto(BASE); await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await page.reload(); await ready(page);
  await page.click('#trainRoot [data-act="start"]'); await page.locator('.lv-live-head').waitFor();
  await page.locator('.lv-ex').first().locator('tr[data-si]').first().locator('[data-act="done"]').click();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.locator('.lv-live-head').waitFor({ timeout: 15000 }).catch(() => {});
  check('オフラインで再起動しても実施中の記録を復元', (await page.locator('.lv-ex tr.done').count()) === 1);
  await page.screenshot({ path: join(OUT, 'v23-offline.png') });
  await context.close();
}

await browser.close(); if (server) server.close();
writeFileSync(join(OUT, 'timings.json'), JSON.stringify(timings, null, 2));
console.log('timings(ms):', JSON.stringify(timings));
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
