(function () {
  var btn = document.querySelector('[data-share]');
  if (!btn) return;
  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1800);
  }
  btn.addEventListener('click', function () {
    var data = { title: document.title, url: location.href };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { toast('링크를 복사했어요'); }, function () { toast(location.href); });
    else toast(location.href);
  });
})();
