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
  assert.match(html, /\.eq\('user_id',cloudUser\.id\)/);
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
  assert.match(html, /finishMeal/);
  assert.match(html, /goToRecordSave/);
  assert.match(html, /id="recordSaveCard"/);
  assert.match(html, /id="recordSaveBtn"/);
  assert.match(html, /recordMissingFields/);
  assert.match(html, /confirmRecordSave/);
  assert.match(html, /この日の記録を上書き/);
  assert.match(html, /保存済み記録は削除されていません/);
  assert.match(html, /function editRecord\(date\)/);
  assert.match(html, /この日を編集/);
  assert.match(html, /const draftKey=date=>storageKey\('Draft'\)/);
  assert.match(html, /function scheduleDraftSave\(\)/);
  assert.match(html, /前回の入力途中データを復元しました/);
  assert.match(html, /removeDraft\(r\.date\)/);
  assert.match(html, /async function deleteRecord\(date\)/);
  assert.match(html, /\.delete\(\)\.eq\('user_id',cloudUser\.id\)\.eq\('record_date',date\)/);
  assert.ok(html.indexOf("from('diet_records').delete()") < html.indexOf("setRecs(recs().filter(r=>r.date!==date))"));
  assert.match(html, /削除できなかったため、記録は残しています/);
});
