/* 本人がChatGPTで確定した実績（仕様書 17）。固定IDで重複登録を防ぐ。 */
(function (root) {
  'use strict';
  const S = (type, weight, reps) => ({ type, weight, reps, done: true });
  const W = (w, r) => S('warmup', w, r), M = (w, r) => S('main', w, r);
  const ex = (name, sets, extra = {}) => ({ name, sets, ...extra });
  const CONFIRMED_SESSIONS = [
    { id: 'confirmed-2026-11-17-shioda-legs', date: '2026-11-17', store: 'shioda', part: 'legs', startedAt: null, finishedAt: null,
      expect: { minutes: null, totalSets: 12, warmupSets: 0, mainSets: 12, totalReps: 177 }, fatigue: null, pain: '', note: '本人確認済みの本セットのみ。準備セット・時間・疲労度・痛み・RIRは未提供のため未記録。',
      exercises: [
        ex('レッグプレス', [M(170, 15), M(170, 12), M(150, 15)]),
        ex('レッグカール', [M(80, 15), M(80, 12), M(70, 15)]),
        ex('レッグエクステンション', [M(80, 14), M(90, 13), M(70, 15)]),
        ex('アブダクション', [M(100, 18), M(100, 15), M(90, 18)])
      ] },
    { id: 'confirmed-2026-11-24-honten-chest', date: '2026-11-24', store: 'honten', part: 'chest', startedAt: '2026-11-24T15:43:00+09:00', finishedAt: '2026-11-24T16:48:00+09:00',
      expect: { minutes: 65, totalSets: 24, warmupSets: 7, mainSets: 17, totalReps: 324 }, fatigue: null, pain: '', note: 'ベンチインクライン・ケーブルフライの方が通常のケーブルフライより効く。痛み・疲労度・RIRは未申告。',
      exercises: [
        ex('インクラインDBプレス', [W(20, 15), W(24, 10), M(30, 12), M(40, 10), M(30, 12)]),
        ex('ISOデクラインプレス', [W(20, 15), W(30, 12), M(40, 12), M(60, 10), M(50, 15)], { note: '片側' }),
        ex('チェストプレス', [W(61, 15), M(82, 13), M(82, 11), M(89, 10), M(61, 20)]),
        ex('ペックフライ', [W(61, 15), M(82, 13), M(89, 12), M(68, 15), M(61, 20)]),
        ex('ベンチインクライン・ケーブルフライ', [W(10, 15), M(15, 15), M(17.5, 12), M(15, 15)], { note: '片側' })
      ] },
    { id: 'confirmed-2026-11-25-shioda-back', date: '2026-11-25', store: 'shioda', part: 'back', startedAt: '2026-11-25T17:24:00+09:00', finishedAt: '2026-11-25T18:26:00+09:00',
      expect: { minutes: 62, totalSets: 24, warmupSets: 7, mainSets: 17, totalReps: 262 }, fatigue: 1, pain: '', note: '痛み・RIRは未申告。',
      exercises: [
        ex('ラットプルダウン・ワイド', [W(40, 8), M(60, 12), M(60, 11), M(60, 11)]),
        ex('ニュートラルグリッププルダウン', [W(40, 8), M(60, 12), M(60, 11)]),
        ex('シーテッドロー', [W(45, 8), W(55, 5), M(67.5, 12), M(67.5, 11), M(60, 13)]),
        ex('ワイドラットプルダウン・プレート式', [W(30, 12), M(50, 11), M(60, 10), M(40, 15)]),
        ex('リアデルトフライ', [W(40, 10), M(60, 10), M(60, 10), M(50, 13)]),
        ex('ケーブルプルオーバー', [W(30, 10), M(50, 13), M(60, 14), M(60, 12)])
      ] },
    { id: 'confirmed-2026-11-26-shioda-shoulders', date: '2026-11-26', store: 'shioda', part: 'shoulders', startedAt: '2026-11-26T18:15:00+09:00', finishedAt: '2026-11-26T19:08:00+09:00',
      expect: { minutes: 53, totalSets: 24, warmupSets: 4, mainSets: 20, totalReps: 326 }, fatigue: 1, pain: '', note: '痛み・RIRは未申告。',
      exercises: [
        ex('マシンショルダープレス', [W(20, 12), M(40, 10), M(50, 9), M(40, 12)]),
        ex('DBサイドレイズ', [W(6, 15), M(8, 21), M(12, 16), M(16, 12), M(12, 17)]),
        ex('Hammer Strengthラテラルレイズ', [M(30, 16), M(40, 14), M(45, 12)]),
        ex('リアデルトマシン', [W(40, 15), M(55, 16), M(60, 12), M(55, 13), M(40, 21)]),
        ex('片手ケーブルサイドレイズ', [M(10, 16), M(15, 11), M(10, 16)]),
        ex('フェイスプル', [W(30, 10), M(50, 10), M(55, 10), M(55, 10)])
      ] }
  ];
  const api = { CONFIRMED_SESSIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HistorySeed = api;
})(typeof window !== 'undefined' ? window : globalThis);
