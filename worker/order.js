// Cloudflare Worker for jurkujurku.com orders -> Telegram.
// Secrets: BOT_TOKEN, CHAT_ID. Plain ASCII on purpose, so copy-paste cannot break it.

var ALLOWED = ['https://jurkujurku.com', 'https://www.jurkujurku.com'];
var LIMIT = 5;
var WINDOW = 600;

function countDigits(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export default {
  async fetch(req, env) {
    var origin = req.headers.get('Origin') || '';
    var cors = {
      'Access-Control-Allow-Origin': ALLOWED.indexOf(origin) >= 0 ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    function reply(body, status) {
      var h = Object.assign({}, cors, { 'Content-Type': 'application/json' });
      return new Response(JSON.stringify(body), { status: status || 200, headers: h });
    }

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply({ ok: false, error: 'method' }, 405);
    if (ALLOWED.indexOf(origin) < 0) return reply({ ok: false, error: 'origin' }, 403);
    if (!env.BOT_TOKEN || !env.CHAT_ID) return reply({ ok: false, error: 'config' }, 500);

    var d;
    try {
      d = await req.json();
    } catch (e) {
      return reply({ ok: false, error: 'json' }, 400);
    }

    var name = clean(d.name);
    var phone = clean(d.phone);
    var text = clean(d.text);

    // hidden field: people never fill it, bots do
    if (clean(d.website)) return reply({ ok: true });

    var nd = countDigits(phone);
    if (!name || name.length > 80) return reply({ ok: false, error: 'name' }, 400);
    if (nd < 10 || nd > 15 || phone.length > 30) return reply({ ok: false, error: 'phone' }, 400);
    if (text.length > 7800) return reply({ ok: false, error: 'long' }, 400);

    // at most LIMIT orders from one IP per WINDOW seconds
    var ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    var key = new Request('https://ratelimit.jurku/' + encodeURIComponent(ip));
    var seen = await caches.default.match(key);
    var count = seen ? (Number(await seen.text()) || 0) : 0;
    if (count >= LIMIT) return reply({ ok: false, error: 'rate' }, 429);
    await caches.default.put(key, new Response(String(count + 1), { headers: { 'Cache-Control': 'max-age=' + WINDOW } }));

    var body = text ? text : ('Name: ' + name + '\nPhone: ' + phone);
    if (text && text.indexOf(phone) < 0) body = 'Name: ' + name + '\nPhone: ' + phone + '\n\n' + text;

    for (var i = 0; i < body.length; i += 3900) {
      var r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.CHAT_ID, text: body.slice(i, i + 3900), disable_web_page_preview: true })
      });
      var j = {};
      try { j = await r.json(); } catch (e) {}
      if (!j.ok) return reply({ ok: false, error: 'telegram' }, 502);
    }
    return reply({ ok: true });
  }
};
