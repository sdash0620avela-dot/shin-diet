// スポーツ科学の定期収集（PubMed E-utilities）
// 新しい系統的レビュー・メタ解析を収集し science/candidates.json に書き出す。
// 収集しただけの候補はメニューへ反映しない。原典（抄録・本文）を照合し、
// science/evidence.json に verified:true で追加したものだけがAIとアプリの判断に使われる。
// 使い方：node scripts/collect-science.mjs [--days 120] [--out science/candidates.json]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const days = Math.max(7, Math.min(730, +opt('--days', 120)));
const out = opt('--out', 'science/candidates.json');
const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const TOPICS = {
  volume: '"resistance training"[tiab] AND (volume[tiab] OR sets[tiab]) AND (hypertrophy[tiab] OR strength[tiab])',
  proximity: '"resistance training"[tiab] AND ("repetitions in reserve"[tiab] OR failure[tiab] OR RPE[tiab])',
  load: '"resistance training"[tiab] AND (load[tiab] OR intensity[tiab]) AND hypertrophy[tiab]',
  rest: '"resistance training"[tiab] AND ("rest interval"[tiab] OR "inter-set rest"[tiab] OR "rest period"[tiab])',
  frequency: '"resistance training"[tiab] AND frequency[tiab] AND (hypertrophy[tiab] OR strength[tiab])',
  progression: '"resistance training"[tiab] AND (progression[tiab] OR autoregulation[tiab] OR deload[tiab])',
  pain: '"resistance training"[tiab] AND (pain[tiab] OR injury[tiab]) AND (shoulder[tiab] OR "low back"[tiab] OR knee[tiab])'
};
const FILTER = ' AND (systematic[sb] OR meta-analysis[pt])';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(path) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(BASE + path, { headers: { 'User-Agent': 'science-collector/1.0' } });
    if (res.ok) return res.json();
    await sleep(1000 * (i + 1));
  }
  throw new Error('PubMed request failed: ' + path.slice(0, 80));
}

const verified = new Set(JSON.parse(readFileSync('science/evidence.json', 'utf8')).items.map(x => x.pmid));
let previous = [];
try { previous = JSON.parse(readFileSync(out, 'utf8')).candidates || []; } catch { previous = []; }
const known = new Map(previous.map(c => [c.pmid, c]));
const found = new Map();
for (const [topic, term] of Object.entries(TOPICS)) {
  const q = encodeURIComponent(term + FILTER);
  const s = await get(`esearch.fcgi?db=pubmed&retmode=json&retmax=20&sort=pub_date&datetype=pdat&reldate=${days}&term=${q}`);
  (s.esearchresult.idlist || []).forEach(id => { const c = found.get(id) || { topics: [] }; c.topics.push(topic); found.set(id, c); });
  await sleep(400); // NCBIの利用規約（APIキーなし：毎秒3件まで）
}
const ids = [...found.keys()].filter(id => !verified.has(id));
const candidates = [];
for (let i = 0; i < ids.length; i += 100) {
  const sum = await get(`esummary.fcgi?db=pubmed&retmode=json&id=${ids.slice(i, i + 100).join(',')}`);
  for (const id of sum.result.uids || []) {
    const r = sum.result[id];
    candidates.push({
      pmid: id, title: r.title, journal: r.source, pubdate: r.pubdate, firstAuthor: r.authors && r.authors[0] ? r.authors[0].name : '',
      doi: (r.articleids || []).find(a => a.idtype === 'doi')?.value || '', topics: found.get(id).topics,
      status: known.get(id)?.status || 'unverified', collectedAt: known.get(id)?.collectedAt || new Date().toISOString().slice(0, 10)
    });
  }
  await sleep(400);
}
const merged = [...candidates, ...previous.filter(p => !candidates.some(c => c.pmid === p.pmid) && !verified.has(p.pmid))].slice(0, 300);
writeFileSync(out, JSON.stringify({ collectedAt: new Date().toISOString(), windowDays: days, note: '未検証の候補。メニュー設計には使用しない。原典照合後に science/evidence.json へ verified:true で追加する。', candidates: merged }, null, 2) + '\n');
const fresh = candidates.filter(c => !known.has(c.pmid));
console.log(`candidates=${merged.length} new=${fresh.length}`);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## スポーツ科学 新規候補 ${fresh.length}件（未検証）\n\n` + fresh.map(c => `- [${c.title}](https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/) ${c.journal} ${c.pubdate}（${c.topics.join(', ')}）`).join('\n') + '\n', { flag: 'a' });
const issueBody = opt('--issue-body', '');
if (issueBody && fresh.length) writeFileSync(issueBody, `月次収集で見つかった未検証の候補です（${fresh.length}件）。\n\n各論文の抄録・本文を確認し、妥当なものだけ science/evidence.json に verified:true・rule付きで追加してください。追加されるまでメニュー設計には使われません。\n\n` + fresh.slice(0, 40).map(c => `- [ ] PMID ${c.pmid}：${c.title}（${c.journal}, ${c.pubdate}）https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`).join('\n') + '\n');
