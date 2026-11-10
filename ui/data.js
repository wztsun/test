/* 种子数据：界面上所有数字的唯一来源。
   接了引擎之后，这份文件被引擎回包替换；在那之前它保证界面自洽——
   待办 3/7、作业 2、产物 3、18.4k = 14.2k + 4.2k 都由这里推导，不手写。 */
window.SEED = {
  run: { id: 'r_7f21', step: 4, steps: 6, elapsedSec: 664 },

  todos: [
    { t: '确认核查口径', s: 'done' },
    { t: '抓取 robots 与 sitemap', s: 'done' },
    { t: '尝试搜索源', s: 'done' },
    { t: '补类型并重跑构建', s: 'run' },
    { t: '两个宽度截图校对', s: 'todo' },
    { t: '写修复建议', s: 'todo' },
    { t: '汇总成一份报告', s: 'todo' }
  ],

  jobs: [
    { t: '预览构建', id: '8c41', state: 'run', pct: 62 },
    { t: '整站抓取', id: '9b07', state: 'done', note: '412 页' }
  ],

  agents: [{ av: 'a', name: 'audit-bot', text: '正在核对站内互链' }],

  artifacts: [
    { name: '收录诊断.md', size: '12.4 KB', path: '/opt/dsh/weiq-audit/收录诊断.md' },
    { name: 'sitemap.py', size: '2.1 KB', path: '/opt/dsh/weiq-audit/sitemap.py' },
    { name: '竞品对照.csv', size: '8.6 KB', path: '/opt/dsh/weiq-audit/竞品对照.csv' }
  ],

  usage: { tokens: '18.4k', inp: '14.2k', out: '4.2k', cache: '61%', cny: '¥0.42' },

  /* 任务表：state = run | wait | done | stopped */
  tasks: [
    { name: '把 weiq.com 的 Google 收录情况查清楚', sub: '/opt/dsh/weiq-audit · 陈默', state: 'wait', step: '4 / 6', dur: '11:04', cost: '18.4k' },
    { name: '把上新流程的 12 个表单接进审核队列', sub: '/opt/dsh/ops-forms · 陈默', state: 'run', step: '7 / 9', dur: '26:31', cost: '41.2k' },
    { name: '重跑上周的投放归因，输出口径对比', sub: '/opt/dsh/attr · 数据组', state: 'done', step: '5 / 5', dur: '08:12', cost: '9.7k' },
    { name: '给 sitemap 生成脚本补单测', sub: '/opt/dsh/weiq-audit · 陈默', state: 'done', step: '4 / 4', dur: '03:40', cost: '6.1k' },
    { name: '把 2026 年内容日历拆成 96 个选题', sub: '/opt/dsh/content · 增长组', state: 'wait', step: '2 / 8', dur: '04:58', cost: '7.4k' },
    { name: '抓竞品近 90 天的公众号推文标题', sub: '/opt/dsh/research · 数据组', state: 'stopped', step: '3 / 6', dur: '02:11', cost: '4.3k' }
  ]
};