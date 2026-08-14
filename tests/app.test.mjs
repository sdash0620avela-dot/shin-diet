import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../api/analyze-meal.js', import.meta.url), 'utf8');
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
  assert.match(html,/有酸素：\$\{x\.cardio\}kcal/);
  assert.match(html,/r\.cardioCalories=breakdown\.cardio/);
  assert.match(html,/r\.strengthCalories=breakdown\.strength/);
  assert.match(html,/r\.accessoryCalories=breakdown\.accessory/);
});

test('v18.0 accepts a current machine calorie reading without copying an old reading', () => {
  assert.match(html,/id="cardioManualCalories"/);
  assert.match(html,/機器表示 kcal（任意）/);
  assert.match(html,/manualEntered\?'machine':'met'/);
  assert.match(html,/機器表示を優先/);
  assert.match(html,/\$\('cardioManualCalories'\)\.value=''/);
  assert.match(html,/cardioCalorieSource=breakdown\.source/);
  assert.match(html,/r\.cardioCalorieSource==='machine'/);
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
  assert.match(html, /assets\/ai-coach-sprite\.png/);
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
