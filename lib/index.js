/**
 * codex-panel —— Codex 模式的悬浮控制面板（宿主半）。
 *
 * 职责很小：把「面板要显示的事实」以 JSON 交给客户端半。
 *   - 一键同意的现状（哪些 git/GitHub 写工具已 preapprove）
 *   - 当前余额与今日花费（读 cost-meter 的 ledger.json）
 *   - 两个 preset（codex / novel-forge）在组合树里是否在册
 *
 * 三条刻意的设计（抄 dsh-status-overlay 的血泪）：
 *
 * 1) **不写模块级 `inject`**。模块级 inject 是硬依赖，缺服务就让 entry 永远 pending，
 *    dsh 会判定「1 entry did not activate」→ **整棵 plugin tree 加载失败**，Web 起不来。
 *    这个插件只用 ctx.get 软取服务，一个都不声明。
 *
 * 2) **一个异常都不能冒出去**。面板是「顺带好看」的功能，绝不能影响 agent 干活 ——
 *    所有 IO 与解析都包在 try/catch 里，失败就回可读错误，不是静默失败。
 *
 * 3) **只读，不改状态**。切换开关的动作由客户端半直接 POST /gitm/preapprove 完成，
 *    宿主半不代劳 —— 少一条写路径就少一个出错面。
 */
export const name = 'codex-panel'

/** git-manager 预批准覆盖的写工具。 */
const WRITE_TOOLS = [
  'git_commit',
  'git_push',
  'github_pr_create',
  'github_pr_merge',
  'github_issue_create',
  'github_issue_comment',
  'github_pr_comment',
  'github_pr_review',
]

/** git-manager 的 REST 基址（与面板同机，直连回环）。 */
const GITM = 'http://127.0.0.1:3080/gitm'

/** cost-meter 账本路径。 */
const LEDGER = '/root/.dsh/storages/cost-meter/ledger.json'

/** 单次请求超时：都在本机，2 秒都不该等。 */
const TIMEOUT_MS = 2000

/** 带超时的 JSON fetch，失败一律回 null 而不抛。 */
async function getJson(url, init) {
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    const res = await fetch(url, { ...init, signal: ac.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** 读 cost-meter 账本，取余额与今日花费。纯本地读，不烧 token。 */
async function readCost() {
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(LEDGER, 'utf8')
    const d = JSON.parse(raw)
    // 今日按本机日期切；账本以 YYYY-MM-DD 为键。
    const now = new Date()
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const today = d?.days?.[key] ?? {}
    return {
      ok: true,
      balance: d?.balanceRef?.total ?? null,
      currency: d?.balanceRef?.currency ?? 'CNY',
      balanceDate: d?.balanceRef?.date ?? null,
      todayCost: typeof today.cost === 'number' ? Number(today.cost.toFixed(4)) : 0,
      todayCalls: today.calls ?? 0,
      todayInput: today.input ?? 0,
      todayCacheRead: today.cacheRead ?? 0,
      todayOutput: today.output ?? 0,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/** 查 git-manager 已预批准的工具清单。 */
async function readPreapproved() {
  const r = await getJson(`${GITM}/preapprove-list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (r === null || r.ok !== true) {
    return { ok: false, error: 'git-manager 面板未连接或路由不可用', tools: [] }
  }
  const tools = Array.isArray(r.value?.tools) ? r.value.tools : []
  return { ok: true, tools }
}

/** 切换某个写工具的预批准状态。返回切换后的现状。 */
async function togglePreapproval(tool, approved) {
  if (!WRITE_TOOLS.includes(tool)) {
    return { ok: false, error: `未知写工具: ${tool}` }
  }
  if (approved) {
    await getJson(`${GITM}/preapprove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool }),
    })
  } else {
    await getJson(`${GITM}/preapprove-clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool }),
    })
  }
  await rememberCurrent()
  return await snapshot()
}

/** 一次性给全部写工具开/关预批准。 */
async function toggleAll(approved) {
  for (const tool of WRITE_TOOLS) {
    if (approved) {
      await getJson(`${GITM}/preapprove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool }),
      })
    } else {
      await getJson(`${GITM}/preapprove-clear`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool }),
      })
    }
  }
  await rememberCurrent()
  return await snapshot()
}

/** 把 git-manager 当前的预批准现状抄到本地，供下次启动回灌。 */
async function rememberCurrent() {
  const pre = await readPreapproved()
  if (!pre.ok) return false
  return await writeWant(Array.isArray(pre.tools) ? pre.tools : [])
}

/** 汇总面板要显示的全部事实。 */
async function snapshot() {
  const [pre, cost] = await Promise.all([readPreapproved(), readCost()])
  const approved = new Set(pre.tools ?? [])
  return {
    preapproval: {
      ok: pre.ok,
      ...(pre.error === undefined ? {} : { error: pre.error }),
      tools: WRITE_TOOLS.map((tool) => ({ tool, approved: approved.has(tool) })),
      approvedCount: WRITE_TOOLS.filter((t) => approved.has(t)).length,
      totalCount: WRITE_TOOLS.length,
    },
    cost,
  }
}

/**
 * 一键同意的**持久化**。
 *
 * 背景（实测得出）：dsh-git-manager 的 preApprovals 是模块级 `new Map()`
 * （lib/index.js:2438），**没有任何持久化**。DSH 一重启，8 个写工具的预批准
 * 全部清零 —— 用户每次重启后又要面对「一个个点同意」。
 *
 * 这里把「用户想要的免审批清单」记在自己的磁盘文件里，并在每次插件加载时
 * 回灌给 git-manager。用户若在面板里关掉某些工具，也会同步写回文件，
 * 所以关掉的状态同样能跨重启保持。
 */
const WANT_FILE = '/root/.dsh/storages/dsh-codex-panel/preapproved.json'

async function readWant() {
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(WANT_FILE, 'utf8')
    const d = JSON.parse(raw)
    return Array.isArray(d?.tools) ? d.tools.filter((t) => WRITE_TOOLS.includes(t)) : null
  } catch {
    return null
  }
}

async function writeWant(tools) {
  try {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(WANT_FILE), { recursive: true })
    await fs.writeFile(
      WANT_FILE,
      JSON.stringify({ tools, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    )
    return true
  } catch {
    return false
  }
}

/**
 * 启动时回灌：把磁盘上「用户想要的免审批清单」重新授予 git-manager。
 *
 * 首次运行时（没有 want 文件）**不擅自授予** —— 只在已有意向记录时才恢复，
 * 避免插件替用户做「要不要放行写操作」的决定。用户第一次在面板里点一下
 * 「全部开启」，之后就永久生效了。
 */
async function restoreOnBoot() {
  const want = await readWant()
  if (want === null) return { restored: false, reason: 'no-preference-recorded' }
  if (want.length === 0) return { restored: false, reason: 'user-kept-all-gated' }
  for (const tool of want) {
    await getJson(`${GITM}/preapprove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool }),
    })
  }
  return { restored: true, tools: want }
}

/** 客户端半与本半之间的 HTTP 基址。 */
const BRIDGE = '/dsh-codex-panel/api'

/** 读请求体（小 JSON），失败回 null 而不是抛。 */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      resolve(v)
    }
    try {
      req.on('data', (c) => {
        raw += c
        if (raw.length > 1e6) finish(null)
      })
      req.on('end', () => {
        if (!raw) return finish(null)
        try {
          finish(JSON.parse(raw))
        } catch {
          finish(null)
        }
      })
      req.on('error', () => finish(null))
    } catch {
      finish(null)
    }
  })
}

/** 统一的 JSON 回复。 */
function sendJson(res, status, payload) {
  try {
    const body = JSON.stringify(payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    try {
      res.writeHead(500)
      res.end()
    } catch {
      /* 连接已经断了，没什么可做的 */
    }
  }
}

export function apply(ctx) {
  // 客户端半用 fetch(BRIDGE + '/<method>') 与本半通信。
  //
  // 注意这里**不能**用 host.call/harness.handle —— 那套私有 RPC 是「动态包」
  // （源码字符串求值、host 作为闭包参数注入）专属的；npm 包的客户端半走
  // __ModuleLoader__.load + factory(require)，根本没有 host 这个符号。
  // npm 包的端到端范式就是 HTTP 路由（见 dsh-better-sidebar 的 /sidebar/api、
  // dsh-free-search 的 /api/dsh-free-search-settings）。
  //
  // webServer 也**不写进模块级 inject**（硬依赖会导致整棵插件树加载失败），
  // 用 ctx.inject 做软依赖：没有 webServer 就不注册，插件本体照常加载。
  try {
    ctx.inject?.(['webServer'], (webCtx) => {
      const register = () => {
        try {
          return webCtx.webServer.register({
            kind: 'prefix',
            path: BRIDGE,
            handler: async (req, res) => {
              try {
                const url = new URL(req.url ?? '/', 'http://x')
                const method = url.pathname.slice(BRIDGE.length).replace(/^\/+/, '').replace(/\/+$/, '')

                if (req.method === 'GET' && (method === '' || method === 'snapshot')) {
                  return sendJson(res, 200, { ok: true, value: await snapshot() })
                }
                if (req.method !== 'POST') {
                  return sendJson(res, 405, { ok: false, error: { code: 'method', message: 'method not allowed' } })
                }

                const body = await readBody(req)
                if (method === 'toggle') {
                  return sendJson(res, 200, {
                    ok: true,
                    value: await togglePreapproval(body?.tool, body?.approved !== false),
                  })
                }
                if (method === 'toggleAll') {
                  return sendJson(res, 200, { ok: true, value: await toggleAll(body?.approved !== false) })
                }
                if (method === 'restore') {
                  return sendJson(res, 200, { ok: true, value: await restoreOnBoot() })
                }
                return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `未知方法 "${method}"` } })
              } catch (err) {
                return sendJson(res, 500, {
                  ok: false,
                  error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
                })
              }
            },
          })
        } catch {
          return undefined
        }
      }
      try {
        webCtx.effect(register, 'codex-panel: /api/dsh-codex-panel routes')
      } catch {
        register()
      }
    })
  } catch {
    // 宿主 API 形态不符时不留痕 —— 面板只是顺带好看的功能。
  }

  // 启动回灌：git-manager 的预批准是纯内存的，重启即丢。这里把用户上次
  // 在面板里表达的意愿重新授予（首次运行没有记录则不动，不替用户做决定）。
  // 延迟到 git-manager 的 web 路由就绪之后再打，避免赶在它注册前空跑。
  try {
    setTimeout(() => {
      restoreOnBoot().catch(() => {})
    }, 3000)
  } catch {
    /* 定时器都建不起来也不影响插件本体 */
  }
}
