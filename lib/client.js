/**
 * codex-panel —— Codex 模式的悬浮控制面板（客户端半）。
 *
 * 挂在 shell.overlay：frame-wide 浮动层，在全部列之上、滚动容器之外，
 * 不会跟着会话列表滚走。右上角一颗胶囊，点开是面板。
 *
 * 三条刻意的设计：
 *
 * 1) **不写模块级 `inject`**（见宿主半注释）。只用 ctx.get 软取 slots。
 *    少一个硬依赖，就少一次「整棵 plugin tree 加载失败、Web 打不开」的机会。
 *
 * 2) **不用 JSX**。客户端内置的是 React 运行时，没有 JSX 转换，
 *    所以全程 React.createElement —— 写成 `h(...)` 省字。
 *
 * 3) **主题令牌不写死颜色**。13 个 --dsw-alias-* 由宿主在亮/暗主题下自动换值，
 *    面板跟着主题走，不自己做暗色适配。
 */
window.__ModuleLoader__.load({
  id: 'dsh-codex-panel',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    /**
     * 宿主半的 HTTP 基址。客户端半没有 host.call 这个符号（那是「动态包」专属
     * 的闭包注入），npm 包的端到端通路就是 HTTP 路由 —— 见 dsh-better-sidebar
     * 的 `/sidebar/api/`、dsh-free-search 的 `/api/dsh-free-search-settings`。
     */
    var BRIDGE = '/dsh-codex-panel/api'

    /** 8 个写工具的中文说明 —— 面板上是人看的，不是给机器看的。 */
    var TOOL_LABEL = {
      git_commit: ['提交', '把暂存区落成一个 commit'],
      git_push: ['推送', '把本地分支推到远端'],
      github_pr_create: ['建 PR', '向上游提一个合并请求'],
      github_pr_merge: ['合并 PR', '把 PR 合进目标分支'],
      github_pr_review: ['审批 PR', '给 PR 提交 review 结论'],
      github_pr_comment: ['PR 评论', '在 PR 下发一条评论'],
      github_issue_create: ['建 Issue', '新开一个议题'],
      github_issue_comment: ['Issue 评论', '在议题下回一条'],
    }

    var CSS = [
      '.cxp-root{position:fixed;right:14px;top:calc(env(safe-area-inset-top, 0px) + 64px);z-index:2147483000;',
      'pointer-events:none;',
      'font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      'font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary);-webkit-tap-highlight-color:transparent}',

      /* 胶囊按钮：pointer-events 必须显式 auto——父层是 none，
         否则整块浮层会「看得见点不着」（Android WebView 上尤其明显） */
      '.cxp-pill{display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:999px;cursor:pointer;',
      'pointer-events:auto;touch-action:manipulation;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);',
      'box-shadow:0 3px 14px rgba(0,0,0,.16);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);',
      'user-select:none;transition:transform .12s ease,box-shadow .12s ease}',
      '.cxp-pill:active{transform:scale(.95)}',
      '.cxp-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.cxp-dot.on{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}',
      '.cxp-pill-label{font-weight:600;letter-spacing:.01em}',

      /* 展开面板 */
      '.cxp-panel{position:absolute;right:0;top:calc(100% + 9px);width:min(331px,calc(100vw - 28px));',
      'pointer-events:auto;',
      'max-height:min(74vh,620px);overflow-y:auto;overscroll-behavior:contain;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:15px;',
      'box-shadow:0 14px 44px rgba(0,0,0,.24);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);',
      'animation:cxp-in .16s cubic-bezier(.2,.9,.3,1)}',
      '@keyframes cxp-in{from{opacity:0;transform:translateY(-7px) scale(.975)}to{opacity:1;transform:none}}',

      '.cxp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;',
      'padding:13px 15px 11px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.cxp-title{font-size:14px;font-weight:700;letter-spacing:.015em}',
      '.cxp-sub{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;font-weight:400}',
      '.cxp-x{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;',
      'font-size:19px;line-height:1;padding:3px 7px;border-radius:7px;flex:none}',
      '.cxp-x:hover{background:var(--dsw-alias-bg-layer-2)}',

      '.cxp-body{padding:13px 15px 15px}',
      '.cxp-sec{margin-bottom:16px}',
      '.cxp-sec:last-child{margin-bottom:0}',
      '.cxp-sec-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}',
      '.cxp-sec-t{font-size:11px;font-weight:700;letter-spacing:.085em;text-transform:uppercase;',
      'color:var(--dsw-alias-label-secondary)}',

      /* 余额 */
      '.cxp-money{display:flex;align-items:baseline;gap:7px}',
      '.cxp-amount{font-size:29px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.02em}',
      '.cxp-amount.err{font-size:15px;font-weight:600;color:var(--dsw-alias-state-error-primary)}',
      '.cxp-unit{font-size:13px;color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.cxp-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:5px;font-variant-numeric:tabular-nums}',
      '.cxp-bar{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);margin-top:9px;overflow:hidden}',
      '.cxp-bar-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);transition:width .35s ease}',

      /* 开关行 */
      '.cxp-row{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:9px;cursor:pointer;',
      'transition:background .12s ease}',
      '.cxp-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.cxp-row:active{background:var(--dsw-alias-bg-layer-1)}',
      '.cxp-row.busy{opacity:.5;pointer-events:none}',
      '.cxp-row-txt{flex:1;min-width:0}',
      '.cxp-row-n{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cxp-row-d{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',

      /* 开关 */
      '.cxp-sw{width:39px;height:22px;border-radius:11px;flex:none;position:relative;',
      'background:var(--dsw-alias-state-idle-primary);transition:background .18s ease}',
      '.cxp-sw.on{background:var(--dsw-alias-state-success-primary)}',
      '.cxp-sw-k{position:absolute;top:2.5px;left:2.5px;width:17px;height:17px;border-radius:50%;background:#fff;',
      'box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s cubic-bezier(.3,1.3,.5,1)}',
      '.cxp-sw.on .cxp-sw-k{transform:translateX(17px)}',

      /* 全开按钮 */
      '.cxp-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:7px;',
      'cursor:pointer;transition:background .12s ease,transform .1s ease;font-family:inherit}',
      '.cxp-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.cxp-btn:active{transform:scale(.96)}',
      '.cxp-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',

      /* 状态芯片 */
      '.cxp-chip{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;',
      'padding:3px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.cxp-chip.ok{color:var(--dsw-alias-state-success-primary)}',
      '.cxp-chip.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cxp-chip.err{color:var(--dsw-alias-state-error-primary)}',

      '.cxp-note{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:9px;line-height:1.5}',
      '.cxp-loading{padding:26px 15px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}',
    ].join('')

    /** 一个开关。 */
    function Switch(on) {
      return h('div', { className: 'cxp-sw' + (on ? ' on' : '') }, h('div', { className: 'cxp-sw-k' }))
    }

    /** 主面板组件。 */
    function CodexPanel(props) {
      var ctxRef = props.ctx
      var st = React.useState({ loading: true, data: null, busy: null })
      var state = st[0]
      var setState = st[1]
      var openSt = React.useState(false)
      var open = openSt[0]
      var setOpen = openSt[1]

      /**
       * 调宿主半。走 HTTP，不走 host.call —— 后者是「动态包」专属的私有 RPC，
       * npm 包的客户端半没有这个符号（真插件 dsh-better-sidebar 用
       * fetch('/sidebar/api/'+m)，dsh-free-search 用 fetch(BRIDGE+'/describe')）。
       */
      function bridge(method, payload) {
        return fetch(BRIDGE + '/' + method, {
          method: payload === undefined ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        })
          .then(function (r) {
            return r.json().catch(function () {
              throw new Error('宿主半回了非 JSON（HTTP ' + r.status + '）')
            })
          })
          .then(function (j) {
            if (!j || j.ok !== true) {
              throw new Error((j && j.error && j.error.message) || '宿主半回了失败')
            }
            return j.value
          })
      }

      /** 取一次快照。失败也要显示错误，不静默。 */
      var load = React.useCallback(function () {
        bridge('snapshot')
          .then(function (d) {
            setState({ loading: false, data: d, busy: null })
          })
          .catch(function (e) {
            setState({ loading: false, data: null, busy: null, error: String((e && e.message) || e) })
          })
      }, [])

      // 首次挂载取一次；展开时再取一次（展开才需要最新数）
      React.useEffect(function () {
        if (open) load()
      }, [open, load])

      // 打开时每 20 秒刷新一次余额，面板关着不打扰
      React.useEffect(
        function () {
          if (!open) return
          var t = setInterval(load, 20000)
          return function () {
            clearInterval(t)
          }
        },
        [open, load],
      )

      /** 切一个工具。 */
      function toggle(tool, approved) {
        setState(function (s) {
          return { ...s, busy: tool }
        })
        bridge('toggle', { tool: tool, approved: approved })
          .then(function (d) {
            setState({ loading: false, data: d, busy: null })
          })
          .catch(function (e) {
            setState(function (s) {
              return { ...s, busy: null, error: String((e && e.message) || e) }
            })
          })
      }

      /** 全开 / 全关。 */
      function toggleAll(approved) {
        setState(function (s) {
          return { ...s, busy: '__all__' }
        })
        bridge('toggleAll', { approved: approved })
          .then(function (d) {
            setState({ loading: false, data: d, busy: null })
          })
          .catch(function (e) {
            setState(function (s) {
              return { ...s, busy: null, error: String((e && e.message) || e) }
            })
          })
      }

      var d = state.data
      var pre = d && d.preapproval
      var cost = d && d.cost
      var nOn = pre && pre.ok ? pre.approvedCount : 0
      var allOn = pre && pre.ok && pre.approvedCount === pre.totalCount && pre.totalCount > 0

      // 胶囊：一眼看出「一键同意」开着没
      var pill = h(
        'div',
        {
          className: 'cxp-pill',
          onClick: function () {
            setOpen(!open)
          },
          role: 'button',
          'aria-label': 'Codex 控制面板',
        },
        h('div', { className: 'cxp-dot' + (nOn > 0 ? ' on' : '') }),
        h('span', { className: 'cxp-pill-label' }, 'Codex'),
        h('span', { style: { fontSize: '10.5px', opacity: 0.62, fontVariantNumeric: 'tabular-nums' } }, nOn + '/' + (pre ? pre.totalCount : 8)),
      )

      if (!open) return h('div', { className: 'cxp-root' }, pill)

      var body
      if (state.loading) {
        body = h('div', { className: 'cxp-loading' }, '读取中…')
      } else if (state.error) {
        body = h('div', { className: 'cxp-loading' }, '读取失败：' + state.error)
      } else {
        var secs = []

        // —— 一键同意 ——
        var rows = []
        if (pre && pre.ok) {
          for (var i = 0; i < pre.tools.length; i++) {
            ;(function (t) {
              var pair = TOOL_LABEL[t.tool] || [t.tool, '']
              rows.push(
                h(
                  'div',
                  {
                    key: t.tool,
                    className: 'cxp-row' + (state.busy === t.tool ? ' busy' : ''),
                    onClick: function () {
                      toggle(t.tool, !t.approved)
                    },
                  },
                  h(
                    'div',
                    { className: 'cxp-row-txt' },
                    h('div', { className: 'cxp-row-n' }, pair[0]),
                    h('div', { className: 'cxp-row-d' }, pair[1]),
                  ),
                  Switch(t.approved),
                ),
              )
            })(pre.tools[i])
          }
        }

        secs.push(
          h(
            'div',
            { className: 'cxp-sec', key: 'pre' },
            h(
              'div',
              { className: 'cxp-sec-h' },
              h('span', { className: 'cxp-sec-t' }, '一键同意'),
              h(
                'button',
                {
                  className: 'cxp-btn' + (allOn ? '' : ' primary'),
                  onClick: function () {
                    toggleAll(!allOn)
                  },
                },
                allOn ? '全部关闭' : '全部开启',
              ),
            ),
            pre && pre.ok
              ? h('div', null, rows)
              : h('div', { className: 'cxp-note' }, 'git-manager 面板未连接：' + (pre && pre.error ? pre.error : '未知原因')),
            h(
              'div',
              { className: 'cxp-note' },
              allOn
                ? '已全开：这 8 个写操作不再弹审批卡。'
                : '开着的工具直接执行，不用点同意；关着的仍会弹卡。',
            ),
          ),
        )

        // —— 余额 ——
        var costEls
        if (cost && cost.ok) {
          var bal = typeof cost.balance === 'number' ? cost.balance : null
          // 以 ¥2 为目标线，画一根进度条（超了就满格）
          var target = 2
          var pct = bal === null ? 0 : Math.max(0, Math.min(100, (bal / target) * 100))
          costEls = [
            h(
              'div',
              { className: 'cxp-money', key: 'm' },
              h('span', { className: 'cxp-amount' }, bal === null ? '—' : '¥' + bal.toFixed(2)),
              h('span', { className: 'cxp-unit' }, cost.currency || 'CNY'),
            ),
            h(
              'div',
              { className: 'cxp-meta', key: 'meta' },
              '今日 ¥' + (cost.todayCost || 0).toFixed(4) + ' · ' + (cost.todayCalls || 0) + ' 次调用',
            ),
            typeof bal === 'number'
              ? h(
                  'div',
                  { className: 'cxp-bar', key: 'bar' },
                  h('div', { className: 'cxp-bar-fill', style: { width: pct + '%' } }),
                )
              : null,
            h('div', { className: 'cxp-note', key: 'n' }, '进度条以 ¥2 为目标线 · 快照 ' + (cost.balanceDate || '?')),
          ]
        } else {
          costEls = [h('div', { className: 'cxp-amount err' }, '读取失败')]
        }

        secs.push(h('div', { className: 'cxp-sec', key: 'cost' }, h('div', { className: 'cxp-sec-h' }, h('span', { className: 'cxp-sec-t' }, '余额')), h('div', null, costEls)))

        body = h('div', { className: 'cxp-body' }, secs)
      }

      var panel = h(
        'div',
        { className: 'cxp-panel', onClick: function (e) { e.stopPropagation() } },
        h(
          'div',
          { className: 'cxp-head' },
          h(
            'div',
            null,
            h('div', { className: 'cxp-title' }, 'Codex 控制面板'),
            h('div', { className: 'cxp-sub' }, nOn > 0 ? nOn + ' 个写操作免审批' : '全部走审批'),
          ),
          h('button', { className: 'cxp-x', onClick: function () { setOpen(false) }, 'aria-label': '收起' }, '×'),
        ),
        body,
      )

      return h('div', { className: 'cxp-root' }, pill, panel)
    }

    /**
     * 客户端入口。
     *
     * inject 是**声明式**的（和 free-search / web-mobile 一致）：声明依赖的客户端服务名，
     * 由宿主在服务就绪后调用 apply。不要用 ctx.get 软取 —— 那个路径没有服务注入，
     * ctx.slots 会是 undefined。
     */
    function apply(ctx) {
      // 样式：直接建 <style> 元素。客户端没有 require('styles') 这个模块
      // （真实插件都走 document.head.appendChild），用 require 会直接抛错。
      try {
        if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="codex-panel/panel.css"]')) {
          var tag = document.createElement('style')
          tag.dataset.plugin = 'codex-panel'
          tag.dataset.pluginCss = 'codex-panel/panel.css'
          tag.textContent = CSS
          document.head.appendChild(tag)
        }
      } catch (e) {
        /* 样式插不进不影响功能 */
      }

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'codex-panel-overlay',
            order: 100,
            inject: function () {
              return { ctx: ctx }
            },
          },
          CodexPanel,
        )
      })
    }

    /**
     * 声明的客户端服务依赖 —— 必须导出，宿主据此注入 ctx.slots。
     * 缺了它 apply 会被调用，但 ctx 上没有 slots。
     * （宿主半不在这个列表里：它通过 HTTP 路由访问，不是客户端服务。）
     */
    var inject = ['slots']

    exports.name = 'codex-panel'
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
