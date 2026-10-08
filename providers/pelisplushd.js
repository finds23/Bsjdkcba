// PelisPlusHD (pelisplushd.bz) - plugin para Nuvio
// Servidores soportados: Voe, VidHide (y familia), StreamWish (y familia)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const FUENTE = 'PelisPlusHD';
const BASES = ['https://pelisplushd.bz', 'https://www.pelisplushd.la'];
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const VERSION = '1.7.0';
let CryptoJS = null;
try {
  CryptoJS = require('crypto-js');
} catch (e) {}

// Servidores activos. VidHide queda apagado: en SeriesKao "responde pero no reproduce".
// Voe: apagado (pide verificación anti-bot). VidHide: apagado (responde pero no reproduce).
const ENABLED = { Voe: false, StreamWish: true, VidHide: false };
const UA_MOVIL = 'Mozilla/5.0 (Linux; Android 13; moto g82 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';

// DEBUG: poner en true para agregar al final de la lista una entrada "ESTADO DE REPRODUCTORES"
// (no reproducible) con lo que pasó en cada paso. Apagado = lista limpia.
const DEBUG = false;
let TRACE = [];
let ESTADO = {};

function trace(m) {
  const l = String(m).replace(/\s+/g, ' ').slice(0, 140);
  if (TRACE.length < 70 && !TRACE.includes(l)) TRACE.push(l);
}

function anotarEstado(label, ok, audio, motivo) {
  const e = ESTADO[label] || (ESTADO[label] = { total: 0, ok: 0, motivo: '', audios: [] });
  e.total++;
  if (ok) {
    e.ok++;
    if (audio && !e.audios.includes(audio)) e.audios.push(audio);
  } else if (!e.motivo) {
    e.motivo = motivo || 'sin video en el embed';
  }
}

function entradaEstado(titulo) {
  const lineas = Object.keys(ESTADO).map((l) => {
    const e = ESTADO[l];
    const a = e.audios.length ? ` [${e.audios.join('/')}]` : '';
    if (!e.ok) return `\u274C ${l} \u2014 ${e.motivo}`;
    if (e.ok < e.total) return `\u26A0\uFE0F ${l} \u2014 ${e.ok}/${e.total} embeds${a}`;
    return `\u2705 ${l} \u2014 ${e.ok} ${e.ok === 1 ? 'embed' : 'embeds'}${a}`;
  });
  const cuerpo = ['\uD83D\uDCE1 ESTADO DE REPRODUCTORES (no reproducir)', `${FUENTE} v${VERSION}${titulo ? ` | ${titulo}` : ''}`].concat(lineas);
  if (!lineas.length) cuerpo.push('(sin reproductores en esta consulta)');
  return { name: FUENTE, title: '', url: `${BASES[0]}/`, quality: cuerpo.concat(['\uD83D\uDEE0 DIAGNOSTICO'], TRACE).join('\n'), headers: {} };
}

const RELOJ = typeof setTimeout === 'function';
const PRESUPUESTO = RELOJ ? 42000 : 25000;
const CIERRE = RELOJ ? 50000 : 40000;
let inicio = Date.now();
const caidos = new Set();
// Hosts que respondieron 403/429: no se les vuelve a pedir nada por un rato (evita que te bloqueen la IP).
const bloqueados = {};
const ENFRIAMIENTO = 15 * 60 * 1000;

/* ------------------------------ utilidades base ------------------------------ */

function esperar(ms) {
  return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function restante() {
  return PRESUPUESTO - (Date.now() - inicio);
}

function conLimite(promesa, ms, valor) {
  let listo = false;
  const fin = Date.now() + ms;
  const trabajo = Promise.resolve(promesa).then((v) => {
    listo = true;
    return v;
  }, () => {
    listo = true;
    return valor;
  });
  if (!RELOJ) return trabajo;
  const reloj = (async () => {
    while (!listo && Date.now() < fin) await esperar(Math.max(1, Math.min(250, fin - Date.now())));
    return valor;
  })();
  return Promise.race([trabajo, reloj]);
}

async function traer(url, opciones) {
  if (typeof __native_fetch !== 'function') return fetch(url, opciones);
  const cabeceras = {};
  for (const k of Object.keys(opciones.headers || {})) cabeceras[k] = String(opciones.headers[k]);
  const cuerpo = opciones.body === undefined || opciones.body === null ? null : String(opciones.body);
  const crudo = await __native_fetch(url, String(opciones.method || 'GET').toUpperCase(), JSON.stringify(cabeceras), cuerpo === null ? 'none' : 'text', cuerpo || '', opciones.redirect !== 'manual');
  const d = JSON.parse(crudo);
  const h = d.headers || {};
  return {
    ok: !!d.ok,
    status: d.status,
    statusText: d.statusText,
    url: d.url || url,
    headers: { get: (n) => h[String(n).toLowerCase()] || null },
    text: () => Promise.resolve(d.body || ''),
    json: () => {
      try {
        return Promise.resolve(d.body ? JSON.parse(d.body) : null);
      } catch (e) {
        return Promise.resolve(null);
      }
    }
  };
}

async function pedir(url, opciones) {
  const host = String(url || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  if (caidos.has(host) || restante() <= 0) return null;
  if (bloqueados[host] && Date.now() - bloqueados[host] < ENFRIAMIENTO) {
    trace(`${host}: en pausa (403/429 reciente)`);
    return null;
  }
  const o = Object.assign({}, opciones || {});
  const limite = Math.min(o.limite || CIERRE, CIERRE - (Date.now() - inicio));
  delete o.limite;
  o.headers = Object.assign({
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
  }, o.headers || {});
  const r = await conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), limite, null);
  if (r && !r.status) {
    caidos.add(host);
    return null;
  }
  if (r && (r.status === 403 || r.status === 429)) {
    bloqueados[host] = Date.now();
    caidos.add(host);
    trace(`${host}: HTTP ${r.status}, no se insiste`);
  }
  return r;
}

async function texto(url, opciones) {
  const r = await pedir(url, opciones);
  if (!r || !r.ok) return '';
  try {
    return (await conLimite(r.text(), 10000, '')) || '';
  } catch (e) {
    return '';
  }
}

async function json(url, opciones) {
  const t = await texto(url, opciones);
  try {
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
}

function origen(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1] : '';
}

function dominio(url) {
  const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}

const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü', iexcl: '¡', iquest: '¿' };

function entidades(t) {
  return String(t || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (x, n) => (n in ENTIDADES ? ENTIDADES[n] : x));
}

function absoluta(url, base) {
  if (!url) return '';
  const u = entidades(String(url).trim().replace(/\\\//g, '/'));
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return origen(base) + u;
  const b = String(base || '').replace(/[?#].*$/, '');
  return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
}

function limpiarHtml(t) {
  return entidades(String(t || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function atobSeguro(t) {
  try {
    return atob(String(t || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'));
  } catch (e) {
    return '';
  }
}

function desempacar(html) {
  const salida = [];
  const patron = /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
  const digitos = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let m;
  while ((m = patron.exec(String(html || '')))) {
    const base = parseInt(m[2], 10);
    const palabras = m[4].split('|');
    const valor = (t) => {
      let n = 0;
      for (const ch of t) {
        const v = digitos.indexOf(ch);
        if (v < 0 || v >= base) return -1;
        n = n * base + v;
      }
      return n;
    };
    salida.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (t) => {
      const i = valor(t);
      return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t;
    }));
  }
  return salida.join('\n');
}

function etiquetaAltura(alto) {
  const h = parseInt(alto, 10) || 0;
  if (!h) return '';
  if (h >= 2000) return '4K';
  if (h >= 1400) return '1440p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 470) return '480p';
  if (h >= 350) return '360p';
  return `${h}p`;
}

function calidadTexto(t) {
  const s = String(t || '');
  if (/2160|4k|uhd/i.test(s)) return '4K';
  const m = s.match(/(1440|1080|720|480|360|240)\s*p?/i);
  return m ? `${m[1]}p` : '';
}

function enlace(url, servidor, headers, calidad) {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }];
}

function buscarVideo(t, base) {
  const fuentes = [
    /["']?hls[24][\"']?\s*:\s*["']([^"']+)["']/i,
    /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i,
    /file\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i,
    /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /sources\s*:\s*\[\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
    /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i
  ];
  for (const f of fuentes) {
    const m = String(t || '').match(f);
    if (m) return absoluta(m[1], base);
  }
  return '';
}

/* ----------------------------------- Voe ----------------------------------- */

function descifrarVoe(cifrado, ruidos) {
  const t = cifrado.replace(/[a-zA-Z]/g, (c) => {
    const tope = c <= 'Z' ? 90 : 122;
    const n = c.charCodeAt(0) + 13;
    return String.fromCharCode(n <= tope ? n : n - 26);
  });
  let limpio = t;
  for (const ruido of ruidos || ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) limpio = limpio.split(ruido).join('');
  const paso = atobSeguro(limpio);
  if (!paso) return null;
  let movido = '';
  for (let i = 0; i < paso.length; i++) movido += String.fromCharCode(paso.charCodeAt(i) - 3);
  const final = atobSeguro(movido.split('').reverse().join(''));
  try {
    return JSON.parse(final);
  } catch (e) {
    return null;
  }
}

// Voe muestra el "no soy un robot" solo en el navegador; el JSON cifrado ya viene en el HTML,
// así que se descifra sin necesidad de resolver el captcha.
async function resolverVoe(url, referer) {
  let actual = url;
  let html = '';
  let estado = '';
  for (let i = 0; i < 3; i++) {
    const r = await pedir(actual, { headers: { Referer: i === 0 && referer ? referer : actual } });
    if (!r) {
      estado = 'sin respuesta';
      html = '';
      break;
    }
    estado = `HTTP ${r.status}`;
    if (r.url) actual = r.url;
    if (!r.ok) {
      html = '';
      break;
    }
    html = (await conLimite(r.text(), 10000, '')) || '';
    const salto = html.length < 4000 && html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
    if (!salto) break;
    actual = absoluta(salto[1], actual);
  }
  if (!html) {
    trace(`voe ${dominio(actual)}: ${estado}`);
    return [];
  }
  const cab = { Referer: `${origen(actual)}/`, 'User-Agent': UA };
  const bloque = html.match(/<script type="application\/json">([\s\S]*?)<\/script>(?:\s*<script[^>]*src=["']([^"']+)["'])?/i);
  if (bloque) {
    let cifrado = '';
    try {
      const dato = JSON.parse(bloque[1].trim());
      cifrado = Array.isArray(dato) ? dato[0] : dato;
    } catch (e) {}
    let datos = cifrado ? descifrarVoe(cifrado) : null;
    if (!datos && cifrado && bloque[2]) {
      const cargador = await texto(absoluta(bloque[2], actual), { headers: { Referer: actual } });
      const lista = (cargador.match(/\[(?:\s*'[^']{1,10}'\s*,?){4,12}\]/) || cargador.match(/\[(?:\s*"[^"]{1,10}"\s*,?){4,12}\]/) || [])[0];
      if (lista) datos = descifrarVoe(cifrado, (lista.match(/['"]([^'"]{1,10})['"]/g) || []).map((x) => x.slice(1, -1)));
    }
    const video = datos && (datos.source || datos.direct_access_url);
    const mp4 = datos && datos.fallback && datos.fallback[0] && datos.fallback[0].file;
    const salida = [];
    if (video) salida.push(...enlace(video, 'Voe', cab));
    if (mp4) salida.push(...enlace(mp4, 'Voe', { 'User-Agent': UA }));
    if (salida.length) return salida;
  }
  const directo = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (directo) return enlace(/^aHR0/.test(directo[1]) ? atobSeguro(directo[1]) : directo[1], 'Voe', cab);
  const fin = enlace(buscarVideo(html, actual), 'Voe', cab);
  if (!fin.length) {
    const tit = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '?';
    trace(`voe ${dominio(actual)}: ${html.length}B, json=${/application\/json/.test(html) ? 'si' : 'no'}${/human|captcha|turnstile|robot|verif/i.test(html) ? ', ANTI-BOT' : ''}, titulo=${entidades(tit.trim()).slice(0, 30)}`);
    if (html.length < 3000) trace(`voe cuerpo: ${html.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  return fin;
}

/* ------------------------- VidHide / StreamWish (packer) ------------------------- */

function candidatosHls(html, url) {
  const codigo = `${desempacar(html)}\n${html}`;
  const salida = [];
  const lm = codigo.match(/links\s*=\s*(\{[^}]+\})/);
  if (lm) {
    try {
      const o = JSON.parse(lm[1].replace(/'/g, '"'));
      for (const k of ['hls2', 'hls3', 'hls4', 'hls1', 'hls']) if (o[k]) salida.push({ k, url: absoluta(o[k], url) });
    } catch (e) {}
  }
  if (!salida.length) {
    const v = absoluta(buscarVideo(codigo, url), url);
    if (v) salida.push({ k: '', url: v });
  }
  return salida;
}

function videoEmpaquetado(html, url) {
  const codigo = `${desempacar(html)}\n${html}`;
  const links = codigo.match(/links\s*=\s*(\{[^}]+\})/);
  let video = '';
  if (links) {
    try {
      const o = JSON.parse(links[1].replace(/'/g, '"'));
      video = o.hls4 || o.hls3 || o.hls2 || o.hls || '';
    } catch (e) {}
  }
  return absoluta(video || buscarVideo(codigo, url), url);
}

async function resolverEmpaquetado(url, servidor, referer, siguiendo) {
  const propio = `${origen(url)}/`;
  for (const ref of [...new Set([referer || propio, propio])]) {
    const html = await texto(url, { headers: { Referer: ref } });
    if (!html) continue;
    const video = videoEmpaquetado(html, url);
    if (video) return enlace(video, servidor, { Referer: propio, Origin: origen(url), 'User-Agent': UA });
    const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (marco && !siguiendo) return resolverEmpaquetado(absoluta(marco[1], url), servidor, url, true);
  }
  return [];
}

// StreamWish/StreamHG (patrón probado en AnimeJara): varios referers, dominios espejo,
// seguimiento de redirecciones JS y UA móvil tanto al leer el embed como al reproducir.
async function paginaWish(url, referer) {
  let actual = url;
  let ref = referer;
  for (let i = 0; i < 2; i++) {
    const r = await pedir(actual, { headers: { 'User-Agent': UA_MOVIL, Referer: ref, 'Accept-Language': 'es-419,es;q=0.9' } });
    if (!r || !r.ok) {
      trace(`wish ${dominio(actual)}: ${r ? `HTTP ${r.status}` : 'sin respuesta'}`);
      return null;
    }
    const html = (await conLimite(r.text(), 10000, '')) || '';
    const pagina = r.url || actual;
    const videos = candidatosHls(html, pagina);
    if (videos.length) return { videos, pagina };
    const salto = html.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) || html.match(/location\.replace\(\s*['"]([^'"]+)['"]/i);
    const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    const siguiente = salto ? absoluta(salto[1], pagina) : marco ? absoluta(marco[1], pagina) : '';
    if (!siguiente || siguiente === actual) {
      trace(`wish ${dominio(pagina)}: sin video (${html.length}B) ${html.length < 1200 ? html.replace(/\s+/g, ' ').slice(0, 90) : ''}`);
      return null;
    }
    ref = pagina;
    actual = siguiente;
  }
  return null;
}

async function resolverStreamwish(url, referer) {
  const inicial = url.replace('hglink.to', 'vibuxer.com');
  const id = inicial.replace(/[?#].*$/, '').split('/').filter(Boolean).pop().replace(/\.html$/, '');
  const propio = `${origen(inicial)}/`;
  const intentos = [];
  for (const r of [...new Set([propio, referer || `${BASES[0]}/`, `${BASES[0]}/`])]) intentos.push({ u: inicial, r });
  for (const b of ['https://hglink.to/e/', 'https://streamwish.to/e/', 'https://hgcloud.to/e/']) {
    if (origen(b + id) !== origen(inicial)) intentos.push({ u: b + id, r: `${origen(b)}/` });
  }
  for (const it of intentos.slice(0, 3)) {
    if (restante() < 3000) break;
    const res = await paginaWish(it.u, it.r);
    if (res) {
      const o = origen(res.pagina);
      const cab = { Referer: `${o}/`, Origin: o, 'User-Agent': UA_MOVIL };
      trace(`wish ok en ${dominio(res.pagina)}: ${res.videos.map((v) => v.k || 'video').join(',')}`);
      const salida = [];
      const vistos = new Set();
      for (const v of res.videos.slice(0, 3)) {
        if (vistos.has(v.url)) continue;
        vistos.add(v.url);
        for (const e of enlace(v.url, 'StreamWish', cab)) {
          e.tag = v.k ? `CDN ${v.k.replace('hls', '') || '1'}` : '';
          salida.push(e);
        }
      }
      return salida;
    }
  }
  return [];
}

const SERVIDORES = [
  ['Voe', /voe\.sx|voe-unblock|voeunbl|voeun|v-o-e|(^|\.)voe\./i, (u, r) => resolverVoe(u, r)],
  ['VidHide', /vidhide|filelions|ryderjet|dintezuvio|mivalyo|dhtpre|peytonepre|smoothpre|vidhidepre|louishide|lylxan|movearnpre|alions|azipcdn|nikaplayer|fviplions|vidhidevip|niikaplayerr|callistanise|dinisglows|vidhideplus|vidhidehub|dingtezuni|minochinos|dramiyos|earnvids|vidnova|streamfort/i, (u, r) => resolverEmpaquetado(u, 'VidHide', r)],
  ['StreamWish', /streamwish|swdyu|wishembed|playerwish|strwish|swhoi|wishfast|sfastwish|hlswish|embedwish|awish|dwish|streamhg|hglink|habetar|mwish|kswplayer|swiftplayers|hanerix|cdnwish|flaswish|obeywish|davioad|jodwish|ghbrisk|dhcplay|iplayerhls|cybervynx|dumbalag|wishonly|asnwish|nekowish|streamhls|vibuxer|premilkyway/i, (u, r) => resolverStreamwish(u, r)]
];

function servidorDe(url) {
  const h = dominio(url);
  return SERVIDORES.find(([, patron]) => patron.test(h)) || null;
}

/* --------------------------- extracción de la página --------------------------- */

function audioDe(t) {
  const s = normalizar(t);
  if (!s) return '';
  if (/latino|\blat\b|latam|mexic|\bmx\b|419/.test(s)) return 'Latino';
  if (/castellano|espana|\bcast\b|\besp\b/.test(s)) return 'Castellano';
  if (/subtitulad|\bvose\b|\bsub\b|\bsubs\b|\bvo\b|japones|ingles|english|original/.test(s)) return 'Subtitulado';
  if (/espanol|spanish/.test(s)) return 'Español';
  return '';
}

// Saca URLs de un fragmento HTML: iframes, data-*, video[n] = '...', url="..." y base64 (?data=...)
function urlsDeFragmento(frag, base) {
  const salida = [];
  const meter = (u) => {
    let v = entidades(String(u || '').trim().replace(/\\\//g, '/'));
    if (!v) return;
    if (/^[A-Za-z0-9+/=_-]{20,}$/.test(v)) {
      const d = atobSeguro(v);
      if (/^https?:\/\//i.test(d)) v = d;
    }
    v = absoluta(v, base);
    if (/^https?:\/\//i.test(v) && !/\.(?:jpg|jpeg|png|gif|webp|svg|css|js|ico)(\?|$)/i.test(v)) salida.push(v);
  };
  let m;
  const iframes = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  while ((m = iframes.exec(frag))) meter(m[1]);
  const attrs = /\bdata-(?:url|video|src|link|embed|server)=["']([^"']+)["']/gi;
  while ((m = attrs.exec(frag))) meter(m[1]);
  const spans = /<[a-z]+[^>]*\burl=["']([^"']+)["']/gi;
  while ((m = spans.exec(frag))) meter(m[1]);
  const asig = /video\[\d+\]\s*=\s*(['"])([\s\S]*?)\1\s*;/g;
  while ((m = asig.exec(frag))) {
    const dentro = m[2].match(/src=["']([^"']+)["']/i);
    meter(dentro ? dentro[1] : m[2]);
  }
  const dataParam = /[?&]data=([A-Za-z0-9+/=_-]{20,})/g;
  while ((m = dataParam.exec(frag))) {
    const d = atobSeguro(m[1]);
    const u = d.match(/https?:\/\/[^\s"'<>\\]+/);
    if (u) meter(u[0]);
  }
  return salida;
}

function bloquesPorIdioma(html) {
  const mapa = {};
  const pest = /<a[^>]+href=["']#([\w-]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = pest.exec(html))) {
    const audio = audioDe(limpiarHtml(m[2]));
    if (audio) mapa[m[1]] = audio;
  }
  const posiciones = Object.keys(mapa)
    .map((id) => ({ id, i: html.search(new RegExp(`id=["']${id}["']`)) }))
    .filter((p) => p.i >= 0)
    .sort((a, b) => a.i - b.i);
  return posiciones.map((p, k) => ({ audio: mapa[p.id], frag: html.slice(p.i, k + 1 < posiciones.length ? posiciones[k + 1].i : html.length) }));
}

async function desenvolver(url, base, pagina) {
  if (servidorDe(url)) return [url];
  if (dominio(url) !== dominio(base) && !/pelisplus|fembed|player/i.test(dominio(url))) return [];
  const r = await pedir(url, { headers: { Referer: pagina }, redirect: 'follow' });
  if (!r) return [];
  if (r.url && servidorDe(r.url)) return [r.url];
  let html = '';
  try {
    html = await conLimite(r.text(), 10000, '');
  } catch (e) {}
  const directo = (html.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) || [])[1];
  const candidatos = urlsDeFragmento(html, url);
  if (directo) candidatos.unshift(absoluta(directo, url));
  return candidatos.filter((u) => servidorDe(u));
}

async function enlacesPagina(html, base, pagina) {
  const items = [];
  const vistos = new Set();
  const agregar = (url, audio) => {
    if (!url || vistos.has(url)) return;
    vistos.add(url);
    items.push({ url, audio, referer: pagina });
  };
  for (const b of bloquesPorIdioma(html)) for (const u of urlsDeFragmento(b.frag, pagina)) agregar(u, b.audio);
  const general = audioDe((html.match(/Español Latino|Latino|Castellano/i) || [''])[0]);
  for (const u of urlsDeFragmento(html, pagina)) agregar(u, general);
  const resueltos = await Promise.all(items.map(async (it) => {
    const reales = await desenvolver(it.url, base, pagina);
    if (!reales.length) trace(`ignorado: ${dominio(it.url)}`);
    return reales.map((u) => ({ url: u, audio: it.audio, referer: pagina }));
  }));
  const finales = [];
  const unicos = new Set();
  for (const it of [].concat(...resueltos)) {
    if (unicos.has(it.url)) continue;
    unicos.add(it.url);
    finales.push(it);
  }
  return finales;
}

/* ------------------------------ búsqueda / TMDB ------------------------------ */

const RELLENO = new Set(['ver', 'online', 'gratis', 'latino', 'castellano', 'subtitulado', 'espanol', 'audio', 'hd', 'full', 'completa', 'pelicula', 'serie']);
const VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);

function limpiarTitulo(t) {
  const n = normalizar(String(t || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
  return n.split(' ').filter((p) => !RELLENO.has(p)).join(' ') || n;
}

function parecido(a, b) {
  const x = limpiarTitulo(a);
  const y = limpiarTitulo(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  const contiene = ` ${largo} `.includes(` ${corto} `) ? 0.6 + (0.4 * corto.length) / largo.length : 0;
  const px = new Set(x.split(' ').filter((p) => !VACIAS.has(p)));
  const py = new Set(y.split(' ').filter((p) => !VACIAS.has(p)));
  let comunes = 0;
  for (const p of px) if (py.has(p)) comunes++;
  const palabras = px.size && py.size ? comunes / Math.max(px.size, py.size) : 0;
  return Math.max(contiene, palabras);
}

async function datosTmdb(tmdbId, tipo) {
  let id = String(tmdbId || '').trim();
  if (/^tt\d+$/.test(id)) {
    const f = await json(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`);
    const r = f && (tipo === 'movie' ? f.movie_results : f.tv_results);
    if (!r || !r[0]) return null;
    id = String(r[0].id);
  }
  const ruta = `https://api.themoviedb.org/3/${tipo}/${id}?api_key=${TMDB_KEY}`;
  const [es, en] = await Promise.all([json(`${ruta}&language=es-MX&append_to_response=external_ids`), json(`${ruta}&language=en-US`)]);
  if (!es && !en) return null;
  const a = es || {};
  const b = en || {};
  return {
    imdb: (/^tt\d+$/.test(String(tmdbId)) ? String(tmdbId) : '') || (a.external_ids && a.external_ids.imdb_id) || a.imdb_id || b.imdb_id || '',
    titulo: a.title || a.name || b.title || b.name || '',
    ingles: b.title || b.name || '',
    original: a.original_title || a.original_name || b.original_title || b.original_name || '',
    anio: String(a.release_date || a.first_air_date || b.release_date || b.first_air_date || '').slice(0, 4)
  };
}

function titulosPosibles(d) {
  const vistos = new Set();
  return [d.titulo, d.ingles, d.original].filter((t) => {
    const n = normalizar(t);
    if (!n || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

function candidatosBusqueda(html, base) {
  const salida = [];
  const vistos = new Set();
  const patron = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = patron.exec(html))) {
    const href = (m[1].match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const url = absoluta(href, base);
    if (dominio(url) !== dominio(base)) continue;
    const ruta = url.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    const partes = ruta.split('/').filter(Boolean);
    if (partes.length < 2 || /\/(temporada|capitulo|episodio|genero|categoria|page|search)\//.test(`${ruta}/`)) continue;
    if (vistos.has(ruta)) continue;
    vistos.add(ruta);
    const textos = [
      (m[1].match(/\btitle=["']([^"']+)["']/i) || [])[1],
      (m[2].match(/\balt=["']([^"']+)["']/i) || [])[1],
      (m[2].match(/<(?:h\d|p|span|strong)\b[^>]*>([\s\S]*?)<\/(?:h\d|p|span|strong)>/i) || [])[1],
      limpiarHtml(m[2]),
      partes[partes.length - 1].replace(/-/g, ' ')
    ].filter(Boolean).map((x) => limpiarHtml(x)).filter((x) => x && x.length < 120);
    salida.push({ url, ruta, esPelicula: /\/pelicula\//i.test(ruta), textos });
  }
  return salida;
}

async function buscar(base, titulos, tipo) {
  let mejor = null;
  let puntos = 0;
  for (const titulo of titulos) {
    const html = await texto(`${base}/search?s=${encodeURIComponent(titulo)}`);
    const todos = candidatosBusqueda(html, base);
    const lista = todos.filter((c) => (tipo === 'movie') === c.esPelicula);
    trace(`busqueda "${titulo.slice(0, 22)}": ${html.length}B, ${todos.length} enlaces, ${lista.length} del tipo`);
    if (!todos.length && html.length > 2000) {
      const prefijos = {};
      (html.match(/href=["'](?:https?:\/\/[^/"']+)?\/[^"'/?#]*/gi) || []).forEach((h) => {
        const k = h.replace(/^href=["'](?:https?:\/\/[^/"']+)?/i, '');
        prefijos[k] = (prefijos[k] || 0) + 1;
      });
      trace(`rutas: ${Object.keys(prefijos).sort((a, b) => prefijos[b] - prefijos[a]).slice(0, 6).map((k) => `${k}(${prefijos[k]})`).join(' ')}`);
    }
    for (const c of lista) {
      let s = 0;
      for (const x of c.textos) for (const tt of titulos) s = Math.max(s, parecido(x, tt));
      if (s > puntos) {
        puntos = s;
        mejor = c;
      }
    }
    if (mejor && puntos >= 0.8) break;
  }
  if (mejor) trace(`mejor: ${mejor.ruta.slice(0, 45)} (${puntos.toFixed(2)})`);
  return mejor && puntos >= 0.8 ? mejor.url : null;
}

/* ------------------------- respaldo: /vidurl/<imdb> (dataLink cifrado) ------------------------- */

const SHA_K = Int32Array.from([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const SHA_M = new Int32Array(64);

function sha256Palabras(txt) {
  const largo = txt.length;
  const bloques = ((largo + 9 + 63) >> 6) << 4;
  const w = new Int32Array(bloques);
  for (let i = 0; i < largo; i++) w[i >> 2] |= (txt.charCodeAt(i) & 255) << (24 - (i & 3) * 8);
  w[largo >> 2] |= 0x80 << (24 - (largo & 3) * 8);
  w[bloques - 1] = largo * 8;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const m = SHA_M;
  for (let b = 0; b < bloques; b += 16) {
    for (let i = 0; i < 16; i++) m[i] = w[b + i] | 0;
    for (let i = 16; i < 64; i++) {
      const x = m[i - 15];
      const y = m[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      m[i] = (m[i - 16] + s0 + m[i - 7] + s1) | 0;
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA_K[i] + m[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7];
}

function nonceTrabajo(reto, dificultad) {
  for (let n = 0; n < 20000000; n++) {
    const p = sha256Palabras(reto + n);
    let ok = true;
    for (let i = 0; i < dificultad && ok; i++) {
      if (((p[i >> 3] >>> (28 - (i & 7) * 4)) & 15) !== 0) ok = false;
    }
    if (ok) return n;
  }
  return -1;
}

const AUDIO_COD = { LAT: 'Latino', ESP: 'Castellano', CAS: 'Castellano', SUB: 'Subtitulado', '0': 'Latino', '1': 'Castellano', '2': 'Subtitulado' };

function leerDataLink(html) {
  const bloque = html.match(/(?:let|var)\s+dataLink\s*=\s*(\[[\s\S]*?\]);/);
  if (!bloque) return { error: 'sin dataLink', lista: [] };
  let grupos = [];
  try {
    grupos = JSON.parse(bloque[1]);
  } catch (e) {
    return { error: 'dataLink ilegible', lista: [] };
  }
  const reto = (html.match(/POW_CHALLENGE\s*=\s*'([^']+)'/) || [])[1];
  const sal = (html.match(/POW_SALT\s*=\s*'([^']+)'/) || [])[1];
  const dificultad = parseInt((html.match(/POW_DIFFICULTY\s*=\s*(\d+)/) || [])[1], 10);
  let clave = null;
  if (reto && sal && dificultad) {
    if (!CryptoJS) return { error: 'falta crypto-js', lista: [] };
    const n = nonceTrabajo(reto, dificultad);
    if (n < 0) return { error: 'POW sin solucion', lista: [] };
    clave = CryptoJS.SHA256(reto + n + sal);
  }
  const lista = [];
  for (const g of grupos) {
    const audio = AUDIO_COD[String(g.video_language).toUpperCase()] || '';
    for (const e of g.sortedEmbeds || []) {
      if (!e.link || e.servername === 'download') continue;
      let destino = e.link;
      if (clave) {
        try {
          const crudo = CryptoJS.enc.Base64.parse(e.link);
          const vector = CryptoJS.lib.WordArray.create(crudo.words.slice(0, 4), 16);
          const cuerpo = CryptoJS.lib.WordArray.create(crudo.words.slice(4), crudo.sigBytes - 16);
          destino = CryptoJS.AES.decrypt({ ciphertext: cuerpo }, clave, { iv: vector, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8);
        } catch (err) {
          destino = '';
        }
      }
      if (/^https?:\/\//.test(destino)) lista.push({ url: destino, audio });
    }
  }
  return { error: '', lista };
}

function urlVidurl(base, imdb, tipo, temporada, episodio) {
  const ruta = tipo === 'movie' ? `${imdb}/` : `${imdb}-${temporada}x${String(episodio).padStart(2, '0')}/`;
  return `${base}/vidurl/${ruta}`;
}

async function viaVidurl(base, imdb, tipo, temporada, episodio) {
  if (!imdb) {
    trace('vidurl: sin IMDb');
    return [];
  }
  const html = await texto(urlVidurl(base, imdb, tipo, temporada, episodio), { headers: { Referer: `${base}/` } });
  if (!html) {
    trace(`vidurl ${dominio(base)}: sin respuesta/404`);
    return [];
  }
  const r = leerDataLink(html);
  trace(`vidurl ${dominio(base)}: ${r.error || `${r.lista.length} embeds`}`);
  return r.lista.filter((x) => {
    if (servidorDe(x.url)) return true;
    trace(`ignorado: ${dominio(x.url)}`);
    return false;
  }).map((x) => ({ url: x.url, audio: x.audio, referer: `${base}/` }));
}

/* ------------------------------ tarjetas Nuvio ------------------------------ */

function esHls(url) {
  const u = String(url || '');
  if (/\.mp4(\?|#|$)/i.test(u)) return false;
  return /\.m3u8|\.txt(\?|#|$)|urlset|\/hls|master|playlist|\/stream\//i.test(u);
}

function pesoCalidad(c) {
  if (/4k/i.test(c)) return 2160;
  return Number((String(c || '').match(/(\d{3,4})p/i) || [])[1]) || 0;
}

function pesoAudio(a) {
  return { Latino: 3, 'Español': 2, Castellano: 1 }[a] || 0;
}

function banderaAudio(a) {
  if (a === 'Latino') return '\uD83C\uDDF2\uD83C\uDDFD LATINO';
  if (a === 'Castellano') return '\uD83C\uDDEA\uD83C\uDDF8 CASTELLANO';
  if (a === 'Subtitulado') return '\uD83C\uDDEF\uD83C\uDDF5 SUBTITULADO';
  return a ? a.toUpperCase() : '';
}

function tarjeta(info, s) {
  const formato = s.type === 'hls' ? 'HLS' : 'MP4';
  const t = {
    name: FUENTE,
    title: '',
    url: s.url,
    quality: [
      `\uD83D\uDCFA ${s.servidor} (${formato})${s.sano === false ? ' \u26A0' : ''}`,
      `${s.calidad || 'HD'} | WEB-DL`,
      banderaAudio(s.audio),
      `\uD83D\uDD17 ${info.etiqueta}${info.pagina ? ` \u00B7 ${info.pagina}` : ''}`
    ].filter(Boolean).join('\n'),
    headers: s.headers || {}
  };
  if (s.type) t.type = s.type;
  return t;
}

// Revisa lista -> variante -> primer segmento. Marca s.sano y s.disfrazado.
// Confirmado en pruebas: los CDN cuyos segmentos llegan como image/png (tiktokcdn) NO reproducen en Nuvio.
// Corre siempre (no solo con DEBUG) para poder descartarlos.
async function sondaHls(s, etiqueta) {
  if (s.type !== 'hls' || restante() < 6000) return;
  const nombre = `${etiqueta}${s.tag ? ` ${s.tag}` : ''}`;
  const h = s.headers || {};
  const m = await pedir(s.url, { headers: h, limite: 6000 });
  if (!m || !m.ok) {
    s.sano = false;
    trace(`${nombre} lista: ${m ? `HTTP ${m.status}` : 'sin respuesta'}`);
    return;
  }
  const maestro = (await conLimite(m.text(), 8000, '')) || '';
  if (!/#EXTM3U/.test(maestro)) {
    s.sano = false;
    trace(`${nombre} no es m3u8: ${maestro.slice(0, 40)}`);
    return;
  }
  if (!s.calidad) {
    let alto = 0;
    maestro.replace(/RESOLUTION=\d+x(\d+)/gi, (_, h) => {
      alto = Math.max(alto, parseInt(h, 10));
      return '';
    });
    s.calidad = etiquetaAltura(alto);
  }
  let lista = maestro;
  let urlLista = m.url || s.url;
  if (/#EXT-X-STREAM-INF/.test(maestro)) {
    const hijo = maestro.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
    urlLista = absoluta(hijo.trim(), urlLista);
    const r2 = await pedir(urlLista, { headers: h, limite: 6000 });
    if (!r2 || !r2.ok) {
      s.sano = false;
      trace(`${nombre} variante: ${r2 ? `HTTP ${r2.status}` : 'sin respuesta'}`);
      return;
    }
    lista = (await conLimite(r2.text(), 8000, '')) || '';
    urlLista = r2.url || urlLista;
  }
  const segs = lista.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  let dur = 0;
  lista.replace(/#EXTINF:([\d.]+)/g, (_, d) => {
    dur += parseFloat(d);
    return '';
  });
  if (!segs.length) {
    s.sano = false;
    trace(`${nombre} variante sin segmentos`);
    return;
  }
  const seg = absoluta(segs[0].trim(), urlLista);
  const r3 = await pedir(seg, { headers: Object.assign({}, h, { Range: 'bytes=0-2047' }), limite: 6000 });
  const ct = String((r3 && r3.headers && r3.headers.get('content-type')) || '');
  s.disfrazado = /image\//i.test(ct);
  s.sano = !!(r3 && r3.status < 400 && !s.disfrazado);
  trace(`${nombre}: ${segs.length} seg, ${Math.round(dur / 60)}min, ${/#EXT-X-ENDLIST/.test(lista) ? 'VOD' : 'sin ENDLIST'}, 1er seg ${r3 ? `HTTP ${r3.status}` : 'sin respuesta'} ${ct.slice(0, 25)} @${dominio(seg)}${s.sano ? '' : ' \u26A0'}`);
}

async function armar(lista, info) {
  const resolverItem = async (item) => {
    const srv = servidorDe(item.url);
    if (!srv) return [];
    if (!ENABLED[srv[0]]) {
      trace(`omitido (desactivado): ${srv[0]}`);
      return [];
    }
    let salida = [];
    let motivo = '';
    try {
      salida = await srv[2](item.url, item.referer);
    } catch (e) {
      motivo = (e && e.message) || 'error';
    }
    if (!salida.length) {
      anotarEstado(srv[0], false, item.audio, motivo);
      trace(`${srv[0]} (${item.audio || '?'}) sin video | ${dominio(item.url)}`);
      return [];
    }
    anotarEstado(srv[0], true, item.audio);
    for (const s of salida) {
      s.servidor = srv[0];
      s.audio = item.audio;
      if (!s.type && esHls(s.url)) s.type = 'hls';
    }
    // Se revisa de uno en uno y se para en el primer CDN sano: menos peticiones a los servidores.
    const revisados = [];
    for (const s of salida) {
      await sondaHls(s, `${srv[0]}/${item.audio || '?'}`);
      revisados.push(s);
      if (s.sano) break;
    }
    for (const s of revisados) if (!s.calidad) s.calidad = calidadTexto(s.url);
    return revisados;
  };
  const resultados = await Promise.all(lista.map(async (it) => {
    const r = await conLimite(resolverItem(it), Math.max(1000, CIERRE - 6000 - (Date.now() - inicio)), null);
    if (r === null) {
      const srv = servidorDe(it.url);
      if (srv) {
        anotarEstado(srv[0], false, it.audio, 'tiempo agotado');
        trace(`${srv[0]} tiempo agotado | ${dominio(it.url)}`);
      }
      return [];
    }
    return r;
  }));
  let todos = [].concat(...resultados);
  if (todos.some((s) => !s.disfrazado)) {
    const antes = todos.length;
    todos = todos.filter((s) => !s.disfrazado);
    if (todos.length < antes) trace(`descartados ${antes - todos.length} CDN con segmentos image/png`);
  }
  const ordenados = todos
    .filter((s) => s.url)
    .map((s, i) => ({ s, orden: pesoAudio(s.audio) * 100000 + (s.sano === false ? 0 : 10000) + pesoCalidad(s.calidad) - i * 0.001 }))
    .sort((a, b) => b.orden - a.orden);
  // Una sola opción por servidor + idioma + formato (la mejor); el resto de CDN se descarta.
  const usados = new Set();
  const tarjetas = [];
  for (const x of ordenados) {
    const clave = `${x.s.servidor}|${x.s.audio || ''}|${x.s.type || 'mp4'}`;
    if (usados.has(clave)) continue;
    usados.add(clave);
    tarjetas.push(tarjeta(info, x.s));
  }
  return tarjetas;
}

/* ---------------------------------- entrada ---------------------------------- */

async function getStreams(tmdbId, mediaType, season, episode) {
  TRACE = [];
  ESTADO = {};
  let titulo = '';
  try {
    inicio = Date.now();
    caidos.clear();
    trace(`${FUENTE} v${VERSION}`);
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) {
      trace('TMDB fallo');
      return DEBUG ? [entradaEstado('')] : [];
    }
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    titulo = tipo === 'tv' ? `${datos.titulo} - T${temporada} E${episodio}` : (datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo);
    trace(`TMDB: ${titulo}`);

    for (const base of BASES) {
      trace(`base ${dominio(base)}`);
      let lista = [];
      let pagina = await buscar(base, titulosPosibles(datos), tipo);
      if (pagina) {
        if (tipo === 'tv') pagina = `${pagina.replace(/\/+$/, '')}/temporada/${temporada}/capitulo/${episodio}`;
        trace(`pagina: ${pagina.replace(base, '')}`);
        const html = await texto(pagina, { headers: { Referer: `${base}/` } });
        if (html) {
          lista = await enlacesPagina(html, base, pagina);
          trace(`${lista.length} enlaces soportados (HTML ${html.length}B, ${(html.match(/<iframe/gi) || []).length} iframes)`);
        } else {
          trace('pagina sin HTML (HTTP/Cloudflare)');
        }
      } else {
        trace('sin coincidencia en la busqueda');
      }
      let mostrar = pagina || '';
      if (!lista.length) {
        lista = await viaVidurl(base, datos.imdb, tipo, temporada, episodio);
        if (lista.length && !mostrar && datos.imdb) mostrar = urlVidurl(base, datos.imdb, tipo, temporada, episodio);
      }
      if (!lista.length) continue;
      const info = { etiqueta: tipo === 'tv' ? `T${temporada}E${episodio}` : titulo, pagina: mostrar };
      const tarjetas = await armar(lista, info);
      trace(`${tarjetas.length} streams`);
      if (tarjetas.length) return DEBUG ? tarjetas.concat([entradaEstado(titulo)]) : tarjetas;
    }
    return DEBUG ? [entradaEstado(titulo)] : [];
  } catch (e) {
    trace(`error: ${e && e.message}`);
    return DEBUG ? [entradaEstado(titulo)] : [];
  }
}

module.exports = { getStreams: (...args) => conLimite(getStreams(...args), CIERRE, []).then((r) => r || []) };
