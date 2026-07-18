/* ============================================================
   CAL — local-only calorie tracker
   All data lives in localStorage on this device.
   ============================================================ */
(() => {
  "use strict";

  const STORE_KEY = "cal.tracker.v1";
  const APP_VERSION = "1.0.0";
  const CAL_PER_KG = 7700; // ~kcal per kg of body mass

  /* ---------- State ---------- */
  const defaultState = () => ({
    settings: { baseline: 2000 },
    meals: [],       // { id, name, calories, proportion, unit }
    activities: [],  // { id, name, calories, duration }
    entries: [],     // { id, ts, date, type:'intake'|'burn', name, calories }
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        settings: { ...base.settings, ...(parsed.settings || {}) },
        meals: parsed.meals || [],
        activities: parsed.activities || [],
        entries: parsed.entries || [],
      };
    } catch (e) {
      console.error("Load failed, starting fresh", e);
      return defaultState();
    }
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const round = (n) => Math.round(n);
  const fmt = (n) => round(n).toLocaleString("en-US");
  const signed = (n) => (n > 0 ? "+" : "") + fmt(n);

  function localDate(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const todayStr = () => localDate();

  function prettyDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const today = todayStr();
    const yesterday = localDate(Date.now() - 864e5);
    if (dateStr === today) return "Today";
    if (dateStr === yesterday) return "Yesterday";
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function timeOf(ts) {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  /* ---------- Derived data ---------- */
  function entriesByDate(dateStr) {
    return state.entries.filter((e) => e.date === dateStr).sort((a, b) => b.ts - a.ts);
  }
  function sumType(list, type) {
    return list.filter((e) => e.type === type).reduce((s, e) => s + e.calories, 0);
  }
  function dayTotals(dateStr) {
    const list = entriesByDate(dateStr);
    const intake = sumType(list, "intake");
    const burn = sumType(list, "burn");
    const baseline = state.settings.baseline;
    return { intake, burn, baseline, balance: intake - burn - baseline };
  }

  /* ============================================================
     RENDER — HOME
     ============================================================ */
  function renderHome() {
    const t = dayTotals(todayStr());
    $("#home-date").textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric",
    });

    const bv = $("#balance-value");
    bv.textContent = signed(t.balance);
    bv.className = "balance-value " + (t.balance > 0 ? "pos" : t.balance < 0 ? "neg" : "zero");

    const hint = $("#balance-hint");
    if (t.balance > 0) hint.textContent = `${fmt(t.balance)} kcal surplus`;
    else if (t.balance < 0) hint.textContent = `${fmt(-t.balance)} kcal deficit`;
    else hint.textContent = "Right on target";

    $("#bd-intake").textContent = fmt(t.intake);
    $("#bd-burn").textContent = fmt(t.burn);
    $("#bd-baseline").textContent = fmt(t.baseline);

    const ul = $("#today-entries");
    const list = entriesByDate(todayStr());
    if (!list.length) {
      ul.innerHTML = `<li class="empty">No entries yet today. Tap a button above to start.</li>`;
      return;
    }
    ul.innerHTML = list.map((e) => `
      <li class="entry-row">
        <span class="entry-dot ${e.type}"></span>
        <div class="entry-main">
          <div class="entry-name">${escapeHtml(e.name)}</div>
          <div class="entry-time">${timeOf(e.ts)}</div>
        </div>
        <div class="entry-cal ${e.type}">${e.type === "burn" ? "−" : "+"}${fmt(e.calories)}</div>
        <button class="entry-del" data-del="${e.id}" aria-label="Delete">✕</button>
      </li>`).join("");
  }

  /* ============================================================
     RENDER — HISTORY
     ============================================================ */
  let currentRange = 30;
  let charts = {};

  function rangeDates() {
    // Returns ascending list of date strings covered by the current range.
    const dates = [...new Set(state.entries.map((e) => e.date))];
    let start;
    if (currentRange === 0) {
      if (!dates.length) return [todayStr()];
      start = dates.sort()[0];
    } else {
      start = localDate(Date.now() - (currentRange - 1) * 864e5);
    }
    const out = [];
    let cur = new Date(start + "T00:00:00");
    const end = new Date(todayStr() + "T00:00:00");
    while (cur <= end) {
      out.push(localDate(cur.getTime()));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  function renderHistory() {
    const dates = rangeDates();
    const series = dates.map((d) => ({ date: d, ...dayTotals(d) }));

    // Only count days that actually have entries for "days logged" + averages.
    const active = series.filter((s) => s.intake > 0 || s.burn > 0);
    const avg = active.length ? active.reduce((a, s) => a + s.balance, 0) / active.length : 0;
    const cum = active.reduce((a, s) => a + s.balance, 0);
    const weight = cum / CAL_PER_KG;

    $("#stat-avg").textContent = signed(avg);
    $("#stat-days").textContent = active.length;
    $("#stat-cum").textContent = signed(cum);
    $("#stat-weight").textContent = (weight >= 0 ? "+" : "") + weight.toFixed(2) + " kg";

    drawCharts(series);
    renderDayList(series);
  }

  function chartColors() {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      text: dark ? "#98989f" : "#8e8e93",
      grid: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)",
      green: dark ? "#30d190" : "#0b7d5a",
      red: dark ? "#ff6961" : "#d1453b",
      blue: dark ? "#5aa2e0" : "#2b6cb0",
      orange: dark ? "#e0a34a" : "#c8791f",
      dim: dark ? "#636366" : "#c7c7cc",
    };
  }

  function drawCharts(series) {
    const c = chartColors();
    const labels = series.map((s) => {
      const [, m, d] = s.date.split("-");
      return `${Number(m)}/${Number(d)}`;
    });
    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      interaction: { intersect: false, mode: "index" },
      plugins: { legend: { labels: { color: c.text, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: c.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: c.text }, grid: { color: c.grid } },
      },
    };

    Object.values(charts).forEach((ch) => ch && ch.destroy());
    charts = {};

    charts.balance = new Chart($("#chart-balance"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Net balance",
          data: series.map((s) => (s.intake || s.burn ? s.balance : null)),
          backgroundColor: series.map((s) => (s.balance > 0 ? c.red : c.green)),
          borderRadius: 4,
        }],
      },
      options: { ...baseOpts, plugins: { legend: { display: false } } },
    });

    charts.io = new Chart($("#chart-io"), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Intake", data: series.map((s) => (s.intake || s.burn ? s.intake : null)), borderColor: c.blue, backgroundColor: c.blue, tension: .3, spanGaps: true, pointRadius: 2 },
          { label: "Burnt", data: series.map((s) => (s.intake || s.burn ? s.burn : null)), borderColor: c.orange, backgroundColor: c.orange, tension: .3, spanGaps: true, pointRadius: 2 },
          { label: "Baseline", data: series.map((s) => s.baseline), borderColor: c.dim, borderDash: [6, 4], pointRadius: 0, tension: 0 },
        ],
      },
      options: baseOpts,
    });

    let running = 0;
    const cumData = series.map((s) => {
      if (s.intake || s.burn) running += s.balance;
      return running;
    });
    charts.cum = new Chart($("#chart-cum"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Cumulative net",
          data: cumData,
          borderColor: c.green,
          backgroundColor: "transparent",
          fill: false, tension: .3, pointRadius: 0, borderWidth: 2,
        }],
      },
      options: { ...baseOpts, plugins: { legend: { display: false } } },
    });
  }

  function renderDayList(series) {
    const ul = $("#day-list");
    const withData = series.filter((s) => s.intake > 0 || s.burn > 0).reverse();
    if (!withData.length) {
      ul.innerHTML = `<li class="empty">No history in this range yet.</li>`;
      return;
    }
    ul.innerHTML = withData.map((s) => `
      <li class="day-row" data-day="${s.date}">
        <div class="day-head">
          <span class="day-date">${prettyDate(s.date)}</span>
          <span class="day-bal ${s.balance > 0 ? "pos" : "neg"}">${signed(s.balance)} <span class="day-chevron">›</span></span>
        </div>
        <div class="day-sub">Intake ${fmt(s.intake)} · Burnt ${fmt(s.burn)} · Baseline ${fmt(s.baseline)}</div>
      </li>`).join("");
  }

  /* ============================================================
     RENDER — LIBRARY
     ============================================================ */
  function renderLibrary() {
    const meals = $("#saved-meals");
    if (!state.meals.length) {
      meals.innerHTML = `<li class="empty">No saved meals yet.</li>`;
    } else {
      meals.innerHTML = state.meals.map((m) => {
        const u = unitAbbr(m.unit || "amount");
        return `
        <li class="saved-row">
          <div class="saved-main">
            <div class="saved-name">${escapeHtml(m.name)}</div>
            <div class="saved-meta">${fmt(m.calories)} kcal per ${trimNum(m.proportion)} ${u} · ${trimNum(m.calories / m.proportion)}/${u}</div>
          </div>
          <div class="saved-actions">
            <button class="icon-btn" data-edit-meal="${m.id}">✏️</button>
            <button class="icon-btn" data-del-meal="${m.id}">🗑️</button>
          </div>
        </li>`;
      }).join("");
    }

    const acts = $("#saved-activities");
    if (!state.activities.length) {
      acts.innerHTML = `<li class="empty">No saved activities yet.</li>`;
    } else {
      acts.innerHTML = state.activities.map((a) => `
        <li class="saved-row">
          <div class="saved-main">
            <div class="saved-name">${escapeHtml(a.name)}</div>
            <div class="saved-meta">${fmt(a.calories)} kcal per ${trimNum(a.duration)} min · ${trimNum(a.calories / a.duration)}/min</div>
          </div>
          <div class="saved-actions">
            <button class="icon-btn" data-edit-act="${a.id}">✏️</button>
            <button class="icon-btn" data-del-act="${a.id}">🗑️</button>
          </div>
        </li>`).join("");
    }
  }

  const trimNum = (n) => {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? r.toString() : r.toString();
  };

  /* ---------- Meal units ---------- */
  const UNIT_LABELS = { g: "g", kg: "kg", dl: "dl", l: "l", amount: "pcs", proportion: "×" };
  const UNIT_OPTIONS = [
    { value: "amount", label: "Amount (pcs)" },
    { value: "g", label: "Grams (g)" },
    { value: "kg", label: "Kilograms (kg)" },
    { value: "dl", label: "Deciliters (dl)" },
    { value: "l", label: "Liters (l)" },
    { value: "proportion", label: "Proportion (×)" },
  ];
  const unitAbbr = (u) => UNIT_LABELS[u] || "pcs";
  const unitSelect = (id, selected) => {
    selected = selected || "amount";
    return `<select id="${id}">${UNIT_OPTIONS.map((o) => `<option value="${o.value}"${o.value === selected ? " selected" : ""}>${o.label}</option>`).join("")}</select>`;
  };

  /* ============================================================
     RENDER — SETTINGS
     ============================================================ */
  function renderSettings() {
    $("#baseline-input").value = state.settings.baseline;
    $("#version-tag").textContent = `CAL v${APP_VERSION} · data stored locally on this device`;
  }

  /* ---------- Fuzzy match + inline autocomplete ---------- */
  function matchScore(name, query) {
    const n = name.toLowerCase();
    if (n === query) return 100;
    if (n.startsWith(query)) return 80;
    if (n.includes(query)) return 60;
    let qi = 0;
    for (let i = 0; i < n.length && qi < query.length; i++) {
      if (n[i] === query[qi]) qi++;
    }
    return qi === query.length ? 30 : 0;
  }

  function savedMeta(item, isIntake) {
    return isIntake
      ? `${fmt(item.calories)} kcal / ${trimNum(item.proportion)} ${unitAbbr(item.unit || "amount")}`
      : `${fmt(item.calories)} kcal / ${trimNum(item.duration)} min`;
  }

  function isDuplicateName(list, name, excludeId) {
    const n = name.trim().toLowerCase();
    return list.some((i) => i.id !== excludeId && i.name.trim().toLowerCase() === n);
  }

  function attachAutocomplete(input, isIntake, getItems, onPick) {
    const box = document.createElement("div");
    box.className = "autocomplete-list hidden";
    input.insertAdjacentElement("afterend", box);

    function render() {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
      const matches = getItems()
        .map((it) => ({ it, score: matchScore(it.name, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (!matches.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
      box.innerHTML = matches.map(({ it }) => `
        <div class="autocomplete-item" data-id="${it.id}">
          <span>${escapeHtml(it.name)}</span>
          <span class="autocomplete-meta">${savedMeta(it, isIntake)}</span>
        </div>`).join("");
      box.classList.remove("hidden");
    }

    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    box.addEventListener("mousedown", (e) => {
      const row = e.target.closest("[data-id]");
      if (!row) return;
      e.preventDefault();
      const item = getItems().find((i) => i.id === row.dataset.id);
      box.classList.add("hidden");
      box.innerHTML = "";
      if (item) onPick(item);
    });
    input.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 150));
  }

  /* ============================================================
     MODALS
     ============================================================ */
  const modalRoot = $("#modal-root");

  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal"><div class="modal-grip"></div>${html}</div>`;
    modalRoot.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modalRoot.hidden = true;
    modalRoot.innerHTML = "";
    document.body.style.overflow = "";
  }
  modalRoot.addEventListener("click", (e) => {
    if (e.target === modalRoot || e.target.dataset.close !== undefined) closeModal();
  });

  /* ---------- Intake / Burn entry modal ---------- */
  function openEntryModal(kind) {
    // kind: 'intake' | 'burn'
    const isIntake = kind === "intake";
    const saved = isIntake ? state.meals : state.activities;
    const scaleLabel = isIntake ? "Amount" : "Duration (min)";
    const title = isIntake ? "Add Intake" : "Add Burn";
    const accent = isIntake ? "Intake" : "Burn";

    const savedOptions = saved.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    const firstUnit = isIntake && saved.length ? unitAbbr(saved[0].unit || "amount") : "";

    openModal(`
      <h2>${title}</h2>
      <div class="seg" id="entry-seg">
        <button data-tab="new" class="active">New</button>
        <button data-tab="saved">From saved</button>
      </div>

      <div id="tab-new">
        <div class="field">
          <label>Calories (kcal)</label>
          <input type="number" id="new-cal" inputmode="numeric" placeholder="e.g. 450" />
        </div>
        <div class="field">
          <label>Name (optional)</label>
          <input type="text" id="new-name" placeholder="${isIntake ? "e.g. Chicken salad" : "e.g. Evening run"}" />
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="save-toggle" checked />
          <label for="save-toggle">Save this ${isIntake ? "meal" : "activity"} for reuse</label>
        </div>
        <div class="field" id="save-scale-field">
          <label>${scaleLabel} this represents</label>
          <div class="row">
            <input type="number" id="new-scale" inputmode="decimal" value="1" step="any" />
            ${isIntake ? unitSelect("new-unit") : ""}
          </div>
          <p class="setting-hint">Later you can add any ${isIntake ? "amount" : "duration"} and calories scale automatically.</p>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" data-close>Cancel</button>
          <button class="btn-confirm" id="confirm-new">Add ${accent}</button>
        </div>
      </div>

      <div id="tab-saved" class="hidden">
        ${saved.length ? `
          <div class="field">
            <label>Choose ${isIntake ? "meal" : "activity"}</label>
            <select id="saved-select">${savedOptions}</select>
          </div>
          <div class="field">
            <label id="saved-scale-label">${isIntake ? `Amount (${firstUnit})` : scaleLabel}</label>
            <input type="number" id="saved-scale" inputmode="decimal" step="any" />
          </div>
          <div class="calc-preview" id="saved-preview">0 kcal</div>
          <div class="modal-actions">
            <button class="btn-cancel" data-close>Cancel</button>
            <button class="btn-confirm" id="confirm-saved">Add ${accent}</button>
          </div>
        ` : `<p class="empty">No saved ${isIntake ? "meals" : "activities"} yet. Add one from the “New” tab or the Library.</p>`}
      </div>
    `);

    // Tab switching
    $$("#entry-seg button").forEach((b) =>
      b.addEventListener("click", () => {
        $$("#entry-seg button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        $("#tab-new").classList.toggle("hidden", b.dataset.tab !== "new");
        $("#tab-saved").classList.toggle("hidden", b.dataset.tab !== "saved");
      })
    );

    // Save toggle reveals scale field
    $("#save-toggle").addEventListener("change", (e) => {
      $("#save-scale-field").classList.toggle("hidden", !e.target.checked);
    });

    // Inline autocomplete: typing a name suggests existing saved items
    attachAutocomplete($("#new-name"), isIntake, () => saved, (item) => {
      $$("#entry-seg button").forEach((x) => x.classList.remove("active"));
      $('#entry-seg [data-tab="saved"]').classList.add("active");
      $("#tab-new").classList.add("hidden");
      $("#tab-saved").classList.remove("hidden");
      const sel = $("#saved-select");
      sel.value = item.id;
      sel.dispatchEvent(new Event("change"));
    });

    // New confirm
    $("#confirm-new").addEventListener("click", () => {
      const cal = parseFloat($("#new-cal").value);
      if (!(cal > 0)) return shake($("#new-cal"));
      const name = $("#new-name").value.trim();
      const label = name || (isIntake ? "Intake" : "Burn");

      if ($("#save-toggle").checked) {
        const scale = parseFloat($("#new-scale").value);
        if (!name) return shake($("#new-name"));
        if (!(scale > 0)) return shake($("#new-scale"));
        if (isDuplicateName(saved, name, null)) {
          const kindWord = isIntake ? "meal" : "activity";
          if (!confirm(`A ${kindWord} named "${name}" is already saved. Save another copy anyway?`)) return;
        }
        if (isIntake) {
          const unit = $("#new-unit").value;
          state.meals.push({ id: uid(), name, calories: cal, proportion: scale, unit });
        } else {
          state.activities.push({ id: uid(), name, calories: cal, duration: scale });
        }
      }
      addEntry(kind, label, cal);
      closeModal();
    });

    // Saved tab live preview + confirm
    if (saved.length) {
      const sel = $("#saved-select");
      const scaleIn = $("#saved-scale");
      const preview = $("#saved-preview");
      const scaleLbl = $("#saved-scale-label");
      const baseOf = (id) => saved.find((s) => s.id === id);
      const perUnit = (item) => item.calories / (isIntake ? item.proportion : item.duration);

      const refresh = () => {
        const item = baseOf(sel.value);
        if (!item) return;
        const q = parseFloat(scaleIn.value);
        const cal = q > 0 ? round(perUnit(item) * q) : 0;
        preview.textContent = `${fmt(cal)} kcal`;
      };
      const setDefault = () => {
        const item = baseOf(sel.value);
        scaleIn.value = item ? trimNum(isIntake ? item.proportion : item.duration) : 1;
        if (isIntake && item) scaleLbl.textContent = `Amount (${unitAbbr(item.unit || "amount")})`;
        refresh();
      };
      sel.addEventListener("change", setDefault);
      scaleIn.addEventListener("input", refresh);
      setDefault();

      $("#confirm-saved").addEventListener("click", () => {
        const item = baseOf(sel.value);
        const q = parseFloat(scaleIn.value);
        if (!item || !(q > 0)) return shake(scaleIn);
        const cal = round(perUnit(item) * q);
        const unitSuffix = isIntake ? ` ${unitAbbr(item.unit || "amount")}` : " min";
        addEntry(kind, `${item.name} (${trimNum(q)}${unitSuffix})`, cal);
        closeModal();
      });
    }
  }

  /* ---------- Day detail modal (history entry breakdown) ---------- */
  function openDayDetail(dateStr) {
    const list = entriesByDate(dateStr);
    const t = dayTotals(dateStr);
    openModal(`
      <h2>${prettyDate(dateStr)}</h2>
      <div class="breakdown" style="margin-bottom:16px;">
        <div class="breakdown-item"><div class="bd-value intake">${fmt(t.intake)}</div><div class="bd-label">Intake</div></div>
        <div class="breakdown-op">−</div>
        <div class="breakdown-item"><div class="bd-value burn">${fmt(t.burn)}</div><div class="bd-label">Burnt</div></div>
        <div class="breakdown-op">−</div>
        <div class="breakdown-item"><div class="bd-value baseline">${fmt(t.baseline)}</div><div class="bd-label">Baseline</div></div>
      </div>
      <div class="day-detail-balance ${t.balance > 0 ? "pos" : "neg"}">${signed(t.balance)} kcal</div>
      <ul class="entry-list">
        ${list.length ? list.map((e) => `
          <li class="entry-row">
            <span class="entry-dot ${e.type}"></span>
            <div class="entry-main">
              <div class="entry-name">${escapeHtml(e.name)}</div>
              <div class="entry-time">${timeOf(e.ts)}</div>
            </div>
            <div class="entry-cal ${e.type}">${e.type === "burn" ? "−" : "+"}${fmt(e.calories)}</div>
            <button class="entry-del" data-del-day="${e.id}" aria-label="Delete">✕</button>
          </li>`).join("") : `<li class="empty">No entries.</li>`}
      </ul>
      <div class="modal-actions">
        <button class="btn-cancel" data-close>Close</button>
      </div>
    `);
  }

  function addEntry(type, name, calories) {
    const ts = Date.now();
    state.entries.push({ id: uid(), ts, date: localDate(ts), type, name, calories: round(calories) });
    save();
    renderHome();
  }

  /* ---------- New / edit saved item modal (from Library) ---------- */
  function openSavedModal(kind, existing) {
    const isMeal = kind === "meal";
    const scaleLabel = isMeal ? "Amount" : "Duration (min)";
    const title = existing ? `Edit ${isMeal ? "meal" : "activity"}` : `New ${isMeal ? "meal" : "activity"}`;
    const cur = existing || {};
    openModal(`
      <h2>${title}</h2>
      <div class="field">
        <label>Name</label>
        <input type="text" id="lib-name" value="${cur.name ? escapeHtml(cur.name) : ""}" placeholder="${isMeal ? "e.g. Oatmeal bowl" : "e.g. Cycling"}" />
      </div>
      <div class="field">
        <label>Calories (kcal)</label>
        <input type="number" id="lib-cal" inputmode="numeric" value="${cur.calories ?? ""}" placeholder="300" />
      </div>
      <div class="field">
        <label>${scaleLabel} this represents</label>
        <div class="row">
          <input type="number" id="lib-scale" inputmode="decimal" step="any" value="${cur ? (isMeal ? cur.proportion : cur.duration) ?? 1 : 1}" />
          ${isMeal ? unitSelect("lib-unit", cur.unit || "amount") : ""}
        </div>
      </div>
      <p class="setting-hint">“${fmt(cur.calories || 0)} kcal for this base amount.” Adding later scales from this.</p>
      <div class="modal-actions">
        <button class="btn-cancel" data-close>Cancel</button>
        <button class="btn-confirm" id="lib-save">Save</button>
      </div>
    `);

    // Inline autocomplete: typing a name that already exists jumps to editing it
    attachAutocomplete(
      $("#lib-name"),
      isMeal,
      () => (isMeal ? state.meals : state.activities).filter((i) => !existing || i.id !== existing.id),
      (item) => {
        closeModal();
        openSavedModal(kind, item);
      }
    );

    $("#lib-save").addEventListener("click", () => {
      const name = $("#lib-name").value.trim();
      const cal = parseFloat($("#lib-cal").value);
      const scale = parseFloat($("#lib-scale").value);
      if (!name) return shake($("#lib-name"));
      if (!(cal > 0)) return shake($("#lib-cal"));
      if (!(scale > 0)) return shake($("#lib-scale"));

      const list = isMeal ? state.meals : state.activities;
      if (isDuplicateName(list, name, existing ? existing.id : null)) {
        const kindWord = isMeal ? "meal" : "activity";
        if (!confirm(`A ${kindWord} named "${name}" already exists. Save as a duplicate anyway?`)) return;
      }

      if (isMeal) {
        const unit = $("#lib-unit").value;
        if (existing) Object.assign(existing, { name, calories: cal, proportion: scale, unit });
        else state.meals.push({ id: uid(), name, calories: cal, proportion: scale, unit });
      } else {
        if (existing) Object.assign(existing, { name, calories: cal, duration: scale });
        else state.activities.push({ id: uid(), name, calories: cal, duration: scale });
      }
      save();
      renderLibrary();
      closeModal();
    });
  }

  function shake(el) {
    el.focus();
    el.style.borderColor = "var(--red)";
    el.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
      { duration: 250 }
    );
  }

  /* ============================================================
     NAVIGATION
     ============================================================ */
  function switchView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${name}`).classList.add("active");
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    window.scrollTo(0, 0);
    if (name === "home") renderHome();
    if (name === "history") renderHistory();
    if (name === "library") renderLibrary();
    if (name === "settings") renderSettings();
  }

  /* ============================================================
     EVENT WIRING
     ============================================================ */
  function wire() {
    // Tab bar
    $$(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

    // Quick action buttons + library "new" buttons (delegated)
    document.addEventListener("click", (e) => {
      const opener = e.target.closest("[data-open]");
      if (opener) {
        const kind = opener.dataset.open;
        if (kind === "intake" || kind === "burn") openEntryModal(kind);
        if (kind === "new-meal") openSavedModal("meal");
        if (kind === "new-activity") openSavedModal("activity");
      }

      // Delete today's entry
      const del = e.target.closest("[data-del]");
      if (del) {
        state.entries = state.entries.filter((x) => x.id !== del.dataset.del);
        save();
        renderHome();
      }

      // Open a past day's entry breakdown
      const dayRow = e.target.closest("[data-day]");
      if (dayRow) openDayDetail(dayRow.dataset.day);

      // Delete an entry from within the day detail modal
      const delDay = e.target.closest("[data-del-day]");
      if (delDay) {
        const entry = state.entries.find((x) => x.id === delDay.dataset.delDay);
        state.entries = state.entries.filter((x) => x.id !== delDay.dataset.delDay);
        save();
        renderHistory();
        if (entry) openDayDetail(entry.date);
      }

      // Library edit/delete
      const em = e.target.closest("[data-edit-meal]");
      if (em) openSavedModal("meal", state.meals.find((m) => m.id === em.dataset.editMeal));
      const dm = e.target.closest("[data-del-meal]");
      if (dm && confirm("Delete this saved meal?")) {
        state.meals = state.meals.filter((m) => m.id !== dm.dataset.delMeal);
        save(); renderLibrary();
      }
      const ea = e.target.closest("[data-edit-act]");
      if (ea) openSavedModal("activity", state.activities.find((a) => a.id === ea.dataset.editAct));
      const da = e.target.closest("[data-del-act]");
      if (da && confirm("Delete this saved activity?")) {
        state.activities = state.activities.filter((a) => a.id !== da.dataset.delAct);
        save(); renderLibrary();
      }
    });

    // History range tabs
    $$("#range-tabs button").forEach((b) =>
      b.addEventListener("click", () => {
        $$("#range-tabs button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        currentRange = Number(b.dataset.range);
        renderHistory();
      })
    );

    // Settings — baseline
    const baseInput = $("#baseline-input");
    const commitBaseline = () => {
      let v = parseInt(baseInput.value, 10);
      if (!Number.isFinite(v) || v < 0) v = 0;
      state.settings.baseline = v;
      baseInput.value = v;
      save();
    };
    baseInput.addEventListener("change", commitBaseline);
    $("#baseline-minus").addEventListener("click", () => { baseInput.value = Math.max(0, (parseInt(baseInput.value, 10) || 0) - 50); commitBaseline(); });
    $("#baseline-plus").addEventListener("click", () => { baseInput.value = (parseInt(baseInput.value, 10) || 0) + 50; commitBaseline(); });

    // Settings — export / import / clear
    $("#export-btn").addEventListener("click", exportData);
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", importData);
    $("#clear-btn").addEventListener("click", () => {
      if (confirm("Erase ALL data (entries, saved meals, activities, settings)? This cannot be undone.")) {
        state = defaultState();
        save();
        renderHome(); renderLibrary(); renderSettings();
        alert("All data erased.");
      }
    });
  }

  /* ---------- Backup ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cal-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object" || !("entries" in data)) throw new Error("Invalid file");
        if (!confirm("This will REPLACE all current data with the backup. Continue?")) return;
        const base = defaultState();
        state = {
          settings: { ...base.settings, ...(data.settings || {}) },
          meals: data.meals || [],
          activities: data.activities || [],
          entries: data.entries || [],
        };
        save();
        renderHome(); renderLibrary(); renderSettings();
        alert("Backup restored.");
      } catch (err) {
        alert("Could not read that file: " + err.message);
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    wire();
    renderHome();
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
    // Re-render charts on color-scheme change so they stay legible.
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if ($("#view-history").classList.contains("active")) renderHistory();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
