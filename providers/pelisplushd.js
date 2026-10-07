// PelisPlusHD (pelisplushd.bz) - plugin para Nuvio
// Servidores soportados: Voe, VidHide (y familia), StreamWish (y familia)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const FUENTE = 'PelisPlusHD';
const BASES = ['https://pelisplushd.bz', 'https://www.pelisplushd.la', 'https://ww3.pelisplus.to'];
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

const RELOJ = typeof setTimeout === 'function';
const PRESUPUESTO = RELOJ ? 42000 : 25000;
const CIERRE = RELOJ ? 50000 : 40000;
let inicio = Date.now();
const caidos = new Set();

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

async function calidadHls(url, headers) {
  if (!/m3u8|\/hls|master|playlist|\.txt/i.test(url) || restante() < 8000) return '';
  const t = await texto(url, { headers, limite: 5000 });
  let alto = 0;
  const patron = /RESOLUTION=\d+x(\d+)/gi;
  let m;
  while ((m = patron.exec(t))) alto = Math.max(alto, parseInt(m[1], 10));
  return etiquetaAltura(alto);
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
  for (let i = 0; i < 3; i++) {
    html = await texto(actual, { headers: { Referer: i === 0 && referer ? referer : actual } });
    const salto = html.length < 4000 && html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
    if (!salto) break;
    actual = absoluta(salto[1], actual);
  }
  if (!html) return [];
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
    if (video) return enlace(video, 'Voe', cab);
  }
  const directo = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (directo) return enlace(/^aHR0/.test(directo[1]) ? atobSeguro(directo[1]) : directo[1], 'Voe', cab);
  return enlace(buscarVideo(html, actual), 'Voe', cab);
}

/* ------------------------- VidHide / StreamWish (packer) ------------------------- */

async function resolverEmpaquetado(url, servidor, referer, siguiendo) {
  const propio = `${origen(url)}/`;
  for (const ref of [...new Set([referer || propio, propio])]) {
    const html = await texto(url, { headers: { Referer: ref } });
    if (!html) continue;
    const codigo = `${desempacar(html)}\n${html}`;
    const links = codigo.match(/links\s*=\s*(\{[^}]+\})/);
    let video = '';
    if (links) {
      try {
        const o = JSON.parse(links[1].replace(/'/g, '"'));
        video = o.hls4 || o.hls3 || o.hls2 || o.hls || '';
      } catch (e) {}
    }
    video = absoluta(video || buscarVideo(codigo, url), url);
    if (video) return enlace(video, servidor, { Referer: propio, Origin: origen(url), 'User-Agent': UA });
    const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (marco && !siguiendo) return resolverEmpaquetado(absoluta(marco[1], url), servidor, url, true);
  }
  return [];
}

async function resolverStreamwish(url, referer) {
  const propio = await resolverEmpaquetado(url, 'StreamWish', referer);
  if (propio.length) return propio;
  const id = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop().replace(/\.html$/, '');
  const espejos = [`https://hglink.to/e/${id}`, `https://streamwish.to/e/${id}`, `https://vibuxer.com/e/${id}`].filter((e) => dominio(e) !== dominio(url));
  const listas = await Promise.all(espejos.map((e) => resolverEmpaquetado(e, 'StreamWish', referer, true)));
  return listas.find((l) => l.length) || [];
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
  const [es, en] = await Promise.all([json(`${ruta}&language=es-MX`), json(`${ruta}&language=en-US`)]);
  if (!es && !en) return null;
  const a = es || {};
  const b = en || {};
  return {
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

async function buscar(base, titulos, tipo) {
  for (const titulo of titulos) {
    const html = await texto(`${base}/search?s=${encodeURIComponent(titulo)}`);
    let mejor = null;
    let puntos = 0;
    const patron = /<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*Posters-link[^"']*["'][\s\S]*?<p[^>]*>([\s\S]*?)<\/p>|<a[^>]+class=["'][^"']*Posters-link[^"']*["'][^>]*href=["']([^"']+)["'][\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = patron.exec(html))) {
      const href = m[1] || m[3];
      const nombre = limpiarHtml(m[2] || m[4]);
      if ((tipo === 'movie') !== /\/pelicula\//.test(href)) continue;
      const s = parecido(nombre, titulo);
      if (s > puntos) {
        puntos = s;
        mejor = absoluta(href, base);
      }
    }
    if (mejor && puntos >= 0.8) return mejor;
  }
  return null;
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

function tarjeta(titulo, s) {
  const formato = s.type === 'hls' ? 'HLS' : 'MP4';
  const t = {
    name: FUENTE,
    title: '',
    url: s.url,
    quality: [`\uD83D\uDCFA ${s.servidor} (${formato})`, `${s.calidad || 'HD'} | WEB-DL`, banderaAudio(s.audio), `\uD83D\uDD17 ${titulo}`].filter(Boolean).join('\n'),
    headers: s.headers || {}
  };
  if (s.type) t.type = s.type;
  return t;
}

async function armar(lista, titulo) {
  const resolverItem = async (item) => {
    const srv = servidorDe(item.url);
    if (!srv) return [];
    let salida = [];
    try {
      salida = await srv[2](item.url, item.referer);
    } catch (e) {
      salida = [];
    }
    for (const s of salida) {
      s.servidor = srv[0];
      s.audio = item.audio;
      if (!s.type && esHls(s.url)) s.type = 'hls';
      if (!s.calidad) s.calidad = (await calidadHls(s.url, s.headers)) || calidadTexto(s.url);
    }
    return salida;
  };
  const resultados = await Promise.all(lista.map((it) => conLimite(resolverItem(it), Math.max(1000, CIERRE - 6000 - (Date.now() - inicio)), [])));
  const vistos = new Set();
  const tarjetas = [];
  for (const s of [].concat(...resultados)) {
    if (!s.url || vistos.has(s.url)) continue;
    vistos.add(s.url);
    tarjetas.push({ orden: pesoAudio(s.audio) * 10000 + pesoCalidad(s.calidad), t: tarjeta(titulo, s) });
  }
  return tarjetas.sort((a, b) => b.orden - a.orden).map((x) => x.t);
}

/* ---------------------------------- entrada ---------------------------------- */

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    inicio = Date.now();
    caidos.clear();
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    const titulo = tipo === 'tv' ? `${datos.titulo} - T${temporada} E${episodio}` : (datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo);

    for (const base of BASES) {
      let pagina = await buscar(base, titulosPosibles(datos), tipo);
      if (!pagina) continue;
      if (tipo === 'tv') pagina = `${pagina.replace(/\/+$/, '')}/temporada/${temporada}/capitulo/${episodio}`;
      const html = await texto(pagina, { headers: { Referer: `${base}/` } });
      if (!html) continue;
      const lista = await enlacesPagina(html, base, pagina);
      if (!lista.length) continue;
      const tarjetas = await armar(lista, titulo);
      if (tarjetas.length) return tarjetas;
    }
    return [];
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: (...args) => conLimite(getStreams(...args), CIERRE, []).then((r) => r || []) };
