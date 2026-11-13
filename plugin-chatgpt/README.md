# plaiiin-lamps — PlaiiinLight lamps for the ChatGPT app

Control, compose for and manage PlaiiinLight lamps on your local network from the ChatGPT app on
the Mac (Codex mode) or the `codex` command-line tool.

```sh
codex plugin marketplace add nebeleben/plaiiin-light-chatgpt
codex plugin add plaiiin-lamps@plaiiin-lamps
```

Everything else — requirements, giving ChatGPT access to a lamp, what the plugin talks to, where
it stores things, how to uninstall — is in the
[repository README](https://github.com/nebeleben/plaiiin-light-chatgpt#readme).

This folder is the plugin as it is installed: `.codex-plugin/plugin.json` (the manifest),
`.mcp.json` (starts `bin/launch`), `bin/launch` (finds Node.js and runs `dist/index.js` under this
plugin's own profile), `skills/`, `assets/`, and the built `dist/`.
