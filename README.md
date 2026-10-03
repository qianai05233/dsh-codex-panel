# dsh-codex-panel

> **Codex 模式悬浮控制面板** —— 一次点击，让 git / GitHub 写操作不再逐个弹审批。
> A floating control panel for [DeepSeek Harness](https://github.com/deepseek-ai/dsh): one-tap approval for git & GitHub write tools, plus live balance.

---

## 它解决什么问题

用 DSH 做 git/GitHub 操作时，`dsh-git-manager` 的每个写工具都会**逐个弹审批卡**：

`git_commit` · `git_push` · `github_pr_create` · `github_pr_merge`
`github_issue_create` · `github_issue_comment` · `github_pr_comment` · `github_pr_review`

点一次两次还行，一天下来就是几十次。这个面板把它们收进一个**总开关**。

---

## 功能

### 一键同意

- 悬浮胶囊显示 `Codex 8/8` —— 一眼看出有几个写工具已免审批
- 展开后是 8 个独立开关，可以逐个切
- **总开关**：全开 / 全关

### 重启后自动恢复 ⭐

这是本插件存在的主要理由。

`dsh-git-manager` 的预批准表是**纯内存 Map**（`lib/index.js:2438`）：

```js
const preApprovals = /* @__PURE__ */ new Map()
```

**零持久化** —— DSH 每次重启，8 个工具的免审批状态全部清零。你会觉得「明明设置过了，怎么又要一个个点」。

本面板把你的选择记在磁盘上：

```
$DSH_HOME/storages/dsh-codex-panel/preapproved.json
```

启动后 3 秒（避开 git-manager 的路由注册）自动回灌。

> **首次运行不擅自放行** —— 没有意愿文件时静默跳过，不会替你决定。

### 余额显示

直接读 cost-meter 账本：当前余额 + 今日花费。

---

## 安装

```sh
dsh plugin --profile web add github:qianai05233/dsh-codex-panel
```

重启 `dsh web`。右上角出现 `Codex` 胶囊。

### 前置要求

- DSH `>= 0.1.7-rc.1`
- 需要 `dsh-git-manager`（悬浮面板会读它的预批准状态；没有它时面板仍显示，只是开关无效）

---

## 它是怎么工作的

```
浏览器 (client.js)               宿主 (index.js)
      │                                │
      │  fetch('/dsh-codex-panel/api/snapshot')
      ├───────────────────────────────>│  读 git-manager 预批准表
      │                                │  读 cost-meter 账本
      │<───────────────────────────────┤  { ok, value }
      │
      │  POST .../toggleAll {approved:true}
      ├───────────────────────────────>│  POST /gitm/preapprove × 8
      │<───────────────────────────────┤
```

**两个实现细节，值得写插件的人参考：**

1. **桥接路径不能放在 `/api` 下。** DSH 的 `/api` 是 `dsh-client-connection` 的浏览器 RPC 通道，带准入检查且约定 `POST + JSON envelope`。放进去的 GET 会被 401/415 拦掉。所以本插件用 `/dsh-codex-panel/api`。

2. **npm 包客户端半没有 `host` / `styles`。** 那套 `new Function(...)` 闭包注入的 Builtin 只属于「动态包」。npm 包客户端只能 `require` 9 个种子模块（react 等），跟宿主通信必须走 HTTP。这一点踩过坑，见[提交历史](https://github.com/qianai05233/dsh-codex-panel/commits)。

---

## 安全

- 授权只作用于 git-manager 的**写操作**，不涉及文件系统或 shell
- 面板**只回掩码数据**，不暴露任何 token
- 随时可在面板里一键全关，恢复逐个审批

---

## 配套

- **[dsh-codex-preset](https://github.com/qianai05233/dsh-codex-preset)** —— Codex 式五阶段工作流 agent preset
- **[dsh-freeapi-panel](https://github.com/qianai05233/dsh-freeapi-panel)** —— 29 家正规免费 LLM provider 聚合

## License

MIT
