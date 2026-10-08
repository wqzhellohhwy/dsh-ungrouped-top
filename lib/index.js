// Host face of dsh-ungrouped-top.
//
// The plugin is presentation-only: nothing is registered on the Host at all.
// Everything happens in the Client face (./client.js), which injects one
// stylesheet and wraps one method on the `uiWorkspace` Client service. The
// Host entry exists so the package is a well-formed DSH bundle.
var name = "dsh-ungrouped-top";
var inject = [];
function apply() {}
export { apply, inject, name };
