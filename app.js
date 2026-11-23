/* FocusFlow · 专注时钟
 * 计时用 rAF + 时间戳差值，避免 setInterval 漂移；状态机驱动阶段切换。*/

(() => {
  const DURATION = { focus: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
  const LABEL = { focus: '专注中', shortBreak: '短休息', longBreak: '长休息' };
  const CIRC = 2 * Math.PI * 104;
  const STORE_KEY = 'focusflow.sessions.v1';
  const THEME_KEY = 'focusflow.theme';

  const $ = (id) => document.getElementById(id);
  const els = {
    ring: $('ringFg'), time: $('timeText'), phase: $('phaseText'), round: $('roundText'),
    start: $('startBtn'), reset: $('resetBtn'), skip: $('skipBtn'),
    task: $('taskInput'), todayCount: $('todayCount'), todayMin: $('todayMin'),
    streak: $('streak'), bars: $('bars'), log: $('logList'), theme: $('themeBtn'),
    modes: [...document.querySelectorAll('.mode')],
  };

  const state = {
    mode: 'focus',
    remaining: DURATION.focus,
    running: false,
    startedAt: 0,
    baseRemaining: DURATION.focus,
    round: 1,
    finishedFocus: 0,
  };

  /* ---------------- 存储 ---------------- */
  const loadSessions = () => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
  };
  const saveSession = (session) => {
    const all = loadSessions();
    all.push(session);
    localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(-800)));
  };
  const dayKey = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* ---------------- 渲染 ---------------- */
  const fmt = (sec) => {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  function render() {
    els.time.textContent = fmt(state.remaining);
    els.phase.textContent = state.running ? LABEL[state.mode] : (state.remaining === DURATION[state.mode] ? '准备开始' : '已暂停');
    els.ring.style.strokeDashoffset = String(CIRC * (1 - state.remaining / DURATION[state.mode]));
    els.start.textContent = state.running ? '暂停' : (state.remaining === DURATION[state.mode] ? '开始' : '继续');
    els.modes.forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    const todayCount = loadSessions().filter((s) => s.day === dayKey() && s.mode === 'focus').length;
    els.round.textContent = `第 ${state.round} 段 · 今日 ${todayCount} 段`;
  }

  function renderStats() {
    const all = loadSessions();
    const today = dayKey();
    const focusAll = all.filter((s) => s.mode === 'focus');
    const todayFocus = focusAll.filter((s) => s.day === today);

    els.todayCount.textContent = String(todayFocus.length);
    els.todayMin.textContent = String(Math.round(todayFocus.reduce((a, s) => a + s.seconds, 0) / 60));

    // 连续天数
    const days = new Set(focusAll.map((s) => s.day));
    let streak = 0;
    const cursor = new Date();
    while (days.has(dayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    els.streak.textContent = String(streak);

    // 最近 7 天柱状
    const perDay = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      const minutes = focusAll.filter((s) => s.day === key).reduce((a, s) => a + s.seconds, 0) / 60;
      perDay.push({ key, minutes, label: `${d.getMonth() + 1}/${d.getDate()}`, today: key === today });
    }
    const max = Math.max(25, ...perDay.map((p) => p.minutes));
    els.bars.innerHTML = perDay.map((p) => `
      <div class="bar-col">
        <div class="bar${p.today ? ' today' : ''}" style="height:${Math.max(4, (p.minutes / max) * 74)}px"
             title="${p.label} · ${Math.round(p.minutes)} 分钟"></div>
        <em>${p.label}</em>
      </div>`).join('');

    // 今日记录
    const list = all.filter((s) => s.day === today).slice(-12).reverse();
    els.log.innerHTML = list.length
      ? list.map((s) => `<li><span style="color:var(--ink)">${escapeHtml(s.task || LABEL[s.mode])}</span><span>${fmt(s.seconds)}</span></li>`).join('')
      : '<li class="log-empty">还没有记录，开始第一段专注吧</li>';
  }

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* ---------------- 计时 ---------------- */
  let rafId = null;

  function tick() {
    const elapsed = (performance.now() - state.startedAt) / 1000;
    const next = state.baseRemaining - elapsed;
    state.remaining = Math.max(0, next);
    render();
    if (next <= 0) {
      complete();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (state.running) return pause();
    state.running = true;
    state.startedAt = performance.now();
    state.baseRemaining = state.remaining;
    rafId = requestAnimationFrame(tick);
    render();
  }

  function pause() {
    state.running = false;
    cancelAnimationFrame(rafId);
    render();
  }

  function reset() {
    pause();
    state.remaining = DURATION[state.mode];
    state.baseRemaining = state.remaining;
    render();
  }

  function complete() {
    pause();
    const elapsedSec = DURATION[state.mode];
    saveSession({
      day: dayKey(),
      mode: state.mode,
      seconds: elapsedSec,
      task: state.mode === 'focus' ? (els.task.value.trim() || '') : '',
      at: new Date().toISOString(),
    });

    if (state.mode === 'focus') {
      state.finishedFocus += 1;
      const long = state.finishedFocus % 4 === 0;
      state.mode = long ? 'longBreak' : 'shortBreak';
      state.round += 1;
    } else {
      state.mode = 'focus';
    }
    state.remaining = DURATION[state.mode];
    state.baseRemaining = state.remaining;
    render();
    renderStats();
    notify();
  }

  function notify() {
    els.phase.textContent = '本轮结束';
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('FocusFlow', { body: `进入${LABEL[state.mode]}` });
    }
  }

  function skip() {
    pause();
    state.mode = state.mode === 'focus' ? 'shortBreak' : 'focus';
    state.remaining = DURATION[state.mode];
    state.baseRemaining = state.remaining;
    render();
  }

  function setMode(mode) {
    pause();
    state.mode = mode;
    state.remaining = DURATION[mode];
    state.baseRemaining = state.remaining;
    render();
  }

  /* ---------------- 交互 ---------------- */
  els.start.addEventListener('click', start);
  els.reset.addEventListener('click', reset);
  els.skip.addEventListener('click', skip);
  els.modes.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); start(); }
    if (e.key.toLowerCase() === 'r') reset();
    if (e.key.toLowerCase() === 's') skip();
  });

  // 主题
  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  };
  els.theme.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  // 初始化
  const savedTheme = localStorage.getItem(THEME_KEY)
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(savedTheme);
  els.ring.style.strokeDasharray = String(CIRC);
  render();
  renderStats();

  // 演示数据：首次打开时灌入几条当日记录，便于展示统计
  if (!localStorage.getItem(STORE_KEY)) {
    const demo = [
      { minutes: 25, task: '梳理需求文档' },
      { minutes: 25, task: '重构计时模块' },
      { minutes: 25, task: 'Review PR' },
    ];
    demo.forEach((d, i) => saveSession({
      day: dayKey(), mode: 'focus', seconds: d.minutes * 60, task: d.task,
      at: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
    }));
    state.round = 4;
    render();
    renderStats();
  }
})();
