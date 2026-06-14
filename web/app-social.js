// The "Under the radar" page — events discovered only on social media, shown
// event-first by date (not by venue). The treasure-hunter feed.
(() => {
  const CFG = window.KESSLER_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const configured = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);

  const STR = {
    he: {
      back: "לאירועים", title: "🔦 מתחת לרדאר",
      sub: "אירועים מתחת לרדאר — זמניים, מחתרתיים, כאלה שלא תמצאו בשום לוח רשמי",
      empty: "עוד לא נמצאו אירועים סודיים — המנוע סורק כל הזמן",
      notConfigured: "לא מחובר למסד הנתונים עדיין", error: "שגיאה בטעינה",
      free: "חינם", today: "היום", tomorrow: "מחר", tickets: "פרטים והרשמה", where: "📍",
    },
    en: {
      back: "events", title: "🔦 Under the radar",
      sub: "Events that fly under the radar — temporary, underground, off the official grid",
      empty: "No secret events found yet — the engine keeps scanning",
      notConfigured: "Not connected to the database yet", error: "Failed to load",
      free: "Free", today: "Today", tomorrow: "Tomorrow", tickets: "Details", where: "📍",
    },
  };
  let lang = localStorage.getItem("kt-lang") || "he";
  const t = (k) => STR[lang][k] || k;

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
    $("#langToggle").textContent = lang === "he" ? "EN" : "עב";
    document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  }

  let events = [];
  const dayKey = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso));
  const dayLabel = (key) => {
    const d = new Date(key + "T12:00:00+03:00");
    const base = new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" }).format(d);
    const today = dayKey(new Date().toISOString());
    const tom = dayKey(new Date(Date.now() + 864e5).toISOString());
    return { base, rel: key === today ? t("today") : key === tom ? t("tomorrow") : "" };
  };
  const timeOf = (iso) => new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
  const proxyImg = (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=640&h=640&fit=cover&output=webp&q=78`;
  const PAL = ["#7aa2ff", "#ff8f6b", "#5ad58a", "#d98cff", "#ffcf5c", "#6be0e0"];
  const hue = (s) => PAL[[...s].reduce((a, c) => a + c.codePointAt(0), 0) % PAL.length];

  function card(e) {
    const pageUrl = e.event_url || e.booking_url || "#";
    const ticketUrl = e.booking_url && e.booking_url !== e.event_url ? e.booking_url : null;
    const a = document.createElement("div");
    a.className = "card"; a.setAttribute("role", "link"); a.tabIndex = 0;
    const open = () => window.open(pageUrl, "_blank", "noopener");
    a.addEventListener("click", open);
    a.addEventListener("keydown", (ev) => { if (ev.key === "Enter") open(); });
    const img = e.image_url
      ? `<img loading="lazy" src="${proxyImg(e.image_url)}" alt="" onerror="this.parentNode.innerHTML='<div class=ph style=background:${hue(e.title)}33>${(e.title || "?")[0]}</div>'">`
      : `<div class="ph" style="background:${hue(e.title)}33">${(e.title || "?")[0]}</div>`;
    const free = e.is_free ? `<span class="badge free">${t("free")}</span>` : "";
    const priceTxt = e.is_free ? `<span class="price free">${t("free")}</span>` : e.price_text ? `<span class="price">${e.price_text}</span>` : "<span></span>";
    const tix = ticketUrl ? `<a class="tix" href="${ticketUrl}" target="_blank" rel="noopener">🎟 ${t("tickets")}</a>` : "";
    a.innerHTML = `
      <div class="img">${img}<span class="badge">${timeOf(e.starts_at)}</span>${free}</div>
      <div class="body">
        <h3></h3>
        ${e.venue ? `<div class="meta"><span class="venue">${t("where")} </span><span class="where-txt"></span></div>` : ""}
        <p class="desc"></p>
        <div class="price-row">${priceTxt}${tix}</div>
      </div>`;
    a.querySelector("h3").textContent = e.title;
    if (e.venue) a.querySelector(".where-txt").textContent = e.venue;
    const d = a.querySelector(".desc"); if (e.description) d.textContent = e.description; else d.remove();
    a.querySelector(".tix")?.addEventListener("click", (ev) => ev.stopPropagation());
    return a;
  }

  function render() {
    const list = $("#list"); list.innerHTML = "";
    if (!events.length) { list.innerHTML = `<div class="state">${t(configured ? "empty" : "notConfigured")}</div>`; return; }
    let day = null, grid = null;
    for (const e of events) {
      const k = dayKey(e.starts_at);
      if (k !== day) {
        day = k; const { base, rel } = dayLabel(k);
        const h = document.createElement("div"); h.className = "day-head";
        h.innerHTML = rel ? `${base}<span class="rel">${rel}</span>` : base; list.appendChild(h);
        grid = document.createElement("div"); grid.className = "cards"; list.appendChild(grid);
      }
      grid.appendChild(card(e));
    }
  }

  async function load() {
    if (!configured) { $("#stateMsg").textContent = t("notConfigured"); return; }
    const since = new Date(Date.now() - 3 * 3600e3).toISOString();
    const url = `${CFG.SUPABASE_URL}/rest/v1/events?select=*&kind=eq.social&starts_at=gte.${encodeURIComponent(since)}&order=starts_at.asc&limit=400`;
    try {
      const res = await fetch(url, { headers: { apikey: CFG.SUPABASE_ANON_KEY } });
      // before schema5 is applied the 'kind' column doesn't exist (400) — that
      // just means no social events yet, so show the friendly empty state
      events = res.ok ? await res.json() : [];
      render();
    } catch { events = []; render(); }
  }

  $("#langToggle").onclick = () => { lang = lang === "he" ? "en" : "he"; localStorage.setItem("kt-lang", lang); applyLang(); render(); };
  applyLang();
  load();
})();
