/* Caderno — organiza cada .module em cabeçalho + 2 colunas (entrada | resultados). Só move nós (ids e listeners intactos). */
(function () {
  var CAT = { "cat-escoamento": "e", "cat-fluidos": "f", "cat-equip": "q", "cat-tubulacao": "t", "cat-operacao": "o", "cat-util": "u" };
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>';
  function bucket(e) {
    if (e.matches(".table-panel, .case-list")) return "wide";
    if (e.matches(".form-panel, button.btn-add, button.btn-clear, .form-panel-row")) return "in";
    return "out"; // readout, gauge, gráficos, alertas, notas
  }
  document.querySelectorAll(".module").forEach(function (m) {
    if (m.querySelector(".mod-cols")) return;
    var title = m.querySelector(":scope > .module-title"), desc = m.querySelector(":scope > .module-desc");
    if (!title) return;
    var tab = document.querySelector('.tab[data-target="' + m.dataset.module + '"]');
    var c = tab && CAT[tab.dataset.category];
    var head = document.createElement("div"); head.className = "mod-head" + (c ? " ncat-" + c : "");
    var ic = document.createElement("span"); ic.className = "mod-ic"; ic.innerHTML = ICON;
    var tx = document.createElement("div"); tx.append(title); if (desc) tx.append(desc);
    head.append(ic, tx);
    var cols = document.createElement("div"); cols.className = "mod-cols";
    var cin = document.createElement("div"); cin.className = "mod-in";
    var cout = document.createElement("div"); cout.className = "mod-out";
    var wide = document.createElement("div"); wide.className = "mod-wide";
    cols.append(cin, cout);
    var kids = Array.prototype.slice.call(m.children), pend = null;
    kids.forEach(function (e) {
      if (e === title || e === desc) return;
      if (e.matches(".subhead")) { pend = e; return; }
      var b = bucket(e), dest = b === "in" ? cin : b === "wide" ? wide : cout;
      if (pend) { dest.append(pend); pend = null; }
      dest.append(e);
    });
    if (pend) cout.append(pend);
    m.prepend(head); head.after(cols); cols.after(wide);
    if (!wide.children.length) wide.remove();
  });
})();
