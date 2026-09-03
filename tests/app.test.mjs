import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../api/analyze-meal.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../manifest.json', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

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
    'sleepScore', 'hasValue', 'hasSleepInput', 'sleepStar', 'isRestDay', 'effectiveExercise', 'scoreBreakdown', 'scoreRecord', 'estimatedDailyBurn', 'estimatedBalance', 'largeDeficitWarning', 'scoreImprovementLines', 'scorePotential'
  ].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { sleepScore, scoreRecord, scoreBreakdown, estimatedDailyBurn, estimatedBalance, largeDeficitWarning, scoreImprovementLines, scorePotential };'
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

const coachApi = new Function(
  ['sleepScore','hasValue','isRestDay','effectiveExercise','hasExerciseInput','hasMealInput','hasSleepInput','assessmentStatus','scoreBreakdown','scoreRecord','sleepStar','animeCoachState'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { animeCoachState };'
)();

const compositionApi = new Function(
  ['avgOf','dayNumber','muscleTypeOf','muscleMeta','bodyCompositionAnalysis'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { bodyCompositionAnalysis };'
)();

const weeklyApi = new Function(
  ['sleepScore','hasValue','isRestDay','effectiveExercise','hasExerciseInput','hasMealInput','hasSleepInput','assessmentStatus','scoreBreakdown','scoreRecord','sleepStar','dayNumber','muscleTypeOf','weeklyWindow','weeklyStats','muscleMeta','buildWeeklyReport'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { weeklyWindow, weeklyStats, buildWeeklyReport };'
)();

const monthlyApi = new Function(
  ['sleepScore','hasValue','isRestDay','effectiveExercise','hasExerciseInput','hasMealInput','hasSleepInput','assessmentStatus','scoreBreakdown','scoreRecord','sleepStar','dayNumber','muscleTypeOf','muscleMeta','monthlyWindow','monthlyStats','monthlyPriority','buildMonthlyReport'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { monthlyWindow, monthlyStats, monthlyPriority, buildMonthlyReport };'
)();

const reminderApi = new Function(
  "const localStorage={getItem:()=>null};const storageKey=x=>x;const appNowMs=()=>Date.now();const readDraft=()=>null;const dateKey=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};"+
  ['hasValue','isRestDay','hasExerciseInput','hasMealInput','hasSleepInput','assessmentStatus','recordMissingFields','reminderMinutes','reminderState'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { reminderMinutes, reminderState };'
)();

const graphApi = new Function(
  ['hasValue','fatTypeOf','muscleTypeOf','dayNumber','graphSeries','rollingSevenDay'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { graphSeries, rollingSevenDay };'
)();

const measurementApi = new Function(
  ['hasValue','measurementStats'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { measurementStats };'
)();

const bodyProgressApi = new Function(
  ['hasValue','avgOf','dayNumber','muscleTypeOf','muscleMeta','measurementStats','bodyCompositionAnalysis','bodyProgressSummary'].map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { bodyProgressSummary };'
)();

const consultApi = new Function(
  extractFunction(html, 'coachContext') + '\nreturn { coachContext };'
)();

const mealAdditionApi = new Function(
  extractFunction(html, 'combineMealEntry') + '\nreturn { combineMealEntry };'
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

test('v17.3 explains the final score and never penalizes blank optional water', () => {
  const record = {intake:2100,protein:93,cardio:true,exerciseTotal:1135,strength:'腕トレ28セット 60分',sleep:'★★★★☆',waterL:null,fatigue:2};
  assert.equal(scoreApi.scoreRecord(record, settings), 87);
  const breakdown=scoreApi.scoreBreakdown(record,settings);
  assert.deepEqual(breakdown.items.map(x=>[x.label,x.points,x.max]),[['摂取カロリー',20,20],['たんぱく質',11,20],['運動',25,25],['睡眠',16,20],['水分',5,5],['疲労度',10,10]]);
  const improvements=scoreApi.scoreImprovementLines(record,settings).join('\n');
  assert.match(improvements,/あと9g、合計102gまで補う → 92点（\+5点）/);
  assert.match(improvements,/あと27g、目標120gまで補う → 96点（\+9点）/);
  assert.match(improvements,/水分は未入力のため減点していません/);
  assert.match(html,/朝コンディション評価と1日実行評価は採点対象が異なる別の点数/);
  assert.match(html,/この点数をAIコーチに詳しく聞く/);
});

test('v17.4 keeps score guidance visible on home and separates morning from daily scoring', () => {
  assert.match(html,/1日実行評価の内訳/);
  assert.match(html,/点数の内訳・上げ方を見る/);
  assert.match(html,/次に点数を上げる方法/);
  assert.match(html,/朝コンディション評価：\$\{morningReportScore\(r\)\}点/);
  assert.match(html,/差し引き比較はしません/);
  assert.match(html,/openScoreConsult\(\)/);
});

test('v17.5 prioritizes a very large estimated deficit before chasing score points', () => {
  const record={intake:2100,protein:93,cardio:true,exerciseTotal:1135,strength:'腕トレ28セット 60分',sleep:'★★★★☆',waterL:null,fatigue:2};
  const personalSettings={...settings,baseBurn:3200};
  assert.equal(scoreApi.estimatedBalance(record,personalSettings),-1100);
  assert.match(scoreApi.largeDeficitWarning(record,personalSettings),/概算収支-1100kcal/);
  assert.match(scoreApi.scoreImprovementLines(record,personalSettings)[0],/これ以上の運動追加や食事削減はしません/);
  assert.match(html,/if\(balanceWarning\)return '最優先：'\+balanceWarning/);
  assert.match(html,/概算収支の赤字が大きいため安全確認を優先/);
});

test('v17.6 does not subtract exercise twice from an activity-adjusted daily burn', () => {
  const record={intake:2100,exerciseTotal:1135};
  assert.equal(scoreApi.estimatedBalance(record,{baseBurn:2800}),-700);
  assert.equal(scoreApi.largeDeficitWarning(record,{baseBurn:2800}),'');
  assert.match(html,/推定1日消費.*普段の活動・運動を含む/);
  assert.match(html,/当日の運動消費は重ねて引きません/);
  assert.doesNotMatch(html,/\(\+r\.intake\)-\(\+s\.baseBurn\|\|0\)-exCalories/);
});

test('v17.7 recalculates daily burn from the record weight when auto mode is on', () => {
  const record={weight:113.8,intake:2100,exerciseTotal:1135};
  const settings={baseBurn:2800,autoBurn:true,age:47,heightCm:181,activityLevel:1.375,sex:'male'};
  assert.equal(scoreApi.estimatedDailyBurn(record,settings),2804);
  assert.equal(scoreApi.estimatedBalance(record,settings),-704);
  assert.equal(scoreApi.estimatedDailyBurn(record,{...settings,autoBurn:false}),2800);
  assert.equal(scoreApi.estimatedBalance(record,{...settings,autoBurn:false}),-700);
  assert.match(html,/id="autoBurn"/);
  assert.match(html,/記録体重から自動計算/);
});

test('v17.8 separates current score, today actionable ceiling and next-time sleep potential', () => {
  const record={intake:2100,protein:93,cardio:true,exerciseTotal:1135,strength:'腕トレ28セット 60分',sleep:'★★★★☆',waterL:null,fatigue:2};
  assert.deepEqual(scoreApi.scorePotential(record,settings),{current:87,todayMax:96,nextTimeMax:100});
  assert.match(html,/点数の見通し/);
  assert.match(html,/今日まだ整えられる項目で最大/);
  assert.match(html,/次回、睡眠★★★★★なら最大/);
});

test('v17.9 estimates cardio separately and keeps strength calories separate', () => {
  const cardioMetSource=html.match(/const cardioMets=\{.*?\};/s)?.[0];
  assert.ok(cardioMetSource);
  const cardioApi=new Function(
    cardioMetSource+'\n'+extractFunction(html,'cardioCalories')+'\nreturn { cardioCalories };'
  )();
  assert.equal(cardioApi.cardioCalories('bike','moderate',45,113.8),538);
  assert.equal(cardioApi.cardioCalories('bike','hard',45,113.8),717);
  assert.match(html,/前回の有酸素・強度をそのまま使う/);
  assert.match(html,/筋トレ消費 kcal（任意・上書き）/);
  assert.match(html,/有酸素小計：\$\{x\.cardio\}kcal/);
  assert.match(html,/r\.cardioCalories=breakdown\.cardio/);
  assert.match(html,/r\.strengthCalories=breakdown\.strength/);
  assert.match(html,/r\.accessoryCalories=breakdown\.accessory/);
});

test('v18.0 accepts a current machine calorie reading without copying an old reading', () => {
  assert.match(html,/id="cardioManualCalories"/);
  assert.match(html,/機器表示 kcal（任意）/);
  assert.match(html,/manual\?'machine':'met'/);
  assert.match(html,/機器表示を優先/);
  assert.match(html,/\$\('cardioManualCalories'\)\.value=''/);
  assert.match(html,/cardioCalorieSource=breakdown\.source/);
  assert.match(html,/source==='machine'/);
});

test('v18.1 estimates strength training from intensity, duration and current weight', () => {
  const strengthMetSource=html.match(/const strengthMets=\{.*?\};/s)?.[0];
  assert.ok(strengthMetSource);
  const api=new Function(strengthMetSource+'\n'+extractFunction(html,'strengthEstimatedCalories')+'\nreturn { strengthEstimatedCalories };')();
  assert.equal(api.strengthEstimatedCalories('moderate',60,113.8),597);
  assert.equal(api.strengthEstimatedCalories('hard',60,113.8),717);
  assert.match(html,/id="strengthIntensity"/);
  assert.match(html,/前回の筋トレ・強度をそのまま使う/);
  assert.match(html,/strengthCalorieSource=breakdown\.strengthSource/);
  assert.match(html,/\$\('exerciseCal'\)\.value=''/);
});

test('v18.2 can copy legacy cardio and strength records without inventing saved intensity', () => {
  assert.match(html,/filter\(r=>r\.date<current&&r\.cardio\)/);
  assert.match(html,/previous\.cardioType\|\|'other'/);
  assert.match(html,/previous\.cardioIntensity\|\|'moderate'/);
  assert.match(html,/種類は「その他」、強度は「普通」に仮設定/);
  assert.match(html,/String\(r\.strength\|\|''\)\.trim\(\)\|\|\+r\.workoutMinutes>0/);
  assert.match(html,/previous\.strengthIntensity\|\|'moderate'/);
  assert.match(html,/強度は「普通」に仮設定/);
});

test('v18.3 preserves calorie sources in the saved daily summary', () => {
  assert.match(html,/function savedExerciseBreakdown\(r\)/);
  assert.match(html,/cardioCalorieSource==='machine'\?'機器表示'/);
  assert.match(html,/strengthCalorieSource==='manual'\?'手入力'/);
  assert.match(html,/補助運動 \$\{accessory\}kcal【目安】/);
  assert.match(html,/消費内訳：\$\{savedExercise\.parts\.join\('＋'\)\}/);
  assert.match(html,/運動消費合計 約\$\{Math\.round\(exCalories\)\}kcal【\$\{savedExercise\.label\}】/);
  assert.doesNotMatch(html,/運動消費 約\$\{Math\.round\(exCalories\)\}kcal【推定】/);
});

test('v18.4 blocks incomplete exercise input before saving', () => {
  assert.match(html,/function exerciseInputErrors\(\)/);
  assert.match(html,/有酸素を行った場合は、有酸素の分数を入力してください/);
  assert.match(html,/有酸素の内容があります。有酸素へチェックを入れるか/);
  assert.match(html,/筋トレ内容がある場合は、筋トレ時間を入力してください/);
  assert.match(html,/const exerciseErrors=exerciseInputErrors\(\);if\(exerciseErrors\.length\)/);
});

test('v18.4 does not mistake workout notes containing rest-day words for a rest day', () => {
  const api=new Function(extractFunction(html,'isRestDay')+'\nreturn { isRestDay };')();
  assert.equal(api.isRestDay({restDay:false,strength:'休養日'}),true);
  assert.equal(api.isRestDay({restDay:false,strength:'休養日明けの胸トレ'}),false);
  assert.equal(api.isRestDay({restDay:false,strength:'今日は休養日（運動0分）'}),true);
  assert.equal(api.isRestDay({restDay:true,strength:'胸トレ'}),true);
});

test('v18.5 preserves unfinished exercise input in drafts', () => {
  assert.match(html,/function collectRecord\(normalizeRest=true\)/);
  assert.match(html,/const record=collectRecord\(false\)/);
  assert.match(html,/if\(normalizeRest&&isRestDay\(r\)\)/);
  assert.match(html,/const r=collectRecord\(\),all=recs\(\)/);
});

test('v19.0 supports two separately calculated cardio activities', () => {
  assert.match(html,/id="cardio2"/);
  assert.match(html,/id="cardio2Type"/);
  assert.match(html,/id="cardio2Intensity"/);
  assert.match(html,/id="cardio2Min"/);
  assert.match(html,/id="cardio2ManualCalories"/);
  assert.match(html,/function cardioEntryFromForm\(prefix\)/);
  assert.match(html,/cardio=first\.calories\+second\.calories/);
  assert.match(html,/cardio1Calories=breakdown\.cardio1/);
  assert.match(html,/cardio2Calories=breakdown\.cardio2/);
  assert.match(html,/additional|追加の有酸素を行った場合は、追加種目の分数を入力してください/);
  assert.match(html,/if\(r\.cardio\|\|r\.cardio2\)exercise\+=8/);
  assert.match(html,/cardioItem\('cardio2'\)/);
  assert.match(html,/id="cardio2Fields" style="display:none"/);
  assert.match(html,/\$\('cardio2Fields'\)\.style\.display=\$\('cardio2'\)\.checked\?'block':'none'/);
});

test('v19.1 copies one complete previous workout without stale calorie overrides', () => {
  assert.match(html,/onclick="copyPreviousWorkout\(\)">前回の運動一式/);
  assert.match(html,/function copyPreviousWorkout\(\)/);
  assert.match(html,/r\.date<current&&!isRestDay\(r\)&&hasExerciseInput\(r\)/);
  assert.match(html,/\$\('cardioManualCalories'\)\.value=''/);
  assert.match(html,/\$\('cardio2ManualCalories'\)\.value=''/);
  assert.match(html,/\$\('exerciseCal'\)\.value=''/);
  assert.match(html,/\['legRaise','plank','powerplate','drawin'\]\.forEach/);
  assert.match(html,/消費kcalは今回の体重・時間・強度で再計算します/);
});

test('v19.2 offers safe one-tap favorite meals from saved history', () => {
  assert.match(html, /function mealFavoritesFor\(id,currentDate\)/);
  assert.match(html, /r\.date<currentDate/);
  assert.match(html, /\.sort\(\(a,b\)=>b\.count-a\.count/);
  assert.match(html, /\.slice\(0,3\)/);
  assert.match(html, /name\.textContent=entry\.text/);
  assert.match(html, /button\.addEventListener\('click',\(\)=>applyMealFavorite/);
  assert.match(html, /scheduleDraftSave\(\)/);
  assert.doesNotMatch(html, /meal-favorite-name[^\n]*innerHTML/);
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
  assert.match(worker, /env\.PHOTO_RATE_LIMITER/);
  assert.match(worker, /limiter\.limit\(\{ key: authUser\.id \}\)/);
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
  assert.match(html, /edit\.className='item-edit'/);
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

test('v16.2 anime coach has four deterministic states', () => {
  assert.match(html, /assets\/ai-coach-niece-anime-v2\.png/);
  assert.equal(coachApi.animeCoachState(null, settings), 'waiting');
  assert.equal(coachApi.animeCoachState({...ideal, sleep:'★★☆☆☆'}, settings), 'warning');
  assert.equal(coachApi.animeCoachState(ideal, settings), 'achievement');
  assert.equal(coachApi.animeCoachState({...ideal, protein:90}, settings), 'good');
  assert.match(html, /renderAnimeCoach\(t,s\)/);
});

test('v16.3 detects plateau, short change and muscle maintenance without asserting fat change', () => {
  const records=Array.from({length:8},(_,i)=>({date:'2026-08-'+String(i+1).padStart(2,'0'),weight:110+(i%2?.1:0),muscle:47+(i%2?.1:0),muscleType:'skeletalMuscleMass'}));
  const stable=compositionApi.bodyCompositionAnalysis(records,records.at(-1));
  assert.equal(stable.plateau,'possible');
  assert.equal(stable.muscle,'maintained');
  const jump=compositionApi.bodyCompositionAnalysis([...records,{date:'2026-08-09',weight:111.2,muscle:47,muscleType:'skeletalMuscleMass'}]);
  assert.equal(jump.shortChange,'possible');
  assert.match(html,/脂肪増減とは断定しません/);
  assert.match(html,/renderCompositionAnalysis\(a,t\)/);
});

test('v16.4 weekly report uses the latest seven calendar days and is copyable', () => {
  const records=[
    {date:'2026-08-01',weight:115},
    {date:'2026-08-08',weight:114,intake:2000,protein:120,restDay:true,sleep:'★★★★★',waterL:2,fatigue:2,muscle:47,muscleType:'skeletalMuscleMass'},
    {date:'2026-08-10',weight:113.8,intake:1900,protein:125,restDay:true,sleep:'★★★★☆',waterL:2,fatigue:2,muscle:47.1,muscleType:'skeletalMuscleMass'},
    {date:'2026-08-14',weight:113.5,intake:1950,protein:122,restDay:true,sleep:'★★★★☆',waterL:2,fatigue:2,muscle:47.2,muscleType:'skeletalMuscleMass'}
  ];
  assert.deepEqual(weeklyApi.weeklyWindow(records).map(r=>r.date),['2026-08-08','2026-08-10','2026-08-14']);
  const report=weeklyApi.buildWeeklyReport(records,settings);
  assert.match(report,/AI週間総括/);
  assert.match(report,/期間内体重差：-0.5kg/);
  assert.match(report,/【来週の最優先】/);
  assert.match(report,/脂肪・筋肉の増減とは断定しません/);
  assert.match(html,/copyWeeklyReport/);
});

test('v16.5 chart switches metrics without mixing measurement types and uses calendar averages', () => {
  const records=[
    {date:'2026-08-01',weight:115,fat:27,fatType:'fatPercent',muscle:47,muscleType:'skeletalMuscleMass'},
    {date:'2026-08-08',weight:114,fat:26.8,fatType:'fatPercent',muscle:47.1,muscleType:'skeletalMuscleMass'},
    {date:'2026-08-09',weight:113.8,fat:30,fatType:'fatMass',muscle:80,muscleType:'muscleMass'},
    {date:'2026-08-14',weight:113.5,fat:29.8,fatType:'fatMass',muscle:79.5,muscleType:'muscleMass'}
  ];
  assert.deepEqual(graphApi.graphSeries(records,'fat').map(x=>x.value),[30,29.8]);
  assert.deepEqual(graphApi.graphSeries(records,'muscle').map(x=>x.value),[80,79.5]);
  const rolling=graphApi.rollingSevenDay(graphApi.graphSeries(records,'weight'));
  assert.equal(rolling.at(-1).value,(114+113.8+113.5)/3);
  assert.match(html,/selectGraphMode\('weight'\)/);
  assert.match(html,/実線：実測値｜点線：7日平均/);
});

test('v19.3 monthly report compares first and last seven-day averages', () => {
  const records=Array.from({length:30},(_,i)=>({
    date:`2026-08-${String(i+1).padStart(2,'0')}`,weight:115-i*.1,intake:2000,protein:120,
    restDay:true,sleep:'★★★★☆',waterL:2,fatigue:2,muscle:47,muscleType:'skeletalMuscleMass'
  }));
  assert.equal(monthlyApi.monthlyWindow(records).length,30);
  const stats=monthlyApi.monthlyStats(records,settings);
  assert.ok(stats.weightAverageChange < -2);
  assert.equal(stats.avgProtein,120);
  const report=monthlyApi.buildMonthlyReport(records,settings);
  assert.match(report,/AI月間総括/);
  assert.match(report,/前半・後半7日平均体重差/);
  assert.match(report,/【翌月の最優先】/);
  assert.match(report,/単日の値ではなく期間平均/);
  assert.match(html,/id="monthly"/);
  assert.match(html,/copyMonthlyReport/);
});

test('v19.4 reminder appears only after its time when today is incomplete', () => {
  const now=new Date(2026,7,15,21,30);
  assert.equal(reminderApi.reminderState([], {reminderEnabled:false,reminderTime:'21:00'}, now).show,false);
  assert.equal(reminderApi.reminderState([], {reminderEnabled:true,reminderTime:'22:00'}, now).reason,'early');
  const incomplete=reminderApi.reminderState([{date:'2026-08-15',weight:113}], {reminderEnabled:true,reminderTime:'21:00'}, now);
  assert.equal(incomplete.show,true);
  assert.deepEqual(incomplete.missing,['食事','運動・休養','睡眠']);
  const complete={date:'2026-08-15',weight:113,intake:2000,restDay:true,sleep:'★★★★☆'};
  assert.equal(reminderApi.reminderState([complete], {reminderEnabled:true,reminderTime:'21:00'}, now).reason,'complete');
  assert.match(html,/アプリを閉じている間のプッシュ通知ではありません/);
  assert.match(html,/function openTodayRecord\(\)/);
  assert.match(html,/function dismissReminderToday\(\)/);
  assert.match(html,/setInterval\(renderRecordReminder,60000\)/);
});

test('v19.5 diagnostics reports actual app and storage state without changing data', () => {
  assert.match(html,/id="appDiagnostics"/);
  assert.match(html,/function appDiagnosticState\(\)/);
  assert.match(html,/navigator\.storage\?\.persisted/);
  assert.match(html,/navigator\.storage\?\.estimate/);
  assert.match(html,/navigator\.serviceWorker\?\.controller/);
  assert.match(html,/display-mode: standalone/);
  assert.match(html,/function requestPersistentStorage\(\)/);
  assert.match(html,/navigator\.storage\?\.persist/);
  assert.match(html,/storageKey\('LastExport'\)/);
  assert.match(html,/クラウド同期またはデータ書き出し/);
});

test('v19.6 rest day overrides stale exercise fields and save errors do not jump to top', () => {
  assert.match(html,/function formIsRestDay\(\)/);
  assert.match(html,/function clearExerciseForRest\(showMsg=true\)/);
  assert.match(html,/休養日を優先し、残っていた運動入力を外しました/);
  assert.match(html,/休養日：運動消費 0kcal/);
  assert.match(html,/if\(rest\)return \[\]/);
  assert.match(html,/\$\('restDay'\)\.addEventListener\('change'/);
  assert.match(html,/\$\('strength'\)\.addEventListener\('input'/);
  assert.match(html,/const exerciseErrors=exerciseInputErrors\(\);if\(exerciseErrors\.length\)\{setStatus\(exerciseErrors\.join\(' '\),false\);return false\}/);
  assert.doesNotMatch(html,/exerciseErrors\.length[^\n]*scrollIntoView/);
});

test('v19.7 distinguishes complete rest from cardio-only days', () => {
  assert.match(html,/今日は完全休養日（有酸素・筋トレ・腹筋など全部0）/);
  assert.match(html,/onclick="quickCardioOnly\(\)">有酸素のみの日/);
  assert.match(html,/function quickCardioOnly\(\)/);
  assert.match(html,/\['legRaise','plank','powerplate','drawin'\]\.forEach/);
  assert.match(html,/\['exerciseCal','workoutMinutes','strength'\]\.forEach/);
  assert.match(html,/有酸素のみの日にしました。種類・強度・時間を確認して保存してください/);
  assert.match(html,/筋トレ内容（しなかった日は空欄でOK）/);
});

test('v19.8 gives first-time users one guide and accepts the full emailed code length', () => {
  assert.match(html,/初めて使う人へ/);
  assert.match(html,/個人設定.*設定を保存/s);
  assert.match(html,/本人専用クラウド/);
  assert.match(html,/数字コード（6〜10桁）/);
  assert.match(html,/pattern="\[0-9\]\{6,10\}"/);
  assert.match(html,/届いた数字をすべて入力/);
  assert.doesNotMatch(html,/6桁のログインコードを送信しています/);
  assert.doesNotMatch(html,/8桁コードを送信しました/);
});

test('v19.9 explains the current iPhone web-app installation flow without re-adding', () => {
  assert.match(html,/iPhoneのホーム画面へ追加する手順/);
  assert.match(html,/このページをSafariで開く/);
  assert.match(html,/「共有」を押し、「ホーム画面に追加」を選ぶ/);
  assert.match(html,/「Webアプリとして開く」をオンにする/);
  assert.match(html,/追加はこのiPhoneで最初の1回だけ/);
  assert.match(html,/古いアイコンを消したり追加し直したりする必要はありません/);
});

test('v19.10 shares the canonical public app URL with a clipboard fallback', () => {
  assert.match(html,/onclick="shareApp\(\)">このアプリを友達に送る/);
  assert.match(html,/id="shareAppStatus"/);
  assert.match(html,/const APP_PUBLIC_URL='https:\/\/sdash0620avela-dot\.github\.io\/shin-diet\/'/);
  assert.match(html,/function shareApp\(\)/);
  assert.match(html,/navigator\.share/);
  assert.match(html,/navigator\.clipboard\.writeText\(APP_PUBLIC_URL\)/);
  assert.match(html,/共有をキャンセルしました/);
  assert.match(html,/アプリのURLをコピーしました/);
});

test('v19.11 shows first-use completion from actual settings, login and records', () => {
  assert.match(html,/初回準備の状況/);
  assert.match(html,/id="firstUseSettings"/);
  assert.match(html,/id="firstUseLogin"/);
  assert.match(html,/id="firstUseRecord"/);
  assert.match(html,/function renderFirstUseProgress\(s=sets\(\)\)/);
  assert.match(html,/profileComplete\(s\)/);
  assert.match(html,/!!cloudUser/);
  assert.match(html,/recs\(\)\.length>0/);
  assert.match(html,/renderFirstUseProgress\(s\)/);
});

test('v19.12 launches from the app shell offline and explains local saving', () => {
  assert.match(html,/id="offlineNotice"/);
  assert.match(html,/記録はこの端末へ保存できます。通信が戻ったらクラウド同期します/);
  assert.match(html,/function renderConnectivity\(\)/);
  assert.match(html,/window\.addEventListener\('offline',renderConnectivity\)/);
  assert.match(html,/window\.addEventListener\('online'/);
  assert.match(html,/if\(cloudUser\)syncNow\(true\)/);
  assert.match(serviceWorker,/caches\.match\('\.\/index\.html'\)\.then\(cached=>cached\|\|fetch/);
  assert.doesNotMatch(serviceWorker,/if\(e\.request\.mode==='navigate'\)\{\s*e\.respondWith\(fetch/);
});

test('v19.13 shows pending offline changes and syncs after reconnecting', () => {
  assert.match(html,/id="syncQueueState"/);
  assert.match(html,/function pendingCloudChanges\(\)/);
  assert.match(html,/オフライン保存済み・同期待ち/);
  assert.match(html,/クラウド同期待ち/);
  assert.match(html,/クラウド同期済み/);
  assert.match(html,/if\(navigator\.onLine===false\)return/);
  assert.match(html,/通信が戻ると自動同期します/);
  assert.match(html,/renderSyncQueueState\(\)/);
});

test('v19.14 retries transient sync failures and pending changes on resume', () => {
  assert.match(html,/function transientSyncError\(error\)/);
  assert.match(html,/function scheduleCloudRetry\(\)/);
  assert.match(html,/cloudRetryAttempt>=3/);
  assert.match(html,/15\*Math\.pow\(2,cloudRetryAttempt-1\)/);
  assert.match(html,/クラウド同期を再試行します/);
  assert.match(html,/if\(transientSyncError\(e\)\)scheduleCloudRetry\(\)/);
  assert.match(html,/pendingCloudChanges\(\)>0\|\|appNowMs\(\)-lastSyncEpoch>300000/);
});

test('v19.15 makes iPhone photo loading resilient and translates network failures', () => {
  assert.match(html,/typeof createImageBitmap==='function'/);
  assert.match(html,/URL\.createObjectURL\(file\)/);
  assert.match(html,/const img=new Image\(\)/);
  assert.match(html,/const max=1024/);
  assert.match(html,/\.78\)/);
  assert.match(html,/load failed\|failed to fetch\|networkerror\|network request failed/i);
  assert.match(html,/写真は消えていません/);
});

test('v19.16 adds saved meals and photo estimates without overwriting either one', () => {
  const protein={text:'プロテイン',kcal:127,protein:22,fat:2,carbs:5,source:'manual'};
  const edamame={text:'枝豆 125g',kcal:172,protein:14.7,fat:7.6,carbs:11.1,source:'ai'};
  assert.deepEqual(mealAdditionApi.combineMealEntry(protein,edamame),{text:'プロテイン、枝豆 125g',kcal:299,protein:36.7,fat:9.6,carbs:16.1,source:'mixed'});
  assert.deepEqual(mealAdditionApi.combineMealEntry(edamame,protein),{text:'枝豆 125g、プロテイン',kcal:299,protein:36.7,fat:9.6,carbs:16.1,source:'mixed'});
  assert.match(html,/function addMealEntry\(id,entry\)/);
  assert.match(html,/mealAnalysisBase\[id\]=combineMealEntry/);
  assert.match(html,/if\(!mealAnalysisItems\[id\]\)mealAnalysisBase\[id\]=mealFormEntry\(id\)/);
  assert.match(html,/保存履歴と写真解析は、この食事へ順番に追加されます/);
});

test('v19.17 remembers editable favorite meals and prevents same-meal doubling', () => {
  assert.match(html,/現在の内容を「いつもの食事」に登録・更新/);
  assert.match(html,/function saveCurrentMealFavorite\(id,label\)/);
  assert.match(html,/savedMealFavorites:all/);
  assert.match(html,/list\.slice\(0,8\)/);
  assert.match(html,/mealNutritionScore\(entry\)>mealNutritionScore\(existing\.entry\)/);
  assert.match(html,/const same=normalizedMealName\(mealFormEntry\(id\)\.text\)===normalizedMealName\(entry\.text\)/);
  assert.match(html,/同じ\$\{label\}なので二重加算せず/);
  assert.match(html,/const existing=sets\(\),s=\{\.\.\.existing/);
});

test('v19.18 hides onboarding until storage is resolved and adds clear nutrition and workout guidance', () => {
  assert.match(html,/let bootStorageReady=false/);
  assert.match(html,/bootStorageReady&&!profileComplete\(s\)&&!recs\(\)\.length/);
  assert.match(html,/たんぱく質（P）/);
  assert.match(html,/脂質（F）/);
  assert.match(html,/炭水化物（C）/);
  assert.match(html,/function openWorkoutConsult\(\)/);
  assert.match(html,/別店舗・別マシンの重量は流用せず/);
  assert.match(html,/質問、減量目標と直近最大14日の記録/);
});

test('v19.19 lets one coach use three consistent personalities in a warmer companion UI', () => {
  assert.match(html,/id="coachStyle"/);
  assert.match(html,/相棒タイプ（標準）/);
  assert.match(html,/やさしい応援タイプ/);
  assert.match(html,/厳しいトレーナータイプ/);
  assert.match(html,/function coachStyledQuestion\(question,s=sets\(\)\)/);
  assert.match(html,/message:coachStyledQuestion\(question\)/);
  assert.match(html,/function coachSummaryLine\(r,s,mode\)/);
  assert.match(html,/coach-state-achievement/);
  assert.match(html,/class="coach-style-name"/);
  assert.match(html,/coachStyle:'partner'/);
  assert.match(html,/coachStyle:COACH_STYLES\[\$\('coachStyle'\)\.value\]/);
});

test('v19.20 switches beginner and detailed nutrition labels without changing recorded fields', () => {
  assert.match(html,/id="displayMode"/);
  assert.match(html,/初心者表示（日本語中心）/);
  assert.match(html,/詳しい表示（P・F・C併記）/);
  assert.match(html,/displayMode:'detailed'/);
  assert.match(html,/displayMode:'beginner'/);
  assert.match(html,/function displayModeKey\(value\)/);
  assert.match(html,/function nutritionLabel\(name,code,mode=/);
  assert.match(html,/function applyDisplayMode\(value=/);
  assert.match(html,/displayMode:displayModeKey\(\$\('displayMode'\)\.value\)/);
  assert.match(html,/applyDisplayMode\(s\.displayMode\)/);
  assert.match(html,/data-nutrition-name="たんぱく質"/);
  assert.match(html,/栄養項目の意味を見る/);
});

test('v20.0 provides simple and pro modes with selectable advice and shared records', () => {
  assert.match(html,/id="usageMode"/);
  assert.match(html,/かんたんモード（写真・AIコーチ中心）/);
  assert.match(html,/しっかり記録モード（すべての項目）/);
  assert.match(html,/usageMode:'pro'/);
  assert.match(html,/usageMode:'simple'/);
  assert.match(html,/id="simpleHome"/);
  assert.match(html,/function applyUsageMode\(value=/);
  assert.match(html,/function openSimpleMeal\(\)/);
  assert.match(html,/function openSimpleBody\(\)/);
  assert.match(html,/id="adviceSupplement"/);
  assert.match(html,/function adviceTopics\(s=sets\(\)\)/);
  assert.match(html,/希望する助言分野/);
  assert.match(html,/adviceSupplement:\$\('adviceSupplement'\)\.checked/);
});

test('v20.0 reads only visible body-composition values and requires confirmation before save', () => {
  assert.match(html,/id="bodyAnalyze"/);
  assert.match(html,/function analyzeBodyComposition\(\)/);
  assert.match(html,/kind:'body_composition'/);
  assert.match(html,/写真の数値と合っているか確認して保存してください/);
  assert.match(html,/function applyBodyCompositionAnalysis\(result\)/);
  assert.match(worker,/const bodyCompositionSchema/);
  assert.match(worker,/body\.kind === 'body_composition'/);
  assert.match(worker,/推測・計算・補完をしないでください/);
  assert.match(worker,/筋肉量と骨格筋量を混同しないでください/);
  assert.match(worker,/detail: 'high'/);
});

test('v20.1 distinguishes muscle type and energy fields after photo reading', () => {
  assert.match(html,/id="muscleTypeGuide"/);
  assert.match(html,/写真から「骨格筋量」と確認して自動選択しました/);
  assert.match(html,/写真から「筋肉量」と確認して自動選択しました/);
  assert.match(html,/写真で項目名を確認できませんでした/);
  assert.match(html,/安静にしていても使うエネルギー/);
  assert.match(html,/1日の総消費エネルギー kcal/);
  assert.match(html,/生活や運動を含めて1日に使う目安/);
});

test('v20.1 meal analysis uses a realistic average without low or high bias', () => {
  assert.match(worker,/低めにも高めにも寄せない最も現実的な平均値/);
  assert.match(worker,/通常含まれる平均的な油・調味料分を計上/);
  assert.match(worker,/不明だからゼロにしたり安全側として過剰に加算したりしない/);
  assert.doesNotMatch(worker,/過大評価を避け/);
});

test('v20.2 gives immediate photo guidance and respects selected advice topics', () => {
  assert.match(html,/id="bodyAnalysisAdvice"/);
  assert.match(html,/function renderBodyAnalysisAdvice\(result\)/);
  assert.match(html,/1回の変化だけでは脂肪の増減とは判断しません/);
  assert.match(html,/AnalysisAdvice" class="analysis-advice"/);
  assert.match(html,/function renderMealAnalysisAdvice\(id,result,s=sets\(\)\)/);
  assert.match(html,/if\(!s\.adviceFood\)return/);
  assert.match(html,/s\.adviceSupplement&&remaining>=25/);
  assert.match(html,/次は、たんぱく質を補える主菜を1つ/);
});

test('v20.2 filters quick questions and explains Android recovery', () => {
  assert.match(html,/id="coachQuickButtons"/);
  assert.match(html,/function renderCoachQuickButtons\(s=sets\(\)\)/);
  assert.match(html,/if\(s\.adviceExercise\)choices\.push/);
  assert.match(html,/Androidで開く・ホーム画面へ追加する手順/);
  assert.match(html,/LINE内ではなくChromeで開き/);
  assert.match(html,/プライベートDNS/);
});

test('v20.3 reduces simple photo recording to one confirmed save', () => {
  assert.match(html,/function simpleMealSlot\(now=new Date\(\)\)/);
  assert.match(html,/hour<10\?'breakfast':hour<15\?'lunch':hour<21\?'dinner':'snack'/);
  assert.match(html,/function setSimpleRecordFocus\(focus='all'\)/);
  assert.match(html,/data-record-focus="meal"/);
  assert.match(html,/id="bodyCompositionCard"/);
  assert.match(html,/id="mealCard"/);
  assert.match(html,/id="exerciseCard"/);
  assert.match(html,/内容を確認してこの食事を保存/);
  assert.match(html,/数値を確認して保存/);
  assert.match(html,/function saveSimpleResult\(button\)/);
  assert.match(html,/function saveRecord\(skipConfirm=false\)/);
  assert.match(html,/if\(!skipConfirm&&!confirmRecordSave/);
});

test('v20.5 uses a larger anime-style version of the submitted niece illustration', () => {
  assert.match(html,/v20\.5 アニメコーチ版/);
  assert.match(html,/assets\/ai-coach-niece-anime-v2\.png/);
  assert.match(html,/grid-template-columns:170px 1fr/);
  assert.match(html,/\.coach-sprite\{width:170px/);
  assert.match(html,/background-size:cover/);
  assert.doesNotMatch(html,/background-size:200% 200%/);
  assert.match(html,/const APP_VERSION='20\.5'/);
  assert.match(serviceWorker,/shin-diet-v20-5-anime-coach/);
  assert.match(serviceWorker,/assets\/ai-coach-niece-anime-v2\.png/);
  assert.match(serviceWorker,/version:'20\.5'/);
  assert.match(manifest,/v20\.5 アニメコーチ版/);
});

test('v16.6 stores and compares optional body measurements', () => {
  const stats=measurementApi.measurementStats([
    {date:'2026-08-01',waistCm:110,chestCm:120},
    {date:'2026-08-08',waistCm:108},
    {date:'2026-08-14',waistCm:106.5,chestCm:118,hipCm:105}
  ]);
  assert.equal(stats.find(x=>x.key==='waistCm').change,-3.5);
  assert.equal(stats.find(x=>x.key==='chestCm').change,-2);
  assert.equal(stats.find(x=>x.key==='hipCm').change,0);
  assert.match(html,/id="waistCm"/);
  assert.match(html,/id="chestCm"/);
  assert.match(html,/id="hipCm"/);
  assert.match(html,/renderMeasurementProgress\(a\)/);
  assert.match(html,/測定位置・姿勢・時間帯の違い/);
});

test('v16.7 body comment only uses recorded numeric changes', () => {
  const records=[
    {date:'2026-08-01',weight:120,waistCm:110,muscle:47,muscleType:'skeletalMuscleMass'},
    {date:'2026-08-08',weight:115,waistCm:106,muscle:47.1,muscleType:'skeletalMuscleMass'},
    {date:'2026-08-14',weight:113.8,waistCm:104.5,muscle:47,muscleType:'skeletalMuscleMass'}
  ];
  const summary=bodyProgressApi.bodyProgressSummary(records,{startWeight:127.4});
  assert.match(summary.facts.join('\n'),/開始体重 127.4kg → 現在 113.8kg（-13.6kg）/);
  assert.match(summary.facts.join('\n'),/ウエスト 110.0cm → 104.5cm（-5.5cm）/);
  assert.match(summary.comment,/体重とウエストが減少/);
  assert.match(summary.comment,/骨格筋量は平均で維持範囲/);
  assert.match(html,/写真から体型を判定したものではありません/);
  assert.match(html,/renderBodyProgressComment\(a,s\)/);
});

test('v17.0 AI consultation sends only a bounded record context for a signed-in user', () => {
  const records=Array.from({length:20},(_,i)=>({date:`2026-08-${String(i+1).padStart(2,'0')}`,weight:120-i,privateExtra:'do not send',condition:'x'.repeat(300)}));
  const context=consultApi.coachContext(records,{displayName:'慎',goalWeight:95,healthNotes:'do not send'});
  assert.equal(context.records.length,14);
  assert.equal(context.records[0].date,'2026-08-07');
  assert.equal(context.records[0].privateExtra,undefined);
  assert.equal(context.records[0].condition.length,200);
  assert.equal(context.settings.healthNotes,undefined);
  assert.match(html,/id="chat" class="page"/);
  assert.match(html,/kind:'coach_chat'/);
  assert.match(html,/cloudClient\.auth\.getSession\(\)/);
  assert.match(html,/相談文・回答は端末やクラウドの記録へ保存しません/);
});

test('v17.0 coach worker authenticates, rate limits and separates facts from inference', () => {
  assert.match(worker,/body\.kind === 'coach_chat'/);
  assert.match(worker,/message\.length > 500/);
  assert.match(worker,/cleanCoachContext/);
  assert.match(worker,/slice\(-14\)/);
  assert.match(worker,/store: false/);
  assert.match(worker,/【確認できた事実】/);
  assert.match(worker,/【推測】/);
  assert.match(worker,/医療診断・投薬指示はしません/);
  assert.match(worker,/limiter\.limit/);
});

test('v17.1 safely renders imported user text without HTML execution paths', () => {
  assert.match(html,/function renderList\(\)[\s\S]*replaceChildren\(\)/);
  assert.match(html,/detail\.textContent=/);
  assert.match(html,/\$\('tw'\)\.textContent=/);
  assert.match(html,/safeName=esc\(name\)/);
  assert.doesNotMatch(html,/function renderList\(\)[^}]*\.innerHTML=/);
});

test('v17.1 coach receives meal details, exercise details and treats record strings as data', () => {
  const context=consultApi.coachContext([{date:'2026-08-14',breakfast:'おにぎり',breakfastSource:'manual',cardio:true,cardioMin:43,legRaise:true,hunger:3,fatigue:2}],settings);
  assert.equal(context.records[0].breakfast,'おにぎり');
  assert.equal(context.records[0].cardioMin,43);
  assert.equal(context.records[0].legRaise,true);
  assert.equal(context.records[0].hunger,3);
  assert.match(worker,/分析対象のデータ/);
  assert.match(worker,/絶対に従わないでください/);
});

test('v17.1 uses authenticated server time and caps future conflict timestamps', () => {
  assert.match(html,/kind:'server_time'/);
  assert.match(html,/shinDietServerClockOffsetMs/);
  assert.match(html,/Math\.min\(t,now\+300000\)/);
  assert.match(html,/updatedAt:appNowIso\(\)/);
  assert.match(worker,/body\.kind === 'server_time'/);
});

test('v17.2 keeps photo analysis and AI consultation rate limits independent', () => {
  assert.match(worker,/env\.AI_CHAT_RATE_LIMITER/);
  assert.match(worker,/env\.PHOTO_RATE_LIMITER/);
  assert.match(worker,/aiKind === 'coach'/);
  assert.match(wrangler,/name = "PHOTO_RATE_LIMITER"/);
  assert.match(wrangler,/namespace_id = "14031"/);
  assert.match(wrangler,/name = "AI_CHAT_RATE_LIMITER"/);
  assert.match(wrangler,/namespace_id = "14032"/);
  assert.match(worker,/kind: aiKind/);
});
