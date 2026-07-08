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
      pickDate: "תאריך",
      empty: "אין אירועים שמתאימים לסינון",
      notConfigured: "האתר עוד לא מחובר למסד הנתונים.\n(צריך למלא את web/config.js)",
      error: "שגיאה בטעינת אירועים",
      status: "סטטוס סריקה",
      tickets: "כרטיסים",
      recs: "המלצות",
      addPlace: "+ הוספת מקום",
      tabEvents: "אירועים",
      tabGoing: "מה כבר בתפריט",
      going: "🎟 הולכים",
      share: "↗ שיתוף",
      goingEmpty: "עדיין אין אירועים בתפריט — סמנו “הולכים” על אירוע",
      cat_fringe: "הופעות שוליים",
      cat_live: "הופעות חיות",
      cat_bohemia: "בוהמיה",
      cat_galleries: "גלריות",
      cat_festival: "פסטיבלים",
      cat_cinema: "קולנועים",
      cat_bars: "ברים",
      cat_restaurants: "מסעדות",
      cat_club: "מועדונים",
      cat_secret: "סודי",
      cat_other: "אחר",
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
      pickDate: "Date",
      empty: "No events match the filter",
      notConfigured: "Site is not connected to the database yet.\n(web/config.js needs to be filled in)",
      error: "Failed to load events",
      status: "Scrape status",
      tickets: "Tickets",
      recs: "Recommendations",
      addPlace: "+ Add place",
      tabEvents: "Events",
      tabGoing: "On my menu",
      going: "🎟 Going",
      share: "↗ Share",
      goingEmpty: "Nothing on your menu yet — tap “Going” on an event",
      cat_fringe: "Fringe",
      cat_live: "Live shows",
      cat_bohemia: "Bohemia",
      cat_galleries: "Galleries",
      cat_festival: "Festivals",
      cat_cinema: "Cinemas",
      cat_bars: "Bars",
      cat_restaurants: "Restaurants",
      cat_club: "Clubs",
      cat_secret: "Secret",
      cat_other: "Other",
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
  // Every filter is single-select with an "All" default: an empty Set means "all",
  // otherwise it holds exactly one value. The filter order in the UI is
  // Date → City → Category → Place, each narrowing the next.
  const srcSel = new Set();
  const citySel = new Set();
  const catSel = new Set();
  const daySel = new Set(); // one of: today / tomorrow / weekend
  let specificDate = null; // a calendar-picked YYYY-MM-DD (exclusive of the presets)
  let freeOnly = false;
  let query = "";
  let view = "events"; // "events" (dashboard) | "going" (מה כבר בתפריט)
  // Events marked "going" — a SHARED list in the DB (going_list) so it syncs
  // across all devices. localStorage is just a fast-paint cache until the DB
  // load returns (and a fallback if the going_list table doesn't exist yet).
  let going = new Set(JSON.parse(localStorage.getItem("kt-going") || "[]"));
  const cacheGoing = () => localStorage.setItem("kt-going", JSON.stringify([...going]));
  // "secret" events are gated behind a code, not just a chip — never shown in the
  // main "All" mix (like galleries), and the filter itself won't switch to it
  // until the code is entered once (then remembered on this device).
  let secretUnlocked = localStorage.getItem("kt-secret") === "1";

  async function loadGoing() {
    if (!configured) return;
    try {
      const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/going_list?select=event_id`, { headers: { apikey: CFG.SUPABASE_ANON_KEY } });
      if (!res.ok) return; // table not created yet → keep the localStorage cache
      const rows = await res.json();
      if (Array.isArray(rows)) { going = new Set(rows.map((r) => r.event_id)); cacheGoing(); render(); }
    } catch {} // offline → keep the cache
  }

  // Toggle an event in the shared list: update locally first (snappy), then the DB.
  async function markGoing(id, on) {
    if (on) going.add(id); else going.delete(id);
    cacheGoing();
    if (view === "going") render();
    if (!configured) return;
    try {
      if (on) {
        await fetch(`${CFG.SUPABASE_URL}/rest/v1/going_list`, {
          method: "POST",
          headers: { apikey: CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ event_id: id }),
        });
      } else {
        await fetch(`${CFG.SUPABASE_URL}/rest/v1/going_list?event_id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { apikey: CFG.SUPABASE_ANON_KEY, Prefer: "return=minimal" },
        });
      }
    } catch {} // a failed write keeps the optimistic local state; re-syncs on next load
  }
  const CATEGORIES = ["fringe", "live", "bohemia", "galleries", "club", "cinema", "festival", "bars", "restaurants", "secret", "other"];
  // shown as info-card listings, not event feeds
  const DIRECTORY_CATS = new Set(["bars", "restaurants", "festival"]);

  // Venue sites often block hotlinked images (and serve huge files); the wsrv.nl
  // proxy fetches them neutrally and resizes — one fix for every problematic site.
  const proxyImg = (url) =>
    `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=640&h=640&fit=cover&output=webp&q=78`;

  // Header photo rotates daily, cycling through web/pics/ in order
  fetch("pics/manifest.json")
    .then((r) => r.json())
    .then((m) => {
      if (!m.count) return;
      const day = Math.floor(Date.now() / 864e5);
      $("#heroImg").src = "pics/" + m.files[day % m.count] + (m.v ? "?v=" + m.v : "");
    })
    .catch(() => {});

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
      let res = await fetch(
        `${CFG.SUPABASE_URL}/rest/v1/sources?enabled=eq.true&select=id,name,category,city,url,image,description,phone&order=added_at.asc`,
        { headers: { apikey: CFG.SUPABASE_ANON_KEY } }
      );
      if (!res.ok) res = await fetch( // before schema9: no image/description/phone columns
        `${CFG.SUPABASE_URL}/rest/v1/sources?enabled=eq.true&select=id,name,category&order=added_at.asc`,
        { headers: { apikey: CFG.SUPABASE_ANON_KEY } }
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) {
        SOURCES = Object.fromEntries(
          rows.map((r) => [r.id, { ...splitName(r.name), category: r.category || "fringe", city: r.city, url: r.url, image: r.image, description: r.description, phone: r.phone }])
        );
        renderChips();
        render();
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
    const s = encodeURIComponent(since);
    const cols = "id,source_id,title,description,starts_at,ends_at,venue,city,price_text,is_free,booking_url,event_url,image_url,kind";
    // Keep an event if it hasn't started yet OR (multi-day runs / exhibitions)
    // hasn't ended yet — so a currently-running exhibition stays visible.
    const url = (extra) =>
      `${CFG.SUPABASE_URL}/rest/v1/events?select=${cols}${extra}` +
      // upcoming, still-running (exhibitions), or dateless (bars/restaurants info cards)
      `&or=(starts_at.gte.${s},ends_at.gte.${s},starts_at.is.null)&order=starts_at.asc&limit=600`;
    try {
      // ",category" gracefully degrades while the DB column doesn't exist yet
      let res = await fetch(url(",category"), { headers: { apikey: CFG.SUPABASE_ANON_KEY } });
      if (!res.ok) res = await fetch(url(""), { headers: { apikey: CFG.SUPABASE_ANON_KEY } });
      if (!res.ok) throw new Error(res.status);
      events = (await res.json()).filter((e) => e.kind !== "social"); // drop any legacy under-radar rows
      renderCityChips();
      renderCatChips();
      renderChips();
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
  const phHTML = (title) => `<div class="ph" style="background:${hue(title || "?")}33">${(title || "?")[0]}</div>`;

  // Manual scroll-position lazy load — not loading="lazy" (its "near enough
  // to the viewport" heuristic has shown up as a real source of blank cards
  // that never trigger even after scrolling into view) and not
  // IntersectionObserver either (same failure mode observed in testing: a
  // freshly created, already-in-viewport element's observer callback simply
  // never fired). Eagerly loading every image up front isn't the fix either —
  // with a few hundred events in the DOM at once, firing that many requests
  // simultaneously on a phone connection causes real congestion, which looks
  // identical to the bug (a card stuck blank for a while). Plain
  // getBoundingClientRect() math on scroll/resize, checked immediately and
  // then on every scroll, is the most basic, dependency-free mechanism there
  // is — nothing left to fail silently.
  const LOAD_MARGIN_PX = 1200;
  const pendingImgs = new Set();
  function checkPendingImgs() {
    if (!pendingImgs.size) return;
    const bottom = window.innerHeight + LOAD_MARGIN_PX;
    for (const im of pendingImgs) {
      if (!im.isConnected) { pendingImgs.delete(im); continue; } // removed by a re-render
      const r = im.getBoundingClientRect();
      if (r.bottom < -LOAD_MARGIN_PX || r.top > bottom) continue; // still far off-screen
      im.src = im.dataset.src;
      pendingImgs.delete(im);
    }
  }
  window.addEventListener("scroll", checkPendingImgs, { passive: true });
  window.addEventListener("resize", checkPendingImgs);

  // An <img> via the wsrv proxy, falling back to a coloured letter placeholder.
  // (Images that the proxy can't fetch — hotlink-blocked venues like levontin7 —
  // are re-hosted into our own Storage by the QC agent, so they load normally.)
  function smartImg(url, title) {
    const im = document.createElement("img");
    im.alt = "";
    im.onerror = () => im.replaceWith(...new DOMParser().parseFromString(phHTML(title), "text/html").body.childNodes);
    im.dataset.src = proxyImg(url);
    pendingImgs.add(im);
    return im;
  }

  function card(e) {
    // Card click -> the event's own page; a separate 🎟 button -> the payment page.
    // (A div with a click handler — an <a> can't legally nest the ticket <a>.)
    const pageUrl = e.event_url || e.booking_url || "#";
    const ticketUrl = e.booking_url && e.booking_url !== e.event_url ? e.booking_url : null;
    const a = document.createElement("div");
    a.className = "card";
    a.setAttribute("role", "link");
    a.tabIndex = 0;
    const open = () => window.open(pageUrl, "_blank", "noopener");
    a.addEventListener("click", open);
    a.addEventListener("keydown", (ev) => { if (ev.key === "Enter") open(); });
    const freeBadge = e.is_free ? `<span class="badge free">${t("free")}</span>` : "";
    const priceTxt = e.is_free ? `<span class="price free">${t("free")}</span>` : e.price_text ? `<span class="price">${e.price_text}</span>` : "<span></span>";
    const tixBtn = ticketUrl ? `<a class="tix" href="${ticketUrl}" target="_blank" rel="noopener">🎟 ${t("tickets")}</a>` : "";
    const price = `<div class="price-row">${priceTxt}${tixBtn}</div>`;
    const src = SOURCES[e.source_id]?.[lang] || e.venue || e.source_id;
    a.innerHTML = `
      <div class="img"><span class="badge">${timeOf(e.starts_at)}</span>${freeBadge}</div>
      <div class="body">
        <h3></h3>
        <div class="meta"><span class="venue">${src}</span>${e.city ? `<span>${e.city}</span>` : ""}</div>
        <p class="desc"></p>
        ${price}
      </div>`;
    const imgBox = a.querySelector(".img");
    imgBox.insertAdjacentElement("afterbegin", e.image_url ? smartImg(e.image_url, e.title) : new DOMParser().parseFromString(phHTML(e.title), "text/html").body.firstChild);
    a.querySelector("h3").textContent = e.title;
    const desc = a.querySelector(".desc");
    if (e.description) desc.textContent = e.description;
    else desc.remove();
    // ticket button is a link of its own — don't trigger the card's link
    a.querySelector(".tix")?.addEventListener("click", (ev) => ev.stopPropagation());
    const stop = (ev) => ev.stopPropagation();
    // "going" toggle — adds/removes the event from the מה כבר בתפריט tab (shared list)
    const goLabel = document.createElement("label");
    goLabel.className = "going" + (going.has(e.id) ? " on" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = going.has(e.id);
    goLabel.append(cb, document.createTextNode(" " + t("going")));
    goLabel.addEventListener("click", stop);
    goLabel.addEventListener("keydown", stop);
    cb.addEventListener("change", () => {
      goLabel.classList.toggle("on", cb.checked);
      markGoing(e.id, cb.checked); // updates the shared DB list + re-renders the menu
    });

    // Share to WhatsApp — pick Nir or Sharon
    const when = e.starts_at
      ? " — " + new Date(e.starts_at).toLocaleString(lang === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })
      : "";
    const link = pageUrl && pageUrl !== "#" ? "\n" + pageUrl : "";
    const shareText = encodeURIComponent(`${e.title}${when}${link}`);
    const share = document.createElement("div");
    share.className = "share";
    const shareBtn = document.createElement("button");
    shareBtn.type = "button"; shareBtn.className = "share-btn"; shareBtn.textContent = t("share");
    const menu = document.createElement("div");
    menu.className = "share-menu";
    for (const c of [{ n: "ניר", p: "972523867417" }, { n: "שרון", p: "972544548395" }]) {
      const to = document.createElement("a");
      to.className = "share-to";
      to.href = `https://wa.me/${c.p}?text=${shareText}`;
      to.target = "_blank"; to.rel = "noopener"; to.textContent = c.n;
      to.addEventListener("click", stop);
      menu.appendChild(to);
    }
    shareBtn.addEventListener("click", (ev) => { stop(ev); share.classList.toggle("open"); });
    share.append(shareBtn, menu);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(goLabel, share);
    a.querySelector(".body").appendChild(actions);
    return a;
  }

  // Which day-keys does the current date filter allow? (null = all)
  function allowedDays() {
    if (specificDate) return [specificDate];
    if (!daySel.size) return null;
    const plus = (n) => dayKey(new Date(Date.now() + n * 864e5).toISOString());
    const days = new Set();
    if (daySel.has("today")) days.add(plus(0));
    if (daySel.has("tomorrow")) days.add(plus(1));
    if (daySel.has("weekend")) {
      // upcoming Friday + Saturday (Israeli weekend)
      let added = 0;
      for (let n = 0; n < 8 && added < 2; n++) {
        const k = plus(n);
        const wd = new Date(k + "T12:00:00+03:00").getUTCDay();
        if (wd === 5 || wd === 6) { days.add(k); added++; }
      }
    }
    return [...days];
  }

  // Directory place card: image, name, phone, description, link to site.
  function placeCard(id, s) {
    const a = document.createElement("a");
    a.className = "card place-card";
    a.href = s.url || "#"; a.target = "_blank"; a.rel = "noopener";
    const name = s[lang] || s.he || id;
    a.innerHTML = `
      <div class="img"></div>
      <div class="body">
        <h3></h3>
        ${s.phone ? `<a class="phone" href="tel:${s.phone.replace(/[^+0-9]/g, "")}">📞 ${s.phone}</a>` : ""}
        <p class="desc"></p>
        <span class="price" style="color:var(--accent-2)">${lang === "he" ? "לאתר ↗" : "Visit ↗"}</span>
      </div>`;
    a.querySelector(".img").insertAdjacentElement("afterbegin", s.image ? smartImg(s.image, name) : new DOMParser().parseFromString(phHTML(name), "text/html").body.firstChild);
    a.querySelector("h3").textContent = name;
    const d = a.querySelector(".desc"); if (s.description) d.textContent = s.description; else d.remove();
    a.querySelector(".phone")?.addEventListener("click", (ev) => ev.stopPropagation());
    return a;
  }

  // True when the active category filter is only directory categories.
  const directoryMode = () => catSel.size > 0 && [...catSel].every((c) => DIRECTORY_CATS.has(c));

  function renderDirectory() {
    const list = $("#list");
    list.innerHTML = "";
    const q = query.trim().toLowerCase();
    const grid = document.createElement("div");
    grid.className = "cards";
    let n = 0;
    // venues that are followed sites (from the sources table)
    Object.keys(SOURCES)
      .filter((id) => catSel.has(SOURCES[id].category) &&
        (!srcSel.size || srcSel.has(id)) &&
        (!citySel.size || srcCity(id) === only(citySel)) &&
        (!q || (SOURCES[id].he + " " + SOURCES[id].en + " " + (SOURCES[id].description || "")).toLowerCase().includes(q)))
      .forEach((id) => { grid.appendChild(placeCard(id, SOURCES[id])); n++; });
    // places added manually via the screenshot uploader (bars/restaurants, no date)
    events
      .filter((e) => catSel.has(e.category) && e.source_id === "manual" &&
        (!citySel.size || citySel.has(e.city)) &&
        (!q || (e.title + " " + (e.description || "")).toLowerCase().includes(q)))
      .forEach((e) => {
        grid.appendChild(placeCard(e.id, { he: e.title, en: e.title, url: e.event_url || e.booking_url, image: e.image_url, description: e.description }));
        n++;
      });
    if (!n) { list.innerHTML = `<div class="state">${t("empty")}</div>`; return; }
    list.appendChild(grid);
    checkPendingImgs();
  }

  // Render a day-grouped list of events into #list (shared by the feed and the menu).
  function renderDayGroups(visible) {
    const list = $("#list");
    const now = Date.now();
    // A currently-running multi-day event (e.g. an exhibition) keeps its real,
    // original starts_at in the data — normalize() relies on that to decide it's
    // still visible at all. But grouping/sorting it under that original date,
    // days or weeks in the past, makes the feed look stuck on old news. While
    // it's still actually running (ends_at in the future), treat it as if it
    // started today for display order only.
    const effectiveStart = (e) => {
      const s = Date.parse(e.starts_at);
      const end = e.ends_at ? Date.parse(e.ends_at) : null;
      return s < now && end && end > now ? now : s;
    };
    const sorted = [...visible].sort((a, b) => effectiveStart(a) - effectiveStart(b));
    let currentDay = null, grid = null;
    for (const e of sorted) {
      const k = dayKey(new Date(effectiveStart(e)).toISOString());
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
    checkPendingImgs(); // cards just entered the DOM — see which posters are already in range
  }

  function render() {
    // "מה כבר בתפריט" tab: just the events the user marked going, by date.
    if (view === "going") {
      const list = $("#list");
      list.innerHTML = "";
      const mine = events.filter((e) => going.has(e.id)); // events[] is already sorted by date
      if (!mine.length) { list.innerHTML = `<div class="state">${t("goingEmpty")}</div>`; return; }
      renderDayGroups(mine);
      return;
    }
    if (directoryMode()) return renderDirectory();
    const list = $("#list");
    list.innerHTML = "";
    const q = query.trim().toLowerCase();
    const days = allowedDays();
    const visible = events.filter(
      (e) =>
        !DIRECTORY_CATS.has(e.category || "") &&
        // galleries (ongoing exhibitions) show only under their own chip, not the main mix
        (catSel.has("galleries") || (e.category || "") !== "galleries") &&
        // secret events never leak into "All" — only when that chip is explicitly active
        (catSel.has("secret") || (e.category || "") !== "secret") &&
        (!srcSel.size || srcSel.has(e.source_id)) &&
        (!citySel.size || citySel.has(e.city)) &&
        (!catSel.size || catSel.has(e.category || "fringe")) &&
        (!freeOnly || e.is_free) &&
        (!days || days.includes(dayKey(e.starts_at))) &&
        (!q || (e.title + " " + (e.description || "")).toLowerCase().includes(q))
    );
    if (!visible.length) {
      list.innerHTML = `<div class="state">${t(configured ? "empty" : "notConfigured")}</div>`;
      return;
    }
    renderDayGroups(visible);
  }

  // Small helper: a chip whose "on" state reflects the (single-select) filter.
  function addChip(wrap, label, on, onClick, extraClass) {
    const b = document.createElement("button");
    b.className = "chip" + (on ? " on" : "") + (extraClass ? " " + extraClass : "");
    b.textContent = label;
    b.onclick = onClick;
    wrap.appendChild(b);
  }

  // The single chosen value of a single-select filter, or null for "all".
  const only = (set) => [...set][0] ?? null;
  // A source's city: from the sources table, else inferred from its events.
  const srcCity = (id) => SOURCES[id]?.city || events.find((e) => e.source_id === id && e.city)?.city || null;

  // Place chips cascade from City + Category: hidden until one of them is chosen
  // (otherwise there are too many places to list), then show only the matching ones.
  function renderChips() {
    const wrap = $("#sourceChips");
    wrap.innerHTML = "";
    const city = only(citySel), cat = only(catSel);
    if (!city && !cat) return; // nothing to narrow by yet
    const ids = Object.keys(SOURCES).filter(
      (id) => (!cat || SOURCES[id].category === cat) && (!city || srcCity(id) === city)
    );
    if (!ids.length) return;
    addChip(wrap, t("all"), !srcSel.size, () => { srcSel.clear(); renderChips(); render(); });
    for (const id of ids) {
      addChip(wrap, SOURCES[id][lang], srcSel.has(id), () => {
        srcSel.clear(); srcSel.add(id); renderChips(); render(); // single-select
      });
    }
  }

  // Category filter — single-select with an "All" default.
  function renderCatChips() {
    const wrap = $("#catChips");
    wrap.innerHTML = "";
    if (!events.some((e) => "category" in e)) return;
    const CAT_COLOR = { live: "cat-live", galleries: "cat-galleries", festival: "cat-festival", cinema: "cat-cinema", bars: "cat-bars", restaurants: "cat-restaurants", club: "cat-club" };
    addChip(wrap, t("all"), !catSel.size, () => {
      catSel.clear(); srcSel.clear(); renderCatChips(); renderChips(); render();
    });
    for (const c of CATEGORIES) {
      addChip(wrap, t("cat_" + c), catSel.has(c), () => {
        if (c === "secret" && !secretUnlocked) {
          const code = prompt(lang === "he" ? "קוד גישה:" : "Access code:");
          if (code !== "1947") return; // wrong or cancelled — leave the filter untouched
          secretUnlocked = true;
          localStorage.setItem("kt-secret", "1");
        }
        catSel.clear(); catSel.add(c); srcSel.clear(); // place chips belong to the previous category
        renderCatChips(); renderChips(); render();
      }, CAT_COLOR[c] || null);
    }
  }

  // City filter — single-select with an "All" default; chips appear only when
  // events span more than one city. City names are English (project convention).
  function renderCityChips() {
    const wrap = $("#cityChips");
    wrap.innerHTML = "";
    const cities = [...new Set(events.map((e) => e.city).filter(Boolean))].sort();
    if (cities.length < 2) return;
    addChip(wrap, t("all"), !citySel.size, () => {
      citySel.clear(); srcSel.clear(); renderCityChips(); renderChips(); render();
    });
    for (const c of cities) {
      addChip(wrap, c, citySel.has(c), () => {
        citySel.clear(); citySel.add(c); srcSel.clear(); // a place may not exist in the new city
        renderCityChips(); renderChips(); render();
      });
    }
  }

  // Date filter — single-select with an "All days" default.
  function renderDateChips() {
    const wrap = $("#dateChips");
    wrap.innerHTML = "";
    addChip(wrap, t("allDays"), !daySel.size && !specificDate, () => {
      daySel.clear(); specificDate = null; renderDateChips(); render();
    });
    for (const val of ["today", "weekend"]) {
      addChip(wrap, t(val), daySel.has(val), () => {
        specificDate = null; daySel.clear(); daySel.add(val); renderDateChips(); render();
      });
    }
    // A clean 📅 chip that opens the native calendar — the bare <input type=date>
    // renders badly on phones. The actual input stays hidden. A specific date is
    // exclusive of the presets.
    const picker = document.createElement("input");
    picker.type = "date";
    picker.className = "date-hidden";
    picker.min = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
    if (specificDate) picker.value = specificDate;
    picker.onchange = () => {
      specificDate = picker.value || null;
      if (specificDate) daySel.clear();
      renderDateChips(); render();
    };
    const btn = document.createElement("button");
    btn.className = "chip" + (specificDate ? " on" : "");
    btn.textContent =
      "📅 " +
      (specificDate
        ? new Date(specificDate + "T12:00:00").toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "numeric" })
        : t("pickDate"));
    btn.onclick = () => {
      try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
    };
    wrap.appendChild(btn);
    wrap.appendChild(picker);
  }

  // ---- wire up --------------------------------------------------------
  $("#langToggle").onclick = () => {
    lang = lang === "he" ? "en" : "he";
    localStorage.setItem("kt-lang", lang);
    applyLang(); renderChips(); renderCatChips(); renderCityChips(); renderDateChips(); render();
  };
  $("#freeOnly").onchange = (e) => { freeOnly = e.target.checked; render(); };
  $("#search").oninput = (e) => { query = e.target.value; render(); };

  // Tabs: the dashboard feed vs. the "מה כבר בתפריט" going list (filters apply
  // only to the feed, so hide them on the menu tab).
  function setView(v) {
    view = v;
    $("#tabEvents").classList.toggle("on", v === "events");
    $("#tabGoing").classList.toggle("on", v === "going");
    $(".filters").style.display = v === "going" ? "none" : "";
    render();
  }
  $("#tabEvents").onclick = () => setView("events");
  $("#tabGoing").onclick = () => setView("going");

  // Close any open share menu when clicking elsewhere (share buttons stopPropagation).
  document.addEventListener("click", () => document.querySelectorAll(".share.open").forEach((s) => s.classList.remove("open")));

  applyLang();
  renderChips();
  renderDateChips();
  loadSources();
  load();
  loadGoing();
})();
