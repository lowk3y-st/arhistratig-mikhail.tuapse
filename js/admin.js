/* Панель администратора. Логин и пароль расшифровывают ключ доступа к репозиторию GitHub (admin-config.json).
   Ключ живёт только в памяти страницы и пропадает при закрытии вкладки. Правки сохраняются коммитами в репозиторий,
   GitHub Pages публикует их через 1-2 минуты. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var logoutBtn = document.getElementById('logout');
  var cfg = null, token = null;
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function b64d(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64e(u) { var s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function utf8b64(str) { return b64e(new TextEncoder().encode(str)); }
  function b64utf8(s) { return new TextDecoder().decode(b64d(s.replace(/\s/g, ''))); }
  function today() { var d = new Date(); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function field(label, node) { var l = el('label', 'adm-field'); l.appendChild(el('span', null, label)); l.appendChild(node); return l; }
  function input(val, type) { var i = el('input'); i.type = type || 'text'; i.value = val || ''; return i; }
  function area(val, rows) { var t = el('textarea'); t.value = val || ''; if (rows) t.rows = rows; return t; }
  function btn(text, cls, fn) { var b = el('button', 'adm-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function status(box, text, kind) { box.textContent = text; box.className = 'adm-note' + (kind ? ' adm-' + kind : ''); }

  /* ---------- GitHub ---------- */
  function path(p) { return (cfg.base ? cfg.base + '/' : '') + p; }
  function gh(method, p, body) {
    var url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + path(p).split('/').map(encodeURIComponent).join('/');
    if (method === 'GET') url += '?ref=' + encodeURIComponent(cfg.branch) + '&t=' + Date.now();
    return fetch(url, {
      method: method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  function keyInfo() {
    var fmt = /^(github_pat_|ghp_)/.test(token || '') ? 'формат токена верный' : 'это не токен GitHub';
    var made = cfg.created ? 'файл настроек создан ' + new Date(cfg.created).toLocaleString('ru-RU') : 'в файле настроек нет даты создания';
    return ' Что загрузила админка: ключ из ' + (token ? token.length : 0) + ' симв., ' + fmt + '; ' + made + '.';
  }
  async function fail(r, what) {
    var m = '';
    try { m = (await r.clone().json()).message || ''; } catch (e) {}
    var tail = m ? ' Ответ GitHub: ' + m : '';
    if (r.status === 401 || r.status === 403) return new Error('GitHub не принял ключ доступа (' + r.status + '). Возможно, истёк срок токена или у него нет права Contents: Read and write.' + tail + keyInfo());
    if (r.status === 404) return new Error(what + ' (ошибка 404): GitHub не нашёл репозиторий или ветку, либо у ключа нет к ним доступа.' + tail);
    return new Error(what + ' (ошибка ' + r.status + ')' + (m ? ': ' + m : ''));
  }
  async function checkAccess() {
    var api = 'https://api.github.com/repos/' + cfg.repo;
    var h = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    var r = await fetch(api, { headers: h, cache: 'no-store' });
    if (r.status === 401) throw new Error('GitHub не принял ключ доступа (401).' + keyInfo());
    if (r.status === 404) throw new Error('Репозиторий «' + cfg.repo + '» не найден, либо у ключа нет к нему доступа. Проверьте написание «владелец/название» в admin-config.json, что репозиторий выбран в «Repository access» у токена и что «Resource owner» токена совпадает с владельцем репозитория.');
    if (!r.ok) throw new Error('Не удалось проверить репозиторий (ошибка ' + r.status + ').');
    var j = await r.json();
    if (j.permissions && j.permissions.push === false) throw new Error('У ключа нет права записи в репозиторий. У токена должно стоять Contents: Read and write.');
    var b = await fetch(api + '/branches/' + cfg.branch.split('/').map(encodeURIComponent).join('/'), { headers: h, cache: 'no-store' });
    if (b.status === 404) throw new Error('В репозитории нет ветки «' + cfg.branch + '». Основная ветка этого репозитория называется «' + j.default_branch + '». Создайте admin-config.json заново с правильной веткой.');
    if (!b.ok) throw new Error('Не удалось проверить ветку «' + cfg.branch + '» (ошибка ' + b.status + ').');
  }
  async function getFile(p) {
    var r = await gh('GET', p);
    if (r.status === 404) return null;
    if (!r.ok) throw await fail(r, 'Не удалось прочитать ' + p);
    var j = await r.json();
    return { sha: j.sha, text: b64utf8(j.content || '') };
  }
  async function putRaw(p, b64, msg, tries) {
    var cur = await gh('GET', p), sha;
    if (cur.ok) sha = (await cur.json()).sha; else if (cur.status !== 404) throw await fail(cur, 'Не удалось прочитать ' + p);
    var r = await gh('PUT', p, { message: msg, content: b64, branch: cfg.branch, sha: sha });
    if ((r.status === 409 || r.status === 422) && (tries || 0) < 2) { await sleep(600); return putRaw(p, b64, msg, (tries || 0) + 1); }
    if (!r.ok) throw await fail(r, 'Не удалось сохранить ' + p);
  }
  async function delFile(p, msg) {
    var cur = await gh('GET', p);
    if (!cur.ok) return;
    var sha = (await cur.json()).sha;
    await gh('DELETE', p, { message: msg, sha: sha, branch: cfg.branch });
  }
  async function readData(name) {
    var f = await getFile('data/' + name + '.json');
    if (!f) return null;
    try { return JSON.parse(f.text); } catch (e) { return null; }
  }
  function writeData(name, obj, msg) { return putRaw('data/' + name + '.json', utf8b64(JSON.stringify(obj, null, 2) + '\n'), msg); }

  /* текущее содержимое страниц сайта (если данных ещё нет, берём то, что написано в самих страницах) */
  async function staticDoc(file) {
    var r = await fetch(file + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('Не удалось открыть ' + file);
    return new DOMParser().parseFromString(await r.text(), 'text/html');
  }
  function txt(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }

  /* ---------- вход ---------- */
  async function loadConfig() {
    try {
      var r = await fetch('admin-config.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  async function showLogin() {
    clear(app); logoutBtn.hidden = true; token = null;
    cfg = await loadConfig();
    var card = el('div', 'frame adm-card');
    if (!cfg) {
      card.appendChild(el('h2', null, 'Вход ещё не настроен'));
      var p = el('p', null, 'Нужно один раз создать файл admin-config.json. Откройте ');
      var a = el('a', null, 'страницу настройки'); a.href = 'admin-setup.html'; p.appendChild(a); p.appendChild(document.createTextNode(' и следуйте шагам.'));
      card.appendChild(p); app.appendChild(card); return;
    }
    card.appendChild(el('h2', null, 'Вход администратора'));
    var form = el('form', 'adm-form'); form.autocomplete = 'off';
    var login = input('', 'text'), pass = input('', 'password');
    login.autocomplete = 'username'; pass.autocomplete = 'current-password';
    var msg = el('p', 'adm-note');
    var go = el('button', 'adm-btn', 'Войти'); go.type = 'submit';
    form.appendChild(field('Логин', login)); form.appendChild(field('Пароль', pass)); form.appendChild(go); form.appendChild(msg);
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); go.disabled = true; status(msg, 'Проверяю…');
      try {
        var enc = new TextEncoder();
        var km = await crypto.subtle.importKey('raw', enc.encode(login.value + '\n' + pass.value), 'PBKDF2', false, ['deriveKey']);
        var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(cfg.salt), iterations: cfg.iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(cfg.iv) }, key, b64d(cfg.ct));
        var o = JSON.parse(new TextDecoder().decode(plain));
        if (o.login !== login.value) throw new Error('bad');
        token = o.token; pass.value = '';
        showApp();
      } catch (err) {
        await sleep(1200);
        status(msg, 'Неверный логин или пароль.', 'err'); go.disabled = false;
      }
    });
    card.appendChild(form); app.appendChild(card);
    login.focus();
  }
  logoutBtn.addEventListener('click', showLogin);

  /* ---------- вкладки ---------- */
  function showApp() {
    clear(app); logoutBtn.hidden = false;
    var tabs = el('div', 'adm-tabs'); tabs.setAttribute('role', 'tablist');
    var body = el('div');
    var defs = [['Новости', newsTab], ['Фотографии', photosTab], ['Воскресная школа', function (b) { return pageTab(b, 'school', 'school.html', 'Воскресная школа'); }], ['Молодёжное движение', function (b) { return pageTab(b, 'youth', 'youth.html', 'Молодёжное движение'); }]];
    var btns = defs.map(function (d, i) {
      var b = el('button', null, d[0]); b.type = 'button'; b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { select(i); });
      tabs.appendChild(b); return b;
    });
    function select(i) {
      btns.forEach(function (b, j) { b.setAttribute('aria-selected', i === j ? 'true' : 'false'); });
      clear(body); body.appendChild(el('p', 'adm-note', 'Загрузка…'));
      defs[i][1](body).catch(function (err) { clear(body); body.appendChild(el('p', 'adm-note adm-err', err.message)); });
    }
    var warn = el('p', 'adm-note'); warn.hidden = true;
    app.appendChild(warn); app.appendChild(tabs); app.appendChild(body); select(0);
    checkAccess().catch(function (err) { warn.hidden = false; status(warn, err.message, 'err'); });
  }
  var PUBLISHED = 'Сохранено. На сайте изменения появятся через 1–2 минуты (так работает GitHub Pages).';

  /* ---------- новости ---------- */
  async function newsTab(root) {
    var data = await readData('news'), items;
    if (data && Array.isArray(data.items)) items = data.items;
    else {
      var doc = await staticDoc('index.html');
      items = Array.prototype.map.call(doc.querySelectorAll('#news .news-item'), function (a) {
        var im = a.querySelector('img'), more = a.querySelector('a.more-link');
        var ps = Array.prototype.filter.call(a.querySelectorAll('.news-body > p'), function (p) { return !p.classList.contains('news-date'); }).map(txt);
        var it = { date: txt(a.querySelector('.news-date')), title: txt(a.querySelector('h3')), text: ps.join('\n\n'), photo: im ? im.getAttribute('src') : '', alt: im ? im.getAttribute('alt') : '' };
        if (more) it.link = { href: more.getAttribute('href'), text: txt(more) };
        return it;
      });
    }
    clear(root);
    var box = el('div'), list = el('div'), msg = el('p', 'adm-note');
    items.forEach(function (it) { it._file = null; });
    function render() {
      clear(list);
      items.forEach(function (it, i) {
        var c = el('div', 'adm-item');
        var date = input(it.date), title = input(it.title), text = area(it.text, 5);
        date.addEventListener('input', function () { it.date = date.value; });
        title.addEventListener('input', function () { it.title = title.value; });
        text.addEventListener('input', function () { it.text = text.value; });
        c.appendChild(field('Дата', date)); c.appendChild(field('Заголовок', title)); c.appendChild(field('Текст (абзацы разделяйте пустой строкой)', text));
        if (it.photo) { var im = el('img', 'cur'); im.src = it.photo; im.alt = ''; c.appendChild(im); }
        var file = el('input'); file.type = 'file'; file.accept = 'image/*';
        file.addEventListener('change', function () { it._file = file.files[0] || null; });
        c.appendChild(field(it.photo ? 'Заменить фото (необязательно)' : 'Фото (необязательно)', file));
        var row = el('div', 'adm-row');
        if (i > 0) row.appendChild(btn('Выше', 'line', function () { items.splice(i - 1, 0, items.splice(i, 1)[0]); render(); }));
        if (it.photo) row.appendChild(btn('Убрать фото', 'line', function () { it.photo = ''; it._file = null; render(); }));
        row.appendChild(btn('Удалить новость', 'del', function () { if (confirm('Удалить эту новость?')) { items.splice(i, 1); render(); } }));
        c.appendChild(row); list.appendChild(c);
      });
      if (!items.length) list.appendChild(el('p', 'adm-note', 'Новостей нет.'));
    }
    render();
    var add = btn('Добавить новость', 'line', function () { items.unshift({ date: today(), title: '', text: '', photo: '', alt: '' }); render(); });
    var save = btn('Сохранить новости', null, async function () {
      save.disabled = true; status(msg, 'Сохраняю…');
      try {
        for (var k = 0; k < items.length; k++) {
          if (items[k]._file) {
            var up = await uploadImage(items[k]._file, 'news', 1600, false);
            items[k].photo = up.src; items[k].alt = items[k].title; items[k]._file = null;
          }
        }
        var out = items.map(function (it) { var o = { date: it.date, title: it.title, text: it.text, photo: it.photo || '', alt: it.alt || it.title }; if (it.link) o.link = it.link; return o; });
        await writeData('news', { items: out }, 'Новости: обновление через админку');
        status(msg, PUBLISHED, 'ok'); render();
      } catch (e) { status(msg, e.message, 'err'); }
      save.disabled = false;
    });
    var top = el('div', 'adm-row'); top.appendChild(add);
    box.appendChild(top); box.appendChild(list);
    var bottom = el('div', 'adm-row'); bottom.appendChild(save); box.appendChild(bottom); box.appendChild(msg);
    root.appendChild(box);
  }

  /* ---------- фотографии ---------- */
  async function resizeImage(file, max, q) {
    var bmp = await createImageBitmap(file);
    var s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    var blob = await new Promise(function (r) { c.toBlob(r, 'image/webp', q); });
    var ext = 'webp';
    if (!blob || blob.type !== 'image/webp') { blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', q); }); ext = 'jpg'; }
    return { blob: blob, w: w, h: h, ext: ext };
  }
  var seq = 0;
  async function uploadImage(file, prefix, max, withThumb) {
    var id = prefix + '-' + Date.now().toString(36) + (seq++);
    var full = await resizeImage(file, max, 0.86);
    var src = 'img/uploads/' + id + '.' + full.ext;
    await putRaw(src, b64e(new Uint8Array(await full.blob.arrayBuffer())), 'Фото: ' + id);
    var out = { src: src, w: full.w, h: full.h };
    if (withThumb) {
      var th = await resizeImage(file, 640, 0.8);
      out.thumb = 'img/uploads/' + id + '-t.' + th.ext;
      await putRaw(out.thumb, b64e(new Uint8Array(await th.blob.arrayBuffer())), 'Фото (миниатюра): ' + id);
    }
    return out;
  }
  var ALBUMS = [['hram', 'Наш храм'], ['molodezh', 'Молодёжное движение'], ['shkola', 'Воскресная школа']];
  async function photosTab(root) {
    var data = (await readData('albums')) || {};
    ALBUMS.forEach(function (a) { if (!Array.isArray(data[a[0]])) data[a[0]] = []; });
    clear(root);
    var sel = el('select'); ALBUMS.forEach(function (a) { var o = el('option', null, a[1]); o.value = a[0]; sel.appendChild(o); });
    var grid = el('div', 'adm-thumbs'), msg = el('p', 'adm-note');
    var files = el('input'); files.type = 'file'; files.accept = 'image/*'; files.multiple = true;
    var alt = input('');
    function render() {
      clear(grid);
      var list = data[sel.value];
      list.forEach(function (p, i) {
        var t = el('div', 'adm-thumb'), im = el('img'); im.src = p.thumb || p.src; im.alt = '';
        var d = el('button', null, 'Удалить'); d.type = 'button';
        d.addEventListener('click', async function () {
          if (!confirm('Удалить это фото из альбома?')) return;
          d.disabled = true; status(msg, 'Удаляю…');
          try {
            list.splice(i, 1);
            await writeData('albums', data, 'Альбом: удаление фото');
            if (p.src) await delFile(p.src, 'Удаление фото'); if (p.thumb) await delFile(p.thumb, 'Удаление миниатюры');
            status(msg, PUBLISHED, 'ok');
          } catch (e) { status(msg, e.message, 'err'); }
          render();
        });
        t.appendChild(im); t.appendChild(d); grid.appendChild(t);
      });
      if (!list.length) grid.appendChild(el('p', 'adm-note', 'Добавленных через админку фото в этом альбоме пока нет.'));
    }
    sel.addEventListener('change', render);
    var up = btn('Загрузить фото', null, async function () {
      var chosen = Array.prototype.slice.call(files.files);
      if (!chosen.length) { status(msg, 'Выберите фотографии.', 'err'); return; }
      up.disabled = true;
      try {
        var album = sel.value;
        for (var i = 0; i < chosen.length; i++) {
          status(msg, 'Загружаю ' + (i + 1) + ' из ' + chosen.length + '…');
          var r = await uploadImage(chosen[i], album, 1800, true);
          r.alt = alt.value.trim();
          data[album].push(r);
        }
        await writeData('albums', data, 'Альбом: добавление фото');
        files.value = ''; status(msg, PUBLISHED, 'ok'); render();
      } catch (e) { status(msg, e.message, 'err'); }
      up.disabled = false;
    });
    var card = el('div', 'frame adm-card');
    card.appendChild(el('h2', null, 'Фотографии в альбомах'));
    card.appendChild(field('Альбом', sel));
    card.appendChild(el('p', 'adm-note', 'Здесь видны фото, добавленные через админку. Снимки, которые были на сайте раньше, остаются и удаляются только в коде. Фото молодёжи и школы попадают и в карусель на их страницах.'));
    card.appendChild(grid);
    card.appendChild(field('Новые фото (можно выбрать несколько)', files));
    card.appendChild(field('Подпись для читающих с экрана (необязательно)', alt));
    var row = el('div', 'adm-row'); row.appendChild(up); card.appendChild(row); card.appendChild(msg);
    root.appendChild(card); render();
  }

  /* ---------- школа и молодёжь ---------- */
  function parsePage(doc) {
    var root = doc.querySelector('.yl-text');
    var d = { intro: [], heading: '', eyebrow: '', cards: [], outro: [], info: [] };
    if (!root) return d;
    var prose = root.querySelector('.prose:not(.prose-end)');
    d.intro = prose ? Array.prototype.map.call(prose.querySelectorAll('p'), txt) : [];
    d.heading = txt(root.querySelector('.sec-head h2')); d.eyebrow = txt(root.querySelector('.sec-head .eyebrow'));
    d.cards = Array.prototype.map.call(root.querySelectorAll('.principles article'), function (a) { return { title: txt(a.querySelector('h3')), text: txt(a.querySelector('p')) }; });
    d.outro = Array.prototype.map.call(root.querySelectorAll('.prose-end p'), txt);
    var g = doc.querySelector('.youth-info');
    if (g) d.info = Array.prototype.map.call(g.querySelectorAll('article'), function (a) {
      var c = { kicker: txt(a.querySelector('.kicker')), title: txt(a.querySelector('h3')), big: txt(a.querySelector('.big-time')) };
      var p = Array.prototype.filter.call(a.querySelectorAll('p'), function (x) { return !x.classList.contains('big-time'); })[0];
      if (p) {
        var ph = p.querySelector('a'); c.phone = ph ? txt(ph) : '';
        var t = txt(p); if (c.phone) t = t.replace(c.phone, ''); c.text = t.replace(/\.\s*$/, '').trim();
      }
      return c;
    });
    return d;
  }
  async function pageTab(root, key, file, label) {
    var all = (await readData('pages')) || {};
    var d = all[key] || parsePage(await staticDoc(file));
    ['intro', 'cards', 'outro', 'info'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    clear(root);
    var msg = el('p', 'adm-note');
    var card = el('div', 'frame adm-card'); card.appendChild(el('h2', null, label));

    var intro = area(d.intro.join('\n\n'), 8), heading = input(d.heading), outro = area(d.outro.join('\n\n'), 5);
    card.appendChild(field('Основной текст (абзацы разделяйте пустой строкой)', intro));
    card.appendChild(field('Заголовок перед карточками', heading));

    var cardsBox = el('div'), infoBox = el('div');
    function renderCards() {
      clear(cardsBox);
      d.cards.forEach(function (c, i) {
        var w = el('div', 'adm-item'), t = input(c.title), x = area(c.text, 4);
        t.addEventListener('input', function () { c.title = t.value; }); x.addEventListener('input', function () { c.text = x.value; });
        w.appendChild(field('Заголовок карточки', t)); w.appendChild(field('Текст карточки', x));
        var r = el('div', 'adm-row'); r.appendChild(btn('Удалить карточку', 'del', function () { d.cards.splice(i, 1); renderCards(); })); w.appendChild(r);
        cardsBox.appendChild(w);
      });
    }
    function renderInfo() {
      clear(infoBox);
      d.info.forEach(function (c, i) {
        var w = el('div', 'adm-item');
        [['kicker', 'Надпись сверху (например, «Когда»)'], ['title', 'Заголовок'], ['big', 'Крупный текст (например, время)'], ['phone', 'Телефон (необязательно)']].forEach(function (f) {
          var inp = input(c[f[0]]); inp.addEventListener('input', function () { c[f[0]] = inp.value; }); w.appendChild(field(f[1], inp));
        });
        var tx = area(c.text, 3); tx.addEventListener('input', function () { c.text = tx.value; }); w.appendChild(field('Пояснение (текст перед телефоном)', tx));
        var r = el('div', 'adm-row'); r.appendChild(btn('Удалить блок', 'del', function () { d.info.splice(i, 1); renderInfo(); })); w.appendChild(r);
        infoBox.appendChild(w);
      });
    }
    renderCards(); renderInfo();
    card.appendChild(cardsBox);
    var r1 = el('div', 'adm-row'); r1.appendChild(btn('Добавить карточку', 'line', function () { d.cards.push({ title: '', text: '' }); renderCards(); })); card.appendChild(r1);
    card.appendChild(field('Заключительный текст', outro));
    card.appendChild(el('h3', null, 'Блоки с временем, возрастом и руководителем'));
    card.appendChild(infoBox);
    var r2 = el('div', 'adm-row'); r2.appendChild(btn('Добавить блок', 'line', function () { d.info.push({ kicker: '', title: '', big: '', text: '', phone: '' }); renderInfo(); })); card.appendChild(r2);

    var save = btn('Сохранить', null, async function () {
      save.disabled = true; status(msg, 'Сохраняю…');
      try {
        var split = function (s) { return s.split(/\n{2,}/).map(function (x) { return x.trim(); }).filter(Boolean); };
        var fresh = (await readData('pages')) || {};
        fresh[key] = { intro: split(intro.value), heading: heading.value.trim(), eyebrow: d.eyebrow || '', cards: d.cards, outro: split(outro.value), info: d.info };
        await writeData('pages', fresh, label + ': обновление через админку');
        status(msg, PUBLISHED, 'ok');
      } catch (e) { status(msg, e.message, 'err'); }
      save.disabled = false;
    });
    var r3 = el('div', 'adm-row'); r3.appendChild(save); card.appendChild(r3); card.appendChild(msg);
    root.appendChild(card);
  }

  showLogin();
})();
