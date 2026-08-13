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
});
