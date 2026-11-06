/* Advisor Quest — game engine */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const rand = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const SAVE = 'advisorQuest.save.v1', ACH = 'advisorQuest.ach.v1', OPT = 'advisorQuest.opt.v1';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const SD = Object.fromEntries(STUDENTS.map((s) => [s.id, s]));
  const SC = Object.fromEntries(SCENES.map((s) => [s.id, s]));
  const EV = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
  const PK = Object.fromEntries(PERKS.map((p) => [p.id, p]));
  const FIXED_EVENTS = { 1: 'welcome', 4: 'inbox', 6: 'midterms', 9: 'regweek', 10: 'inbox', 12: 'finals' };
  const MAX_WEEKS = 12;

  let S = null;                       // game state (saved)
  let opts = store.get(OPT, { sound: true });
  let achs = store.get(ACH, {});
  let modal = null;                   // {type, arg}
  let titleView = 'main';             // 'main' | 'difficulty'
  let inboxTimer = null, fbTimer = null;

  const first = (id) => SD[id].name.split(' ')[0];
  const st = (id) => S.students.find((x) => x.id === id);
  const has = (perk) => S.perks.includes(perk);
  const fmt = (t, id) => esc(t).replaceAll('{n}', id ? esc(first(id)) : 'they');
  const diff = () => DIFFICULTIES[S.diff];
  const save = () => { if (S) store.set(SAVE, S); };

  /* ---------------- Sound ---------------- */
  let actx = null;
  function sound(kind) {
    if (!opts.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = { click: [520], good: [660, 880], bad: [260, 180], ach: [660, 880, 1175], page: [400] }[kind] || [440];
      notes.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        const t0 = actx.currentTime + i * 0.09;
        o.type = kind === 'bad' ? 'square' : 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(kind === 'bad' ? 0.03 : 0.07, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        o.connect(g).connect(actx.destination);
        o.start(t0); o.stop(t0 + 0.18);
      });
    } catch { /* audio unavailable */ }
  }

  /* ---------------- Achievements & toasts ---------------- */
  function toast(html, cls = '') {
    let wrap = $('#toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; document.body.appendChild(wrap); }
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.innerHTML = html;
    wrap.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }
  function unlock(id) {
    if (achs[id]) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    achs[id] = Date.now();
    store.set(ACH, achs);
    sound('ach');
    toast(`<span class="toast-icon">${a.icon}</span><div><b>Achievement unlocked</b><br>${esc(a.name)}</div>`, 'ach');
  }

  /* ---------------- Effects ---------------- */
  const FX_META = {
    s: { label: 'Stress', good: (v) => v < 0 },
    t: { label: 'Trust', good: (v) => v > 0 },
    g: { label: 'GPA', good: (v) => v > 0 },
    p: { label: 'Progress', good: (v) => v > 0 },
    e: { label: 'Energy', good: (v) => v > 0 },
    r: { label: 'Reputation', good: (v) => v > 0 },
    k: { label: 'Kudos', good: (v) => v > 0 },
  };
  function chip(key, v, prefix = '') {
    const m = FX_META[key];
    const shown = key === 'g' ? Math.abs(v).toFixed(2) : Math.abs(Math.round(v));
    return { text: `${prefix}${m.label} ${v > 0 ? '+' : '−'}${shown}`, good: m.good(v) };
  }
  function applyToStudent(s, key, v) {
    if (key === 's') s.stress = clamp(s.stress + v);
    else if (key === 't') s.trust = clamp(s.trust + v);
    else if (key === 'g') s.gpa = Math.round(clamp(s.gpa + v, 0, 4) * 100) / 100;
    else if (key === 'p') s.progress = clamp(s.progress + v);
  }
  function applyToAdvisor(key, v) {
    if (key === 'e') {
      S.energy = clamp(S.energy + v, 0, 100);
      if (S.energy <= 0) { S.stats.energyZero = true; unlock('burnout'); }
    } else if (key === 'r') S.rep = clamp(S.rep + v);
    else if (key === 'k') S.kudos = Math.max(0, S.kudos + v);
  }
  function applyFx(fx = {}, s = null, all = null) {
    const chips = [];
    for (const [k, v] of Object.entries(fx)) {
      if (!v) continue;
      if ('stgp'.includes(k)) { if (s) { applyToStudent(s, k, v); chips.push(chip(k, v)); } }
      else { applyToAdvisor(k, v); chips.push(chip(k, v)); }
    }
    if (all) {
      for (const stu of S.students) if (stu.status === 'active') for (const [k, v] of Object.entries(all)) applyToStudent(stu, k, v);
      for (const [k, v] of Object.entries(all)) if (v) chips.push(chip(k, v, 'All advisees: '));
    }
    return chips;
  }
  const chipsHTML = (chips) => chips.length
    ? `<div class="chips">${chips.map((c) => `<span class="chip ${c.good ? 'good' : 'bad'}">${esc(c.text)}</span>`).join('')}</div>` : '';

  /* ---------------- Game flow ---------------- */
  function newGame(d) {
    const D = DIFFICULTIES[d];
    S = {
      v: 1, diff: d, week: 1, energy: 100, rep: 50, kudos: D.kudos, perks: [],
      students: STUDENTS.map((s) => ({ id: s.id, stress: clamp(s.stress + D.stress), trust: s.trust, gpa: s.gpa, progress: s.progress,
        status: 'active', flags: {}, done: [], notes: [], seen: 0 })),
      queue: [], slots: 3, slotsUsed: 0, phase: 'event', event: null, eventResult: null, usedEvents: [],
      current: null, planner: null, inbox: null, summary: null,
      stats: { meetings: 0, perfect: 0, crises: 0, energyZero: false, inboxBest: 0 },
    };
    startWeek();
  }

  function startWeek() {
    S.slots = 3 + (has('hours') ? 1 : 0);
    S.slotsUsed = 0;
    S.queue = [];
    S.current = null;
    let id = FIXED_EVENTS[S.week];
    if (!id) {
      const pool = EVENTS.filter((e) => !e.fixed && !S.usedEvents.includes(e.id));
      id = (pool.length ? rand(pool) : rand(EVENTS.filter((e) => !e.fixed))).id;
      S.usedEvents.push(id);
    }
    S.event = id;
    S.eventResult = null;
    S.phase = 'event';
    save();
    render();
  }

  function eventChoose(i) {
    const ev = EV[S.event];
    const ch = ev.choices[i];
    if (ch.need && !has(ch.need)) return;
    if (ev.special === 'inbox') { startInbox(); return; }
    let fx = { ...(ch.fx || {}) }, out = ch.out;
    if (ch.roll) {
      const win = Math.random() < ch.roll.p;
      const r = win ? ch.roll.win : ch.roll.lose;
      for (const [k, v] of Object.entries(r.fx)) fx[k] = (fx[k] || 0) + v;
      out = r.out;
    }
    const chips = applyFx(fx, null, ch.all);
    if (ch.slots) { S.slots = Math.max(1, S.slots + ch.slots); chips.push({ text: `Appointments ${ch.slots > 0 ? '+' : '−'}${Math.abs(ch.slots)}`, good: ch.slots > 0 }); }
    if (ch.ach) unlock(ch.ach);
    S.eventResult = { label: ch.label, out, chips };
    sound(chips.some((c) => !c.good) && !chips.some((c) => c.good) ? 'bad' : 'good');
    save();
    render();
  }

  function openOffice() {
    buildQueue();
    S.phase = 'office';
    save();
    render();
  }

  function pickScene(s, taken) {
    if (s.stress >= 90) return 'crisis';
    if ((S.week === 9 || S.week === 10) && !s.flags.registered) return 'registration';
    const ok = (sc) => (sc.minWeek || 1) <= S.week && !s.done.includes(sc.id) && (!sc.req || sc.req(S, s));
    const arcs = SCENES.filter((sc) => sc.who === s.id && ok(sc));
    const gens = SCENES.filter((sc) => !sc.who && !sc.special && ok(sc) && !taken.includes(sc.id));
    if (arcs.length && (Math.random() < 0.65 || !gens.length)) return arcs[0].id;
    if (gens.length) return rand(gens).id;
    return 'vent';
  }

  function buildQueue() {
    S.queue = [];
    const active = S.students.filter((s) => s.status === 'active');
    const regWeek = S.week === 9 || S.week === 10;
    const scored = active.map((s) => {
      let n = s.stress * 0.6 + (100 - s.trust) * 0.15 + Math.random() * 45;
      if (s.stress >= 90) n += 1000;
      if (regWeek && !s.flags.registered) n += 30;
      return { s, n };
    }).sort((a, b) => b.n - a.n);
    const count = Math.min(active.length, S.slots + 2);
    const taken = [];
    for (const { s } of scored.slice(0, count)) {
      const scene = pickScene(s, taken);
      taken.push(scene);
      S.queue.push({ sid: s.id, scene, seen: false });
    }
  }

  const meetingCost = (sc) => Math.max(4, (sc.cost || 10) - (has('mindful') ? 3 : 0));

  function startMeeting(i) {
    const q = S.queue[i];
    if (!q || q.seen || S.slotsUsed >= S.slots) return;
    const sc = SC[q.scene];
    const c = meetingCost(sc);
    if (S.energy < c) return;
    S.energy -= c;
    q.seen = true;
    S.slotsUsed++;
    S.stats.meetings++;
    const s = st(q.sid);
    s.seen++;
    if (has('candy')) s.trust = clamp(s.trust + 3);
    S.current = { sid: q.sid, scene: q.scene, result: null, cost: c };
    S.phase = 'meeting';
    unlock('first_meeting');
    sound('page');
    save();
    render();
  }

  function rollChance(ch, s) { return clamp(ch.roll.p + (s.trust - 50) / 250, 0.05, 0.95); }

  function choose(i) {
    const cur = S.current;
    if (!cur || cur.result) return;
    const sc = SC[cur.scene], ch = sc.choices[i], s = st(cur.sid);
    if (ch.need && !has(ch.need)) return;
    const fx = { ...(ch.fx || {}) };
    let out = ch.out || '', rolled = null;
    if (ch.roll) {
      const win = Math.random() < rollChance(ch, s);
      const r = win ? ch.roll.win : ch.roll.lose;
      for (const [k, v] of Object.entries(r.fx)) fx[k] = (fx[k] || 0) + v;
      out = r.out;
      rolled = win ? 'win' : 'lose';
    }
    const chips = applyFx(fx, s);
    if (ch.flag) s.flags[ch.flag] = true;
    if (!sc.repeat) s.done.push(sc.id);
    if (ch.ach) unlock(ch.ach);
    if (sc.id === 'crisis' && (fx.s || 0) <= -20) { S.stats.crises++; unlock('crisis_hero'); }
    s.notes.unshift({ w: S.week, t: `${sc.title} — ${ch.label}${rolled ? (rolled === 'win' ? ' (it worked!)' : ' (it didn\'t land)') : ''}` });
    cur.result = { out, chips, rolled, planner: !!ch.planner };
    const good = chips.filter((c) => c.good).length, bad = chips.length - good;
    sound(good >= bad ? 'good' : 'bad');
    save();
    render();
  }

  function afterMeeting() {
    const cur = S.current;
    if (cur && cur.result && cur.result.planner) { startPlanner(cur.sid); return; }
    S.current = null;
    S.phase = 'office';
    save();
    render();
  }

  function coffeeBreak() {
    if (S.slotsUsed >= S.slots) return;
    S.slotsUsed++;
    applyToAdvisor('e', 14);
    toast('<span class="toast-icon">☕</span><div><b>Coffee break</b><br>Energy +14</div>');
    sound('good');
    save();
    render();
  }

  /* ---------------- Course Planner ---------------- */
  function startPlanner(sid) {
    S.planner = { sid, picks: [], result: null };
    S.current = null;
    S.phase = 'planner';
    save();
    render();
  }

  function courseIssues(plan, course, picks, idx) {
    const issues = [];
    if (course.full) issues.push('Section is full');
    const missing = course.pre.filter((p) => !plan.completed.includes(p));
    if (missing.length) issues.push(`Needs ${missing.join(', ')}`);
    if (plan.avoid.includes(course.t)) issues.push(`${course.t} conflicts: ${plan.avoidWhy}`);
    for (const j of picks) {
      if (j === idx) continue;
      const o = plan.catalog[j];
      if (course.t !== 'Online' && o.t === course.t) issues.push(`Time conflict with ${o.c}`);
      if (o.c === course.c) issues.push(`Duplicate of ${o.c}`);
    }
    return issues;
  }

  function evaluatePlan(sid, picks) {
    const plan = PLANS[sid], s = st(sid);
    const courses = picks.map((i) => plan.catalog[i]);
    const errors = [], warns = [];
    const credits = courses.reduce((a, c) => a + c.cr, 0);
    const dsum = courses.reduce((a, c) => a + c.d, 0);
    const reqCount = new Set(courses.filter((c) => c.req).map((c) => c.c)).size;
    const cap = plan.maxDiff - (s.stress >= 65 ? 2 : 0);
    const minCr = plan.minCredits || 12;
    if (credits < minCr) errors.push(`Only ${credits} credits — under ${minCr} means part-time status${sid === 'devon' ? ' and lost athletic eligibility' : ' (financial aid at risk)'}.`);
    if (credits > 18) errors.push(`${credits} credits is an overload — needs a petition nobody will approve.`);
    courses.forEach((c) => {
      if (c.full) errors.push(`${c.c} ${c.n} is full — ${first(sid)} would be stuck on the waitlist.`);
      const missing = c.pre.filter((p) => !plan.completed.includes(p));
      if (missing.length) errors.push(`${c.c} requires ${missing.join(' & ')}, which ${first(sid)} hasn't taken.`);
      if (plan.avoid.includes(c.t)) errors.push(`${c.c} meets ${c.t} — conflicts with ${plan.avoidWhy.toLowerCase()}.`);
    });
    const seenCodes = new Set(), seenTimes = new Map();
    courses.forEach((c) => {
      if (seenCodes.has(c.c)) errors.push(`${c.c} is in the schedule twice.`);
      seenCodes.add(c.c);
      if (c.t !== 'Online') {
        if (seenTimes.has(c.t)) errors.push(`${c.c} and ${seenTimes.get(c.t)} both meet ${c.t}.`);
        else seenTimes.set(c.t, c.c);
      }
    });
    if (plan.must && !courses.some((c) => plan.must.includes(c.c))) errors.push(`Missing ${plan.mustWhy}.`);
    const heavy = dsum > cap;
    if (heavy) warns.push(`Difficulty ${dsum}/${cap}: a brutal load for someone at ${first(sid)}'s stress level.`);
    if (reqCount < 3) warns.push(`Only ${reqCount} degree requirement${reqCount === 1 ? '' : 's'} — aim for 3+ to keep progress on track.`);
    let grade;
    if (!errors.length && reqCount >= 3 && !heavy) grade = 'perfect';
    else if (!errors.length) grade = 'good';
    else if (errors.length === 1) grade = 'shaky';
    else grade = 'bad';
    return { errors, warns, credits, dsum, cap, reqCount, grade, heavy };
  }

  function togglePick(i) {
    const P = S.planner;
    if (!P || P.result) return;
    const k = P.picks.indexOf(i);
    if (k >= 0) P.picks.splice(k, 1); else P.picks.push(i);
    sound('click');
    save();
    render();
  }

  function submitPlan() {
    const P = S.planner;
    if (!P || P.result || !P.picks.length) return;
    const s = st(P.sid);
    const ev = evaluatePlan(P.sid, P.picks);
    const FX = {
      perfect: { p: 15, s: -6, t: 8, r: 4, k: 2 },
      good: { p: 10, s: -2, t: 4, r: 2, k: 1 },
      shaky: { p: 2, s: 6, t: -3, r: -1 },
      bad: { p: -6, s: 12, t: -8, r: -3 },
    };
    const fx = { ...FX[ev.grade] };
    if (ev.heavy) fx.s = (fx.s || 0) + 10;
    if (has('audit') && (ev.grade === 'perfect' || ev.grade === 'good')) fx.p += 5;
    const chips = applyFx(fx, s);
    s.flags.registered = true;
    if (P.sid === 'marcus' && !ev.errors.length) s.flags.marcus_lab = true;
    if (ev.grade === 'perfect') { S.stats.perfect++; unlock('perfect_plan'); }
    s.notes.unshift({ w: S.week, t: `Course Planner — ${{ perfect: 'flawless schedule', good: 'solid schedule', shaky: 'shaky schedule', bad: 'registration disaster' }[ev.grade]}` });
    P.result = { ...ev, chips };
    sound(ev.grade === 'perfect' || ev.grade === 'good' ? 'good' : 'bad');
    save();
    render();
  }

  function plannerDone() {
    S.planner = null;
    S.phase = 'office';
    save();
    render();
  }

  /* ---------------- Inbox Avalanche ---------------- */
  function startInbox() {
    const total = 8;
    const max = 45 + (has('templates') ? 15 : 0);
    S.inbox = { ids: shuffle(EMAILS.map((_, i) => i)).slice(0, total), i: 0, correct: 0, time: max, max, fb: null, done: false, chips: [] };
    S.phase = 'inbox';
    save();
    render();
    runInboxTimer();
  }
  function runInboxTimer() {
    clearInterval(inboxTimer);
    inboxTimer = setInterval(() => {
      const I = S && S.inbox;
      if (!I || I.done || S.phase !== 'inbox') { clearInterval(inboxTimer); return; }
      if (I.fb) return; // paused during feedback
      I.time--;
      const t = $('#inbox-time');
      if (t) { t.textContent = I.time; t.parentElement.classList.toggle('urgent', I.time <= 10); }
      const bar = $('#inbox-timebar');
      if (bar) bar.style.width = `${(I.time / I.max) * 100}%`;
      if (I.time <= 0) finishInbox();
    }, 1000);
  }
  function inboxAnswer(a) {
    const I = S.inbox;
    if (!I || I.done || I.fb) return;
    const em = EMAILS[I.ids[I.i]];
    const ok = em.a === a;
    if (ok) I.correct++;
    I.fb = { ok, why: em.why, picked: a };
    sound(ok ? 'good' : 'bad');
    render();
    clearTimeout(fbTimer);
    fbTimer = setTimeout(() => {
      I.fb = null;
      I.i++;
      if (I.i >= I.ids.length) finishInbox(); else render();
    }, ok ? 900 : 1900);
  }
  function finishInbox() {
    const I = S.inbox;
    if (!I || I.done) return;
    clearInterval(inboxTimer);
    clearTimeout(fbTimer);
    I.fb = null;
    I.done = true;
    const n = I.ids.length;
    const fx = { e: -8, r: Math.round((I.correct - n / 2) * 1.5), k: I.correct >= n - 1 ? 2 : I.correct >= n / 2 + 1 ? 1 : 0 };
    I.chips = applyFx(fx);
    S.stats.inboxBest = Math.max(S.stats.inboxBest, I.correct);
    if (I.correct === n) unlock('inbox_zero');
    save();
    render();
  }

  /* ---------------- End of week ---------------- */
  function endWeek() {
    const D = diff();
    const sum = { week: S.week, missed: [], withdrew: [], changes: [], kudos: 0, energy: 0 };
    const peer = has('peers');
    for (const q of S.queue) {
      if (q.seen) continue;
      const s = st(q.sid);
      if (s.status !== 'active') continue;
      s.trust = clamp(s.trust - (peer ? 3 : 7));
      s.stress = clamp(s.stress + (peer ? 3 : 6));
      s.notes.unshift({ w: S.week, t: 'Requested an appointment — you couldn\'t fit them in.' });
      sum.missed.push({ id: q.sid, crisis: q.scene === 'crisis' });
    }
    const drift = [6, 7].includes(S.week) ? 4 : [11, 12].includes(S.week) ? 5 : -2;
    for (const s of S.students) {
      if (s.status !== 'active') continue;
      const b = { s: s.stress, g: s.gpa, p: s.progress, t: s.trust };
      s.stress = clamp(s.stress + drift + (D.stress > 0 ? 1 : 0));
      s.gpa = Math.round(clamp(s.gpa + (50 - s.stress) / 900, 0, 4) * 100) / 100;
      s.progress = clamp(s.progress + (s.gpa >= 3 ? 2 : s.gpa >= 2 ? 1 : -2) - (s.stress >= 85 ? 2 : 0));
      const missedCrisis = sum.missed.some((m) => m.id === s.id && m.crisis);
      if ((missedCrisis && s.trust < 60) || (s.stress >= 100 && s.trust < 35)) {
        s.status = 'withdrew';
        s.withdrewWeek = S.week;
        s.notes.unshift({ w: S.week, t: 'Withdrew from the university.' });
        sum.withdrew.push(s.id);
      }
      sum.changes.push({ id: s.id, ds: s.stress - b.s, dg: Math.round((s.gpa - b.g) * 100) / 100, dp: s.progress - b.p, dt: s.trust - b.t });
    }
    const regen = Math.max(10, 35 + (has('espresso') ? 15 : 0) + D.regen);
    const before = S.energy;
    S.energy = clamp(S.energy + regen);
    sum.energy = S.energy - before;
    sum.kudos = 1 + (S.rep >= 65 ? 1 : 0) + (sum.missed.length === 0 ? 1 : 0);
    S.kudos += sum.kudos;
    S.summary = sum;
    S.phase = 'summary';
    sound('page');
    save();
    render();
    window.scrollTo({ top: 0 });
  }

  function buyPerk(id) {
    const p = PK[id];
    if (!p || has(id) || S.kudos < p.cost) return;
    S.kudos -= p.cost;
    S.perks.push(id);
    if (id === 'hours') { /* applies from next week */ }
    sound('ach');
    toast(`<span class="toast-icon">${p.icon}</span><div><b>Perk acquired</b><br>${esc(p.name)}</div>`);
    if (PERKS.every((x) => has(x.id))) unlock('shopaholic');
    save();
    render();
  }

  function nextWeek() {
    if (S.week >= MAX_WEEKS) { finish(); return; }
    S.week++;
    S.summary = null;
    startWeek();
    window.scrollTo({ top: 0 });
  }

  /* ---------------- Ending ---------------- */
  function studentScore(s) {
    if (s.status !== 'active') return 0;
    return Math.round(s.progress * 0.4 + (s.gpa / 4) * 100 * 0.3 + (100 - s.stress) * 0.15 + s.trust * 0.15);
  }
  function tier(score, s) {
    if (s.status !== 'active') return { name: 'Withdrew', cls: 'withdrew', ep: 2 };
    if (score >= 72) return { name: 'Thriving', cls: 'thriving', ep: 0 };
    if (score >= 55) return { name: 'On Track', cls: 'ontrack', ep: 1 };
    if (score >= 40) return { name: 'Struggling', cls: 'struggling', ep: 1 };
    return { name: 'At Risk', cls: 'atrisk', ep: 2 };
  }
  function finish() {
    const scores = S.students.map(studentScore);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const final = Math.round(avg * 0.75 + S.rep * 0.25);
    S.final = { score: final, avg: Math.round(avg) };
    S.phase = 'ending';
    unlock('finish');
    if (S.students.every((s) => s.status === 'active')) unlock('no_withdraw');
    if (S.students.every((s) => tier(studentScore(s), s).name === 'Thriving')) unlock('all_thriving');
    if (S.diff === 'hard') unlock('hard_mode');
    const best = store.get('advisorQuest.best', 0);
    if (final > best) { store.set('advisorQuest.best', final); S.final.newBest = true; }
    save();
    render();
    window.scrollTo({ top: 0 });
  }
  function advisorTitle(score) {
    if (score >= 82) return ['🏆', 'Legendary Advisor', 'Students will name a campus bench after you. Possibly a building.'];
    if (score >= 70) return ['🌟', 'Advisor of the Year', 'The Dean mentions you by name at convocation. Your students would follow you anywhere (to office hours).'];
    if (score >= 58) return ['🧭', 'Trusted Guide', 'Solid, caring, dependable. Your advisees know your door is open.'];
    if (score >= 45) return ['📚', 'Finding Your Footing', 'A tough semester, but you learned a lot. Next term will be better.'];
    return ['🫠', 'Overwhelmed but Trying', 'Advising is hard. Rest up, refill the candy drawer, and try again.'];
  }

  /* ---------------- Rendering ---------------- */
  const bar = (v, cls, label) => `<div class="meter ${cls}" title="${label}: ${Math.round(v)}"><span style="width:${clamp(v)}%"></span></div>`;
  const avatar = (id, size = '') => `<div class="avatar ${size}" style="--av:${SD[id].color}"><span>${SD[id].emoji}</span></div>`;

  function hud() {
    const pct = ((S.week - 1) / MAX_WEEKS) * 100;
    return `
    <header class="hud">
      <button class="brand" data-act="menu" aria-label="Main menu"><span class="crest">🎓</span><span>Advisor Quest</span></button>
      <div class="hud-week">
        <div class="hud-label">Week <b>${S.week}</b> of ${MAX_WEEKS}</div>
        <div class="weekbar"><span style="width:${pct}%"></span></div>
      </div>
      <div class="hud-stats">
        <div class="stat" title="Your energy. Meetings cost energy; it recovers each week."><span class="stat-ic">⚡</span><div><small>Energy</small>${bar(S.energy, 'energy', 'Energy')}</div><b>${Math.round(S.energy)}</b></div>
        <div class="stat" title="Your professional reputation."><span class="stat-ic">⭐</span><div><small>Reputation</small>${bar(S.rep, 'rep', 'Reputation')}</div><b>${Math.round(S.rep)}</b></div>
        <div class="stat kudos" title="Kudos — spend them on perks at the end of each week."><span class="stat-ic">🎖️</span><div><small>Kudos</small></div><b>${S.kudos}</b></div>
      </div>
      <div class="hud-btns">
        <button class="icon-btn" data-act="help" aria-label="How to play" title="How to play">❔</button>
        <button class="icon-btn" data-act="sound" aria-label="Toggle sound" title="Toggle sound">${opts.sound ? '🔊' : '🔈'}</button>
      </div>
    </header>`;
  }

  function roster() {
    const queued = new Set(S.queue.filter((q) => !q.seen).map((q) => q.sid));
    return `<aside class="roster">
      <h3>Your Advisees</h3>
      <div class="roster-list">
      ${S.students.map((s) => {
        const d = SD[s.id];
        const gone = s.status !== 'active';
        return `<button class="r-card ${gone ? 'gone' : ''} ${s.stress >= 90 && !gone ? 'crisis' : ''}" data-act="student" data-arg="${s.id}">
          ${avatar(s.id, 'sm')}
          <div class="r-body">
            <div class="r-top"><b>${esc(d.name)}</b>${queued.has(s.id) ? '<span class="dot" title="Requested an appointment"></span>' : ''}</div>
            <div class="r-sub">${esc(d.major)} · GPA ${s.gpa.toFixed(2)}</div>
            ${gone ? '<div class="r-gone">Withdrew</div>' : `
            <div class="r-meters">
              <label>Stress</label>${bar(s.stress, 'stress', 'Stress')}
              <label>Trust</label>${bar(s.trust, 'trust', 'Trust')}
              <label>Progress</label>${bar(s.progress, 'prog', 'Degree progress')}
            </div>`}
          </div>
        </button>`;
      }).join('')}
      </div>
    </aside>`;
  }

  function shell(stage) {
    return `${hud()}<main class="layout">${roster()}<section class="stage">${stage}</section></main>${modalHTML()}`;
  }

  /* ---- Title ---- */
  function renderTitle() {
    const saved = store.get(SAVE, null);
    const canContinue = saved && saved.phase !== 'ending';
    const best = store.get('advisorQuest.best', 0);
    const nAch = Object.keys(achs).length;
    let inner;
    if (titleView === 'difficulty') {
      inner = `<h2 class="t-sub">Choose your semester</h2>
        <div class="diffs">${Object.entries(DIFFICULTIES).map(([k, d]) => `
          <button class="diff-card" data-act="new" data-arg="${k}">
            <span class="diff-ic">${d.icon}</span><b>${esc(d.name)}</b><small>${esc(d.desc)}</small>
          </button>`).join('')}</div>
        <button class="btn ghost" data-act="title-back">← Back</button>`;
    } else {
      inner = `
        <div class="title-btns">
          ${canContinue ? `<button class="btn primary big" data-act="continue">Continue — Week ${saved.week}</button>` : ''}
          <button class="btn ${canContinue ? '' : 'primary'} big" data-act="choose-diff">${canContinue ? 'New Semester' : 'Begin Your Semester'}</button>
          <div class="title-row">
            <button class="btn ghost" data-act="help">How to Play</button>
            <button class="btn ghost" data-act="achievements">Achievements (${nAch}/${ACHIEVEMENTS.length})</button>
          </div>
        </div>
        ${best ? `<p class="best">Best advisor score: <b>${best}</b></p>` : ''}`;
    }
    app.innerHTML = `
      <div class="title-screen">
        <div class="floaters" aria-hidden="true">${['📚', '✉️', '☕', '📝', '🎓', '📅', '🖇️', '💡', '📎', '🍎'].map((e, i) => `<span style="--i:${i}">${e}</span>`).join('')}</div>
        <div class="title-card">
          <div class="title-crest">🎓</div>
          <h1>Advisor Quest</h1>
          <p class="tagline">One semester. Eight advisees. Infinite emails.</p>
          <p class="pitch">You're the newest academic advisor at <b>Quill &amp; Ivy University</b>. Guide your students through crises, course registration, and existential dread — while keeping your own energy (and the candy drawer) stocked.</p>
          ${inner}
        </div>
        <footer class="title-foot">Sound ${opts.sound ? 'on' : 'off'} · <button class="linklike" data-act="sound">toggle</button></footer>
      </div>${modalHTML()}`;
  }

  /* ---- Event ---- */
  function renderEvent() {
    const ev = EV[S.event];
    const R = S.eventResult;
    let body;
    if (R) {
      body = `<div class="result-box"><div class="you-chose">You chose: <b>${esc(R.label)}</b></div><p>${esc(R.out)}</p>${chipsHTML(R.chips)}</div>
        <div class="actions-row"><button class="btn primary" data-act="office">Open office hours →</button></div>`;
    } else {
      body = `<div class="choices">${ev.choices.map((c, i) => {
        const locked = c.need && !has(c.need);
        return `<button class="choice ${locked ? 'locked' : ''}" data-act="event-choose" data-arg="${i}" ${locked ? 'disabled' : ''}>
          <span class="choice-text">${esc(c.label)}</span>
          ${locked ? `<span class="tag lock">🔒 Requires ${esc(PK[c.need].name)}</span>` : ''}
          ${c.roll ? '<span class="tag roll">🎲 Risky</span>' : ''}
        </button>`;
      }).join('')}</div>`;
    }
    const kind = ev.fixed ? 'Week ' + S.week + ' · Campus Calendar' : 'Week ' + S.week + ' · Random Event';
    app.innerHTML = shell(`
      <div class="card event-card pop">
        <div class="eyebrow">${kind}</div>
        <div class="event-head"><span class="event-icon">${ev.icon}</span><h2>${esc(ev.title)}</h2></div>
        <p class="lead">${esc(ev.text)}</p>
        ${body}
      </div>`);
  }

  /* ---- Office ---- */
  function renderOffice() {
    const left = S.slots - S.slotsUsed;
    const waiting = S.queue.filter((q) => !q.seen);
    const slotDots = Array.from({ length: S.slots }, (_, i) => `<span class="slot ${i < S.slotsUsed ? 'used' : ''}"></span>`).join('');
    const cards = S.queue.map((q, i) => {
      const s = st(q.sid), d = SD[q.sid], sc = SC[q.scene];
      const cost = meetingCost(sc);
      const urgent = q.scene === 'crisis';
      const cantAfford = S.energy < cost;
      const disabled = q.seen || left <= 0 || cantAfford;
      return `<div class="appt ${q.seen ? 'seen' : ''} ${urgent ? 'urgent' : ''}">
        ${avatar(q.sid)}
        <div class="appt-body">
          <div class="appt-name"><b>${esc(d.name)}</b> <small>${esc(d.year)} · ${esc(d.major)}</small></div>
          <div class="appt-topic">${esc(sc.hint)}</div>
          <div class="appt-meta"><span>Stress ${Math.round(s.stress)}</span><span>Trust ${Math.round(s.trust)}</span><span>⚡ ${cost}</span></div>
        </div>
        <button class="btn ${urgent ? 'danger' : 'primary'}" data-act="meet" data-arg="${i}" ${disabled ? 'disabled' : ''}>
          ${q.seen ? 'Seen ✓' : cantAfford ? 'Too tired' : left <= 0 ? 'No slots' : 'Meet'}
        </button>
      </div>`;
    }).join('');
    const unseen = waiting.length;
    app.innerHTML = shell(`
      <div class="card office pop">
        <div class="office-head">
          <div>
            <div class="eyebrow">Week ${S.week} · Office Hours</div>
            <h2>Appointment Requests</h2>
          </div>
          <div class="slots" title="Appointment slots this week">${slotDots}<small>${left} left</small></div>
        </div>
        <p class="hint">${left > 0
          ? `You can see <b>${left}</b> more student${left === 1 ? '' : 's'} this week. Anyone you can't see loses trust and gains stress.`
          : 'Your calendar is full. Time to wrap up the week.'}</p>
        <div class="appts">${cards || '<p class="muted">No requests this week. Suspicious...</p>'}</div>
        <div class="actions-row">
          <button class="btn ghost" data-act="coffee" ${left <= 0 ? 'disabled' : ''} title="Uses one appointment slot">☕ Coffee break <small>(+14 ⚡, uses a slot)</small></button>
          <button class="btn ${left <= 0 || !unseen ? 'primary' : ''}" data-act="end-week">Wrap up week ${S.week} →${unseen && left > 0 ? ` <small>(${unseen} waiting)</small>` : ''}</button>
        </div>
      </div>`);
  }

  /* ---- Meeting ---- */
  function renderMeeting() {
    const cur = S.current, sc = SC[cur.scene], s = st(cur.sid), d = SD[cur.sid];
    let body;
    if (cur.result) {
      const R = cur.result;
      body = `<div class="result-box ${R.rolled || ''}">
          ${R.rolled ? `<div class="roll-badge ${R.rolled}">${R.rolled === 'win' ? '🎲 It worked!' : '🎲 Didn\'t land'}</div>` : ''}
          <p>${fmt(R.out, cur.sid)}</p>${chipsHTML(R.chips)}
        </div>
        <div class="actions-row"><button class="btn primary" data-act="after-meeting">${R.planner ? 'Open Course Planner →' : 'Back to office hours →'}</button></div>`;
    } else {
      body = `<div class="choices">${sc.choices.map((c, i) => {
        const locked = c.need && !has(c.need);
        const pct = c.roll ? Math.round(rollChance(c, s) * 100) : null;
        return `<button class="choice ${locked ? 'locked' : ''}" data-act="choose" data-arg="${i}" ${locked ? 'disabled' : ''}>
          <span class="choice-text">${fmt(c.label, cur.sid)}</span>
          ${locked ? `<span class="tag lock">🔒 Requires ${esc(PK[c.need].name)}</span>` : ''}
          ${pct !== null ? `<span class="tag roll" title="Higher trust improves your odds">🎲 ~${pct}% chance</span>` : ''}
          ${c.planner ? '<span class="tag plan">🧩 Minigame</span>' : ''}
        </button>`;
      }).join('')}</div>`;
    }
    app.innerHTML = shell(`
      <div class="card meeting pop">
        <div class="meeting-side">
          ${avatar(cur.sid, 'lg')}
          <h3>${esc(d.name)}</h3>
          <div class="muted small">${esc(d.year)} · ${esc(d.major)}</div>
          <div class="mini-stats">
            <div><label>Stress</label>${bar(s.stress, 'stress', 'Stress')}<b>${Math.round(s.stress)}</b></div>
            <div><label>Trust</label>${bar(s.trust, 'trust', 'Trust')}<b>${Math.round(s.trust)}</b></div>
            <div><label>Progress</label>${bar(s.progress, 'prog', 'Progress')}<b>${Math.round(s.progress)}</b></div>
            <div><label>GPA</label><span class="gpa">${s.gpa.toFixed(2)}</span></div>
          </div>
        </div>
        <div class="meeting-main">
          <div class="eyebrow">Appointment · ⚡ −${cur.cost}</div>
          <h2>${esc(sc.title)}</h2>
          <p class="lead">${fmt(sc.text, cur.sid)}</p>
          ${body}
        </div>
      </div>`);
  }

  /* ---- Planner ---- */
  function renderPlanner() {
    const P = S.planner, plan = PLANS[P.sid], s = st(P.sid), d = SD[P.sid];
    const audit = has('audit');
    const live = evaluatePlan(P.sid, P.picks);
    const cards = plan.catalog.map((c, i) => {
      const picked = P.picks.includes(i);
      const issues = audit ? courseIssues(plan, c, P.picks, i) : [];
      return `<button class="course ${picked ? 'picked' : ''} ${audit && issues.length ? 'flagged' : ''}" data-act="pick" data-arg="${i}" ${P.result ? 'disabled' : ''} aria-pressed="${picked}">
        <div class="course-top"><b>${esc(c.c)}</b><span class="cr">${c.cr} cr</span></div>
        <div class="course-name">${esc(c.n)}</div>
        <div class="course-meta">
          <span class="time">🕘 ${esc(c.t)}</span>
          <span class="diffdots" title="Difficulty">${'●'.repeat(c.d)}${'○'.repeat(3 - c.d)}</span>
        </div>
        <div class="course-tags">
          ${c.req ? '<span class="tag req">Degree req.</span>' : '<span class="tag elective">Elective</span>'}
          ${c.full ? '<span class="tag full">FULL</span>' : ''}
          ${c.pre.length ? `<span class="tag pre">Prereq: ${esc(c.pre.join(', '))}</span>` : ''}
        </div>
        ${audit && issues.length ? `<div class="issues">⚠️ ${esc(issues.join(' · '))}</div>` : ''}
      </button>`;
    }).join('');

    let footer;
    if (P.result) {
      const R = P.result;
      const titles = { perfect: ['🧩', 'Flawless schedule!', 'The Registrar sheds a single proud tear.'], good: ['✅', 'Solid schedule', 'It works. A few things could be better, but it all registers.'], shaky: ['😬', 'Shaky schedule', 'One problem slipped through. Spring is going to be bumpy.'], bad: ['💥', 'Registration disaster', 'Error messages everywhere. ' + first(P.sid) + ' is not having a good Monday.'] }[R.grade];
      footer = `<div class="plan-result ${R.grade}">
        <h3>${titles[0]} ${titles[1]}</h3><p>${esc(titles[2])}</p>
        ${R.errors.length ? `<ul class="errs">${R.errors.map((e) => `<li>❌ ${esc(e)}</li>`).join('')}</ul>` : ''}
        ${R.warns.length ? `<ul class="warns">${R.warns.map((e) => `<li>⚠️ ${esc(e)}</li>`).join('')}</ul>` : ''}
        ${chipsHTML(R.chips)}
        <div class="actions-row"><button class="btn primary" data-act="planner-done">Back to office hours →</button></div>
      </div>`;
    } else {
      footer = `<div class="plan-bar">
        <div class="pb-stat ${live.credits >= (plan.minCredits || 12) && live.credits <= 18 ? 'ok' : ''}"><small>Credits</small><b>${live.credits}</b><span>/ 12–18</span></div>
        <div class="pb-stat ${live.reqCount >= 3 ? 'ok' : ''}"><small>Requirements</small><b>${live.reqCount}</b><span>/ 3+</span></div>
        <div class="pb-stat ${live.dsum <= live.cap ? 'ok' : 'warn'}"><small>Difficulty</small><b>${live.dsum}</b><span>/ ${live.cap} max</span></div>
        <button class="btn primary" data-act="submit-plan" ${P.picks.length ? '' : 'disabled'}>Register ${esc(first(P.sid))} →</button>
      </div>`;
    }

    app.innerHTML = shell(`
      <div class="card planner pop">
        <div class="eyebrow">Course Planner · Spring Registration</div>
        <h2>${avatar(P.sid, 'xs')} Build ${esc(first(P.sid))}'s schedule</h2>
        <div class="plan-info">
          <div><label>Degree</label><span>${esc(plan.degree)}</span></div>
          <div><label>Completed</label><span class="codes">${plan.completed.map((c) => `<code>${esc(c)}</code>`).join(' ')}</span></div>
          ${plan.avoid.length ? `<div><label>Can't attend</label><span>${plan.avoid.map((t) => `<code class="bad">${esc(t)}</code>`).join(' ')} — ${esc(plan.avoidWhy)}</span></div>` : ''}
          ${plan.must ? `<div><label>Must include</label><span>one of ${plan.must.map((c) => `<code>${esc(c)}</code>`).join(' ')} — ${esc(plan.mustWhy)}</span></div>` : ''}
          <div><label>Goals</label><span>${plan.minCredits || 12}–18 credits · 3+ degree requirements · no time conflicts · prereqs met · difficulty within ${live.cap}${s.stress >= 65 ? ' (lowered — stress is high)' : ''}</span></div>
        </div>
        ${audit ? '<p class="hint">📊 <b>Degree Audit Pro</b> is flagging problems for you.</p>' : '<p class="hint">Tip: check every prerequisite against the completed list — the catalog won\'t warn you. (Degree Audit Pro would.)</p>'}
        <div class="courses">${cards}</div>
        ${footer}
      </div>`);
  }

  /* ---- Inbox ---- */
  function renderInbox() {
    const I = S.inbox;
    let inner;
    if (I.done) {
      const n = I.ids.length;
      inner = `<div class="inbox-done">
        <div class="big-num">${I.correct}<small>/${n}</small></div>
        <h3>${I.correct === n ? 'Inbox Zero. Legendary.' : I.correct >= n - 2 ? 'Nicely triaged!' : I.correct >= n / 2 ? 'Mostly sorted.' : 'Several emails went to the wrong place...'}</h3>
        <p class="muted">Right referrals get students to the right help, fast.</p>
        ${chipsHTML(I.chips)}
        <div class="actions-row"><button class="btn primary" data-act="office">Open office hours →</button></div>
      </div>`;
    } else {
      const em = EMAILS[I.ids[I.i]];
      inner = `
        <div class="inbox-top">
          <div class="timer ${I.time <= 10 ? 'urgent' : ''}">⏱️ <b id="inbox-time">${I.time}</b>s</div>
          <div class="timebar"><span id="inbox-timebar" style="width:${(I.time / I.max) * 100}%"></span></div>
          <div class="count">${I.i + 1} / ${I.ids.length} · ✅ ${I.correct}</div>
        </div>
        <div class="email ${I.fb ? (I.fb.ok ? 'ok' : 'no') : ''}" >
          <div class="email-from">From: <b>${esc(em.from)}</b></div>
          <div class="email-subj">${esc(em.subj)}</div>
          ${I.fb ? `<div class="email-fb">${I.fb.ok ? '✅ Correct!' : '❌ Not quite.'} ${esc(em.why)}</div>` : ''}
        </div>
        <div class="inbox-actions">${INBOX_ACTIONS.map((a) => `
          <button class="btn inbox-btn ${I.fb && a.id === em.a ? 'correct' : ''} ${I.fb && !I.fb.ok && a.id === I.fb.picked ? 'wrong' : ''}" data-act="inbox" data-arg="${a.id}" ${I.fb ? 'disabled' : ''}>
            <span>${a.icon}</span>${esc(a.label)}
          </button>`).join('')}
        </div>
        <p class="hint center">Handle it yourself, refer to the right office, or archive the noise.</p>`;
    }
    app.innerHTML = shell(`
      <div class="card inbox pop">
        <div class="eyebrow">Minigame · Week ${S.week}</div>
        <h2>📬 Inbox Avalanche</h2>
        ${inner}
      </div>`);
  }

  /* ---- Summary + shop ---- */
  function renderSummary() {
    const sum = S.summary;
    const arrow = (v, invert, dec) => {
      if (!v) return '<span class="d0">—</span>';
      const good = invert ? v < 0 : v > 0;
      return `<span class="${good ? 'dgood' : 'dbad'}">${v > 0 ? '▲' : '▼'}${dec ? Math.abs(v).toFixed(2) : Math.abs(Math.round(v))}</span>`;
    };
    const rows = sum.changes.map((c) => `<tr>
        <td>${avatar(c.id, 'xs')} ${esc(first(c.id))}</td>
        <td>${arrow(c.ds, true)}</td><td>${arrow(c.dt)}</td><td>${arrow(c.dp)}</td><td>${arrow(c.dg, false, true)}</td>
      </tr>`).join('');
    const last = S.week >= MAX_WEEKS;
    const shop = PERKS.map((p) => {
      const own = has(p.id), afford = S.kudos >= p.cost;
      return `<div class="perk ${own ? 'owned' : ''}">
        <div class="perk-ic">${p.icon}</div>
        <div class="perk-body"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></div>
        <button class="btn sm ${own ? 'ghost' : afford ? 'primary' : ''}" data-act="buy" data-arg="${p.id}" ${own || !afford ? 'disabled' : ''}>${own ? 'Owned' : `🎖️ ${p.cost}`}</button>
      </div>`;
    }).join('');
    app.innerHTML = shell(`
      <div class="card summary pop">
        <div class="eyebrow">End of Week ${sum.week}</div>
        <h2>Weekly Report</h2>
        ${sum.withdrew.length ? `<div class="alert bad">💔 ${sum.withdrew.map((id) => `<b>${esc(SD[id].name)}</b>`).join(', ')} withdrew from the university. A crisis went unanswered.</div>` : ''}
        ${sum.missed.length ? `<div class="alert warn">📭 You couldn't see: ${sum.missed.map((m) => esc(first(m.id)) + (m.crisis ? ' 🚨' : '')).join(', ')}. They lost some trust and gained stress.</div>` : '<div class="alert good">🌟 You saw every student who asked this week!</div>'}
        <div class="sum-grid">
          <div class="sum-stat"><span>⚡</span><b>+${sum.energy}</b><small>Energy recovered</small></div>
          <div class="sum-stat"><span>🎖️</span><b>+${sum.kudos}</b><small>Kudos earned</small></div>
          <div class="sum-stat"><span>⭐</span><b>${Math.round(S.rep)}</b><small>Reputation</small></div>
        </div>
        <details class="changes" open>
          <summary>How your advisees' week went</summary>
          <table><thead><tr><th>Student</th><th>Stress</th><th>Trust</th><th>Progress</th><th>GPA</th></tr></thead><tbody>${rows || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
        </details>
        ${last ? '' : `<h3 class="shop-h">Professional Development Shop <span class="kudos-pill">🎖️ ${S.kudos} kudos</span></h3><div class="shop">${shop}</div>`}
        <div class="actions-row"><button class="btn primary big" data-act="next-week">${last ? 'See your annual review →' : `Start week ${S.week + 1} →`}</button></div>
      </div>`);
  }

  /* ---- Ending ---- */
  function renderEnding() {
    const F = S.final;
    const [ic, title, blurb] = advisorTitle(F.score);
    const cards = S.students.map((s) => {
      const sc = studentScore(s), t = tier(sc, s);
      return `<div class="ep ${t.cls}">
        ${avatar(s.id)}
        <div>
          <div class="ep-head"><b>${esc(SD[s.id].name)}</b><span class="tier ${t.cls}">${t.name}</span></div>
          <p>${esc(EPILOGUES[s.id][t.ep])}</p>
          <div class="muted small">GPA ${s.gpa.toFixed(2)} · Progress ${Math.round(s.progress)} · Trust ${Math.round(s.trust)}</div>
        </div>
      </div>`;
    }).join('');
    const shareText = `I finished a semester of Advisor Quest as "${title}" with a score of ${F.score}! 🎓`;
    app.innerHTML = `
      <div class="ending">
        <div class="card ending-card pop">
          <div class="eyebrow">Annual Performance Review · ${esc(DIFFICULTIES[S.diff].name)}</div>
          <div class="final-ic">${ic}</div>
          <h1>${esc(title)}</h1>
          <p class="lead center">${esc(blurb)}</p>
          <div class="final-score"><div><b>${F.score}</b><small>Advisor score${F.newBest ? ' · New best!' : ''}</small></div><div><b>${F.avg}</b><small>Avg. student outcome</small></div><div><b>${Math.round(S.rep)}</b><small>Reputation</small></div><div><b>${S.stats.meetings}</b><small>Meetings held</small></div></div>
          <h3>Where are they now?</h3>
          <div class="eps">${cards}</div>
          <div class="actions-row center">
            <button class="btn" data-act="copy-share" data-arg="${esc(shareText)}">📋 Copy result</button>
            <button class="btn ghost" data-act="achievements">🏅 Achievements</button>
            <button class="btn primary big" data-act="play-again">Play another semester</button>
          </div>
        </div>
      </div>${modalHTML()}`;
  }

  /* ---- Modals ---- */
  function modalHTML() {
    if (!modal) return '';
    let inner = '';
    if (modal.type === 'help') {
      inner = `<h2>How to Play</h2>
        <ol class="howto">
          <li><b>Each week</b> starts with a campus event. Then you hold <b>office hours</b>: students request appointments, but you only have a few slots.</li>
          <li><b>Meetings</b> cost ⚡ energy. Your choices change each student's <b>Stress</b>, <b>Trust</b>, <b>Degree Progress</b>, and <b>GPA</b>. Open questions and warm referrals usually beat quick fixes.</li>
          <li>Students you <b>can't see</b> lose trust and get more stressed. If stress hits 90, they'll show up in <b>🚨 crisis</b> — answer it, or they may withdraw.</li>
          <li>🎲 Risky options succeed more often when the student <b>trusts</b> you.</li>
          <li>Minigames: <b>📬 Inbox Avalanche</b> (sort emails to the right office) and the <b>🧩 Course Planner</b> (build a valid schedule: prerequisites, time conflicts, full sections, real-life constraints).</li>
          <li>Earn 🎖️ <b>kudos</b> and spend them on <b>perks</b> at the end of each week. The <b>Campus Referral Network</b> unlocks many powerful options.</li>
          <li>After 12 weeks, you'll get your <b>annual review</b> — and find out where each advisee ends up.</li>
        </ol>
        <p class="muted small">Your progress saves automatically in this browser.</p>`;
    } else if (modal.type === 'achievements') {
      inner = `<h2>Achievements</h2><div class="achs">${ACHIEVEMENTS.map((a) => `
        <div class="ach ${achs[a.id] ? 'got' : ''}"><span>${achs[a.id] ? a.icon : '🔒'}</span><div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div></div>`).join('')}</div>`;
    } else if (modal.type === 'student') {
      const s = st(modal.arg), d = SD[modal.arg];
      inner = `<div class="sp-head">${avatar(s.id, 'lg')}<div><h2>${esc(d.name)}</h2><div class="muted">${esc(d.year)} · ${esc(d.major)}${s.status !== 'active' ? ' · <b class="bad-text">Withdrew</b>' : ''}</div></div></div>
        <p>${esc(d.bio)}</p>
        <div class="mini-stats wide">
          <div><label>Stress</label>${bar(s.stress, 'stress', 'Stress')}<b>${Math.round(s.stress)}</b></div>
          <div><label>Trust</label>${bar(s.trust, 'trust', 'Trust')}<b>${Math.round(s.trust)}</b></div>
          <div><label>Progress</label>${bar(s.progress, 'prog', 'Progress')}<b>${Math.round(s.progress)}</b></div>
          <div><label>GPA</label><span class="gpa">${s.gpa.toFixed(2)}</span></div>
        </div>
        <h3>Advising notes</h3>
        ${s.notes.length ? `<ul class="notes">${s.notes.slice(0, 12).map((n) => `<li><span>Wk ${n.w}</span>${esc(n.t)}</li>`).join('')}</ul>` : '<p class="muted">No meetings yet.</p>'}`;
    } else if (modal.type === 'menu') {
      inner = `<h2>Paused</h2>
        <div class="menu-btns">
          <button class="btn primary" data-act="close">Resume</button>
          <button class="btn" data-act="help">How to Play</button>
          <button class="btn" data-act="achievements">Achievements</button>
          <button class="btn ghost" data-act="to-title">Save &amp; return to title</button>
        </div>`;
    }
    return `<div class="modal-wrap" data-act="close-bg"><div class="modal pop" role="dialog" aria-modal="true">
      <button class="modal-x" data-act="close" aria-label="Close">✕</button>${inner}</div></div>`;
  }

  function render() {
    if (S && S.phase !== 'inbox') clearInterval(inboxTimer);
    if (!S) { renderTitle(); return; }
    switch (S.phase) {
      case 'event': renderEvent(); break;
      case 'office': renderOffice(); break;
      case 'meeting': renderMeeting(); break;
      case 'planner': renderPlanner(); break;
      case 'inbox': renderInbox(); break;
      case 'summary': renderSummary(); break;
      case 'ending': renderEnding(); break;
      default: renderTitle();
    }
  }

  /* ---------------- Input ---------------- */
  const actions = {
    'choose-diff': () => { titleView = 'difficulty'; render(); },
    'title-back': () => { titleView = 'main'; render(); },
    new: (d) => { modal = null; titleView = 'main'; newGame(d); },
    continue: () => {
      S = store.get(SAVE, null);
      if (!S) return render();
      if (S.phase === 'inbox' && S.inbox && !S.inbox.done) { startInbox(); return; }
      render();
    },
    'play-again': () => { S = null; store.del(SAVE); titleView = 'difficulty'; render(); },
    'to-title': () => { save(); S = null; modal = null; titleView = 'main'; clearInterval(inboxTimer); render(); },
    menu: () => { modal = { type: 'menu' }; render(); },
    help: () => { modal = { type: 'help' }; render(); },
    achievements: () => { modal = { type: 'achievements' }; render(); },
    student: (id) => { modal = { type: 'student', arg: id }; render(); },
    close: () => { modal = null; render(); },
    'close-bg': (_, e) => { if (e.target.classList.contains('modal-wrap')) { modal = null; render(); } },
    sound: () => { opts.sound = !opts.sound; store.set(OPT, opts); sound('click'); render(); },
    'event-choose': (i) => eventChoose(+i),
    office: () => openOffice(),
    meet: (i) => startMeeting(+i),
    choose: (i) => choose(+i),
    'after-meeting': () => afterMeeting(),
    coffee: () => coffeeBreak(),
    'end-week': () => endWeek(),
    'next-week': () => nextWeek(),
    buy: (id) => buyPerk(id),
    pick: (i) => togglePick(+i),
    'submit-plan': () => submitPlan(),
    'planner-done': () => plannerDone(),
    inbox: (a) => inboxAnswer(a),
    'copy-share': (text) => {
      const done = () => toast('<span class="toast-icon">📋</span><div>Copied to clipboard!</div>');
      if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + location.href).then(done, () => {});
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.dataset.act !== 'close-bg') sound('click');
    fn(el.dataset.arg, e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal) { modal = null; render(); return; }
    if (modal || !S) return;
    // Number keys pick choices / inbox actions
    const n = parseInt(e.key, 10);
    if (Number.isNaN(n) || n < 1) return;
    if (S.phase === 'meeting' && S.current && !S.current.result) {
      const c = SC[S.current.scene].choices[n - 1];
      if (c && !(c.need && !has(c.need))) choose(n - 1);
    } else if (S.phase === 'event' && !S.eventResult) {
      const c = EV[S.event].choices[n - 1];
      if (c && !(c.need && !has(c.need))) eventChoose(n - 1);
    } else if (S.phase === 'inbox' && S.inbox && !S.inbox.done && INBOX_ACTIONS[n - 1]) {
      inboxAnswer(INBOX_ACTIONS[n - 1].id);
    }
  });

  // Expose a tiny hook for automated testing.
  window.__AQ = { get state() { return S; } };

  render();
})();
