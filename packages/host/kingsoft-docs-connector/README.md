# `@deepseek-ai/dsh-host-kingsoft-docs-connector`

English | [中文](README.zh.md)

Web Host integration for the official Kingsoft Docs [`kdocs-cli`](https://github.com/kdocs-app/kdocs-skill). The `kingsoftDocsConnector` Remote turns an explicit loopback-page gesture into `kdocs-cli auth login`, which opens the user's default browser. The CLI stores authentication in the operating-system keychain; the browser, Remote payloads, Harness credential store, model, and session log never receive the saved value.

The package owns both parts that must evolve with this provider: the process-wide browser-login and subprocess lifecycle at the package root, and the optional preset-scoped tool Consumer at `./tool`. The standard, code, and Cordis presets mount the Consumer. It registers tools only while the gateway reports `connected`; the minimal preset receives none.

Install the official CLI before connecting by following the [Kingsoft Docs installation and authentication guide](https://github.com/kdocs-app/kdocs-skill/blob/master/references/auth.md). `command` defaults to `kdocs-cli` and may be an absolute executable path in an overlay. This connector supports the personal-account CLI; enterprise WPS accounts require the WPS 365 integration named by the provider documentation.

## Remote API

| Method | Input | Result |
|---|---|---|
| `get` | none | Current login lifecycle state for a loopback page. |
| `publicGet` | none | The same credential-free state for a trusted non-loopback page. |
| `connect` | none | Reuse a valid keychain login or open browser authorization and verify the result. |
| `disconnect` | none | Remove the saved login through `kdocs-cli auth logout` after active calls settle. |

`get`, `connect`, and `disconnect` are loopback-pinned. `publicGet` and `kingsoft-docs-connector/change` expose only status, tool count, a stable safe failure, and an update timestamp. Failure codes are `CLI_NOT_FOUND`, `CLI_INCOMPATIBLE`, `LOGIN_FAILED`, `LOGIN_TIMEOUT`, `AUTH_REJECTED`, and `DISCONNECT_FAILED`.

Every child process runs through `ctx.subprocess` with an explicit executable, argument vector, working directory, environment, stream cap, deadline, and process-tree termination grace. Action parameters travel as one JSON object over stdin. No shell parses service names, action names, or user data. The legacy `KINGSOFT_DOCS_TOKEN` ambient variable is removed from every child environment so it cannot bypass browser/keychain authentication.

## Model Experience

### Connected Kingsoft Docs tools

#### What the model sees

The scoped Consumer exposes two stable tools instead of copying the CLI's changing action catalog into the model request: `kingsoft_docs_help` reads current CLI help without performing a document API operation, while `kingsoft_docs_call` executes one supported service/action with JSON parameters after a one-shot local approval. The accepted services are `drive`, `sheet`, `otl`, `dbsheet`, `form`, `wpp`, `aippt`, `wps`, `pdf`, and `kwiki`. Action names must be kebab-case and should come from `kingsoft_docs_help` rather than model memory. The model is told to confirm irreversible delete/close actions explicitly and to verify writes with a separate read.

#### Token effect

The two fixed schemas consume a stable request prefix. CLI help and action results enter context only when the corresponding tool is called.

#### KV Cache effect

Login and logout add or remove the same two tool schemas from the next request for affected presets. Connector state itself is not model-visible.

## Known Limitations and Deferred Work

- `kdocs-cli` is an external prerequisite and is not downloaded or upgraded by the Harness process.
- Login intent is not persisted. A Host restart begins disconnected even when a valid keychain entry exists; clicking Web login reuses and verifies it without opening another page.
- One process-wide login is shared by all connected sessions. Account selection and simultaneous personal accounts are not implemented.
- Tool schemas intentionally describe the stable generic bridge, not every provider action. The installed CLI's help output is authoritative for current action parameters.
