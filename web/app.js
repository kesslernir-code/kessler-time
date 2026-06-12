(() => {
  const CFG = window.KESSLER_CONFIG || {};
  const $ = (s) => document.querySelector(s);

  // ---- i18n -----------------------------------------------------------
  const STR = {
    he: {
      tagline: "האירועים הקרובים מהמקומות שאנחנו אוהבים",
      freeOnly: "רק בחינם",
      search: "חיפוש…",
      all: "הכל",
      free: "חינם",
      today: "היום",
      tomorrow: "מחר",
      weekend: "סופ״ש",
      allDays: "כל הימים",
      empty: "אין אירועים שמתאימים לסינון",
      notConfigured: "האתר עוד לא מחובר למסד הנתונים.\n(צריך למלא את web/config.js)",
      error: "שגיאה בטעינת אירועים",
      status: "סטטוס סריקה",
      tickets: "כרטיסים",
      recs: "המלצות",
      addPlace: "+ הוספת מקום",
    },
    en: {
      tagline: "Upcoming events from the places we love",
      freeOnly: "Free only",
      search: "Search…",
      all: "All",
      free: "Free",
      today: "Today",
      tomorrow: "Tomorrow",
      weekend: "Weekend",
      allDays: "All days",
      empty: "No events match the filter",
      notConfigured: "Site is not connected to the database yet.\n(web/config.js needs to be filled in)",
      error: "Failed to load events",
      status: "Scrape status",
      tickets: "Tickets",
      recs: "Recommendations",
      addPlace: "+ Add place",
    },
  };
  let lang = localStorage.getItem("kt-lang") || "he";
  const t = (k) => STR[lang][k] || k;

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
    $("#langToggle").textContent = lang === "he" ? "EN" : "עב";
    document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    $("#search").placeholder = t("search");
  }

  // ---- state ----------------------------------------------------------
  let events = [];
  const configured = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  let activeSource = "all";
  let freeOnly = false;
  let query = "";
  let dateFilter = "all"; // "all" | "today" | "tomorrow" | "weekend" | "YYYY-MM-DD"
  let activeCity = "all";

  // Venue sites often block hotlinked images (and serve huge files); the wsrv.nl
  // proxy fetches them neutrally and resizes — one fix for every problematic site.
  const proxyImg = (url) =>
    `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=640&h=640&fit=cover&output=webp&q=78`;

  // Source labels load from the DB so sites added via admin.html get a chip
  // automatically. A bilingual name like "Radical רדיקל" is split per language.
  let SOURCES = {};
  function splitName(name) {
    const he = (name.match(/[֐-׿][֐-׿\s'״׳0-9]*/g) || []).join(" ").trim();
    const en = (name.match(/[A-Za-z][A-Za-z\s0-9&'.-]*/g) || []).join(" ").trim();
    return { he: he || name, en: en || name };
  }
  async function loadSources() {
    if (!configured) return;
    try {
      const res = await fetch(
        `${CFG.SUPABASE_URL}/rest/v1/sources?enabled=eq.true&select=id,name&order=added_at.asc`,
        { headers: { apikey: CFG.SUPABASE_ANON_KEY } }
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) {
        SOURCES = Object.fromEntries(rows.map((r) => [r.id, splitName(r.name)]));
        renderChips();
      }
    } catch {} // chips just stay minimal if the sources table is unreachable
  }

  // ---- data -----------------------------------------------------------
  async function load() {
    if (!configured) {
      $("#stateMsg").textContent = t("notConfigured");
      return;
    }
    const since = new Date(Date.now() - 3 * 3600e3).toISOString();
    const url =
      `${CFG.SUPABASE_URL}/rest/v1/events` +
      `?select=id,source_id,title,description,starts_at,venue,city,price_text,is_free,booking_url,event_url,image_url` +
      `&starts_at=gte.${encodeURIComponent(since)}&order=starts_at.asc&limit=600`;
    try {
      const res = await fetch(url, { headers: { apikey: CFG.SUPABASE_ANON_KEY } });
      if (!res.ok) throw new Error(res.status);
      events = await res.json();
      renderCityChips();
      render();
    } catch (e) {
      $("#stateMsg").textContent = `${t("error")} (${e.message})`;
    }
  }

  // ---- render ---------------------------------------------------------
  const dayKey = (iso) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso));

  const dayLabel = (key) => {
    const d = new Date(key + "T12:00:00+03:00");
    const base = new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem",
    }).format(d);
    const today = dayKey(new Date().toISOString());
    const tomorrow = dayKey(new Date(Date.now() + 864e5).toISOString());
    const rel = key === today ? t("today") : key === tomorrow ? t("tomorrow") : "";
    return { base, rel };
  };

  const timeOf = (iso) =>
    new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }).format(new Date(iso));

  const PALETTE = ["#7aa2ff", "#ff8f6b", "#5ad58a", "#d98cff", "#ffcf5c", "#6be0e0"];
  const hue = (s) => PALETTE[[...s].reduce((a, c) => a + c.codePointAt(0), 0) % PALETTE.length];

  function card(e) {
    const a = document.createElement("a");
    a.className = "card";
    a.href = e.booking_url || e.event_url || "#";
    a.target = "_blank";
    a.rel = "noopener";
    const img = e.image_url
      ? `<img loading="lazy" src="${proxyImg(e.image_url)}" alt="" onerror="this.parentNode.innerHTML='<div class=ph style=background:${hue(e.title)}33>${(e.title || "?")[0]}</div>'">`
      : `<div class="ph" style="background:${hue(e.title)}33">${(e.title || "?")[0]}</div>`;
    const freeBadge = e.is_free ? `<span class="badge free">${t("free")}</span>` : "";
    const price = e.is_free
      ? `<div class="price free">${t("free")}</div>`
      : e.price_text
        ? `<div class="price">${e.price_text}</div>`
        : "";
    const src = SOURCES[e.source_id]?.[lang] || e.venue || e.source_id;
    a.innerHTML = `
      <div class="img">${img}<span class="badge">${timeOf(e.starts_at)}</span>${freeBadge}</div>
      <div class="body">
        <h3></h3>
        <div class="meta"><span class="venue">${src}</span>${e.city ? `<span>${e.city}</span>` : ""}</div>
        <p class="desc"></p>
        ${price}
      </div>`;
    a.querySelector("h3").textContent = e.title;
    const desc = a.querySelector(".desc");
    if (e.description) desc.textContent = e.description;
    else desc.remove();
    return a;
  }

  // Which day-keys does the current date filter allow? (null = all)
  function allowedDays() {
    const today = dayKey(new Date().toISOString());
    const plus = (n) => dayKey(new Date(Date.now() + n * 864e5).toISOString());
    if (dateFilter === "today") return [today];
    if (dateFilter === "tomorrow") return [plus(1)];
    if (dateFilter === "weekend") {
      // upcoming Friday + Saturday (Israeli weekend)
      const days = [];
      for (let n = 0; n < 8 && days.length < 2; n++) {
        const k = plus(n);
        const wd = new Date(k + "T12:00:00+03:00").getUTCDay();
        if (wd === 5 || wd === 6) days.push(k);
      }
      return days;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) return [dateFilter];
    return null;
  }

  function render() {
    const list = $("#list");
    list.innerHTML = "";
    const q = query.trim().toLowerCase();
    const days = allowedDays();
    const visible = events.filter(
      (e) =>
        (activeSource === "all" || e.source_id === activeSource) &&
        (activeCity === "all" || e.city === activeCity) &&
        (!freeOnly || e.is_free) &&
        (!days || days.includes(dayKey(e.starts_at))) &&
        (!q || (e.title + " " + (e.description || "")).toLowerCase().includes(q))
    );
    if (!visible.length) {
      list.innerHTML = `<div class="state">${t(configured ? "empty" : "notConfigured")}</div>`;
      return;
    }
    let currentDay = null, grid = null;
    for (const e of visible) {
      const k = dayKey(e.starts_at);
      if (k !== currentDay) {
        currentDay = k;
        const { base, rel } = dayLabel(k);
        const h = document.createElement("div");
        h.className = "day-head";
        h.innerHTML = rel ? `${base}<span class="rel">${rel}</span>` : base;
        list.appendChild(h);
        grid = document.createElement("div");
        grid.className = "cards";
        list.appendChild(grid);
      }
      grid.appendChild(card(e));
    }
  }

  function renderChips() {
    const wrap = $("#sourceChips");
    wrap.innerHTML = "";
    for (const id of ["all", ...Object.keys(SOURCES)]) {
      const b = document.createElement("button");
      b.className = "chip" + (activeSource === id ? " on" : "");
      b.textContent = id === "all" ? t("all") : SOURCES[id][lang];
      b.onclick = () => { activeSource = id; renderChips(); render(); };
      wrap.appendChild(b);
    }
  }

  // City names are always English (project convention); chips appear only when
  // events span more than one city.
  function renderCityChips() {
    const wrap = $("#cityChips");
    wrap.innerHTML = "";
    const cities = [...new Set(events.map((e) => e.city).filter(Boolean))].sort();
    if (cities.length < 2) return;
    for (const c of ["all", ...cities]) {
      const b = document.createElement("button");
      b.className = "chip" + (activeCity === c ? " on" : "");
      b.textContent = c === "all" ? t("all") : c;
      b.onclick = () => { activeCity = c; renderCityChips(); render(); };
      wrap.appendChild(b);
    }
  }

  function renderDateChips() {
    const wrap = $("#dateChips");
    wrap.innerHTML = "";
    const presets = [["all", "allDays"], ["today", "today"], ["tomorrow", "tomorrow"], ["weekend", "weekend"]];
    for (const [val, label] of presets) {
      const b = document.createElement("button");
      b.className = "chip" + (dateFilter === val ? " on" : "");
      b.textContent = t(label);
      b.onclick = () => { dateFilter = val; renderDateChips(); render(); };
      wrap.appendChild(b);
    }
    const picker = document.createElement("input");
    picker.type = "date";
    picker.className = "chip date-pick" + (/^\d{4}/.test(dateFilter) ? " on" : "");
    picker.min = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
    if (/^\d{4}/.test(dateFilter)) picker.value = dateFilter;
    picker.onchange = () => {
      dateFilter = picker.value || "all";
      renderDateChips(); render();
    };
    wrap.appendChild(picker);
  }

  // ---- wire up --------------------------------------------------------
  $("#langToggle").onclick = () => {
    lang = lang === "he" ? "en" : "he";
    localStorage.setItem("kt-lang", lang);
    applyLang(); renderChips(); renderCityChips(); renderDateChips(); render();
  };
  $("#freeOnly").onchange = (e) => { freeOnly = e.target.checked; render(); };
  $("#search").oninput = (e) => { query = e.target.value; render(); };

  applyLang();
  renderChips();
  renderDateChips();
  loadSources();
  load();
})();
