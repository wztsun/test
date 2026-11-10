/* Workbench UI 逻辑。无框架、无打包器——三个文件（data / bridge / app）就是全部前端。 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const ESC = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  const SEED = window.SEED;
  const LS = 'wb.settings';

  /* 与 Rust 侧 store::Settings 字段逐字对应 —— 名字不一致就存不下去 */
  const DEFAULTS = {
    approval: 'risky',
    model: 'V4.1 Flash',
    budget_cny: 300,
    downgrade_over_budget: true,
    tools: { terminal: true, fetch: true, search: false, subagent: true },
    workspace_root: '',
    theme: 'light',
    engine: {
      command: 'dsh', args: ['web'], url: 'http://127.0.0.1:3080', workdir: '',
      autostart: true, kill_on_exit: true, start_timeout_sec: 25,
      prompt_path: '', approve_path: ''
    }
  };

  const S = {
    settings: clone(DEFAULTS),
    engine: { running: false, reachable: false, pid: null, url: 'http://127.0.0.1:3080' },
    filter: 'all',
    sortByCost: false,
    elapsed: SEED.run.elapsedSec,
    decisions: []
  };

  /* ── 提示条 ─────────────────────────────────────── */
  let toastTimer = 0;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.dataset.kind = kind || '';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  /* ── 主题 ───────────────────────────────────────── */
  function applyTheme() {
    const dark = S.settings.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#theme-label').textContent = dark ? '深色' : '浅色';
  }

  /* ── 视图切换 ───────────────────────────────────── */
  const CRUMB = { workbench: '会话 / 收录核查', tasks: '任务', settings: '设置' };
  function go(name) {
    document.body.dataset.view = name;
    $('#crumb-tail').textContent = CRUMB[name] || name;
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + name; });
    $$('.nav a[data-nav]').forEach((a) => {
      if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ── 运行栏（全部由 SEED 推导）──────────────────── */
  function renderRail() {
    const doneN = SEED.todos.filter((x) => x.s === 'done').length;
    const running = SEED.jobs.filter((j) => j.state === 'run').length;

    const todos = SEED.todos.map((x) => {
      const cls = x.s === 'done' ? 'd' : (x.s === 'run' ? 'p' : '');
      const mark = x.s === 'done' ? '✓' : (x.s === 'run' ? '▸' : '');
      return `<div><span class="box ${cls}">${mark}</span><span class="${x.s === 'done' ? 'done' : ''}">${ESC(x.t)}</span></div>`;
    }).join('');

    const jobs = SEED.jobs.map((j) => {
      const done = j.state === 'done';
      const w = done ? 100 : j.pct;
      return `<div class="job">
        <div class="job-h">${ESC(j.t)}<span class="id">${ESC(j.id)}</span></div>
        <div class="bar"><i class="${done ? 'ok' : ''}" style="width:${w}%"></i></div>
        <div class="job-m"><span>${done ? '已完成' : '运行中'}</span><span class="num">${done ? ESC(j.note) : j.pct + '%'}</span></div>
      </div>`;
    }).join('');

    const agents = SEED.agents.map((a) =>
      `<div class="agents"><span class="av">${ESC(a.av)}</span><span>${ESC(a.name)} ${ESC(a.text)}</span></div>`
    ).join('');

    const files = SEED.artifacts.map((f) =>
      `<button class="file" data-artifact="${ESC(f.path)}" title="${ESC(f.path)}">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/></svg>
        <span class="nm">${ESC(f.name)}</span><span class="sz">${ESC(f.size)}</span>
      </button>`
    ).join('');

    $('#rail').innerHTML = `
      <section>
        <h3>待办 <span class="n">${doneN} / ${SEED.todos.length}</span></h3>
        <div class="todo">${todos}</div>
      </section>
      <section>
        <h3>后台作业 <span class="n">${SEED.jobs.length}</span></h3>
        ${jobs}
      </section>
      <section>
        <h3>子代理 <span class="n">${SEED.agents.length}</span></h3>
        ${agents}
      </section>
      <section>
        <h3>产物 <span class="n">${SEED.artifacts.length}</span></h3>
        ${files}
      </section>
      <section class="money">
        <h3 style="margin-bottom:6px">本轮消耗</h3>
        <div class="big">${ESC(SEED.usage.tokens)}<small>tokens · ${ESC(SEED.usage.cny)}</small></div>
        <div class="split"><span>输入 <b>${ESC(SEED.usage.inp)}</b></span><span>输出 <b>${ESC(SEED.usage.out)}</b></span><span>命中 <b>${ESC(SEED.usage.cache)}</b></span></div>
      </section>`;

    $('#bg-label').textContent = `后台 ${running}`;
    $('#bg-pill').querySelector('.dot').className = running ? 'dot run' : 'dot ok';
  }

  /* ── 任务表 ─────────────────────────────────────── */
  const STATUS = {
    run: { cls: 'run', dot: 'run', text: '运行中' },
    wait: { cls: 'wait', dot: 'run', text: '待你批准' },
    done: { cls: 'run', dot: 'ok', text: '已完成' },
    stopped: { cls: '', dot: '', text: '已中断' }
  };

  function renderTasks() {
    const rows = SEED.tasks
      .filter((t) => S.filter === 'all' || t.state === S.filter)
      .slice()
      .sort((a, b) => (S.sortByCost
        ? parseFloat(b.cost) - parseFloat(a.cost)
        : 0));

    const body = $('#tasks-body');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="5"><div class="empty">这个筛选下没有任务</div></td></tr>`;
    } else {
      body.innerHTML = rows.map((t) => {
        const st = STATUS[t.state] || STATUS.stopped;
        return `<tr data-state="${t.state}">
          <td><div class="rname">${ESC(t.name)}</div><div class="rsub">${ESC(t.sub)}</div></td>
          <td><span class="status ${st.cls}"><span class="dot ${st.dot}"></span>${st.text}</span></td>
          <td class="mono">${ESC(t.step)}</td>
          <td class="r mono">${ESC(t.dur)}</td>
          <td class="r mono">${ESC(t.cost)}</td>
        </tr>`;
      }).join('');
    }

    const wait = SEED.tasks.filter((t) => t.state === 'wait').length;
    const run = SEED.tasks.filter((t) => t.state === 'run').length;
    $('#tasks-summary').innerHTML =
      `<span>最近 ${SEED.tasks.length} 条</span><span class="sep"></span>` +
      `<span><span class="dot run" style="display:inline-block;vertical-align:1px"></span> ${run} 个在跑</span>` +
      `<span class="sep"></span><span>${wait} 个在等你批准</span>`;

    const count = $('#nav-count');
    count.textContent = String(wait);
    count.dataset.zero = wait ? '0' : '1';
  }

  /* ── 引擎状态 ───────────────────────────────────── */
  function setEngine(st) {
    if (!st) return;
    S.engine = st;
    const dot = $('#engine-dot');
    const label = $('#engine-label');
    const pill = $('#engine-pill');

    if (st.reachable) {
      dot.className = 'dot ok';
      label.textContent = st.running ? `引擎 ${st.pid || ''}`.trim() : '引擎已连';
      pill.dataset.state = 'on';
      pill.title = `${st.url}${st.pid ? ' · 由本应用托管 pid ' + st.pid : ' · 外部进程'}`;
    } else if (st.running) {
      dot.className = 'dot warn';
      label.textContent = '引擎启动中';
      pill.dataset.state = 'on';
      pill.title = `${st.url} · 端口还没通`;
    } else {
      dot.className = 'dot';
      label.textContent = '引擎未连';
      pill.dataset.state = 'off';
      pill.title = `${st.url || ''} · 没有服务在跑`;
    }

    $('#engine-state-text').textContent = st.reachable
      ? `已连通 ${st.url}${st.pid ? ' · pid ' + st.pid : ' · 外部进程'}`
      : (st.running ? `进程已起，端口未通 ${st.url}` : `未运行 · ${st.url || ''}`);
  }

  async function refreshEngine() {
    if (!WB.native) return;
    if (document.hidden) return;
    const st = await WB.tryCall('engine_status');
    if (st) setEngine(st);
  }

  /* ── 设置表单 ───────────────────────────────────── */
  function fillForm() {
    const s = S.settings;
    const radio = $(`#set-approval input[value="${s.approval}"]`);
    if (radio) radio.checked = true;
    $('#set-model').firstChild.textContent = s.model + ' ';
    $('#sw-downgrade').setAttribute('aria-checked', String(!!s.downgrade_over_budget));
    $('#set-budget').value = '￥ ' + Number(s.budget_cny || 0).toFixed(2);
    $('#sw-terminal').setAttribute('aria-checked', String(!!s.tools.terminal));
    $('#sw-fetch').setAttribute('aria-checked', String(!!s.tools.fetch));
    $('#sw-search').setAttribute('aria-checked', String(!!s.tools.search));
    $('#sw-subagent').setAttribute('aria-checked', String(!!s.tools.subagent));
    $('#set-workspace').value = s.workspace_root || '';
    $('#cfg-command').value = s.engine.command || '';
    $('#cfg-args').value = (s.engine.args || []).join(' ');
    $('#cfg-url').value = s.engine.url || '';
    $('#sw-autostart').setAttribute('aria-checked', String(!!s.engine.autostart));
    $('#sw-killonexit').setAttribute('aria-checked', String(!!s.engine.kill_on_exit));
    $('#cfg-prompt-path').value = s.engine.prompt_path || '';
    $('#cfg-approve-path').value = s.engine.approve_path || '';
    $('#chip-model').firstChild.textContent = s.model + ' ';
    $('#set-meta').textContent = '字段与 settings.json 一一对应 · 保存后立即生效';
  }

  function readForm() {
    const s = clone(S.settings);
    const picked = $('#set-approval input:checked');
    s.approval = picked ? picked.value : 'risky';
    s.model = $('#set-model').firstChild.textContent.trim();
    s.budget_cny = parseFloat(String($('#set-budget').value).replace(/[^\d.]/g, '')) || 0;
    s.downgrade_over_budget = $('#sw-downgrade').getAttribute('aria-checked') === 'true';
    s.tools.terminal = $('#sw-terminal').getAttribute('aria-checked') === 'true';
    s.tools.fetch = $('#sw-fetch').getAttribute('aria-checked') === 'true';
    s.tools.search = $('#sw-search').getAttribute('aria-checked') === 'true';
    s.tools.subagent = $('#sw-subagent').getAttribute('aria-checked') === 'true';
    s.workspace_root = $('#set-workspace').value.trim();
    s.engine.command = $('#cfg-command').value.trim();
    s.engine.args = $('#cfg-args').value.trim() ? $('#cfg-args').value.trim().split(/\s+/) : [];
    s.engine.url = $('#cfg-url').value.trim();
    s.engine.autostart = $('#sw-autostart').getAttribute('aria-checked') === 'true';
    s.engine.kill_on_exit = $('#sw-killonexit').getAttribute('aria-checked') === 'true';
    s.engine.prompt_path = $('#cfg-prompt-path').value.trim();
    s.engine.approve_path = $('#cfg-approve-path').value.trim();
    return s;
  }

  async function saveSettings() {
    const next = readForm();
    S.settings = next;
    if (WB.native) {
      const ok = await WB.tryCall('settings_save', { settings: next });
      if (ok === null) { toast('保存失败：写不进配置文件', 'err'); return; }
    } else {
      try { localStorage.setItem(LS, JSON.stringify(next)); } catch (e) { /* 隐私模式下忽略 */ }
    }
    applyTheme();
    toast('已保存');
    refreshEngine();
  }

  /* ── 审批 ───────────────────────────────────────── */
  async function decide(kind) {
    const label = { approve: '批准并继续', type: '改成只补类型', reject: '拒绝' }[kind] || kind;
    // 以表单里的实时值为准：填完路径不必先点保存也能生效
    const path = ($('#cfg-approve-path').value || S.settings.engine.approve_path || '').trim();
    let note;

    if (path && S.engine.reachable) {
      const r = await WB.tryCall('engine_http', {
        method: 'POST',
        path,
        body: JSON.stringify({ run: SEED.run.id, step: SEED.run.step, decision: kind })
      });
      if (!r) { toast('审批没发出去：引擎无响应', 'err'); return; }
      if (r.status >= 400) { toast(`审批被引擎拒绝（HTTP ${r.status}）`, 'err'); console.warn('[wb] approve', r); return; }
      note = `已提交引擎（HTTP ${r.status}）`;
    } else {
      note = path ? '引擎未连，只记在本地' : '没接审批接口，只记在本地';
    }

    S.decisions.push({ run: SEED.run.id, kind, at: Date.now() });
    try { localStorage.setItem('wb.decisions', JSON.stringify(S.decisions)); } catch (e) { /* 忽略 */ }

    const card = $('#approve');
    const node = $('#node-4');
    card.classList.add('done');
    card.innerHTML = kind === 'reject'
      ? '<div class="approve-h">已拒绝 · 任务停在这一步</div><p style="margin-bottom:0">不会继续执行。想换个做法就重新发起，或在下面直接说要求。</p>'
      : `<div class="approve-h">✓ ${ESC(label)} · 正在执行</div><p style="margin-bottom:0">补类型 → 重跑构建 → 截图。完成后这一条会自动变成「完成」。</p>`;

    if (kind === 'reject') {
      node.classList.remove('wait', 'run', 'done');
      node.classList.add('todo');
      node.textContent = String(SEED.run.step);
      $('#run-state-text').textContent = `已拒绝 · 第 ${SEED.run.step} / ${SEED.run.steps} 步`;
    } else {
      node.classList.remove('wait', 'todo', 'done');
      node.classList.add('run');
      node.textContent = '▸';
      $('#run-state-text').textContent = `运行中 · 第 ${SEED.run.step} / ${SEED.run.steps} 步`;
    }
    toast(`${label} · ${note}`);
  }

  /* ── 发送 ───────────────────────────────────────── */
  async function send() {
    const el = $('#composer-input');
    const text = el.value.trim();
    if (!text) return;

    const path = ($('#cfg-prompt-path').value || S.settings.engine.prompt_path || '').trim();
    if (!path) { toast('没接发消息接口：去设置里填一个路径，或先把这段流程走通', 'err'); return; }
    if (!S.engine.reachable) { toast('引擎没连上，消息没发出去', 'err'); return; }

    const r = await WB.tryCall('engine_http', {
      method: 'POST', path, body: JSON.stringify({ run: SEED.run.id, prompt: text })
    });
    if (!r) { toast('发不出去：引擎无响应', 'err'); return; }
    if (r.status >= 400) { toast(`引擎拒绝（HTTP ${r.status}）`, 'err'); return; }
    el.value = '';
    toast(`已发送（HTTP ${r.status}）`);
  }

  /* ── 时钟：只走真实秒数，不编造进度 ─────────────── */
  function startClock() {
    setInterval(() => {
      if (document.hidden) return;
      if (document.body.dataset.view !== 'workbench') return;
      S.elapsed += 1;
      const m = Math.floor(S.elapsed / 60);
      const s = S.elapsed % 60;
      const h = Math.floor(m / 60);
      $('#run-elapsed').textContent = h > 0
        ? `${h} 时 ${pad(m % 60)} 分 ${pad(s)} 秒`
        : `${m} 分 ${pad(s)} 秒`;
    }, 1000);
  }

  /* ── 绑定 ───────────────────────────────────────── */
  function wire() {
    $$('.nav a[data-nav]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.nav); });
    });

    $('#theme-btn').addEventListener('click', () => {
      S.settings.theme = S.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      if (WB.native) WB.tryCall('settings_save', { settings: S.settings });
      else { try { localStorage.setItem(LS, JSON.stringify(S.settings)); } catch (e) {} }
    });

    $$('.winctl button').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.win;
        if (k === 'min') WB.minimize();
        else if (k === 'max') WB.toggleMax();
        else if (k === 'close') WB.close();
      });
    });

    $('#engine-pill').addEventListener('click', async () => {
      if (!WB.native) { toast('浏览器里跑，没有本机引擎可用'); return; }
      toast('探测中…');
      await refreshEngine();
    });

    $('#bg-pill').addEventListener('click', () => go('tasks'));

    /* 审批 */
    $('#btn-approve').addEventListener('click', () => decide('approve'));
    $('#btn-approve-type').addEventListener('click', () => decide('type'));
    $('#btn-reject').addEventListener('click', () => decide('reject'));
    $('#link-diff').addEventListener('click', (e) => { e.preventDefault(); toast('diff 视图还没做，下一步补'); });

    $('#btn-abort').addEventListener('click', () => toast('中断需要引擎支持，当前只是界面动作'));

    /* 产物定位 */
    $('#rail').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-artifact]');
      if (!btn) return;
      const p = btn.dataset.artifact;
      if (!WB.native) { toast(p); return; }
      const r = await WB.tryCall('reveal_path', { path: p });
      if (r === null) toast('打不开：文件不存在或没有权限', 'err');
    });

    /* 任务表 */
    $$('#tasks-filters button[data-filter]').forEach((b) => {
      b.addEventListener('click', () => {
        S.filter = b.dataset.filter;
        $$('#tasks-filters button[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderTasks();
      });
    });
    $('#btn-sort').addEventListener('click', () => {
      S.sortByCost = !S.sortByCost;
      $('#btn-sort').textContent = S.sortByCost ? '按消耗排序' : '按最近活动排序';
      renderTasks();
    });
    $('#tasks-body').addEventListener('click', (e) => {
      if (e.target.closest('tr')) go('workbench');
    });
    $('#btn-new-task').addEventListener('click', () => {
      go('workbench');
      $('#composer-input').focus();
      toast('在下面说清要做什么，就会起一个新的');
    });

    /* 设置：开关 */
    $$('.sw').forEach((s) => s.addEventListener('click', () => {
      s.setAttribute('aria-checked', s.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    }));

    $('#btn-save').addEventListener('click', saveSettings);
    $('#btn-reset').addEventListener('click', () => {
      S.settings = clone(DEFAULTS);
      fillForm();
      applyTheme();
      toast('已恢复默认，点保存才生效');
    });

    /* 引擎手动控制 */
    $('#btn-engine-start').addEventListener('click', async () => {
      if (!WB.native) { toast('浏览器里跑，没有本机进程可拉'); return; }
      toast('正在拉起引擎…');
      const st = await WB.tryCall('engine_start');
      if (st) { setEngine(st); toast(st.reachable ? '引擎已连通' : '进程起了，端口还没通', st.reachable ? '' : 'err'); }
      else toast('启动失败，看设置里的路径对不对', 'err');
    });
    $('#btn-engine-stop').addEventListener('click', async () => {
      if (!WB.native) return;
      const st = await WB.tryCall('engine_stop');
      if (st) { setEngine(st); toast('已停止'); }
    });

    /* 输入 */
    $('#composer-input').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });
    $('#btn-send').addEventListener('click', send);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $('#toast').hidden = true;
    });
  }

  /* ── 启动 ───────────────────────────────────────── */
  async function boot() {
    applyTheme();
    renderRail();
    renderTasks();
    wire();
    startClock();

    if (WB.native) {
      const s = await WB.tryCall('settings_load');
      if (s && typeof s === 'object') S.settings = Object.assign(clone(DEFAULTS), s, { engine: Object.assign(clone(DEFAULTS.engine), s.engine || {}) });
      const st = await WB.tryCall('engine_status');
      if (st) setEngine(st);
      await WB.on('engine-status', () => refreshEngine());
      setInterval(refreshEngine, 6000);
    } else {
      try {
        const raw = localStorage.getItem(LS);
        if (raw) S.settings = Object.assign(clone(DEFAULTS), JSON.parse(raw));
      } catch (e) { /* 忽略坏档 */ }
      try { S.decisions = JSON.parse(localStorage.getItem('wb.decisions') || '[]'); } catch (e) { /* 忽略 */ }
    }

    applyTheme();
    fillForm();
    go('workbench');

    // 首帧画完再显窗，避免白屏闪一下
    requestAnimationFrame(() => requestAnimationFrame(() => WB.show()));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();