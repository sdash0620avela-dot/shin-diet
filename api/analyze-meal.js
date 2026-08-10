const ALLOWED_ORIGINS = new Set([
  'https://sdash0620avela-dot.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

const schema = {
  type: 'object', additionalProperties: false,
  required: ['items', 'total', 'confidence', 'uncertainties'],
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'estimated_amount'], properties: { name: { type: 'string' }, estimated_amount: { type: 'string' } } } },
    total: { type: 'object', additionalProperties: false,
      required: ['kcal', 'protein_g', 'fat_g', 'carbs_g'], properties: {
        kcal: { type: 'number', minimum: 0 }, protein_g: { type: 'number', minimum: 0 },
        fat_g: { type: 'number', minimum: 0 }, carbs_g: { type: 'number', minimum: 0 }
      } },
    confidence: { type: 'string', enum: ['高', '中', '低'] },
    uncertainties: { type: 'array', items: { type: 'string' } }
  }
};

function cors(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin', 'Content-Type': 'application/json; charset=utf-8' };
}
function json(body, status, origin) { return new Response(JSON.stringify(body), { status, headers: cors(origin) }); }

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: '許可されていない接続元です。' }, 403, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POSTのみ利用できます。' }, 405, origin);
    if (!env.OPENAI_API_KEY) return json({ error: '解析サーバーの設定が未完了です。' }, 503, origin);
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > 10_000_000) return json({ error: '写真データが大きすぎます。' }, 413, origin);
    try {
      const body = await request.json();
      if (!body.image || !/^data:image\/(jpeg|png|webp);base64,/.test(body.image)) return json({ error: '対応する写真データがありません。' }, 400, origin);
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini', store: false,
          instructions: 'あなたは日本の食事記録用栄養推定器です。写真に見える食品だけを対象に、一般的な日本の一人前と容器サイズから量を推定してください。見えない油・調味料・重量を断定せず、uncertaintiesに日本語で記載してください。栄養値は食事全体の推定合計です。食事でない画像ならitemsを空、全数値を0、confidenceを低にしてください。',
          input: [{ role: 'user', content: [
            { type: 'input_text', text: `${String(body.meal_type || '食事')}の写真です。料理名、推定量、kcal、P・F・Cを推定してください。` },
            { type: 'input_image', image_url: body.image, detail: 'low' }
          ] }],
          text: { format: { type: 'json_schema', name: 'meal_nutrition', strict: true, schema } },
          max_output_tokens: 800
        })
      });
      const data = await response.json();
      if (!response.ok) return json({ error: 'AI解析に接続できませんでした。', detail: data.error?.message || '' }, 502, origin);
      const output = data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
      if (!output) return json({ error: '解析結果を取得できませんでした。' }, 502, origin);
      return json(JSON.parse(output), 200, origin);
    } catch (error) {
      return json({ error: '写真解析中にエラーが発生しました。' }, 500, origin);
    }
  }
};
