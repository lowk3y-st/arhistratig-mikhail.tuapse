/* Содержимое, которое меняет администратор (admin.html): новости, фото в альбомах, тексты школы и молодёжи.
   Данные лежат в папке data/ (news.json, albums.json, pages.json). Если файла нет, страница остаётся такой, как в коде.
   После отрисовки подгружается js/script.js, чтобы карусели и просмотр фото видели новые снимки. */
(function () {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function getJson(name) {
    return fetch('data/' + name + '.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  /* разрешаем только свои картинки, без внешних адресов и скриптов */
  function safeSrc(s) { return typeof s === 'string' && /^img\/[\w\-\/.]+$/.test(s) ? s : ''; }

  function renderNews(data) {
    var list = document.querySelector('#news .news-list');
    if (!list || !data || !Array.isArray(data.items)) return;
    list.textContent = '';
    data.items.forEach(function (n) {
      var art = el('article', 'frame news-item');
      var src = safeSrc(n.photo);
      if (src) {
        var fig = el('figure', 'news-photo'), a = el('a', 'photo-link'), im = el('img');
        a.href = src; im.src = src; im.loading = 'lazy'; im.decoding = 'async'; im.alt = n.alt || n.title || '';
        a.appendChild(im); fig.appendChild(a); art.appendChild(fig);
      }
      var body = el('div', 'news-body');
      if (n.date) body.appendChild(el('p', 'news-date', n.date));
      body.appendChild(el('h3', null, n.title || ''));
      String(n.text || '').split(/\n{2,}|\n/).forEach(function (p) { if (p.trim()) body.appendChild(el('p', null, p.trim())); });
      if (n.link && /^[\w\-]+\.html$/.test(n.link.href || '')) {
        var l = el('a', 'more-link', n.link.text || 'Подробнее'); l.href = n.link.href; body.appendChild(l);
      }
      art.appendChild(body);
      list.appendChild(art);
    });
    if (!data.items.length) list.appendChild(el('p', 'note', 'Новостей пока нет.'));
  }

  function figure(p) {
    var f = el('figure', 'frame photo'), a = el('a', 'photo-link'), im = el('img');
    a.href = safeSrc(p.src); im.src = safeSrc(p.thumb) || safeSrc(p.src); im.loading = 'lazy'; im.decoding = 'async'; im.alt = p.alt || '';
    a.appendChild(im); f.appendChild(a); return f;
  }
  function slide(p) {
    var a = el('a', 'slide photo-link'), im = el('img');
    a.href = safeSrc(p.src); im.src = safeSrc(p.src); im.loading = 'lazy'; im.decoding = 'async'; im.alt = p.alt || '';
    if (p.w && p.h) { im.width = p.w; im.height = p.h; }
    a.appendChild(im); return a;
  }
  function plural(n) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'фото' : 'фото'; }

  function renderAlbums(data) {
    if (!data) return;
    ['hram', 'molodezh', 'shkola'].forEach(function (id) {
      var items = (data[id] || []).filter(function (p) { return safeSrc(p.src); });
      if (!items.length) return;
      var album = document.getElementById(id);
      if (album) {
        var g = album.querySelector('.gallery, .gallery-grid');
        if (g) items.forEach(function (p) { g.appendChild(figure(p)); });
        var card = document.querySelector('.album-card[data-album="' + id + '"] small');
        if (card && g) card.textContent = g.children.length + ' ' + plural(g.children.length);
      }
    });
    /* карусели на страницах школы и молодёжи */
    var map = { 'youth': 'molodezh', 'school': 'shkola' };
    Object.keys(map).forEach(function (pg) {
      if (!document.querySelector('body[data-page="' + pg + '"]')) return;
      var items = (data[map[pg]] || []).filter(function (p) { return safeSrc(p.src); });
      var sl = document.querySelector('[data-slider] .slides');
      if (!sl || !items.length) return;
      items.forEach(function (p) { sl.appendChild(slide(p)); });
      var total = document.querySelector('[data-slider] .sl-count');
      if (total && total.lastChild) total.lastChild.textContent = ' / ' + sl.children.length;
    });
  }

  function infoCard(c) {
    var a = el('article', 'frame card');
    if (c.kicker) a.appendChild(el('span', 'kicker', c.kicker));
    if (c.title) a.appendChild(el('h3', null, c.title));
    if (c.big) a.appendChild(el('p', 'big-time', c.big));
    if (c.text || c.phone) {
      var p = el('p');
      if (c.text) p.appendChild(document.createTextNode(c.text + (c.phone ? ' ' : '')));
      if (c.phone) {
        var t = el('a', 'plain', c.phone); t.href = 'tel:+' + c.phone.replace(/\D/g, ''); p.appendChild(t);
        if (c.dot !== false) p.appendChild(document.createTextNode('.'));
      }
      a.appendChild(p);
    }
    return a;
  }
  function paragraphs(box, list) {
    (list || []).forEach(function (t) { if (String(t).trim()) box.appendChild(el('p', null, String(t).trim())); });
  }
  function renderPage(d) {
    var root = document.querySelector('.yl-text');
    if (!d || !root) return;
    var prose = root.querySelector('.prose:not(.prose-end)');
    if (prose && Array.isArray(d.intro)) { prose.textContent = ''; paragraphs(prose, d.intro); }
    var h = root.querySelector('.sec-head h2');
    if (h && d.heading) h.textContent = d.heading;
    var ey = root.querySelector('.sec-head .eyebrow');
    if (ey && d.eyebrow != null) ey.textContent = d.eyebrow;
    var cards = root.querySelector('.principles');
    if (cards && Array.isArray(d.cards)) {
      cards.textContent = '';
      d.cards.forEach(function (c) {
        var a = el('article', 'frame card'); a.appendChild(el('h3', null, c.title || '')); a.appendChild(el('p', null, c.text || ''));
        cards.appendChild(a);
      });
    }
    var end = root.querySelector('.prose-end');
    if (end && Array.isArray(d.outro)) {
      end.textContent = '';
      var o = el('div', 'orn'); o.setAttribute('aria-hidden', 'true'); o.appendChild(el('i')); end.appendChild(o);
      paragraphs(end, d.outro);
    }
    if (Array.isArray(d.info)) {
      Array.prototype.forEach.call(document.querySelectorAll('.youth-info'), function (g) {
        g.textContent = '';
        d.info.forEach(function (c) { g.appendChild(infoCard(c)); });
      });
    }
  }

  function done() {
    var s = document.createElement('script');
    s.src = 'js/script.js';
    document.body.appendChild(s);
  }

  try {
    var page = document.body.getAttribute('data-page') || '';
    var jobs = [];
    if (document.querySelector('#news .news-list')) jobs.push(getJson('news').then(renderNews));
    if (document.querySelector('.album, [data-slider]')) jobs.push(getJson('albums').then(renderAlbums));
    if ((page === 'school' || page === 'youth')) jobs.push(getJson('pages').then(function (d) { if (d) renderPage(d[page]); }));
    var timer = new Promise(function (r) { setTimeout(r, 3000); });
    Promise.race([Promise.all(jobs), timer]).then(done, done);
  } catch (e) { done(); }
})();
