// Host face of dsh-ungrouped-top.
//
// All behaviour lives in the Client face (./client.js): it injects one
// stylesheet and wraps one method on the `uiWorkspace` Client service. The Host
// entry exists so the package is a well-formed DSH bundle, and additionally
// accepts a self-check report from the Client face.
//
// The report exists because a Client plugin's failure is otherwise invisible
// from the Host: a stale page, a provider that never registered, or a wrapper
// that got replaced all look identical from here ("plugin is active"), while
// the user just sees the feature do nothing. The Client face posts its own
// state to this endpoint and the Host drops it on disk.
import { appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

var name = "dsh-ungrouped-top";
var inject = ["connection"];
var DIAGNOSTICS_ENDPOINT = "ungrouped-top/diagnostics";

function badRequest(message) {
  return new Response(message, { status: 400 });
}

function apply(ctx, config = {}) {
  if (config.diagnostics === false) return;
  const target = typeof config.diagnosticsFile === "string" && config.diagnosticsFile !== ""
    ? config.diagnosticsFile
    : join(tmpdir(), "dsh-ungrouped-top-diagnostics.json");
  ctx.effect(() => ctx.connection.fetch.register({
    path: "/api/" + DIAGNOSTICS_ENDPOINT,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return new Response("content type must be application/json", { status: 415 });
      }
      let message;
      try {
        message = await request.json();
      } catch (reason) {
        return badRequest("body is not JSON");
      }
      if (typeof message !== "object" || message === null || message.type !== "client-request" || typeof message.rpcId !== "string") {
        return badRequest("invalid client-request envelope");
      }
      try {
        await appendFile(target, JSON.stringify({ receivedAt: new Date().toISOString(), payload: message.payload }) + "\n", "utf8");
      } catch (reason) {
        ctx.logger?.warn?.(`dsh-ungrouped-top: cannot write diagnostics file: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
      return Response.json({
        type: "server-response",
        rpcId: message.rpcId,
        result: { ok: true, value: { file: target } }
      });
    }
  }), name + ": diagnostics endpoint");
}
export { apply, inject, name };
