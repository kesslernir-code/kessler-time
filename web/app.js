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
      empty: "אין אירועים שמתאימים לסינון",
      notConfigured: "האתר עוד לא מחובר למסד הנתונים.\n(צריך למלא את web/config.js)",
      error: "שגיאה בטעינת אירועים",
      status: "סטטוס סריקה",
      tickets: "כרטיסים",
    },
    en: {
      tagline: "Upcoming events from the places we love",
      freeOnly: "Free only",
      search: "Search…",
      all: "All",
      free: "Free",
      today: "Today",
      tomorrow: "Tomorrow",
      empty: "No events match the filter",
      notConfigured: "Site is not connected to the database yet.\n(web/config.js needs to be filled in)",
      error: "Failed to load events",
      status: "Scrape status",
      tickets: "Tickets",
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
  let activeSource = "all";
  let freeOnly = false;
  let query = "";

  const SOURCES = {
    mazkeka: { he: "מזקקה", en: "Mazkeka" },
    radical: { he: "רדיקל", en: "Radical" },
    matmon: { he: "מטמון", en: "Matmon" },
  };

  // ---- data -----------------------------------------------------------
  async function load() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
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
      ? `<img loading="lazy" src="${e.image_url}" alt="" onerror="this.parentNode.innerHTML='<div class=ph style=background:${hue(e.title)}33>${(e.title || "?")[0]}</div>'">`
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
        ${price}
      </div>`;
    a.querySelector("h3").textContent = e.title;
    return a;
  }

  function render() {
    const list = $("#list");
    list.innerHTML = "";
    const q = query.trim().toLowerCase();
    const visible = events.filter(
      (e) =>
        (activeSource === "all" || e.source_id === activeSource) &&
        (!freeOnly || e.is_free) &&
        (!q || (e.title + " " + (e.description || "")).toLowerCase().includes(q))
    );
    if (!visible.length) {
      list.innerHTML = `<div class="state">${t("empty")}</div>`;
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

  // ---- wire up --------------------------------------------------------
  $("#langToggle").onclick = () => {
    lang = lang === "he" ? "en" : "he";
    localStorage.setItem("kt-lang", lang);
    applyLang(); renderChips(); render();
  };
  $("#freeOnly").onchange = (e) => { freeOnly = e.target.checked; render(); };
  $("#search").oninput = (e) => { query = e.target.value; render(); };

  applyLang();
  renderChips();
  load();
})();
