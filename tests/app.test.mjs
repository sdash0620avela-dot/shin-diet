import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../api/analyze-meal.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const scoreApi = new Function(
  [
    'sleepScore', 'isRestDay', 'effectiveExercise', 'scoreRecord'
  ].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { sleepScore, scoreRecord };'
)();

const syncApi = new Function(
  ['stateTime', 'mergeSyncStates', 'backupStates'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { mergeSyncStates, backupStates };'
)();

const analysisApi = new Function(
  ['dayNumber', 'weightAnalysis'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { weightAnalysis };'
)();

const morningApi = new Function(
  ['hasValue', 'isRestDay', 'effectiveExercise', 'hasExerciseInput', 'morningReportScore'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { morningReportScore };'
)();

const ideal = {
  intake: 2000,
  protein: 120,
  restDay: true,
  sleep: '★★★★★',
  waterL: 2,
  fatigue: 2
};
const settings = { calorieGoal: 2000, proteinGoal: 120 };

test('perfect inputs score exactly 100', () => {
  assert.equal(scoreApi.scoreRecord(ideal, settings), 100);
});

test('four-star sleep cannot score 100', () => {
  const record = { ...ideal, sleep: '★★★★☆' };
  assert.equal(scoreApi.scoreRecord(record, settings), 96);
  assert.ok(scoreApi.scoreRecord(record, settings) < 100);
});

test('each signed-in user has a separate local storage namespace', () => {
  assert.match(html, /shinDiet:\${id}:\${kind\.toLowerCase\(\)}/);
  assert.match(html, /activateUserStorage\(nextUser\.id\)/);
  assert.match(html, /user_id:cloudUser\.id/);
});

test('photo analysis requires the current signed-in session', () => {
  assert.match(html, /cloudClient\.auth\.getSession\(\)/);
  assert.match(html, /Authorization':`Bearer \${sessionData\.session\.access_token}`/);
  assert.match(worker, /auth\/v1\/user/);
  assert.match(worker, /PHOTO_RATE_LIMITER\.limit\(\{ key: authUser\.id \}\)/);
  assert.match(worker, /429/);
});

test('v14.4 update notice and email OTP are wired', () => {
  assert.match(html, /id="updateNotice"/);
  assert.match(html, /APP_UPDATED/);
  assert.match(html, /verifyOtp\(\{email,token,type:'email'\}\)/);
  assert.match(html, /id="authOtp"/);
  assert.match(html, /maxlength="10"/);
  assert.match(html, /JWT issued at future/);
  assert.match(html, /retryCount<6/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /storageKey\('LastSync'\)/);
  assert.match(html, /over_request_rate_limit/);
  assert.match(html, /copyPreviousMeal/);
  assert.match(html, /function finishMeals\(\)/);
  assert.match(html, /id="finishMealsBtn"/);
  assert.match(html, /食事内容をこれで確定/);
  assert.doesNotMatch(html, /この食事を確定/);
  assert.match(html, /goToRecordSave/);
  assert.match(html, /id="recordSaveCard"/);
  assert.match(html, /id="recordSaveBtn"/);
  assert.match(html, /recordMissingFields/);
  assert.match(html, /confirmRecordSave/);
  assert.match(html, /この日の記録を上書き/);
  assert.match(html, /保存済み記録は削除されていません/);
  assert.match(html, /function editRecord\(date\)/);
  assert.match(html, /class="item-edit"/);
  assert.match(html, /const draftKey=date=>storageKey\('Draft'\)/);
  assert.match(html, /function scheduleDraftSave\(\)/);
  assert.match(html, /前回の入力途中データを復元しました/);
  assert.match(html, /removeDraft\(r\.date\)/);
  assert.match(html, /async function deleteRecord\(date\)/);
  assert.match(html, /_deleted:true/);
  assert.match(html, /setDeletedRecords/);
  assert.match(html, /removeDeletedRecord\(r\.date\)/);
  assert.match(html, /record:tombstone/);
  assert.match(html, /削除できなかったため、記録は残しています/);
});

test('newer deletion tombstone wins over an old record from another device', () => {
  const oldRecord = { date: '2026-08-01', weight: 110, updatedAt: '2026-08-01T09:00:00.000Z' };
  const tombstone = { date: '2026-08-01', _deleted: true, updatedAt: '2026-08-02T09:00:00.000Z' };
  assert.deepEqual(syncApi.mergeSyncStates([oldRecord], [tombstone]), [tombstone]);
});

test('saving again after deletion wins when it is newer', () => {
  const tombstone = { date: '2026-08-01', _deleted: true, updatedAt: '2026-08-02T09:00:00.000Z' };
  const restored = { date: '2026-08-01', weight: 109, updatedAt: '2026-08-03T09:00:00.000Z' };
  assert.deepEqual(syncApi.mergeSyncStates([tombstone], [restored]), [restored]);
});


test('backup includes deletion tombstones', () => {
  assert.match(html, /deletedRecords:deletedRecords\(\)/);
  const tombstone = { date: '2026-08-01', _deleted: true, updatedAt: '2026-08-02T09:00:00.000Z' };
  const parsed = syncApi.backupStates({ records: [], deletedRecords: [tombstone] });
  assert.deepEqual(parsed.deleted, [tombstone]);
});

test('old backup cannot revive a more recent deletion', () => {
  const oldBackup = { date: '2026-08-01', weight: 110, updatedAt: '2026-08-01T09:00:00.000Z' };
  const tombstone = { date: '2026-08-01', _deleted: true, updatedAt: '2026-08-02T09:00:00.000Z' };
  assert.deepEqual(syncApi.mergeSyncStates([tombstone], [oldBackup]), [tombstone]);
});

test('legacy array backup remains readable', () => {
  const record = { date: '2026-08-01', weight: 110 };
  assert.deepEqual(syncApi.backupStates([record]), { records: [record], deleted: [] });
});

test('forecast waits for enough weight history', () => {
  const sparse = analysisApi.weightAnalysis([
    { date: '2026-08-01', weight: 110 },
    { date: '2026-08-02', weight: 109 }
  ]);
  assert.equal(sparse.readyForecast, false);
  assert.equal(sparse.delta7, null);
});

test('analysis compares weekly averages instead of two individual days', () => {
  const records = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    weight: 110 - i * 0.1
  }));
  const analysis = analysisApi.weightAnalysis(records);
  assert.equal(analysis.readyForecast, true);
  assert.ok(analysis.delta7 < 0);
  assert.match(analysis.label, /下降傾向/);
});

test('v16 analysis UI shows trend and one daily priority', () => {
  assert.match(html, /id="trendAnalysis"/);
  assert.match(html, /id="todayAction"/);
  assert.match(html, /function todayActionText\(t,s\)/);
  assert.match(html, /最低7回・13日以上/);
});

test('v16.1 morning summary keeps four-star sleep below 100', () => {
  const morning = {
    date: '2026-08-14',
    weight: 113.8,
    fat: 26.4,
    muscle: 47.1,
    sleep: '★★★★☆',
    cardio: true,
    cardioMin: 43,
    exerciseTotal: 480
  };
  assert.equal(morningApi.morningReportScore(morning), 98);
});

test('v16.1 stores the full body-composition fields used by the summary', () => {
  assert.match(html, /id="visceralFat"/);
  assert.match(html, /id="bmi"/);
  assert.match(html, /id="basalMetabolism"/);
  assert.match(html, /id="totalEnergy"/);
  assert.match(html, /function fieldIds\(\).*visceralFat.*basalMetabolism.*totalEnergy/);
});

test('v16.1 provides morning and daily summaries with verified and inferred sections', () => {
  assert.match(html, /id="dailySummary"/);
  assert.match(html, /selectSummaryMode\('morning'\)/);
  assert.match(html, /selectSummaryMode\('daily'\)/);
  assert.match(html, /function buildDailySummary\(r,prev,s,mode\)/);
  assert.match(html, /【確認できた事実】/);
  assert.match(html, /【推測】/);
  assert.match(html, /単日変化/);
  assert.match(html, /copyCurrentSummary/);
});
