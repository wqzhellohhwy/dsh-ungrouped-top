# dsh-ungrouped-top

> 把 DSH 侧边栏的**「未分组」钉在最上面**，并让**「新会话」默认落进无工作区会话**。

一个零依赖的 DeepSeek Harness Web / Desktop 客户端插件。它不改 DSH 源码，只在运行时注入一小段样式，并在 `uiWorkspace` 服务的一个方法上做一层薄包装。

---

## 它解决什么问题

DSH 的侧边栏有两个写死的行为，设置里没有开关：

**1. 「未分组」永远垫底。** 分组列表由 `groupByWorkspace()` 生成——先按顺序铺开所有工作区，最后才把不属于任何工作区的会话追加成「未分组」组；而且这一组**没有拖拽手柄**（拖拽属性只在真实工作区上挂），既拖不动自己，也不能当作别人的落点。容器还是普通 block 布局，所以连 CSS `order` 都失效。

**2. 「新会话」永远跳回某个工作区。** `uiWorkspace.startSession()` 挑工作区的顺序是：

```
显式指定的工作区  →  当前会话所属的工作区  →  最近使用的工作区
```

无工作区会话不属于任何工作区，所以永远轮不到它——每次点「新会话」都会跳回最近用过的那个工作区。

---

## 它做什么

- **未分组置顶**：把侧边栏列表容器临时变成 flex 纵向布局，再给「未分组」那一组 `order: -1`。工作区之间的拖动排序不受影响。
- **新会话默认无工作区**（需配合 [dsh-projectless-session](https://github.com/jarvisluk/dsh-projectless-session) 之类的 provider）：拦截无参数的「新会话」调用并转交给 provider；给某个工作区分组点「+」时仍在该工作区里新建。
- **各分组始终「最近更新」在上**：DSH 的排序模式是全局的，而手动排序模式下任何持有「已保存顺序」的分组都会冻结；DSH 还会在你选中空白会话时把**所有**分组的当前顺序一次性回写（工作区因此也会被冻结，哪怕你从没拖过）。插件持续把已持有顺序的分组刷新成当前时间序——工作区与未分组一起保持「最新在上」。
- **临时分组标题校正**：provider 给临时工作区改名的那一步偶发会输给工作区列表刷新（结果分组标题退化成 `session-…` 目录名），插件会重试写回正确标题。
- **临时分组改名抢跑 + 置顶**：临时工作区一出现在列表里就被改名（不等 provider 走完「建目录 → 建工作区 → 开会话」整轮），并在它存在期间排到「未分组」之上——新会话不会再顶着 `session-…` 的名字、出现在松散会话列表的下方。

## 它不做什么

- 不修改 DSH 源码或 `app.asar`，不写任何 DSH 安装目录。
- 不创建目录、不管理会话生命周期、不做空白会话回收——那是 provider（如 projectless）的职责，本插件只调用它公开的入口。
- 不注册任何工具、不注入提示词、不读环境变量、不发任何网络请求。
- 不硬编码任何用户目录、profile 名或盘符。

---

## 安装

DSH 的插件装进某个 **profile**（`web`、`desktop` 等）。先把仓库取到本地，再选一种方式装进去。

### 方式 A：本地目录 link（推荐，改完即生效）

```powershell
git clone https://github.com/wqzhellohhwy/dsh-ungrouped-top.git D:\dsh-plugins\dsh-ungrouped-top
dsh plugin --profile web add "link:D:/dsh-plugins/dsh-ungrouped-top"
```

### 方式 B：直接从 GitHub 装

```powershell
dsh plugin --profile web add github:wqzhellohhwy/dsh-ungrouped-top
```

> 把 `--profile web` 换成你自己的 profile 名（桌面版通常是 `desktop`）。
> 装完**重启 DSH**；桌面版重启后如果不生效，再按一次 `Ctrl+R` 刷新界面。

### 可选：配合无工作区插件使用

「新会话默认无工作区」这一条需要环境里存在一个**无工作区会话 provider**。推荐：

```powershell
dsh plugin --profile web add dsh-projectless-session
```

provider 不在时，插件**安静降级**：未分组置顶照常生效，「新会话」回到 DSH 原生行为（跳回最近使用的工作区），控制台只会留一条 `console.warn`，不会报错也不会崩。

---

## 工作原理

### 未分组置顶（纯 CSS）

DSH 侧边栏的分组行带一个 `data-row-key` 标记：工作区是 `workspace:<workspaceId>`，未分组是 `workspace:`（id 为空）。插件据此定位并注入：

```css
[role="tree"]:has([data-row-key="workspace:"])            { display:flex; flex-direction:column }
[role="tree"]:has([data-row-key="workspace:"]) > *        { flex:0 0 auto }
[role="tree"]:has([data-row-key="workspace:"]) > div:has([data-row-key="workspace:"]) { order:-1 }
```

`display:flex` 只在该容器里确实存在未分组分组时才应用，其他视图（单一列表、无松散会话的工作区树）完全不受影响。

### 新会话转交（包装一个方法）

插件包装 `uiWorkspace.startSession`：

- **带了 `workspaceId`**（某个工作区分组的「+」）→ 原样交给 DSH；
- **没带**（侧边栏「新会话」按钮、`session.new` 快捷键、空状态）→ 交给 provider。

provider 的入口从 hero 工作区插槽 `conversation.hero.workspace` 里取：先按 locale 命名空间 / 组件名里含 `projectless` 识别，识别不到就退化为「任何注入了 `createProjectlessSession` 的插槽条目」，因此 provider 改名也能继续工作。

### 分组排序（时间序刷新）

DSH 的排序模式（视图选项里的「手动排序 / 最近更新」）是**全局**的，两种模式对"新成员"的处理方式不同：

- **最近更新**模式：每个分组都实时按 `updatedAt` 倒序，谁都追得上。
- **手动排序**模式：分组一旦持有「已保存顺序」，成员就按那份顺序**冻结**。

而 DSH 在手动排序模式下有个连带行为：**只要当前选中一个空白会话（刚新建、还没发消息），它就把每个账户的当前渲染顺序一次性回写进存储**（`syncSessionOrders`）。所以"没拖过就没有顺序"并不成立——新建一次会话，**所有**分组就被冻结了，工作区从此也不再按「最近更新」重排。

插件因此订阅会话列表与视图存储，在手动排序模式下核对**每一个已持有顺序的账户**：一旦它与当前时间序（`updatedAt` 倒序）不一致就刷新它。顺序一致时不做任何写入，因此不会产生写入循环。在「最近更新」模式下插件完全静默——DSH 自己就是时间序。

只刷新**已经持有顺序**的账户：没有顺序的分组本来就按时间序渲染，插件不会凭空创建一个。「单一列表」视图的账户不处理（它的成员口径由 DSH 自己维护）。

> 代价：手动拖拽排出的固定顺序会被下一次刷新覆盖。这是刻意的取舍——本插件的立场是各分组永远「最新在上」。

### 临时工作区分组（抢名 + 置顶）

无工作区会话在**发出第一条消息之前**必须借一个临时工作区落脚（DSH 不给没有工作区的会话完整界面）。provider 的流程是：建目录 → 注册临时工作区 → 开会话 → 改名 → 首条消息后注销注册。

问题出在中间那段时间：临时工作区先是顶着目录名（`session-26-05-31-a1b2c3d4`）出现在侧边栏，而且排在「未分组」下面——看起来就像新建的会话跑错了地方。插件因此做两件事：

- **抢名**：调用 provider 之前就订阅工作区列表，临时工作区一出现（标题仍等于目录名、路径形状匹配 `<root>/YYYY-MM-DD/session-…`）就立刻改名成 provider 的分组名，不等 provider 走完剩下几步。
- **置顶**：给标题等于 provider 分组名的那个分组打上 `data-ungrouped-top-temp`，样式表据此把它排到「未分组」之上（`order:-2`）。

两条规则都先核对路径形状与标题，因此不会误伤真实工作区；标记在插件卸载时清除。

### 护栏

| 护栏 | 为什么需要 |
|---|---|
| 在途锁 + 复用已打开的空白会话 | 连点「新会话」不会并发开出多个临时工作区 |
| 标题重试（400ms × 5） | provider 改名会输给紧随其后的工作区列表刷新，标题会退化成目录名 |
| 未分组顺序按时间序刷新 | 手动排序模式下「未分组」会冻结成固定顺序，不再「最新在上」 |

### 自检上报

Client 面在加载后（以及每次「新会话」被调用时）把自身状态 POST 给 Host 面注册的 `/api/ungrouped-top/diagnostics`，Host 以 JSONL 追加写到 `os.tmpdir()/dsh-ungrouped-top-diagnostics.json`：

```json
{"phase":"applied","providerFound":true,"wrapperInstalled":true,"orderBy":"manual","taggedTemporarySections":1}
{"phase":"startSession","mode":"default","providerFound":true}
```

它不改变任何行为，只用来回答"插件到底有没有在工作"——因为"插件没加载""加载了但 provider 没找到""包装被换掉了"这三种情况，从 Host 侧看是一模一样的（插件都是 active）。不需要就关掉：

```yaml
- id: dsh-ungrouped-top
  config:
    diagnostics: false
```

---

## 兼容性

| 项 | 要求 |
|---|---|
| DeepSeek Harness | `0.2.0-rc.2`（用到 `uiWorkspace`、`slots`、`locale`、`sessions`、`workspaces` 客户端服务） |
| Node.js | `>=22.19`（随 DSH 运行时，无需单独安装） |
| 平台 | Windows / macOS / Linux —— 插件不触碰文件系统与平台 API |
| profile | Web / Desktop（需要浏览器端 UI） |

**关于 DSH 升级**：插件依赖三个 DSH 内部约定——侧边栏的 `[role="tree"]` + `data-row-key` 标记（临时分组置顶还要读分组行的标题文本）、`uiWorkspace.startSession` 的兜底链、以及 `sidebar.workspaces` 插槽注册上携带的视图存储（用于刷新未分组顺序）。DSH 大版本升级后如果失效，改的是这三处，改动量都很小。

---

## 卸载

```powershell
dsh plugin --profile web remove dsh-ungrouped-top
```

插件在 `apply` 里用 `ctx.effect` 注册了样式与方法包装，卸载时会自动撤销（样式节点移除、`startSession` 还原成原方法）。DSH 自带的「未分组」行为随之恢复。

---

## 开发

**没有构建步骤**：`lib/` 里的两个文件就是源码，也是发布产物（Host 侧是标准 ESM，Client 侧是 DSH 的 `__ModuleLoader__.load({ id, factory })` 形式）。

改完之后：

```powershell
# 本地 link 安装的情况下，重启 DSH 即可生效
# 桌面版：重启后再 Ctrl+R 刷新界面
```

调试时看浏览器控制台，插件所有异常都以 `dsh-ungrouped-top:` 开头。

### 目录结构

```
lib/index.js        Host 侧入口：空插件（只为让包成为一个完整的 DSH bundle）
lib/client.js       Client 侧全部逻辑：样式注入 + startSession 包装 + 未分组顺序刷新 + 临时分组抢名与置顶
cordis.patch.yml    bundle patch：把本插件插入 loader
package.json        包元数据 + dsh.bundle / dsh.client 声明
```

---

## 常见问题

**装完没反应？**
先确认重启过 DSH（桌面版再 `Ctrl+R`），再确认 profile 名选对了。控制台若出现 `dsh-ungrouped-top:` 开头的警告，把它贴到 issue 里。

**「新会话」还是跳回工作区？**
说明环境里没有无工作区 provider。装 `dsh-projectless-session`，或把 provider 的入口暴露方式告知作者。

**「未分组」或某个工作区不按最新更新排序？**
说明视图选项里选的是「手动排序」，而那个分组持有「已保存顺序」。插件会把已持有顺序的分组自动刷成时间序（见上文「分组排序」）；如果没生效，先确认 `Ctrl+R` 刷过界面，再看控制台有没有 `cannot refresh a stored order`。

**禁用插件之后再启用，功能没回来？**
按 `Ctrl+R` 刷新界面。客户端插件代码**只在页面加载时执行一次**，在设置页里开关插件不会让它重新运行。刷新后控制台会有一行 `dsh-ungrouped-top: client face applied` 表示已生效；连这行都没有，说明插件根本没被加载（去检查 profile 的 `bundles`）。

**未分组还是能拖动？**
它本来就不能拖——DSH 没给这一组拖拽能力，本插件只改显示顺序，不伪造拖拽。

**会不会和别的插件打架？**
本插件只包装 `uiWorkspace.startSession` 一个方法，并且只拦截**无参数**调用；样式也不覆盖任何 DSH 原有规则。`dsh-projectless-session` 是设计上配合的对象，两者不冲突。

---

## 许可证

[MIT](LICENSE)
