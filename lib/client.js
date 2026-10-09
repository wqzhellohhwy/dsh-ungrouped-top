window.__ModuleLoader__.load({ id: "dsh-ungrouped-top", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
// Client face of dsh-ungrouped-top.
//
// 1) Sidebar order
//    DSH derives sidebar groups by appending the Ungrouped bucket after every
//    Workspace group (dsh-client-ui-workspace `groupByWorkspace`), and that
//    bucket carries no drag handle, so it can neither be reordered nor moved.
//    The rows are plain block children of the `[role="tree"]` scroll
//    container, which means `order` has no effect there either. The stylesheet
//    below turns that container into a flex column so `order` applies, then
//    lifts the Ungrouped section with `order: -1`. The selector keys off the
//    row marker `data-row-key="workspace:"`, which DSH emits only for the
//    Ungrouped section, so the rule is inert in every other sidebar view.
//
// 2) New-session default
//    `uiWorkspace.startSession(workspaceId)` falls back to the current
//    Session's Workspace and then to the most recently used Workspace — never
//    to a projectless Session. This plugin wraps that method: an unqualified
//    new Session is delegated to whichever projectless provider is installed,
//    while an explicit workspaceId (a group's "+") keeps DSH's own behaviour.
//    Two guards follow each provisioned Session: an in-flight lock (plus reuse
//    of an already-open blank projectless Session) so repeated clicks cannot
//    queue parallel provisions, and a label reconcile, because the provider's
//    rename of its temporary Workspace can lose a race with the Workspace list
//    refresh and leave the directory basename (a `session-…` name) on the group.
//
// 3) Ungrouped ordering
//    DSH keeps ONE ordering mode for the whole sidebar. Under "manual" mode a
//    group that owns a stored order freezes it, and Ungrouped is the group that
//    ends up owning one — so it stops following "newest first" while every
//    ordinary Workspace (no stored order) keeps following it. This plugin
//    rewrites Ungrouped's stored order to the current recency order whenever it
//    drifts, and only under "manual" mode: under "last updated" mode DSH already
//    orders by recency, so nothing is written at all. Only the Ungrouped
//    account is touched — Workspace orders are never disturbed.
var name = "dsh-ungrouped-top";
var inject = ["connection", "locale", "sessions", "slots", "uiWorkspace", "workspaces"];
var DIAGNOSTICS_ENDPOINT = "ungrouped-top/diagnostics";
// The slot a projectless provider publishes its Workspace picker into.
var HERO_SLOT = "conversation.hero.workspace";
// The slot whose registration carries the sidebar's view store.
var SIDEBAR_SLOT = "sidebar.workspaces";
// A provider identifies itself by a locale namespace and/or a component name
// that mention "projectless"; the label key is read from its dictionary.
var PROVIDER_HINT = /projectless/i;
var LABEL_KEY = "picker.projectless";
// The directory shape a projectless provider gives its per-Session workspace:
// <root>/YYYY-MM-DD/session-HH-mm-ss-xxxxxxxx
var DATE_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/;
var SESSION_DIRECTORY = /^session-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;
var TREE = '[role="tree"]:has([data-row-key="workspace:"])';
// A temporary projectless Workspace is tagged by `markTemporaryGroups` so the
// stylesheet can hold it above Ungrouped. It only exists between "the Workspace
// is created" and "the first prompt retires it", and a brand-new Session
// appearing *below* the loose-Session list is exactly what reads as "the new
// chat landed in the wrong place".
var TEMP_ATTR = "data-ungrouped-top-temp";
var CSS = [
  "/* dsh-ungrouped-top: keep Ungrouped above every workspace group, and the */",
  "/* projectless temporary Workspace above Ungrouped while it exists.        */",
  TREE + "{display:flex;flex-direction:column}",
  TREE + ">*{flex:0 0 auto}",
  TREE + ">div:has([data-row-key=\"workspace:\"]){order:-1}",
  TREE + ">div[" + TEMP_ATTR + "]{order:-2}"
].join("\n");
/** A path shaped like `…/YYYY-MM-DD/session-HH-mm-ss-xxxxxxxx`, i.e. one a projectless provider owns. */
function isProjectlessPath(path) {
  const segments = String(path).replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  const dateName = segments[segments.length - 2];
  const sessionName = segments[segments.length - 1];
  return dateName !== void 0 && sessionName !== void 0 && DATE_DIRECTORY.test(dateName) && SESSION_DIRECTORY.test(sessionName);
}
/** The final path segment — the label DSH shows before a Workspace gets renamed. */
function baseName(path) {
  const segments = String(path).replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "";
}
/**
* Rename a freshly created projectless Workspace the moment it shows up, rather
* than waiting for the provider to finish opening the Session first.
*
* The provider renames it too, at the end of its own provisioning round trip;
* this watcher only makes the rename win the race, so the directory name (a
* `session-…` label) does not sit on the sidebar for the whole of that trip.
* @returns a stop function.
*/
function watchTemporaryLabel(ctx, label) {
  if (label === void 0) return () => {};
  let stopped = false;
  const fix = () => {
    if (stopped) return;
    let items;
    try {
      items = ctx.workspaces.list.getSnapshot().items ?? [];
    } catch (reason) {
      return;
    }
    for (const workspace of items) {
      if (!isProjectlessPath(workspace.path)) continue;
      if (workspace.title === label) continue;
      if (workspace.title !== baseName(workspace.path)) continue;
      try {
        ctx.workspaces.rename(workspace.workspaceId, label).catch(() => {});
      } catch (reason) {}
    }
  };
  let unsubscribe = () => {};
  try {
    unsubscribe = ctx.workspaces.list.subscribe(fix) || (() => {});
  } catch (reason) {}
  fix();
  return () => {
    stopped = true;
    try {
      unsubscribe();
    } catch (reason) {}
  };
}
/**
* Tag the sidebar section owned by a projectless temporary Workspace, so the
* stylesheet can lift it above Ungrouped.
*
* The section is recognised by its group label — the provider's own localized
* string — because the temporary Workspace id is not known ahead of time. The
* tag is (re)applied on every Workspace list change, deferred past React's
* commit by a timeout plus a frame.
*/
function markTemporaryGroups(ctx) {
  ctx.effect(() => {
    const mark = () => {
      const provider = findProjectless(ctx);
      const label = provider === void 0 ? void 0 : providerLabel(ctx, provider.locale);
      if (label === void 0) return;
      let sections;
      try {
        sections = document.querySelectorAll('[role="tree"] > div');
      } catch (reason) {
        return;
      }
      for (const section of sections) {
        let row;
        try {
          row = section.querySelector('[data-row-key^="workspace:"]');
        } catch (reason) {
          continue;
        }
        const text = row === null ? "" : String(row.textContent ?? "").trim();
        if (text === label) section.setAttribute(TEMP_ATTR, "1");
        else section.removeAttribute(TEMP_ATTR);
      }
    };
    const schedule = () => {
      window.setTimeout(mark, 0);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(mark);
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = ctx.workspaces.list.subscribe(schedule) || (() => {});
    } catch (reason) {}
    schedule();
    return () => {
      try {
        unsubscribe();
      } catch (reason) {}
      try {
        for (const section of document.querySelectorAll("[" + TEMP_ATTR + "]")) section.removeAttribute(TEMP_ATTR);
      } catch (reason) {}
    };
  }, name + ": tag the temporary workspace section");
}
/**
* Find the projectless provider's own "Session without workspace" entry point
* in the hero workspace slot, so this plugin never re-implements its directory
* provisioning or blank-session cleanup.
*
* A provider is recognised by a locale namespace or component name mentioning
* "projectless"; when no entry matches that, any slot entry whose injected
* actions expose `createProjectlessSession` is accepted, so the integration
* keeps working across provider renames.
* @returns the provider's actions plus its locale namespace, or undefined.
*/
function findProjectless(ctx) {
  let entries;
  try {
    entries = ctx.slots.entries(HERO_SLOT);
  } catch (reason) {
    return void 0;
  }
  const list = [...(entries ?? [])];
  const hinted = (entry) => {
    if (entry === void 0) return false;
    if (typeof entry.locale === "string" && PROVIDER_HINT.test(entry.locale)) return true;
    const component = entry.component;
    return typeof component === "function" && PROVIDER_HINT.test(component.name ?? "");
  };
  const read = (entry) => {
    const factory = entry.inject ?? entry.options?.inject;
    if (typeof factory !== "function") return void 0;
    try {
      const actions = factory();
      if (actions === null || typeof actions !== "object") return void 0;
      if (typeof actions.createProjectlessSession !== "function") return void 0;
      return { actions, locale: typeof entry.locale === "string" ? entry.locale : void 0 };
    } catch (reason) {
      console.warn("dsh-ungrouped-top: projectless entry point unavailable:", reason);
    }
    return void 0;
  };
  for (const entry of list) if (hinted(entry)) {
    const found = read(entry);
    if (found !== void 0) return found;
  }
  for (const entry of list) {
    const found = read(entry);
    if (found !== void 0) return found;
  }
  return void 0;
}
/** The provider's group label in the active language, or undefined when its dictionary is absent. */
function providerLabel(ctx, localeNamespace) {
  if (typeof localeNamespace !== "string" || localeNamespace === "") return void 0;
  try {
    const label = ctx.locale.bind(localeNamespace)(LABEL_KEY);
    if (typeof label === "string" && label !== "") return label;
  } catch (reason) {}
  return void 0;
}
// NOTE: there used to be an `openBlankProjectlessSession` reuse guard here —
// "if a blank projectless Session is already open, just focus it". It was
// removed because it cannot tell a provider-owned temporary Workspace from a
// user's own Workspace that happens to point at a `…/YYYY-MM-DD/session-…`
// directory: the path shape matches, so an unqualified "new Session" was
// silently swallowed (it just re-opened the existing Session, and nothing
// appeared to happen). The in-flight lock already covers the repeated-click
// case that guard was written for.
/**
* Re-apply the provider's group label until it sticks: the provider's own
* rename can be overtaken by the Workspace list refresh that immediately
* follows provisioning, which leaves the temporary directory basename (the
* `session-…` name) on the group.
*/
function reconcileLabel(ctx, sessionId, localeNamespace) {
  const label = providerLabel(ctx, localeNamespace);
  if (label === void 0) return;
  const attempt = (remaining) => {
    let workspace;
    try {
      workspace = (ctx.workspaces.list.getSnapshot().items ?? []).find((item) => item.sessionIds.includes(sessionId));
    } catch (reason) {
      workspace = void 0;
    }
    if (workspace !== void 0) {
      if (!isProjectlessPath(workspace.path)) return;
      if (workspace.title === label) return;
      try {
        ctx.workspaces.rename(workspace.workspaceId, label).catch(() => {});
      } catch (reason) {}
    }
    if (remaining > 0) window.setTimeout(() => {
      attempt(remaining - 1);
    }, 400);
  };
  attempt(5);
}
/**
* The sidebar's view-store instance: current viewing state (grouping mode,
* ordering mode, stored per-account orders) plus the engine's own write set.
* The slot registration carries it as `store`; the owner memoises `create()`,
* so this always hands back the live instance.
* @returns the instance, or undefined when the sidebar is not mounted.
*/
function workspaceViewInstance(ctx) {
  let entries;
  try {
    entries = ctx.slots.entries(SIDEBAR_SLOT);
  } catch (reason) {
    return void 0;
  }
  for (const entry of entries ?? []) {
    const store = entry?.options?.store ?? entry?.store;
    if (store === void 0 || typeof store.create !== "function") continue;
    try {
      const instance = store.create();
      if (instance === void 0 || instance === null) continue;
      if (instance.store === void 0 || typeof instance.store.update !== "function") continue;
      if (typeof instance.getSnapshot !== "function") continue;
      return instance;
    } catch (reason) {}
  }
  return void 0;
}
/** Every account's members in "newest first" order, keyed by account ("" is Ungrouped). */
function recencyOrders(ctx) {
  const sessions = ctx.sessions.list.getSnapshot();
  const workspaces = ctx.workspaces.list.getSnapshot();
  const byRecency = (ids) => (ids ?? [])
    .filter((id) => sessions.byId[id] !== void 0)
    .slice()
    .sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0));
  const orders = {};
  const accounted = new Set();
  for (const workspace of workspaces.items ?? []) {
    for (const id of workspace.sessionIds ?? []) accounted.add(id);
    orders[workspace.workspaceId] = byRecency(workspace.sessionIds);
  }
  orders[""] = byRecency((sessions.ids ?? []).filter((id) => !accounted.has(id)));
  return orders;
}
function sameOrder(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}
/**
* Keep every account following "newest first" while DSH is in manual ordering
* mode.
*
* Manual mode freezes any group that owns a stored order, and DSH hands one to
* *every* account the moment a blank Session is selected (`syncSessionOrders`
* writes the current rendered order back for all of them). That is what makes a
* workspace stop re-sorting by recency after the first new Session: the stored
* order wins from then on. Ungrouped additionally drifts on its own, since every
* Session either joins it or leaves it.
*
* So this writer refreshes an account's stored order whenever it no longer
* matches the current recency order. Only accounts that already own one are
* touched — with no stored order DSH renders by recency anyway, and creating one
* would be a change nobody asked for. Under "last updated" mode stored orders
* are not consulted at all, and this writer stays idle.
*
* Trade-off: a manual drag on any group is overwritten by the next refresh. That
* is deliberate — this plugin's position is that groups stay newest-first.
*/
function keepRecencyOrder(ctx) {
  ctx.effect(() => {
    let view;
    let disposed = false;
    let disposers = [];
    let timers = [];
    let warned = false;
    const sync = () => {
      if (disposed || view === void 0) return;
      let snapshot;
      try {
        snapshot = view.getSnapshot();
      } catch (reason) {
        return;
      }
      if (snapshot === void 0 || snapshot.orderBy !== "manual") return;
      const stored = snapshot.sessionOrderByAccount;
      if (stored === void 0) return;
      const changed = {};
      for (const [account, order] of Object.entries(recencyOrders(ctx))) {
        const current = stored[account];
        if (!Array.isArray(current) || sameOrder(current, order)) continue;
        changed[account] = order;
      }
      if (Object.keys(changed).length === 0) return;
      try {
        view.store.update((draft) => {
          if (draft.sessionOrderByAccount === void 0) draft.sessionOrderByAccount = {};
          for (const [account, order] of Object.entries(changed)) draft.sessionOrderByAccount[account] = [...order];
        });
      } catch (reason) {
        console.warn("dsh-ungrouped-top: cannot refresh a stored order:", reason);
      }
    };
    const attach = () => {
      if (disposed || view !== void 0) return;
      const found = workspaceViewInstance(ctx);
      if (found === void 0) return;
      view = found;
      try {
        disposers.push(ctx.sessions.list.subscribe(sync));
      } catch (reason) {}
      try {
        disposers.push(view.subscribe(sync));
      } catch (reason) {}
      sync();
    };
    const attachOnce = () => {
      attach();
      if (view === void 0) {
        if (!warned) {
          warned = true;
          console.warn("dsh-ungrouped-top: sidebar view store not found yet; will keep retrying");
        }
        return;
      }
      for (const timer of timers) window.clearTimeout(timer);
      timers = [];
    };
    let stopSlots = () => {};
    try {
      stopSlots = ctx.slots.subscribe(SIDEBAR_SLOT, attachOnce) || (() => {});
    } catch (reason) {}
    // The sidebar registers its view store after this plugin's own apply (slot
    // registration is deferred until the parent slot is declared), and a
    // subscription does not re-fire for a slot that already exists, so a short
    // retry ladder covers both orders.
    attachOnce();
    for (const delay of [250, 1000, 3000, 8000]) timers.push(window.setTimeout(attachOnce, delay));
    return () => {
      disposed = true;
      for (const timer of timers) window.clearTimeout(timer);
      timers = [];
      try {
        stopSlots();
      } catch (reason) {}
      for (const dispose of disposers) try {
        dispose();
      } catch (reason) {}
      disposers = [];
      view = void 0;
    };
  }, name + ": keep every group in recency order");
}
/**
* Post the Client face's own state to the Host. Nothing here changes
* behaviour; it exists so that "the plugin reads as active but the feature does
* nothing" can be told apart from the outside — a stale page, a provider that
* never registered, and a wrapper that got replaced are indistinguishable from
* the Host otherwise.
*/
function reportDiagnostics(ctx, payload) {
  try {
    const rpc = ctx.connection?.rpc;
    if (rpc === void 0 || typeof rpc.call !== "function") return;
    void Promise.resolve(rpc.call("/api", DIAGNOSTICS_ENDPOINT, payload)).catch(() => {});
  } catch (reason) {}
}
function selfCheck(ctx, phase) {
  let provider;
  try {
    provider = findProjectless(ctx);
  } catch (reason) {}
  let heroEntries = -1;
  try {
    heroEntries = (ctx.slots.entries(HERO_SLOT) ?? []).length;
  } catch (reason) {}
  let orderBy = null;
  let storedAccounts = null;
  try {
    const view = workspaceViewInstance(ctx);
    if (view !== void 0) {
      const snapshot = view.getSnapshot();
      orderBy = snapshot?.orderBy ?? null;
      const store = snapshot?.sessionOrderByAccount ?? {};
      const recency = recencyOrders(ctx);
      storedAccounts = Object.fromEntries(Object.entries(store).map(([key, value]) => {
        const stored = Array.isArray(value) ? value : [];
        const target = recency[key] ?? [];
        return [key === "" ? "(ungrouped)" : key.slice(0, 8), { members: stored.length, outOfRecency: stored.filter((id, index) => id !== target[index]).length }];
      }));
    }
  } catch (reason) {}
  let sections = -1;
  let tagged = -1;
  try {
    sections = document.querySelectorAll('[role="tree"] > div').length;
    tagged = document.querySelectorAll("[" + TEMP_ATTR + "]").length;
  } catch (reason) {}
  const ui = ctx.uiWorkspace;
  reportDiagnostics(ctx, {
    phase,
    plugin: name + "@1.3.0",
    url: String((typeof location === "undefined" ? void 0 : location.href) ?? ""),
    providerFound: provider !== void 0,
    providerLocale: provider === void 0 ? null : provider.locale ?? null,
    wrapperInstalled: typeof ui?.startSession === "function" && ui.startSession.__dshUngroupedTop === true,
    heroSlotEntries: heroEntries,
    orderBy,
    storedAccounts,
    sidebarSections: sections,
    taggedTemporarySections: tagged,
    at: Date.now()
  });
}
function installStyles(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = name;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, name + ": styles");
}
function defaultNewSessionToProjectless(ctx) {
  ctx.effect(() => {
    const ui = ctx.uiWorkspace;
    let fallback = ui.startSession;
    if (typeof fallback !== "function") return;
    let inFlight = false;
    let warnedNoProvider = false;
    const patched = function (workspaceId) {
      if (workspaceId !== void 0) {
        reportDiagnostics(ctx, { phase: "startSession", mode: "explicit-workspace", at: Date.now() });
        return fallback.call(ui, workspaceId);
      }
      const provider = findProjectless(ctx);
      reportDiagnostics(ctx, { phase: "startSession", mode: "default", providerFound: provider !== void 0, at: Date.now() });
      if (provider === void 0) {
        if (!warnedNoProvider) {
          warnedNoProvider = true;
          console.warn("dsh-ungrouped-top: no projectless provider found; a new Session keeps DSH's own default");
        }
        return fallback.call(ui, workspaceId);
      }
      if (inFlight) return;
      inFlight = true;
      const stopWatch = watchTemporaryLabel(ctx, providerLabel(ctx, provider.locale));
      void Promise.resolve().then(() => provider.actions.createProjectlessSession()).then((sessionId) => {
        if (typeof sessionId !== "string") return;
        reconcileLabel(ctx, sessionId, provider.locale);
      }).catch((reason) => {
        console.warn("dsh-ungrouped-top: projectless session failed:", reason);
      }).finally(() => {
        inFlight = false;
        window.setTimeout(stopWatch, 2000);
      });
    };
    patched.__dshUngroupedTop = true;
    /**
    * Keep the wrapper installed. Enabling the plugin again, or any reload that
    * rebuilds the `uiWorkspace` service, hands out a fresh object whose
    * `startSession` is DSH's own again — the effect would already have run, so
    * without this guard the override silently disappears while the plugin still
    * reads as active. A slower wrapper found underneath is preserved as the
    * fallback instead of being dropped.
    */
    const install = () => {
      if (ui.startSession === patched) return;
      const current = ui.startSession;
      if (typeof current !== "function") return;
      if (current.__dshUngroupedTop !== true) fallback = current;
      try {
        ui.startSession = patched;
      } catch (reason) {
        console.warn("dsh-ungrouped-top: cannot override startSession:", reason);
      }
    };
    install();
    const guard = window.setInterval(install, 2000);
    return () => {
      window.clearInterval(guard);
      if (ui.startSession === patched) {
        try {
          ui.startSession = fallback;
        } catch (reason) {}
      }
    };
  }, name + ": default new session to projectless");
}
function apply(ctx) {
  // One line, once per page load: the only way to tell "the plugin never ran"
  // from "it ran but did not take effect" when a feature is reported missing.
  console.info("dsh-ungrouped-top: client face applied");
  installStyles(ctx);
  defaultNewSessionToProjectless(ctx);
  keepRecencyOrder(ctx);
  markTemporaryGroups(ctx);
  window.setTimeout(() => selfCheck(ctx, "applied"), 2500);
}
module.exports = { apply, inject, name };
return module.exports; } });
