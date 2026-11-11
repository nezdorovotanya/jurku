// Cloudflare Worker: принимает заявку с jurkujurku.com и пересылает её в Telegram.
// Токен бота и чат хранятся в секретах воркера (BOT_TOKEN, CHAT_ID) и на сайт не попадают.

const ALLOWED = ['https://jurkujurku.com', 'https://www.jurkujurku.com'];
const LIMIT = 5;          // заявок с одного адреса
const WINDOW = 600;       // за 10 минут

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply({ ok: false, error: 'method' }, 405);
    if (!ALLOWED.includes(origin)) return reply({ ok: false, error: 'origin' }, 403);
    if (!env.BOT_TOKEN || !env.CHAT_ID) return reply({ ok: false, error: 'config' }, 500);

    let d;
    try { d = await req.json(); } catch (e) { return reply({ ok: false, error: 'json' }, 400); }
    const str = v => (typeof v === 'string' ? v : '').trim();
    const name = str(d.name), phone = str(d.phone), text = str(d.text);

    // скрытое поле: человек его не видит, а боты заполняют. Отвечаем «ок», чтобы бот не пробовал снова
    if (str(d.website)) return reply({ ok: true });

    const digits = phone.replace(/\D/g, '').length;
    if (!name || name.length > 80) return reply({ ok: false, error: 'name' }, 400);
    if (digits < 10 || digits > 15 || phone.length > 30) return reply({ ok: false, error: 'phone' }, 400);
    if (text.length > 7800) return reply({ ok: false, error: 'long' }, 400);

    // ограничение частоты: не больше LIMIT заявок с одного IP за WINDOW секунд
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const key = new Request('https://ratelimit.jurku/' + encodeURIComponent(ip));
    const cache = caches.default;
    const seen = await cache.match(key);
    const n = seen ? Number(await seen.text()) || 0 : 0;
    if (n >= LIMIT) return reply({ ok: false, error: 'rate' }, 429);
    await cache.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': `max-age=${WINDOW}` } }));

    // имя и телефон берём из проверенных полей, а не из текста заявки
    const body = text.startsWith('Новая заявка') ? text : `Новая заявка с сайта\nИмя: ${name}\nТелефон: ${phone}\n\n${text}`;
    for (let i = 0; i < body.length; i += 3900) {
      const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.CHAT_ID, text: body.slice(i, i + 3900), disable_web_page_preview: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) return reply({ ok: false, error: 'telegram' }, 502);
    }
    return reply({ ok: true });
  },
};
