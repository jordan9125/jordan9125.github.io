(function () {
  var input = document.getElementById('q');
  var box = document.getElementById('results');
  if (!input || !box) return;
  var data = null;
  var base = (document.querySelector('link[rel="icon"]') || {}).getAttribute ? document.querySelector('link[rel="icon"]').getAttribute('href').replace(/assets\/icon\.svg$/, '') : '/';

  function load() {
    if (data) return Promise.resolve(data);
    return fetch(base + 'search.json').then(function (r) { return r.json(); }).then(function (d) { data = d; return d; });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function snippet(text, q) {
    var i = text.toLowerCase().indexOf(q);
    if (i < 0) return '';
    var start = Math.max(0, i - 30);
    var s = text.slice(start, i + q.length + 50);
    return (start > 0 ? '…' : '') + esc(s);
  }
  function render() {
    var q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    load().then(function (d) {
      if (input.value.trim().toLowerCase() !== q) return;
      var hits = [];
      d.forEach(function (p) {
        var inTitle = p.t.toLowerCase().indexOf(q) >= 0;
        var inText = !inTitle && p.x.toLowerCase().indexOf(q) >= 0;
        if (inTitle || inText) hits.push({ p: p, score: inTitle ? 0 : 1 });
      });
      hits.sort(function (a, b) { return a.score - b.score; });
      box.hidden = false;
      if (!hits.length) { box.innerHTML = '<p>찾는 글이 없어요.</p>'; return; }
      box.innerHTML = hits.slice(0, 20).map(function (h) {
        var p = h.p;
        var sub = h.score ? snippet(p.x, q) : esc(p.p || '');
        return '<a href="' + esc(p.u) + '"><strong>' + esc(p.t) + '</strong>' + (sub ? '<small>' + sub + '</small>' : '') + '</a>';
      }).join('');
    }).catch(function () { box.hidden = false; box.innerHTML = '<p>검색을 불러오지 못했어요.</p>'; });
  }
  var t;
  input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(render, 120); });
  input.addEventListener('focus', load, { once: true });
  if (location.hash === '#search') setTimeout(function () { input.focus(); }, 50);
})();
