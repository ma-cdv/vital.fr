/* =========================================================
   VITAL — interactions (i18n, menu, reveal)
   ========================================================= */

// --- i18n ---------------------------------------------------
const STORAGE_KEY = 'vital_lang';
const SUPPORTED_LANGS = ['fr', 'en', 'es', 'zh'];

function detectInitialLang() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
  const browser = (navigator.language || 'fr').slice(0, 2);
  return SUPPORTED_LANGS.includes(browser) ? browser : 'fr';
}

function applyLang(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-fr]').forEach(el => {
    const t = el.getAttribute(`data-${lang}`);
    if (t !== null) el.textContent = t;
  });
  document.querySelectorAll('[data-fr-attr]').forEach(el => {
    // data-fr-attr="placeholder:Tapez ici" data-en-attr="placeholder:Type here"
    const raw = el.getAttribute(`data-${lang}-attr`);
    if (!raw) return;
    const [attr, ...rest] = raw.split(':');
    el.setAttribute(attr, rest.join(':'));
  });

  // Generic per-lang title lookup — works for any code in SUPPORTED_LANGS
  const titleEl = document.querySelector('title');
  if (titleEl) {
    const t = titleEl.getAttribute('data-title-' + lang);
    if (t) document.title = t;
  }

  document.querySelectorAll('.lang-switch button').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
    b.setAttribute('aria-pressed', b.dataset.lang === lang);
  });

  localStorage.setItem(STORAGE_KEY, lang);
}

function initLangSwitch() {
  document.querySelectorAll('.lang-switch button').forEach(btn => {
    btn.addEventListener('click', () => applyLang(btn.dataset.lang));
  });
  applyLang(detectInitialLang());
}

// --- Mobile nav --------------------------------------------
function initMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => {
    const isOpen = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen);
  });
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', false);
    });
  });
}

// --- Scroll reveal -----------------------------------------
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length || !('IntersectionObserver' in window)) {
    els.forEach(e => e.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach(el => io.observe(el));
}

// --- Animated stat counters --------------------------------
function renderStat(el, value) {
  const formatter = new Intl.NumberFormat('fr-FR');
  const suffix = el.dataset.suffix || '';
  const num = formatter.format(Math.round(value));
  el.innerHTML = num + (suffix ? `<span class="stat-suffix">${suffix}</span>` : '');
}

function animateCount(el) {
  const target = parseInt(el.dataset.count, 10);
  if (!Number.isFinite(target)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    renderStat(el, target);
    return;
  }
  // Per-stat duration override via data-duration="3500" — fallback 2800ms.
  // The slower default makes the bigger figures (7000, 1000) feel more
  // intentional than the previous 1600ms rapid count.
  const duration = parseInt(el.dataset.duration, 10) || 2800;
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    renderStat(el, target * eased);
    if (t < 1) requestAnimationFrame(tick);
    else renderStat(el, target);
  }
  requestAnimationFrame(tick);
}

function initCounters() {
  const els = document.querySelectorAll('.stat-number[data-count]');
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) {
    els.forEach(animateCount);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animateCount(e.target);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });
  els.forEach(el => io.observe(el));
}

// --- Init ----------------------------------------------------
// --- Before/After slider -----------------------------------
// VITAL 1980 ↔ 2026 comparison piece. Diagonal clip-path driven by --pos
// (0–100). Handles drag (mouse + touch), keyboard, and a one-shot auto-sweep
// triggered when the slider scrolls into view. Auto-sweep moves the bar
// right-to-left with a slight overshoot, then settles. User interaction
// cancels the sweep permanently.
function initBeforeAfter() {
  const sliders = document.querySelectorAll('.ba-slider');
  if (!sliders.length) return;
  const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Stay away from the edges so both images always remain partially visible
  // during the auto-sweep. Manual drag uses a slightly wider range (8–92%).
  const SWEEP_MIN = 25, SWEEP_MAX = 75;
  const DRAG_MIN  = 8,  DRAG_MAX  = 92;

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  sliders.forEach(el => {
    const handle = el.querySelector('.ba-handle');
    let dragging = false;
    let userInteracted = false;

    // ---- Position helpers ----
    // snap=true → no transition (instant jump); used while dragging
    const setPos = (pct, { snap = false, clamp = DRAG_MIN, clampMax = DRAG_MAX } = {}) => {
      const v = Math.max(clamp, Math.min(clampMax, pct));
      if (snap) {
        el.classList.add('is-snap');
        el.style.setProperty('--pos', v + '%');
        // Restore the transition on the next frame so the next move animates again
        requestAnimationFrame(() =>
          requestAnimationFrame(() => el.classList.remove('is-snap'))
        );
      } else {
        el.style.setProperty('--pos', v + '%');
      }
    };

    const setPosFromX = (clientX) => {
      const rect = el.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setPos(pct, { snap: true });
    };

    const markInteracted = () => {
      if (!userInteracted) {
        userInteracted = true;
        el.classList.add('is-interacted');
      }
    };

    // ---- Drag handlers (mouse + touch) ----
    const onDown = (clientX) => {
      dragging = true;
      markInteracted();
      el.classList.add('is-dragging');
      setPosFromX(clientX);
    };
    const onMove = (clientX) => { if (dragging) setPosFromX(clientX); };
    const onUp   = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('is-dragging');
    };

    el.addEventListener('mousedown', (e) => { e.preventDefault(); onDown(e.clientX); });
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onUp);

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length) onDown(e.touches[0].clientX);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length) onMove(e.touches[0].clientX);
    }, { passive: true });
    el.addEventListener('touchend',   onUp);
    el.addEventListener('touchcancel', onUp);

    // ---- Keyboard (focused handle) ----
    if (handle) {
      handle.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 10 : 3;
        const cur = parseFloat(getComputedStyle(el).getPropertyValue('--pos')) || 50;
        if (e.key === 'ArrowLeft')       { markInteracted(); setPos(cur - step); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { markInteracted(); setPos(cur + step); e.preventDefault(); }
        else if (e.key === 'Home')       { markInteracted(); setPos(DRAG_MIN); e.preventDefault(); }
        else if (e.key === 'End')        { markInteracted(); setPos(DRAG_MAX); e.preventDefault(); }
      });
    }

    // ---- Auto-sweep on first viewport entry ----
    // Right-to-left bias with a slight overshoot to draw the eye.
    // Each step waits for the CSS transition (1.4s) before moving on.
    const sweepSequence = [
      { pos: 70, wait: 1100 },   // 1. drift to the right (reveal more of 1980)
      { pos: 30, wait: 1900 },   // 2. sweep right→left (reveal more of 2026)
      { pos: 55, wait: 1100 },   // 3. mild overshoot back to the right
      { pos: 50, wait: 0    },   // 4. settle in the middle
    ];

    const runSweep = async () => {
      if (prefersReduce || userInteracted) return;
      // Anchor at 50% without animation to make the first step feel intentional
      setPos(50, { snap: true });
      await wait(700);
      for (const step of sweepSequence) {
        if (userInteracted) return;
        setPos(step.pos, { clamp: SWEEP_MIN, clampMax: SWEEP_MAX });
        await wait(step.wait);
      }
    };

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !userInteracted) {
            runSweep();
            io.unobserve(el);
          }
        });
      }, { threshold: 0.4 });
      io.observe(el);
    } else {
      setTimeout(runSweep, 600);
    }
  });
}

// --- Location map (Leaflet + OpenStreetMap) -------------------
// Initialises the #vital-map div with a single burgundy marker pinned
// on VITAL's Vitrolles platform. Tiles served by OpenStreetMap (no key,
// no quota). The marker uses a CSS-styled divIcon so it stays on-brand
// and animates a soft pulse — see .vital-marker in styles.css.
function initLocationMap() {
  const el = document.getElementById('vital-map');
  if (!el || typeof L === 'undefined') return;

  // 17 rue de Copenhague, ZI Les Estroublans, 13127 Vitrolles
  const VITAL_LATLNG = [43.4565, 5.2410];

  const map = L.map(el, {
    center: VITAL_LATLNG,
    zoom: 11,
    scrollWheelZoom: false,    // page-scroll friendly
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  // Burgundy pulsing dot, anchored at center via marginLeft/Top
  const icon = L.divIcon({
    className: 'vital-marker-wrap',
    html: '<div class="vital-marker"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  L.marker(VITAL_LATLNG, { icon, title: 'VITAL — Vitrolles' })
    .addTo(map)
    .bindPopup(
      '<strong>VITAL</strong><br>' +
      '17 rue de Copenhague<br>' +
      'ZI Les Estroublans<br>' +
      '13127 Vitrolles, France<br><br>' +
      '<a href="https://www.google.com/maps/dir/?api=1&destination=17+rue+de+Copenhague,+13127+Vitrolles,+France" ' +
      'target="_blank" rel="noopener">Itinéraire ↗</a>'
    );

  // Re-enable scroll-zoom once the map gets explicit focus (click)
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());
}

// --- Scroll-to-top for "Accueil" -----------------------------
// Catches the nav "Accueil" link (data-scroll-top) and smooth-scrolls to
// the top of the page instead of triggering a full reload via href="/".
function initScrollTop() {
  document.querySelectorAll('[data-scroll-top]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// --- Contact modal -----------------------------------------
// Wires every [data-modal="contact"] to open the <dialog id="contact-modal">.
// Form posts to Web3Forms (https://web3forms.com) — real email delivery from
// a static site, no backend. On any failure, a mailto: fallback opens the
// user's mail client pre-filled with the same payload.
function initContactModal() {
  const dialog = document.getElementById('contact-modal');
  if (!dialog) return;
  const openers = document.querySelectorAll('[data-modal="contact"]');
  const closers = dialog.querySelectorAll('[data-modal-close]');
  const form    = dialog.querySelector('.contact-form');

  const open = () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.body.classList.add('has-modal-open');
    const firstInput = dialog.querySelector('input, select, textarea');
    if (firstInput) requestAnimationFrame(() => firstInput.focus());
  };

  const close = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    document.body.classList.remove('has-modal-open');
  };

  openers.forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); open(); });
  });
  closers.forEach(btn => btn.addEventListener('click', close));

  // Click on backdrop closes
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  // Native Esc → cleanup body class
  dialog.addEventListener('close', () => {
    document.body.classList.remove('has-modal-open');
  });

  if (form) {
    form.addEventListener('submit', async (e) => {
      if (!('fetch' in window)) return; // let native POST happen
      e.preventDefault();

      const data = new FormData(form);
      // Strip Web3Forms config fields from the payload we'd reuse in the
      // mailto: fallback. Anything still in `data` (incl. access_key) gets
      // POSTed as-is.
      const HIDDEN_KEYS = new Set([
        'access_key', 'from_name', 'subject', 'cc', 'bcc',
        'redirect', 'botcheck', 'replyto',
      ]);
      const payload = {};
      for (const [k, v] of data.entries()) {
        if (!HIDDEN_KEYS.has(k) && v) payload[k] = v;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: data,
        });
        // Web3Forms returns 200 with { success: true, message: "..." }
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) {
          throw new Error('Web3Forms: ' + (json.message || res.status));
        }
        const en = document.documentElement.lang === 'en';
        form.innerHTML = `
          <div class="contact-form__success" style="text-align:center;padding:24px 0;">
            <h3 style="font-family:var(--font-display,'Fraunces',serif);font-size:1.5rem;margin:0 0 10px;">
              ${en ? 'Message sent!' : 'Message envoyé !'}
            </h3>
            <p style="color:var(--muted,#5c5751);margin:0;">
              ${en
                ? 'Thanks — the VITAL team will get back to you within one business day.'
                : "Merci — l'équipe VITAL revient vers vous sous 24h ouvrées."}
            </p>
          </div>`;
        setTimeout(close, 2800);
      } catch (err) {
        // Fallback: open mail client pre-filled
        const subject = encodeURIComponent('Contact via vital.fr — ' + (payload['Sujet'] || ''));
        const body = encodeURIComponent(
          Object.entries(payload).map(([k, v]) => `${k} :\n${v}`).join('\n\n')
        );
        window.location.href = `mailto:vital@vital.fr,jadad@vital.fr?subject=${subject}&body=${body}`;
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Confirmation chip after Web3Forms redirect (?contact=ok)
  if (new URLSearchParams(location.search).get('contact') === 'ok') {
    const en = document.documentElement.lang === 'en';
    const flash = document.createElement('div');
    flash.textContent = en
      ? '✓ Message sent — we will reply within 24h.'
      : '✓ Message envoyé — nous répondons sous 24h.';
    Object.assign(flash.style, {
      position: 'fixed', bottom: '24px', left: '50%',
      transform: 'translateX(-50%)', zIndex: '9999',
      padding: '14px 22px', borderRadius: '999px',
      background: '#1a1a1a', color: '#fff',
      fontSize: '0.92rem', boxShadow: '0 8px 30px rgba(0,0,0,.3)',
    });
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 5000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLangSwitch();
  initMobileNav();
  initReveal();
  initCounters();
  initBeforeAfter();
  initContactModal();
  initScrollTop();
  initLocationMap();
});
