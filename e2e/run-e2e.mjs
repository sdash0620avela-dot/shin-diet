// 筋トレAIコーチ E2E（iPhone 13相当・Chromium）
// 本番データ保護：Supabaseは e2e/fake-supabase.js（仮想クラウド）に、AI WorkerはモックAPIに差し替える。
// 使い方：node e2e/run-e2e.mjs   （BASE_URLを指定すると公開URLで実行。その場合もSupabase・AIはモック）
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
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
const USER = { id: 'e2e-user-0001', email: 'e2e@example.test' };
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 日本時間

/* ---------- 静的サーバー ---------- */
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
const cloud = { diet_profiles: new Map(), diet_records: new Map() };
const ai = { mode: 'ok', delay: 300, calls: [] };
function dbHandle(body) {
  const t = cloud[body.table];
  if (body.op === 'select') {
    const rows = [...t.values()].filter(r => r.user_id === body.filters.user_id);
    return { data: rows };
  }
  body.rows.forEach(r => { if (r.user_id !== body.user) throw new Error('RLS violation'); t.set(body.table === 'diet_profiles' ? r.user_id : `${r.user_id}|${r.record_date}`, JSON.parse(JSON.stringify(r))); });
  return { data: [] };
}
function aiPlan(body) {
  const ex = (body.baseline || []).map((b, i) => ({ name: b.name, loadType: 'total', weight: i === 0 && b.weight === null ? 99 : b.weight, reps: b.reps, repsMin: b.repsTarget[0], repsMax: b.repsTarget[1], sets: b.sets, restSec: b.restSec, rir: b.rir, reason: 'AIモック：' + String(b.reason).slice(0, 30), evidence: ['volume-dose'] }));
  return { summary: `AIモック設計（${body.store}/${body.part}）`, warnings: [], evidence: ['volume-dose', 'rir-near-failure'], exercises: ex, model: 'mock-model' };
}
function aiChat(body) {
  const m = body.message;
  if (/ペックフライ/.test(m) && /ない/.test(m)) return { reply: '塩田店にはペックフライがないので外しました。', exercises: (body.plan.exercises || []).filter(e => e.name !== 'ペックフライ').map(e => ({ name: e.name, loadType: 'total', weight: e.weight, reps: e.reps || 10, repsMin: 8, repsMax: 12, sets: e.sets, restSec: e.restSec || 90, rir: 2, reason: '会話で変更', evidence: [] })), preferenceChanges: [{ action: 'add', type: 'missing_equipment', value: 'ペックフライ', store: 'shioda' }], model: 'mock-model' };
  return { reply: '了解しました。', exercises: null, preferenceChanges: [], model: 'mock-model' };
}
async function routeAll(context) {
  await context.route(SUPA_LIB, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await context.route('https://fake-supabase.test/**', async r => { try { r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dbHandle(JSON.parse(r.request().postData()))) }); } catch (e) { r.fulfill({ status: 403, body: e.message }); } });
  await context.route('https://ulorhqbotwsbhyoapixi.supabase.co/**', r => r.abort()); // 本番Supabaseへの到達を禁止
  await context.route(WORKER + '**', async r => {
    const body = JSON.parse(r.request().postData() || '{}');
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers });
    if (body.kind === 'server_time') return r.fulfill({ status: 200, headers, body: JSON.stringify({ server_time: new Date().toISOString() }) });
    ai.calls.push({ kind: body.kind, store: body.store, part: body.part, body });
    await new Promise(res => setTimeout(res, ai.mode === 'slow' ? 25000 : ai.delay));
    if (ai.mode === 'error') return r.fulfill({ status: 502, headers, body: JSON.stringify({ error: 'AIコーチでエラーが発生しました。（エラー番号：server_error）' }) });
    if (ai.mode === 'quota') return r.fulfill({ status: 502, headers, body: JSON.stringify({ error: 'OpenAI APIの利用残高がありません。' }) });
    const out = body.kind === 'workout_plan' ? aiPlan(body) : body.kind === 'workout_chat' ? aiChat(body) : { answer: 'ok' };
    r.fulfill({ status: 200, headers, body: JSON.stringify(out) });
  });
}

/* ---------- テスト用履歴（両店舗・旧形式＋新形式） ---------- */
function seedHistory() {
  const recs = [];
  const add = (date, rec) => recs.push({ date, updatedAt: `${date}T12:00:00.000Z`, weight: 120 - recs.length * 0.1, intake: 2000, protein: 120, ...rec });
  const d = n => new Date(Date.parse(TODAY) - n * 86400e3).toISOString().slice(0, 10);
  for (let w = 10; w >= 1; w--) {
    add(d(w * 7 + 1), { workoutPlace: '本店', workoutPart: 'chest', workoutExercises: [{ name: 'チェストプレス', weight: 40 + (10 - w) * 1.5, reps: 10, sets: 3 }, { name: 'ペックフライ', weight: 35, reps: 12, sets: 3 }], workoutFeedback: w === 1 ? '余裕あり' : '' });
    add(d(w * 7 + 3), { workoutPlace: '塩田店', workoutPart: 'back', workoutExercises: [{ name: 'ラットプルダウン', weight: 30 + (10 - w), reps: 12, sets: 3 }] });
  }
  // v21.1より前の自由記述形式（店舗・重量なし）と、店舗名が判別できない記録
  add(d(90), { strength: '胸25セット　1時間' });
  add(d(88), { strength: '背中20セット' });
  add(d(86), { workoutPlace: 'ジム', strength: 'ショルダープレス30kg×10×3' });
  add(d(5), { workoutSessions: [{ id: 's1', status: 'finished', store: 'shioda', part: 'legs', startedAt: `${d(5)}T10:00:00Z`, finishedAt: `${d(5)}T11:00:00Z`, feedback: { overall: 'ok', pain: '', note: '' }, exercises: [{ name: 'レッグプレス', sets: [{ weight: 100, reps: 12, done: true }, { weight: 100, reps: 11, done: true }, { weight: 100, reps: 10, done: true }] }] }] });
  recs.sort((a, b) => a.date.localeCompare(b.date));
  recs.forEach(r => cloud.diet_records.set(`${USER.id}|${r.date}`, { user_id: USER.id, record_date: r.date, record: r, updated_at: r.updatedAt }));
  cloud.diet_profiles.set(USER.id, { user_id: USER.id, settings: { displayName: 'E2E', startDate: '2026-06-17', startWeight: 127, goalWeight: 95, baseBurn: 2800, age: 47, sex: 'male', heightCm: 175, activityLevel: 1.55, updatedAt: '2026-11-01T00:00:00.000Z' }, updated_at: '2026-11-01T00:00:00.000Z' });
  return recs.length;
}

/* ---------- 実行補助 ---------- */
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await chromium.launch();
const iphone = devices['iPhone 13'];
async function newDevice({ sw = false, user = USER, consent = true } = {}) {
  const context = await browser.newContext({ ...iphone, serviceWorkers: sw ? 'allow' : 'block', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await routeAll(context);
  await context.addInitScript(([u, consentKey, c]) => {
    if (!sessionStorage.getItem('e2eInit')) { sessionStorage.setItem('e2eInit', '1'); if (u) localStorage.setItem('e2eAuthUser', JSON.stringify(u)); if (c) localStorage.setItem(consentKey, JSON.stringify({ version: '1', acceptedAt: new Date().toISOString() })); }
  }, [user, `shinDiet:${user && user.id}:aiconsent`, consent]);
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => check('ページでJSエラーが発生しない', false, e.message));
  return { context, page };
}
async function openTrain(page) {
  await page.goto(BASE); await page.waitForFunction(() => window.WorkoutUI && typeof activeStorageId !== 'undefined' && activeStorageId !== 'legacy', null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.locator('.tab', { hasText: '筋トレ' }).click();
  await page.locator('#wcPlanCard, .wc-live').first().waitFor();
}
async function pick(page, act, v) {
  // 実際の利用者と同じく「変更 ▼」を開いてから選ぶ
  if (!(await page.locator(`[data-act="${act}"][data-v="${v}"]`).isVisible())) await page.locator('#wcPicker > summary').click();
  await page.locator(`[data-act="${act}"][data-v="${v}"]`).click();
}
const lsJson = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const activeKey = `shinDiet:${USER.id}:workoutactive`, recordsKey = `shinDiet:${USER.id}:records`, settingsKey = `shinDiet:${USER.id}:settings`;

/* ---------- シナリオ ---------- */
const seeded = seedHistory();
{
  const { context, page } = await newDevice();
  // 1. 起動・全履歴同期
  await openTrain(page);
  const local = await lsJson(page, recordsKey);
  check('ログイン後にクラウドの全履歴が端末へ同期される', local && local.length === seeded, `${local && local.length}/${seeded}日`);
  // 2. 両店舗×全部位：即時表示 → AI最適化
  for (const store of ['honten', 'shioda']) for (const part of ['chest', 'back', 'shoulders', 'arms', 'legs', 'fullbody']) {
    const t0 = Date.now();
    await pick(page, 'store', `${store}`);
    await pick(page, 'part', `${part}`);
    const items = await page.locator('#wcPlanCard .wc-ex').count();
    const instant = Date.now() - t0;
    await page.waitForFunction(() => document.querySelector('.wc-badge.ai'), null, { timeout: 8000 }).catch(() => {});
    const ai = await page.locator('.wc-badge.ai').count();
    const summary = await page.locator('.wc-summary').textContent();
    check(`生成 ${store}/${part}：即時表示とAI最適化`, items >= 2 && ai === 1 && summary.includes('AIモック'), `${items}種目・表示${instant}ms・${summary}`);
  }
  // 3. 店舗別の重量（他店舗の重量を流用しない・AIの根拠なし重量を除去）
  await pick(page, 'store', 'honten'); await pick(page, 'part', 'chest');
  const hontenChest = await page.locator('#wcPlanCard .wc-ex').first().textContent();
  await pick(page, 'store', 'shioda');
  const shiodaChest = await page.locator('#wcPlanCard').textContent();
  check('本店の胸は本店の実績重量から設計（前回53.5kg×10回・余裕→同重量で12回へ漸進）', /チェストプレス[\s\S]*53\.5kg × 12回/.test(hontenChest), hontenChest.replace(/\s+/g, ' ').slice(0, 120));
  check('塩田店の胸は本店重量を流用せず確認重量・参考表示', !/99kg/.test(shiodaChest) && /確認重量/.test(shiodaChest) && /本店では/.test(shiodaChest));
  await page.screenshot({ path: join(OUT, '01-plan-shioda-chest.png'), fullPage: false });
  // 3b. v22.1：使い方の案内・前回実績・履歴の読み取り・店舗不明の割当・種目追加
  check('初回は「新しくなりました」の案内を表示', (await page.locator('#wcWhatsNew').count()) === 1);
  await page.click('[data-act="hidenew"]');
  check('案内は閉じると再表示しない', (await page.locator('#wcWhatsNew').count()) === 0);
  await pick(page, 'store', 'honten'); await pick(page, 'part', 'chest');
  await page.locator('#wcPlanCard .wc-ex').first().scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -80)); await page.screenshot({ path: join(OUT, '07-plan-list.png') });
  check('各種目に前回の実績を表示', /前回 \d\d\/\d\d：53\.5×10/.test(await page.locator('#wcPlanCard .wc-ex').first().textContent()));
  const hist = await page.locator('#wcHistory').textContent();
  check('自由記述・店舗不明を含む全記録を読み取って表示', /24回を読み取り/.test(hist) && /部位・セット数のみ 2回/.test(hist) && /店舗不明 3回/.test(hist), hist.replace(/\s+/g, ' ').slice(0, 110));
  await pick(page, 'part', 'shoulders');
  const beforeAssign = await page.locator('#wcPlanCard').textContent();
  await page.locator('[data-act="unknownas"][data-v="honten"]').click();
  const afterAssign = await page.locator('#wcPlanCard').textContent();
  check('店舗不明の記録は割り当てるまで重量に使わず、割当後は使う', /店舗不明では30kg/.test(beforeAssign) && /ショルダープレス[\s\S]*30kg × 1[12]回/.test(afterAssign), afterAssign.replace(/\s+/g, ' ').slice(0, 100));
  await page.locator('[data-act="unknownas"][data-v=""]').click();
  await pick(page, 'part', 'chest');
  const nBefore = await page.locator('#wcPlanCard .wc-ex').count();
  const addName = await page.locator('#wcAddSelect option').first().getAttribute('value');
  await page.selectOption('#wcAddSelect', addName);
  await page.click('[data-act="addex"]');
  check('「＋ 種目を追加」でメニューに種目を追加', (await page.locator('#wcPlanCard .wc-ex').count()) === nBefore + 1 && (await page.locator('#wcPlanCard .wc-ex').last().textContent()).includes(addName), addName);
  await page.locator('#wcPlanCard .wc-ex').last().locator('[data-act="remove"]').click();
  await pick(page, 'store', 'shioda');
  // 4. 会話でメニュー変更・恒久設定
  await page.fill('#wcChatInput', '塩田店にはペックフライがない');
  await page.click('[data-act="chat"]');
  await page.waitForFunction(() => document.querySelector('#wcChatLog .wc-msg.coach'), null, { timeout: 8000 });
  const prefs = (await lsJson(page, settingsKey)).workoutCoach.prefs;
  const afterChat = (await page.locator('#wcPlanCard .wc-ex').allTextContents()).join(' ');
  check('会話で恒久設定（塩田店にペックフライなし）を保存', prefs.stores.shioda.missing.includes('ペックフライ'));
  check('会話後のメニューからペックフライが消える', !/ペックフライ/.test(afterChat));
  await pick(page, 'store', 'honten');
  check('本店では恒久設定の影響を受けずペックフライが残る', /ペックフライ/.test((await page.locator('#wcPlanCard .wc-ex').allTextContents()).join(' ')));
  // 5. 開始・入力・自動保存・再読み込み復元
  await pick(page, 'part', 'chest');
  await page.click('[data-act="start"]');
  await page.locator('.wc-live').waitFor();
  let act = await lsJson(page, activeKey);
  check('開始時刻を自動保存', act && act.status === 'active' && !!act.startedAt, act && act.startedAt);
  const firstSet = page.locator('.wc-live-ex').first().locator('.wc-set').first();
  await firstSet.locator('[data-act="w+"]').click();
  await firstSet.locator('[data-f="reps"]').fill('11');
  await firstSet.locator('[data-act="done"]').click();
  act = await lsJson(page, activeKey);
  const s0 = act.exercises[0].sets[0];
  check('重量・回数・完了チェックを即時自動保存', s0.done && s0.reps === 11 && s0.weight > 0, JSON.stringify(s0));
  const exBefore = act.exercises.length;
  const liveAdd = await page.locator('#wcAddSelect option').first().getAttribute('value');
  await page.selectOption('#wcAddSelect', liveAdd); await page.click('[data-act="addex"]');
  act = await lsJson(page, activeKey);
  check('実施中も「＋ 種目を追加」で追加・自動保存', act.exercises.length === exBefore + 1 && act.exercises[exBefore].name === liveAdd, liveAdd);
  await page.screenshot({ path: join(OUT, '02-session.png') });
  await page.waitForTimeout(4500);
  const mirrored = await lsJson(page, settingsKey);
  check('実施中の状態をクラウド同期用設定にも保存', mirrored.workoutCoach.active && mirrored.workoutCoach.active.exercises[0].sets[0].done === true);
  await page.reload();
  await page.locator('.wc-live').waitFor({ timeout: 15000 });
  const restored = await page.locator('.wc-live-ex').first().locator('.wc-set').first();
  check('再読み込み後に自動で筋トレ画面へ戻り入力を復元', (await restored.locator('[data-f="reps"]').inputValue()) === '11' && (await restored.getAttribute('class')).includes('done'));
  // 6. 通信切断中の入力・終了
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const sets2 = page.locator('.wc-live-ex').first().locator('.wc-set');
  await sets2.nth(1).locator('[data-act="done"]').click();
  await page.locator('.wc-live-ex').nth(1).locator('.wc-set').first().locator('[data-f="weight"]').fill('20');
  await page.locator('.wc-live-ex').nth(1).locator('.wc-set').first().locator('[data-act="done"]').click();
  act = await lsJson(page, activeKey);
  check('オフライン中も入力を端末へ保存', act.exercises[0].sets[1].done && act.exercises[1].sets[0].weight === 20);
  await page.click('[data-act="finish"]');
  await page.click('[data-act="overall"][data-v="ok"]');
  await page.fill('#wcFinishPain', '右肩1/10');
  await page.click('[data-act="save"]');
  await page.locator('.wc-result').waitFor();
  const recsAfter = await lsJson(page, recordsKey);
  const todayRec = recsAfter.find(r => r.date === TODAY);
  check('終了後に実績を日別記録へ保存（オフライン）', todayRec && todayRec.workoutSessions && todayRec.workoutSessions[0].status === 'finished' && todayRec.workoutPlace === '本店' && todayRec.workoutExercises.length === 2, todayRec && `${todayRec.workoutCompletion}/${todayRec.workoutMinutes}分`);
  check('既存の体重・食事データを保持', recsAfter.length === seeded + 1 && recsAfter.filter(r => r.date !== TODAY).every(r => r.intake === 2000));
  check('終了後に実施中データを消去', !(await lsJson(page, activeKey)));
  const nextText = await page.locator('#wcPlanCard').textContent();
  check('終了後に次回メニューを自動生成（オフラインはアプリ設計）', /アプリ設計/.test(nextText) && !/胸/.test(await page.locator('.wc-summary').textContent()), (await page.locator('.wc-summary').textContent()));
  await page.waitForTimeout(1000); await page.screenshot({ path: join(OUT, '03-finished-next.png') });
  // 7. 通信復帰 → クラウド同期・次回メニューのAI最適化はユーザー操作なしで保存済みを表示
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(k => !!document && true, null);
  await page.waitForTimeout(3000);
  const cloudRec = cloud.diet_records.get(`${USER.id}|${TODAY}`);
  check('通信復帰後に実績がクラウドへ同期', cloudRec && cloudRec.record.workoutSessions && cloudRec.record.workoutSessions.length === 1);
  // 8. 保存済み次回メニューの即時表示（再起動後）
  const nextSummary = await page.locator('.wc-summary').textContent();
  const callsBefore = ai.calls.length;
  await page.reload(); await page.waitForFunction(() => window.WorkoutUI && activeStorageId !== 'legacy'); await page.waitForTimeout(600);
  const homeCard = await page.locator('#trainHomeCard').textContent();
  check('ホームに保存済みの次回メニューを表示', homeCard.includes('次回の筋トレ'), homeCard.replace(/\s+/g, ' ').slice(0, 80));
  await page.screenshot({ path: join(OUT, '04-home-next.png') });
  await page.locator('.tab', { hasText: '筋トレ' }).click();
  const shownNext = await page.locator('.wc-summary').textContent();
  check('再起動後、次回メニューを即時表示', shownNext.length > 0 && (await page.locator('#wcPlanCard .wc-ex').count()) > 0 && shownNext === nextSummary, `${nextSummary} → ${shownNext}`);
  // 9. 従来の記録画面で同じ日を保存しても筋トレ実績が消えない
  await page.locator('.tab', { hasText: '食事など' }).click();
  await page.fill('#intake', '1900');
  await page.click('#recordSaveBtn');
  await page.waitForTimeout(300);
  const afterLegacySave = (await lsJson(page, recordsKey)).find(r => r.date === TODAY);
  check('従来画面で保存しても workoutSessions を保持', afterLegacySave.workoutSessions && afterLegacySave.workoutSessions.length === 1 && afterLegacySave.intake === 1900);
  // 10. 別端末で実施中セッションを復元
  await page.locator('.tab', { hasText: '筋トレ' }).click();
  await pick(page, 'store', 'shioda'); await pick(page, 'part', 'legs');
  await page.click('[data-act="start"]');
  await page.locator('.wc-live-ex').first().locator('.wc-set').first().locator('[data-act="done"]').click();
  await page.waitForTimeout(5500); // クラウド同期間隔
  const deviceB = await newDevice();
  await deviceB.page.goto(BASE);
  await deviceB.page.locator('.wc-live').waitFor({ timeout: 15000 }).catch(() => {});
  const bText = await deviceB.page.locator('#trainRoot').textContent();
  check('別端末でも実施中の筋トレを復元（クラウド経由）', /塩田店・脚/.test(bText) && (await deviceB.page.locator('.wc-set.done').count()) === 1);
  await deviceB.context.close();
  // 11. 実施中は店舗を変更できず、セッション内容が保たれる
  check('実施中は店舗選択を表示しない（誤変更防止）', (await page.locator('[data-act="store"]').count()) === 0);
  await page.click('[data-act="finish"]'); await page.click('[data-act="discard"]');
  check('破棄で実施中データを消去', !(await lsJson(page, activeKey)));
  await page.waitForTimeout(1500);
  check('破棄がクラウドにも反映（他端末で誤復元しない）', !(cloud.diet_profiles.get(USER.id).settings.workoutCoach || {}).active);
  await context.close();
}
{
  // 12. AI遅延：待たずに開始できる
  ai.mode = 'slow';
  const { context, page } = await newDevice();
  await openTrain(page);
  await pick(page, 'part', 'arms');
  const status = await page.locator('#wcPlanStatus').textContent();
  const t0 = Date.now(); await page.click('[data-act="start"]'); await page.locator('.wc-live').waitFor({ timeout: 3000 });
  check('AI応答が遅くても即時に開始できる', /最適化/.test(status) && /待たずに/.test(status) && Date.now() - t0 < 3000, status);
  await page.click('[data-act="finish"]'); await page.click('[data-act="discard"]'); await page.waitForTimeout(1500);
  await context.close();
  // 13. AIエラー・残高不足：エラー表示と継続
  for (const mode of ['error', 'quota']) {
    ai.mode = mode === 'error' ? 'ok' : mode;
    const d = await newDevice();
    await openTrain(d.page);
    if (mode === 'error') {
      // 通信できる時にAIメニューを保存 → AI不通にして再起動 → 保存済みAIメニューが即時に出るか
      await pick(d.page, 'store', 'honten');
      await pick(d.page, 'part', 'shoulders');
      await d.page.locator('.wc-badge.ai').waitFor({ timeout: 8000 });
      ai.mode = 'error';
      const before = ai.calls.length;
      await d.page.reload(); await d.page.waitForFunction(() => window.WorkoutUI && activeStorageId !== 'legacy'); await d.page.waitForTimeout(500);
      await d.page.locator('.tab', { hasText: '筋トレ' }).click();
      await pick(d.page, 'store', 'honten');
      await pick(d.page, 'part', 'shoulders');
      await d.page.waitForTimeout(1600);
      check('AI不通でも保存済みのAIメニューを即時表示（AIへ再送しない）', (await d.page.locator('.wc-badge.ai').count()) === 1 && ai.calls.length === before, await d.page.locator('.wc-summary').textContent());
    }
    await pick(d.page, 'part', 'shoulders');
    await pick(d.page, 'minutes', '90');
    await d.page.waitForFunction(() => /AIで再調整/.test(document.querySelector('#wcPlanStatus').textContent), null, { timeout: 8000 }).catch(() => {});
    const st = await d.page.locator('#wcPlanStatus').textContent();
    await d.page.click('[data-act="start"]');
    check(`AI${mode === 'error' ? 'エラー' : '残高不足'}時もアプリ設計で開始できる`, (await d.page.locator('.wc-live').count()) === 1 && (mode === 'error' ? /server_error/ : /利用残高/).test(st) && /AIで再調整/.test(st), st.slice(0, 80));
    await d.page.click('[data-act="finish"]'); await d.page.click('[data-act="discard"]'); await d.page.waitForTimeout(1500);
    await d.context.close();
  }
  ai.mode = 'ok';
}
{
  // 14. 履歴なしの新規利用者
  const newUser = { id: 'e2e-new-user', email: 'new@example.test' };
  const { context, page } = await newDevice({ user: newUser, consent: false });
  await page.goto(BASE); await page.waitForFunction(() => window.WorkoutUI && activeStorageId === 'e2e-new-user', null, { timeout: 15000 });
  await page.locator('.tab', { hasText: '筋トレ' }).click();
  const txt = await page.locator('#trainRoot').textContent();
  check('履歴不足でも確認重量のメニューを表示', /筋トレ記録がまだない/.test(txt) && /確認重量/.test(txt) && (await page.locator('#wcPlanCard .wc-ex').count()) >= 2);
  check('未同意時はAIへ自動送信しない', /AIで最適化/.test(txt) && !ai.calls.some(c => c.body && JSON.stringify(c.body.context || {}).includes('e2e-new')));
  await page.screenshot({ path: join(OUT, '05-no-history.png') });
  await context.close();
}
{
  // 15. オフライン起動（Service Worker経由）で本人データと実施中セッションを復元
  const { context, page } = await newDevice({ sw: true });
  await page.goto(BASE);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await page.reload(); await page.waitForFunction(() => window.WorkoutUI && activeStorageId !== 'legacy', null, { timeout: 15000 });
  await page.locator('.tab', { hasText: '筋トレ' }).click();
  await pick(page, 'part', 'back');
  await page.click('[data-act="start"]');
  await page.locator('.wc-live-ex').first().locator('.wc-set').first().locator('[data-act="done"]').click();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.locator('.wc-live').waitFor({ timeout: 15000 }).catch(() => {});
  const live = await page.locator('.wc-live').count();
  const storage = await page.evaluate(() => typeof activeStorageId !== 'undefined' ? activeStorageId : null);
  check('オフラインで再起動しても本人データで起動し実施中を復元', live === 1 && storage === USER.id && (await page.locator('.wc-set.done').count()) === 1, `storage=${storage}`);
  await page.screenshot({ path: join(OUT, '06-offline-restart.png') });
  await context.close();
}

await browser.close(); if (server) server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
