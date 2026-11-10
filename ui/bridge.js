/* 前端与 Rust 的唯一接口层。
   在浏览器里裸开 index.html 时 WB.native = false，一切降级为本地演示，不报错。 */
(function () {
  const T = window.__TAURI__ || null;
  const core = T && T.core;
  const invoke = core && typeof core.invoke === 'function' ? (...a) => core.invoke(...a)
    : (T && typeof T.invoke === 'function' ? (...a) => T.invoke(...a) : null);
  const listenRaw = T && T.event && typeof T.event.listen === 'function' ? (...a) => T.event.listen(...a) : null;

  const winApi = T && T.window;
  let win = null;
  try {
    if (winApi) {
      win = typeof winApi.getCurrentWindow === 'function' ? winApi.getCurrentWindow()
        : (typeof winApi.getCurrent === 'function' ? winApi.getCurrent() : null);
    }
  } catch (e) { win = null; }

  function guard(fn) {
    return (...args) => {
      try { return fn(...args); } catch (e) { console.warn('[wb]', e); return undefined; }
    };
  }

  window.WB = {
    native: !!invoke,
    win,

    async call(cmd, args) {
      if (!invoke) throw new Error('不在客户端里运行');
      return invoke(cmd, args);
    },

    /* 走这条：命令失败只记日志，不把异常甩进 UI 事件里 */
    async tryCall(cmd, args) {
      if (!invoke) return null;
      try { return await invoke(cmd, args); } catch (e) { console.warn('[wb]', cmd, e); return null; }
    },

    async on(evt, cb) {
      if (!listenRaw) return;
      try { await listenRaw(evt, (e) => cb(e.payload)); } catch (e) { console.warn('[wb] listen', evt, e); }
    },

    show: guard(() => win && win.show && win.show()),
    minimize: guard(() => win && win.minimize && win.minimize()),
    toggleMax: guard(() => win && win.toggleMaximize && win.toggleMaximize()),
    close: guard(() => win && win.close && win.close())
  };

  // Windows 上把窗口控件挪到右边（macOS 保持左侧三个点）
  const ua = navigator.userAgent;
  document.documentElement.dataset.os =
    /Windows/i.test(ua) ? 'win' : (/Macintosh|Mac OS X/i.test(ua) ? 'mac' : 'linux');
})();