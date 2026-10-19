/* Caderno — navegação: catálogo montado a partir dos módulos existentes (ids reais). Não altera fórmulas. */
(function () {
  var CN = {
    "cat-escoamento": ["Escoamento", "e", "M3 8c3 0 3-3 6-3s3 3 6 3 3-3 6-3M3 16c3 0 3-3 6-3s3 3 6 3 3-3 6-3"],
    "cat-fluidos": ["Fluidos", "f", "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"],
    "cat-equip": ["Equipamentos", "q", "M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 9h14M5 15h14"],
    "cat-tubulacao": ["Tubulação", "t", "M3 9h9a5 5 0 0 1 5 5v7M3 5v8M15 21h4"],
    "cat-operacao": ["Operação", "o", "M4 16a8 8 0 1 1 16 0M12 16l4-5"],
    "cat-util": ["Utilidades", "u", "M13 2L5 14h6l-1 8 8-12h-6z"]
  };
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab[data-target]"));
  if (!tabs.length) return;
  var M = tabs.map(function (t) {
    var s = document.querySelector('.module[data-module="' + t.dataset.target + '"]');
    var ti = s && s.querySelector(".module-title"), de = s && s.querySelector(".module-desc");
    return { id: t.dataset.target, cat: t.dataset.category, t: ti ? ti.textContent.trim() : t.dataset.target,
             d: de ? de.textContent.replace(/\s+/g, " ").trim() : "" };
  });
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var norm = function (s) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };
  var esc = function (s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var ic = function (k) { return '<svg class="ni" viewBox="0 0 24 24" aria-hidden="true"><path d="' + CN[k][2] + '"/></svg>'; };
  var logo = '<svg class="ni" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 12l4-4"/></svg>';
  var search = '<label class="nsearch"><svg class="ni" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input class="nq" type="search" placeholder="Buscar módulo, categoria ou termo…" aria-label="Buscar módulo" autocomplete="off"></label>';

  var hub = document.createElement("section");
  hub.id = "hub"; hub.setAttribute("aria-label", "Catálogo de módulos");
  hub.innerHTML = '<div class="hero"><div class="big" aria-hidden="true">' + M.length + '</div><h1>Encontre o cálculo que você precisa</h1><p>' + M.length + ' módulos de processo e hidráulica para estudo, direto no celular e offline.</p></div><div class="sbox">' + search + '</div><div class="wrap"><div class="nchips" id="nchips" role="group" aria-label="Filtrar por categoria"></div><p class="ncount" id="ncount" aria-live="polite"></p><div class="ngrid" id="ngrid"></div></div>';
  var nav = document.createElement("aside");
  nav.id = "nav"; nav.setAttribute("aria-label", "Módulos");
  nav.innerHTML = '<div class="nb">' + logo + 'Caderno</div><div><a data-hub href="#">← Todos os módulos</a> · <a href="https://projetoindustrial.github.io/">Projeto Industrial</a></div>' + search + '<h2>Categorias</h2><div id="ncn"></div><h2 id="ncs" aria-live="polite"></h2><div id="nlist"></div>';
  var bar = document.createElement("div");
  bar.className = "navbar-m";
  bar.innerHTML = '<a data-hub href="#">‹ Catálogo</a><button type="button" id="nmenu" aria-expanded="false">Módulos</button>';
  var app = document.getElementById("app");
  app.parentNode.insertBefore(hub, app); app.parentNode.insertBefore(bar, app); document.body.appendChild(nav);

  var q = "", cat = "", inHub = !(M.some(function (m) { return m.id === location.hash.slice(1); }) || /[?&]modulo=/.test(location.search));
  document.body.classList.toggle("hub-mode", inHub);

  function active() { var a = $(".tab.active"); return a ? a.dataset.target : ""; }
  function vis() {
    var k = norm(q).trim();
    return M.filter(function (m) { return (!cat || m.cat === cat) && (!k || norm(m.t + " " + m.d + " " + CN[m.cat][0]).indexOf(k) > -1); });
  }
  function render() {
    var v = vis(), cur = inHub ? "" : active(), n = v.length + " de " + M.length + " módulos";
    document.querySelectorAll(".nq").forEach(function (x) { if (x.value !== q) x.value = q; });
    var chips = [["", "Todas"]].concat(Object.keys(CN).map(function (k) { return [k, CN[k][0]]; }));
    $("#nchips").innerHTML = chips.map(function (c) { return '<button type="button" class="nchip" data-c="' + c[0] + '" aria-pressed="' + (cat === c[0]) + '">' + c[1] + "</button>"; }).join("");
    $("#ncount").textContent = n; $("#ncs").textContent = n;
    $("#ngrid").innerHTML = v.map(function (m) {
      return '<button type="button" class="ncard ncat-' + CN[m.cat][1] + '" data-id="' + m.id + '"><span class="ntile">' + ic(m.cat) + "</span><b>" + esc(m.t) + '</b><span class="nc">' + CN[m.cat][0] + "</span><p>" + esc(m.d) + "</p></button>";
    }).join("") || '<div class="nempty">Nenhum módulo encontrado. Limpe a busca ou escolha “Todas”.</div>';
    $("#ncn").innerHTML = Object.keys(CN).map(function (k) {
      return '<button type="button" class="ncn" data-c="' + (cat === k ? "" : k) + '" aria-pressed="' + (cat === k) + '">' + ic(k) + CN[k][0] + "<small>" + M.filter(function (m) { return m.cat === k; }).length + "</small></button>";
    }).join("");
    $("#nlist").innerHTML = v.map(function (m) {
      return '<button type="button" class="nmi" data-id="' + m.id + '"' + (m.id === cur ? ' aria-current="page"' : "") + ">" + esc(m.t) + "</button>";
    }).join("") || '<p style="padding:8px;color:#8FB5AB">Nenhum módulo encontrado.</p>';
  }
  function setHub(v) {
    inHub = v; document.body.classList.toggle("hub-mode", v); document.body.classList.remove("nav-open");
    $("#nmenu").setAttribute("aria-expanded", "false"); render(); window.scrollTo(0, 0);
  }
  function open(id) {
    var t = document.querySelector('.tab[data-target="' + id + '"]');
    if (!t) return;
    if (active() !== id) t.click();
    setHub(false);
    if (location.hash.slice(1) !== id) location.hash = id;
  }
  document.addEventListener("input", function (e) { if (e.target.classList.contains("nq")) { q = e.target.value; render(); } });
  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-c]"); if (c && c.closest("#hub,#nav")) { cat = c.dataset.c; render(); return; }
    var d = e.target.closest("[data-id]"); if (d && d.closest("#hub,#nav")) { open(d.dataset.id); return; }
    var h = e.target.closest("[data-hub]"); if (h) { e.preventDefault(); if (location.hash) history.pushState(null, "", location.pathname + location.search); setHub(true); return; }
    if (e.target.closest(".tab")) setTimeout(function () { if (inHub) setHub(false); else render(); }, 0);
  });
  $("#nmenu").addEventListener("click", function () {
    var o = document.body.classList.toggle("nav-open"); this.setAttribute("aria-expanded", o);
  });
  window.addEventListener("hashchange", function () {
    var id = location.hash.slice(1);
    if (M.some(function (m) { return m.id === id; })) open(id); else setHub(true);
  });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") document.body.classList.remove("nav-open"); });
  if (!inHub) { var id0 = location.hash.slice(1); if (id0 && active() !== id0) open(id0); }
  render();
})();
