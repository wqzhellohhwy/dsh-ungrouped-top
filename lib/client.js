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
//
//    Three guards follow each provisioned Session:
//    - an in-flight lock, plus reuse of an already-open blank projectless
//      Session, so repeated clicks cannot queue parallel provisions;
//    - a label reconcile, because the provider's rename of its temporary
//      Workspace can lose a race with the Workspace list refresh and leave the
//      directory basename (a `session-…` name) on the group;
//    - a front-of-group write, because manual ordering appends Sessions it has
//      never seen to the end of Ungrouped, so a brand-new Session would
//      otherwise appear at the very bottom.
var name = "dsh-ungrouped-top";
var inject = ["locale", "sessions", "slots", "uiWorkspace", "workspaces"];
// The slot a projectless provider publishes its Workspace picker into.
var HERO_SLOT = "conversation.hero.workspace";
// A provider identifies itself by a locale namespace and/or a component name
// that mention "projectless"; the label key is read from its dictionary.
var PROVIDER_HINT = /projectless/i;
var LABEL_KEY = "picker.projectless";
// The directory shape a projectless provider gives its per-Session workspace:
// <root>/YYYY-MM-DD/session-HH-mm-ss-xxxxxxxx
var DATE_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/;
var SESSION_DIRECTORY = /^session-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;
var FLAT_SESSION_ORDER_KEY = "__flat_session_order__";
var TREE = '[role="tree"]:has([data-row-key="workspace:"])';
var CSS = [
  "/* dsh-ungrouped-top: keep the Ungrouped group above every workspace group. */",
  TREE + "{display:flex;flex-direction:column}",
  TREE + ">*{flex:0 0 auto}",
  TREE + ">div:has([data-row-key=\"workspace:\"]){order:-1}"
].join("\n");
/** A path shaped like `…/YYYY-MM-DD/session-HH-mm-ss-xxxxxxxx`, i.e. one a projectless provider owns. */
function isProjectlessPath(path) {
  const segments = String(path).replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  const dateName = segments[segments.length - 2];
  const sessionName = segments[segments.length - 1];
  return dateName !== void 0 && sessionName !== void 0 && DATE_DIRECTORY.test(dateName) && SESSION_DIRECTORY.test(sessionName);
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
/** The open blank Session living in a projectless temporary Workspace, if any. */
function openBlankProjectlessSession(ctx) {
  let sessions;
  let workspaces;
  try {
    sessions = ctx.sessions.list.getSnapshot();
    workspaces = ctx.workspaces.list.getSnapshot();
  } catch (reason) {
    return void 0;
  }
  const archived = new Set(workspaces.archivedSessionIds ?? []);
  for (const id of sessions.ids ?? []) {
    const summary = sessions.byId[id];
    if (summary === void 0 || !summary.blank || archived.has(id)) continue;
    const owner = (workspaces.items ?? []).find((item) => item.sessionIds.includes(id));
    if (owner !== void 0 && isProjectlessPath(owner.path)) return id;
  }
  return void 0;
}
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
* Front a freshly provisioned Session inside its own group order (Ungrouped,
* since a projectless Session owns no Workspace). Manual ordering appends
* unknown members to the end, so without this write the new Session lands
* below every existing loose Session.
*/
function frontSession(ctx, sessionId) {
  const view = ctx.uiWorkspace?.view;
  if (view === void 0 || typeof view.pinSessionOrder !== "function") return;
  let sessions;
  let workspaces;
  try {
    sessions = ctx.sessions.list.getSnapshot();
    workspaces = ctx.workspaces.list.getSnapshot();
  } catch (reason) {
    return;
  }
  const items = workspaces.items ?? [];
  const accounted = new Set(items.flatMap((workspace) => workspace.sessionIds));
  const ids = (sessions.ids ?? []).filter((id) => sessions.byId[id] !== void 0);
  const source = {
    members: Object.fromEntries([
      ...items.map((workspace) => [workspace.workspaceId, workspace.sessionIds]),
      ["", ids.filter((id) => !accounted.has(id))],
      [FLAT_SESSION_ORDER_KEY, ids]
    ]),
    summaries: sessions.byId,
    rowState: {
      pinnedSessionIds: workspaces.pinnedSessionIds ?? [],
      archivedSessionIds: workspaces.archivedSessionIds ?? []
    }
  };
  try {
    view.pinSessionOrder(sessionId, [""], source);
  } catch (reason) {
    console.warn("dsh-ungrouped-top: cannot front the new session:", reason);
  }
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
    const original = ui.startSession;
    if (typeof original !== "function") return;
    let inFlight = false;
    const patched = function (workspaceId) {
      if (workspaceId !== void 0) return original.call(ui, workspaceId);
      const provider = findProjectless(ctx);
      if (provider === void 0) return original.call(ui, workspaceId);
      const existing = openBlankProjectlessSession(ctx);
      if (existing !== void 0) {
        ui.openSession(existing);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      void Promise.resolve().then(() => provider.actions.createProjectlessSession()).then((sessionId) => {
        if (typeof sessionId !== "string") return;
        frontSession(ctx, sessionId);
        reconcileLabel(ctx, sessionId, provider.locale);
      }).catch((reason) => {
        console.warn("dsh-ungrouped-top: projectless session failed:", reason);
      }).finally(() => {
        inFlight = false;
      });
    };
    try {
      ui.startSession = patched;
    } catch (reason) {
      console.warn("dsh-ungrouped-top: cannot override startSession:", reason);
      return;
    }
    return () => {
      if (ui.startSession === patched) ui.startSession = original;
    };
  }, name + ": default new session to projectless");
}
function apply(ctx) {
  installStyles(ctx);
  defaultNewSessionToProjectless(ctx);
}
module.exports = { apply, inject, name };
return module.exports; } });
