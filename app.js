// =============================================================================
//  ⚙️  SISTEMA — NÃO EDITAR ESTE ARQUIVO
//  Todas as configurações ficam em js/config.js
// =============================================================================

// ── ESTADO GLOBAL ─────────────────────────────────────────────────────────────
let ALL_ROWS    = [];
let ESCALA_ROWS = [];
let MOT_COLORS  = {};
let selMes = new Set(), selSem = new Set(), selMot = new Set(), selVei = new Set();
let retryCount = 0, cdTimer = null, nextAt = null, firstLoad = true;

// Conjuntos de exclusão (lidos do config.js)
const SKIP     = new Set(CONFIG.SKIP);
const SKIP_KPI = new Set(CONFIG.SKIP_KPI);

// =============================================================================
//  UTILITÁRIOS
// =============================================================================

// Escapa HTML para evitar XSS
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initials(n) {
  const p = n.split(" ");
  return p.length >= 2 ? p[0][0] + p[1][0] : n.substring(0, 2);
}

// ── Tooltip ──
const tip = document.getElementById("tip");
function showTip(e, h) { tip.innerHTML = h; tip.style.display = "block"; moveTip(e); }
function moveTip(e)     { tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY - 10) + "px"; }
function hideTip()      { tip.style.display = "none"; }

// =============================================================================
//  PARSE DO CSV
// =============================================================================
function parseCSV(text) {
  const mNames = ["","JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
  const stats  = [];   // estatísticas (exclui RURAL/HEMO/etc)
  const escala = [];   // escala do dia (inclui tudo, exceto OK)

  for (const line of text.split(/\r?\n/)) {
    // Parser de CSV respeitando aspas
    const p = [];
    let cur = "", inQ = false;
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { p.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    p.push(cur.trim());
    if (p.length < 3) continue;

    const veiculo   = (p[0] || "").toUpperCase();
    const motorista = (p[1] || "").toUpperCase();
    const destino   = (p[2] || "").toUpperCase();

    // Validações básicas
    if (!motorista || motorista === "MOTORISTA" || motorista.startsWith("-")) continue;
    if (/^[0-9]{1,2}\/[0-9]{1,2}/.test(motorista)) continue;
    if (!destino   || destino === "DESTINO"    || destino.startsWith("-"))   continue;

    const isVeiOpcional = destino.includes("FERIAS") || destino.includes("RECESSO") || destino.includes("DISPONIVEL");
    if (!isVeiOpcional && (!veiculo || veiculo.startsWith("-") || veiculo === "VEICULO" || veiculo === "VEICULOS / MOTORISTAS")) continue;
    if (veiculo.startsWith("-") || veiculo === "VEICULO" || veiculo === "VEICULOS / MOTORISTAS") continue;

    const saida = (p[3] || "").trim();
    const pac   = (p[4] || "").trim();
    const obs   = (p[5] || "").trim();
    const data  = (p[6] || "").trim();
    const ok    = (p[7] || "").trim().toUpperCase();
    const mes   = (p[8] || "").toUpperCase();

    if (!data || !data.includes("/")) continue;

    let day = 1, wk = "Sem 1", mesFinal = mes || "?";
    try {
      const dp = data.split("/");
      day = parseInt(dp[0]) || 1;
      wk  = "Sem " + Math.min(5, Math.floor((day - 1) / 7) + 1);
      if (!mes || mes === "?") {
        const mn = parseInt(dp[1]) || 0;
        if (mn >= 1 && mn <= 12) mesFinal = mNames[mn];
      }
    } catch (e) {}

    const row = { v: veiculo, m: motorista, d: destino, dt: data, mes: mesFinal, day, wk,
                  ok: ok === "OK" ? "OK" : "", saida, pac, obs };

    // Escala: tudo exceto viagens já confirmadas
    if (ok !== "OK") escala.push(row);

    // Estatísticas: exclui categorias especiais, mantém histórico completo
    let skip = false;
    for (const s of SKIP) { if (destino.includes(s)) { skip = true; break; } }
    if (!skip) stats.push(row);
  }

  return { stats, escala };
}

// =============================================================================
//  FETCH — BUSCA OS DADOS DA PLANILHA
// =============================================================================
async function fetchLive() {
  const banner = document.getElementById("banner");
  banner.style.display = "flex";
  banner.innerHTML = `<span style="color:var(--accent)">⏳ Atualizando...</span> · Buscando planilha...`;

  try {
    const res = await fetch(CONFIG.CSV_URL + "&cachebust=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);

    const parsed = parseCSV(await res.text());
    if (parsed.stats.length < 3) throw new Error("Dados insuficientes — planilha publicada?");

    ALL_ROWS    = parsed.stats;
    ESCALA_ROWS = parsed.escala;
    retryCount  = 0;

    // Mantém cores existentes — só adiciona novos motoristas
    const allMots = [...new Set([...ALL_ROWS, ...ESCALA_ROWS].map(r => r.m))].sort();
    allMots.forEach((m, i) => { if (!MOT_COLORS[m]) MOT_COLORS[m] = CONFIG.COLORS[i % CONFIG.COLORS.length]; });

    if (firstLoad) {
      document.getElementById("loadingScreen").classList.add("hidden");
      document.getElementById("mainContent").style.display = "";
      firstLoad = false;
    }

    buildFilters();
    render();

    nextAt = Date.now() + CONFIG.REFRESH_MS;
    const tag = document.getElementById("statusTag");
    tag.className = "tag tag-live";
    tag.innerHTML = `<span class="live-dot"></span>AO VIVO · ${parsed.stats.length} viagens`;

    banner.innerHTML =
      `<span style="color:var(--green)">🟢 Atualizado às ${new Date().toLocaleTimeString("pt-BR")}</span>` +
      ` · <b style="color:var(--accent)">${parsed.stats.length} viagens</b>` +
      ` · próx. em <b id="cdSec">${Math.ceil(CONFIG.REFRESH_MS / 1000)}s</b>` +
      ` &nbsp;<button class="btn" onclick="fetchLive()" style="font-size:10px;padding:3px 10px">⟳ Agora</button>`;

    document.getElementById("tsLbl").textContent =
      "🔄 Dados ao vivo · atualizado às " + new Date().toLocaleTimeString("pt-BR");

    startCountdown();
    setTimeout(fetchLive, CONFIG.REFRESH_MS);

  } catch (err) {
    retryCount++;

    if (firstLoad && ALL_ROWS.length === 0) {
      document.getElementById("loadingScreen").classList.add("hidden");
      const es = document.getElementById("errorScreen");
      es.style.display = "flex";
      document.getElementById("errorMsg").textContent = err.message;
      setTimeout(fetchLive, CONFIG.RETRY_MS);
      return;
    }

    const delay = retryCount <= CONFIG.MAX_RETRY ? CONFIG.RETRY_MS : CONFIG.REFRESH_MS;
    nextAt = Date.now() + delay;

    const tag = document.getElementById("statusTag");
    tag.className = "tag tag-off";
    tag.innerHTML = "⚠️ Offline";

    banner.innerHTML =
      `<span style="color:var(--gold)">⚠️ Usando dados anteriores</span>` +
      ` · Erro: ${err.message}` +
      ` · retry em <b id="cdSec">${Math.ceil(delay / 1000)}s</b>` +
      ` &nbsp;<button class="btn" onclick="fetchLive()" style="font-size:10px;padding:3px 10px">⟳ Tentar</button>`;

    document.getElementById("tsLbl").textContent =
      "Dados anteriores · " + new Date().toLocaleTimeString("pt-BR");

    startCountdown();
    setTimeout(fetchLive, delay);
  }
}

function startCountdown() {
  if (cdTimer) clearInterval(cdTimer);
  cdTimer = setInterval(function() {
    if (!nextAt) return;
    const s  = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
    const el = document.getElementById("cdSec");
    if (el) el.textContent = s + "s";
    if (s === 0) clearInterval(cdTimer);
  }, 500);
}

// Pausa o countdown quando a aba fica em segundo plano
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "hidden") {
    if (cdTimer) clearInterval(cdTimer);
  } else if (nextAt && Date.now() > nextAt - CONFIG.REFRESH_MS / 2) {
    fetchLive();
  }
});

// =============================================================================
//  NAVEGAÇÃO — ABAS
// =============================================================================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function(b)   { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('tab'   + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

// =============================================================================
//  FILTROS
// =============================================================================
function getFiltered() {
  return ALL_ROWS.filter(function(r) {
    return (selMes.size === 0 || selMes.has(r.mes))
        && (selSem.size === 0 || selSem.has(r.wk))
        && (selMot.size === 0 || selMot.has(r.m))
        && (selVei.size === 0 || selVei.has(r.v));
  });
}

function resetFilters() {
  selMes = new Set(); selSem = new Set(); selMot = new Set(); selVei = new Set();
  buildFilters();
  render();
}

function toggleFilter(set, val, el, cls) {
  if (set.has(val)) { set.delete(val); el.className = "chip"; }
  else              { set.add(val);    el.className = "chip " + cls; }
  render();
}

function toggleMotFilter(m, el) {
  if (selMot.has(m)) {
    selMot.delete(m);
    el.style.cssText = "";
    el.className = "chip";
  } else {
    selMot.add(m);
    el.style.cssText = `border-color:${MOT_COLORS[m]};color:${MOT_COLORS[m]};background:${MOT_COLORS[m]}22`;
    el.className = "chip on";
  }
  render();
}

function buildFilters() {
  const meses = [...new Set(ALL_ROWS.map(function(r) { return r.mes; }))].sort();
  const sems  = [...new Set(ALL_ROWS.map(function(r) { return r.wk;  }))].sort();
  const mots  = [...new Set(ALL_ROWS.map(function(r) { return r.m;   }))].sort();
  const veis  = [...new Set(ALL_ROWS.map(function(r) { return r.v;   }).filter(function(v) { return v && v !== "N/D"; }))].sort();

  document.getElementById("fMes").innerHTML = meses.map(function(m) {
    return `<button class="chip${selMes.has(m) ? " on" : ""}" onclick="toggleFilter(selMes,'${m}',this,'on')">${m}</button>`;
  }).join("");

  document.getElementById("fSem").innerHTML = sems.map(function(s) {
    return `<button class="chip${selSem.has(s) ? " on-gold" : ""}" onclick="toggleFilter(selSem,'${s}',this,'on-gold')">${s}</button>`;
  }).join("");

  document.getElementById("fMot").innerHTML = mots.map(function(m) {
    const sel = selMot.has(m);
    return `<button class="chip${sel ? " on" : ""}" style="${sel ? `border-color:${MOT_COLORS[m]};color:${MOT_COLORS[m]};background:${MOT_COLORS[m]}22` : ""}" onclick="toggleMotFilter('${m}',this)">${m}</button>`;
  }).join("");

  document.getElementById("fVei").innerHTML = veis.map(function(v) {
    return `<button class="chip${selVei.has(v) ? " on-purple" : ""}" onclick="toggleFilter(selVei,'${v}',this,'on-purple')">${v}</button>`;
  }).join("");
}

// =============================================================================
//  RENDER — ESTATÍSTICAS
// =============================================================================
function render() {
  const rows = getFiltered();

  document.getElementById("fResult").innerHTML =
    `<span style="font-size:26px;font-weight:800;color:var(--accent)">${rows.length}</span>` +
    ` <span style="font-size:13px;color:var(--muted);font-family:'Barlow',sans-serif;font-weight:400">viagens</span>`;

  // Mapa por motorista
  const motMap = {};
  rows.forEach(function(r) {
    if (!motMap[r.m]) motMap[r.m] = {
      name:  r.m,
      color: MOT_COLORS[r.m] || CONFIG.COLORS[0],
      init:  initials(r.m),
      trips: 0, dests: {}, veis: {}, weeks: {}
    };
    motMap[r.m].trips++;
    motMap[r.m].dests[r.d]  = (motMap[r.m].dests[r.d]  || 0) + 1;
    motMap[r.m].veis[r.v]   = (motMap[r.m].veis[r.v]   || 0) + 1;
    motMap[r.m].weeks[r.wk] = (motMap[r.m].weeks[r.wk] || 0) + 1;
  });

  const list = Object.values(motMap).sort(function(a, b) { return b.trips - a.trips; });
  list.forEach(function(d) {
    d.topDest = Object.entries(d.dests).sort(function(a, b) { return b[1] - a[1]; })[0]?.[0] || "";
    d.topVei  = Object.entries(d.veis).sort(function(a, b)  { return b[1] - a[1]; })[0]?.[0] || "";
  });

  const total  = list.reduce(function(s, d) { return s + d.trips; }, 0);
  const avg    = list.length ? total / list.length : 0;
  const max    = list.length ? Math.max(...list.map(function(d) { return d.trips; })) : 0;
  const min    = list.length ? Math.min(...list.map(function(d) { return d.trips; })) : 0;
  const equity = list.length > 1 ? Math.max(0, Math.round(100 - ((max - min) / Math.max(avg, 1) * 40))) : 100;
  const period = [...selMes].join(", ") || "Todos os meses";

  // KPIs
  document.getElementById("eqScore").textContent  = equity;
  document.getElementById("kT").textContent        = total;
  document.getElementById("kP").textContent        = period;
  document.getElementById("kA").textContent        = Math.round(avg);
  document.getElementById("kD").textContent        = new Set(rows.map(function(r) { return r.d; })).size;
  document.getElementById("kTop").textContent      = max || "--";
  document.getElementById("kTopN").textContent     = list[0]?.name || "--";
  document.getElementById("kV").textContent        = max - min;
  document.getElementById("avgLbl").textContent    = Math.round(avg);
  document.getElementById("tblSub").textContent    = list.length + " motoristas · " + period;
  document.getElementById("destSub").textContent   = new Set(rows.map(function(r) { return r.d; })).size + " destinos";
  document.getElementById("veiSub").textContent    = new Set(rows.map(function(r) { return r.v; }).filter(function(v) { return v && v !== "N/D"; })).size + " veículos";
  document.getElementById("donutN").textContent    = total;

  const emptyRow = '<tr><td colspan="10" class="empty">Nenhuma viagem encontrada.</td></tr>';
  if (!list.length) {
    ["drvTbody","destTbody","veiTbody","logTbody"].forEach(function(id) {
      document.getElementById(id).innerHTML = emptyRow;
    });
    document.getElementById("eqGrid").innerHTML   = '<div class="empty">Sem dados.</div>';
    document.getElementById("heatWrap").innerHTML = '<div class="empty">Sem dados.</div>';
    document.getElementById("wChart").innerHTML   = "";
    return;
  }

  // ── Ranking ──
  document.getElementById("drvTbody").innerHTML = list.map(function(d, i) {
    const diff = Math.round(d.trips - avg);
    const bdg  = diff > 3
      ? `<span class="bdg bdg-g">+${diff}</span>`
      : diff < -3
        ? `<span class="bdg bdg-r">${diff}</span>`
        : `<span class="bdg bdg-y">≈ média</span>`;
    return `<tr>
      <td style="color:var(--muted);font-weight:700;font-size:10px">${i + 1}º</td>
      <td><div class="drv-info">
        <div class="av" style="background:${d.color}22;color:${d.color};border:1.5px solid ${d.color}55">${d.init}</div>
        <div><div class="drv-name">${d.name}</div><div class="drv-sub">${d.topDest}</div></div>
      </div></td>
      <td><span class="n-big" style="color:${d.color}">${d.trips}</span></td>
      <td><div class="bar-row"><div class="bar-bg"><div class="bar-fill" style="width:${(d.trips/max*100).toFixed(1)}%;background:${d.color}"></div></div>
        <span class="bar-pct">${(d.trips/total*100).toFixed(1)}%</span></div></td>
      <td style="font-size:10px;color:var(--muted)">${d.topDest || "-"}</td>
      <td style="font-size:10px;color:var(--muted)">${d.topVei  || "-"}</td>
      <td>${bdg}</td>
    </tr>`;
  }).join("");

  // ── Donut ──
  const svg  = document.getElementById("donutSvg");
  const cx = 70, cy = 70, r = 58, sw = 15, circ = 2 * Math.PI * r;
  svg.innerHTML = "";
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bg.setAttribute("cx", cx); bg.setAttribute("cy", cy); bg.setAttribute("r", r);
  bg.setAttribute("fill", "none"); bg.setAttribute("stroke", "#1e2333"); bg.setAttribute("stroke-width", sw);
  svg.appendChild(bg);
  let off = 0;
  list.forEach(function(d) {
    const pct = d.trips / total, dash = pct * circ;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
    c.setAttribute("fill", "none"); c.setAttribute("stroke", d.color); c.setAttribute("stroke-width", sw);
    c.setAttribute("stroke-dasharray", `${Math.max(0, dash - 1)} ${circ - Math.max(0, dash - 1)}`);
    c.setAttribute("stroke-dashoffset", -off * circ);
    svg.appendChild(c);
    off += pct;
  });
  document.getElementById("donutLeg").innerHTML = list.slice(0, 8).map(function(d) {
    return `<div class="leg-item">
      <div class="leg-l"><div class="leg-dot" style="background:${d.color}"></div><span class="leg-n">${d.name.split(" ")[0]}</span></div>
      <div class="leg-r"><span class="leg-pct" style="color:${d.color}">${(d.trips/total*100).toFixed(1)}%</span><span class="leg-t">${d.trips}v</span></div>
    </div>`;
  }).join("");

  // ── Equidade individual ──
  document.getElementById("eqGrid").innerHTML = list.map(function(d) {
    const diff = Math.round(d.trips - avg);
    const cls  = diff > 3 ? "up" : diff < -3 ? "dn" : "eq";
    return `<div class="eq-card">
      <div class="eq-av" style="background:${d.color}22;color:${d.color};border:1.5px solid ${d.color}55">${d.init}</div>
      <div class="eq-trips" style="color:${d.color}">${d.trips}</div>
      <div class="eq-name">${d.name.split(" ")[0]}</div>
      <div class="eq-diff ${cls}">${diff > 0 ? "+" : ""}${diff} vs média</div>
    </div>`;
  }).join("");

  // ── Mapa de calor ──
  const dc   = {};
  rows.forEach(function(r) { dc[r.d] = (dc[r.d] || 0) + 1; });
  const topD = Object.entries(dc).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10).map(function(e) { return e[0]; });
  const maxV = Math.max(...list.flatMap(function(d) { return topD.map(function(dest) { return d.dests[dest] || 0; }); }), 1);

  let hh = `<div class="heat-hdr">${topD.map(function(d) { return `<span title="${d}">${d.substring(0, 5)}</span>`; }).join("")}</div>`;
  list.forEach(function(d) {
    hh += `<div class="heat-row"><div class="heat-lbl">${d.name.split(" ")[0]}</div>`;
    topD.forEach(function(dest) {
      const v  = d.dests[dest] || 0;
      const al = v > 0 ? Math.min(1, .2 + v / maxV * .8) : .06;
      const bg2 = v > 0 ? `background:${d.color};opacity:${al}` : "background:var(--s2);opacity:.4";
      hh += `<div class="heat-cell" style="${bg2}"
        onmouseenter="showTip(event,'<b>${d.name}</b> → ${dest}<br>${v} viagens')"
        onmouseleave="hideTip()" onmousemove="moveTip(event)">${v || ""}</div>`;
    });
    hh += "</div>";
  });
  document.getElementById("heatWrap").innerHTML = hh;

  // ── Gráfico semanal ──
  const weeks = [...new Set(rows.map(function(r) { return r.wk; }))].sort();
  const maxW  = Math.max(...list.flatMap(function(d) { return weeks.map(function(w) { return d.weeks[w] || 0; }); }), 1);
  document.getElementById("wChart").innerHTML = weeks.map(function(w) {
    const bars = list.map(function(d) {
      const v = d.weeks[w] || 0;
      return `<div class="wchart-bar" style="background:${d.color};height:${v ? (v/maxW*110).toFixed(1) : 2}px;opacity:${v ? 1 : .15}"
        onmouseenter="showTip(event,'<b>${d.name}</b><br>${w}: <b>${v}</b> viagens')"
        onmouseleave="hideTip()" onmousemove="moveTip(event)"></div>`;
    }).join("");
    return `<div class="wchart-col"><div class="wchart-group">${bars}</div><div class="wchart-lbl">${w}</div></div>`;
  }).join("");
  document.getElementById("wLeg").innerHTML = list.map(function(d) {
    return `<div class="wleg"><div class="wleg-dot" style="background:${d.color}"></div>${d.name.split(" ")[0]}</div>`;
  }).join("");

  // ── Destinos ──
  const dmap = {}, dmot = {};
  rows.forEach(function(r) {
    dmap[r.d] = (dmap[r.d] || 0) + 1;
    if (!dmot[r.d]) dmot[r.d] = new Set();
    dmot[r.d].add(r.m.split(" ")[0]);
  });
  const dsorted = Object.entries(dmap).sort(function(a, b) { return b[1] - a[1]; });
  const dmaxT   = dsorted[0]?.[1] || 1;
  const dtot    = dsorted.reduce(function(s, e) { return s + e[1]; }, 0);
  document.getElementById("destTbody").innerHTML = dsorted.map(function([d, t]) {
    return `<tr>
      <td><div class="dest-name">📍 ${d}</div><div class="dest-who">${[...dmot[d]].join(", ")}</div></td>
      <td style="font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:800;color:var(--gold)">${t}</td>
      <td><div class="bar-row"><div class="bar-bg"><div class="bar-fill" style="width:${(t/dmaxT*100).toFixed(1)}%;background:var(--gold)"></div></div>
        <span class="bar-pct">${(t/dtot*100).toFixed(1)}%</span></div></td>
      <td style="font-size:9px;color:var(--muted)">${[...dmot[d]].slice(0, 4).join(", ")}</td>
    </tr>`;
  }).join("");

  // ── Veículos ──
  const vc = {}, vm = {};
  rows.filter(function(r) { return r.v && r.v !== "N/D"; }).forEach(function(r) {
    vc[r.v] = (vc[r.v] || 0) + 1;
    if (!vm[r.v]) vm[r.v] = new Set();
    vm[r.v].add(r.m.split(" ")[0]);
  });
  const vsorted = Object.entries(vc).sort(function(a, b) { return b[1] - a[1]; });
  const vmaxT   = vsorted[0]?.[1] || 1;
  const vtot    = vsorted.reduce(function(s, e) { return s + e[1]; }, 0);
  document.getElementById("veiTbody").innerHTML = vsorted.map(function([v, t]) {
    return `<tr>
      <td><div class="dest-name">🚗 ${v}</div><div class="dest-who">${[...vm[v]].join(", ")}</div></td>
      <td style="font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:800;color:var(--purple)">${t}</td>
      <td><div class="bar-row"><div class="bar-bg"><div class="bar-fill" style="width:${(t/vmaxT*100).toFixed(1)}%;background:var(--purple)"></div></div>
        <span class="bar-pct">${(t/vtot*100).toFixed(1)}%</span></div></td>
      <td style="font-size:9px;color:var(--muted)">${[...vm[v]].slice(0, 3).join(", ")}</td>
    </tr>`;
  }).join("");

  // ── Log de viagens ──
  const lsorted = [...rows].sort(function(a, b) {
    return b.dt.split("/").reverse().join("").localeCompare(a.dt.split("/").reverse().join(""));
  });
  document.getElementById("logSub").textContent = lsorted.length + " viagens";
  document.getElementById("logTbody").innerHTML = lsorted.slice(0, 5000).map(function(r) {
    return `<tr>
      <td style="color:var(--muted)">${r.dt}</td>
      <td><span style="color:${MOT_COLORS[r.m] || '#fff'};font-weight:600">${r.m}</span></td>
      <td>📍 ${r.d}</td>
      <td style="color:var(--muted);font-size:10px">${r.v}</td>
      <td><span style="background:rgba(0,212,255,.1);color:var(--accent);border:1px solid rgba(0,212,255,.2);padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700">${r.mes}</span></td>
      <td style="color:var(--muted);font-size:10px">${r.wk}</td>
    </tr>`;
  }).join("");

  // Atualiza escala do dia junto com os dados
  renderEscala();
}

// =============================================================================
//  RENDER — ESCALA DO DIA
// =============================================================================
function renderEscala() {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const hd = ("0" + hoje.getDate()).slice(-2);
  const hm = ("0" + (hoje.getMonth() + 1)).slice(-2);
  const hy = hoje.getFullYear();
  const hojeStr = hd + "/" + hm + "/" + hy;

  // Filtra viagens a partir de hoje (sem OK — já excluído no parseCSV)
  const rows = ESCALA_ROWS.filter(function(r) {
    if (!r.dt || !r.dt.includes("/")) return false;
    const dp    = r.dt.split("/");
    if (dp.length < 3) return false;
    const rDate = new Date(parseInt(dp[2]), parseInt(dp[1]) - 1, parseInt(dp[0]));
    rDate.setHours(0, 0, 0, 0);
    return rDate >= hoje;
  });

  // KPIs — exclui categorias especiais
  const ativas = rows.filter(function(r) {
    const du = r.d.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const s of SKIP_KPI) { if (du.includes(s)) return false; }
    return true;
  });
  const totalPac = ativas.reduce(function(s, r) { return s + (parseInt(r.pac) || 0); }, 0);
  const destinos = new Set(ativas.map(function(r) { return r.d; })).size;

  document.getElementById("ekTotal").textContent   = rows.length    || "--";
  document.getElementById("ekAtivos").textContent  = ativas.length  || "--";
  document.getElementById("ekDest").textContent    = destinos        || "--";
  document.getElementById("ekPac").textContent     = totalPac        || "--";
  document.getElementById("escalaCount").textContent =
    rows.length + " viagem" + (rows.length !== 1 ? "s" : "") + " · a partir de " + hojeStr;
  document.getElementById("escalaInfo").textContent =
    "Atualizado às " + new Date().toLocaleTimeString("pt-BR");

  const tbody = document.getElementById("escalaTbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--muted)">📭 Nenhuma viagem pendente a partir de ${hojeStr}</td></tr>`;
    return;
  }

  // Ordena por data → horário de saída
  const sorted = rows.slice().sort(function(a, b) {
    const da = a.dt.split("/").reverse().join(""), db = b.dt.split("/").reverse().join("");
    if (da !== db) return da.localeCompare(db);
    return (a.saida || "99:99").localeCompare(b.saida || "99:99");
  });

  const diasSemana = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  let html2 = "", lastDt = "";

  sorted.forEach(function(r) {
    // Separador de data
    if (r.dt !== lastDt) {
      lastDt = r.dt;
      const dp      = r.dt.split("/");
      const rDate   = new Date(parseInt(dp[2]), parseInt(dp[1]) - 1, parseInt(dp[0]));
      const isHoje  = rDate.getTime() === hoje.getTime();
      const diasFut = Math.round((rDate - hoje) / 864e5);
      const sufixo  = isHoje
        ? "<span style='color:var(--green);font-weight:800'>● HOJE</span>"
        : diasFut === 1
          ? "<span style='color:var(--muted)'>· amanhã</span>"
          : "<span style='color:var(--muted)'>· em " + diasFut + " dias</span>";
      const corData = isHoje ? "var(--green)" : "var(--accent)";
      html2 += "<tr class='row-sep'><td colspan='7'><span style='color:" + corData + ";font-weight:700'>" +
               diasSemana[rDate.getDay()] + " · " + r.dt + "</span> " + sufixo + "</td></tr>";
    }

    const cor = MOT_COLORS[r.m] || "#aaa";
    const pts = r.m.split(" ");
    const ini = pts.length >= 2 ? pts[0][0] + pts[1][0] : r.m.substring(0, 2);

    // Veículo
    const vei     = r.v || "";
    const veiCell = vei
      ? `<span class="vei-badge">${vei}</span>`
      : `<span style="color:var(--muted)">—</span>`;

    // Destino com classes por tipo
    const dest = r.d || "";
    const DU   = dest.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let destCell = "";
    if      (DU.includes("FERIAS") || DU.includes("RECESSO"))     destCell = `<span class="dest-ferias">🏖️ ${esc(dest)}</span>`;
    else if (DU.includes("RURAL"))                                 destCell = `<span class="dest-rural">🌾 ${esc(dest)}</span>`;
    else if (DU.includes("HEMODIALISE") || DU.includes("HEMO"))   destCell = `<span class="dest-hemo">🏥 ${esc(dest)}</span>`;
    else if (DU.includes("MALOTE"))                                destCell = `<span class="dest-malote">📦 ${esc(dest)}</span>`;
    else if (DU.includes("DISPONIVEL"))                            destCell = `<span class="dest-disp">✅ DISPONIVEL</span>`;
    else                                                           destCell = `<b class="dest-val">${esc(dest)}</b>`;

    const saidaCell = r.saida
      ? `<span class="saida-val">${esc(r.saida)}</span>`
      : `<span style="color:var(--muted)">—</span>`;

    const pacCell = r.pac
      ? `<span class="pac-val">${esc(r.pac)}</span>`
      : `<span style="color:var(--muted)">—</span>`;

    const obsCell = r.obs ? `<span class="obs-val">${esc(r.obs)}</span>` : "";

    html2 += `<tr>
      <td><span class="escala-data">${esc(r.dt)}</span></td>
      <td><div class="mot-cell">
        <div class="mot-av" style="background:${cor}22;color:${cor};border:1.5px solid ${cor}55">${esc(ini)}</div>
        <span class="mot-nome" style="color:${cor}">${esc(r.m)}</span>
      </div></td>
      <td>${veiCell}</td>
      <td>${destCell}</td>
      <td>${saidaCell}</td>
      <td>${pacCell}</td>
      <td>${obsCell}</td>
    </tr>`;
  });

  tbody.innerHTML = html2;
}

// =============================================================================
//  INICIALIZAÇÃO
// =============================================================================
fetchLive();
