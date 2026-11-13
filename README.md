# plaiiin-lamps — PlaiiinLight lamps for the ChatGPT app

A plugin for the [ChatGPT app](https://chatgpt.com/download) on the Mac that lets ChatGPT work
with your [PlaiiinLight](https://plaiiin-light.com) lamps from a conversation: switch and colour
them, write and preview new light effects, draw pictures, save scenes, keep several lamps in step
and check them for firmware updates.

It runs entirely on your computer and talks to the lamps over your own network. You decide, per
lamp, what ChatGPT is allowed to do.

> **Where it works.** In the ChatGPT app's **Codex mode** and in the `codex` command-line tool —
> the conversations that run on your Mac. It does **not** work in Chat mode, on the web or on the
> phone: those run in OpenAI's cloud, which cannot reach the lamps in your home.

## Requirements

- **macOS.** Linux and Windows are untested and not released.
- The ChatGPT app, or the `codex` command-line tool.
- A PlaiiinLight lamp with firmware 2.8 or newer, on the same network as your computer.
- Node.js 20 or newer — only if the ChatGPT app is not installed in `/Applications`. The plugin
  uses the Node.js that ships inside the app when it finds it.

## Install

```sh
codex plugin marketplace add nebeleben/plaiiin-light-chatgpt
codex plugin add plaiiin-lamps@plaiiin-lamps
```

Restart the ChatGPT app, open a conversation in **Codex mode**, type `@` and pick
**PlaiiinLight lamps** — or just say "find my lamps".

No `codex` command on your Mac? The ChatGPT app carries one. Use
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` in place of `codex` in the
commands on this page.

You can also do the second step in the app: after adding the marketplace and restarting, open the
Plugins Directory, choose the **PlaiiinLight** marketplace and install the plugin there.

## Update

```sh
codex plugin marketplace upgrade plaiiin-lamps
codex plugin add plaiiin-lamps@plaiiin-lamps
```

Then restart the ChatGPT app. If it still shows the old version, remove the plugin and add it again
(`codex plugin remove plaiiin-lamps@plaiiin-lamps`, then the `add` line above); your lamps and keys
are kept.

## Giving ChatGPT access to a lamp

A lamp that nobody has paired yet is found on the network and can be used right away, with full
access.

For a lamp you have paired in the PlaiiinLight app, you create a key for ChatGPT:

1. In the app: **Share** → **New Share** → pick the lamp.
2. **Access: AI**.
3. Choose what ChatGPT may do. Each of these is a separate switch: control (power, colour,
   brightness, modes), scripts, drawings, scenes, live streaming, firmware update, rename, and
   reading the swarm.
4. Optionally limit the brightness, and allow ChatGPT to act only while the lamp is switched on.
5. Create. The app shows a link and a QR code.

Copy the link and tell ChatGPT to add the lamp; it reads the link from the clipboard, so the key
does not pass through the chat. A saved screenshot of the QR code works too.

The lamp itself enforces these permissions. You can change them, or revoke the key, in the app's
Share tab at any time. An AI key cannot be used by the apps.

**Keys are not shared between assistants.** If you also use the PlaiiinLight plugin for another
assistant, a key you gave to that one is not available here, and the other way round. Create a
separate AI share for ChatGPT.

## What it does and what it talks to

- **Lamps and access** — find lamps, list them with their state, add a shared lamp, forget one.
- **Control** — power, colour, brightness, mode, play, next, previous, stop.
- **Effects** — write an effect script, preview it locally as a strip of frames, check and compile
  it on the lamp, upload it, tune it, copy it to other lamps, keep a local library.
- **Images** — draw pixel art or send a PNG, save, show, label, copy, delete.
- **Scenes** — capture what a lamp shows, edit, activate, copy between lamps.
- **Streaming** — GIFs, PNG frames or a script, live to the lamp.
- **Firmware** — compare lamps with the newest release and install it, one lamp at a time, with a
  checksum check.

It comes with five skills: compose-effect, draw-image, scenes, fleet-ota and lamp-access.

The plugin's server talks to exactly two things:

- your lamps, over plain HTTP and WebSocket on your local network;
- GitHub, to read and download the firmware releases of `nebeleben/plaiiin-light`, and only when
  you ask about or install firmware.

There is no hosted service, no account and no telemetry. Your conversation with ChatGPT itself
goes to OpenAI as it always does; that includes what the tools report back, such as lamp names,
states and preview pictures. Lamp keys are not part of that, unless you paste a share link into
the chat yourself.

## Where things are stored

- Keys: the macOS Keychain, service `plaiiin-lamp-mcp-chatgpt`, one entry per lamp.
- `~/.plaiiin/lamps-chatgpt/fleet.json` — the lamps this plugin knows. No secrets.
- `~/.plaiiin/lamps-chatgpt/library/` — effects, images and scenes you saved to the local library.

## Safety

- **Two steps for anything destructive.** Deleting, overwriting, renaming, forgetting a lamp and
  firmware updates first return a summary; ChatGPT shows it to you and acts only after you agree.
  Ordinary control — a colour, an effect — happens when you ask for it. Whether the ChatGPT app
  additionally asks before a tool runs is your own setting in the app; the plugin does not change
  it.
- **An AI key only allows what you granted**, and the lamp firmware enforces it, not just the
  plugin.
- **Effect preview sandbox.** `effect_preview` runs untrusted scripts in a separate Node process
  under the Node permission model (`--permission`, reading only its own worker file), with a heap
  cap and a timeout; the script itself runs in a `vm` context holding only the shade runtime (no
  `require`, `process` or `fetch`). The permission model blocks file-system access, child processes
  and worker threads, but it does **not** restrict network access: a script that escaped the `vm`
  context could still open sockets. Treat previews of scripts from strangers accordingly.
- **Share links are `http://` only.** Lamps serve plain http on the LAN, so an `https://` share link
  is refused ("lamps use http — use the http:// link") rather than guessed at port 443 or 80.
- **Moved lamps.** When a lamp is found at a new address (mDNS re-resolve or `lamps_discover`), the
  new host must report the same `deviceId` on the open `GET /api` before the stored key is sent to it.
- **Keys.** The key is passed to `security -i` on stdin, never on its command line.

## Uninstall

```sh
codex plugin remove plaiiin-lamps@plaiiin-lamps
codex plugin marketplace remove plaiiin-lamps
rm -rf ~/.plaiiin/lamps-chatgpt                                   # optional: lamp list and library
security delete-generic-password -s plaiiin-lamp-mcp-chatgpt      # optional: repeat until none are left
```

Revoke the AI keys themselves in the app's Share tab.

## How releases are built

What the ChatGPT app runs is a single bundled file, `plugin-chatgpt/dist/index.js`, started by the
small script `plugin-chatgpt/bin/launch`. Nobody reads a bundle, so this repository is arranged to
let you check it against the source instead:

- **`main`** (this branch) has one commit per release. Each holds that release's source code *and*
  what was built from it: the bundle, the plugin's copy of the skills, and
  `plugin-chatgpt/THIRD-PARTY-NOTICES.txt` for the packages inside the bundle.
- **`source`** has the full commit history of the code, without built files.
- The **`ci`** workflow runs on every release commit. It rebuilds everything from the source in
  the same commit and fails if the result is not byte-for-byte what was published. Its results are
  public in the Actions tab, and the GitHub Release for a version is only created when the same
  comparison passes.

You can repeat that comparison on your own machine from a checkout of `main`:

```sh
npm ci && npm run build && git diff --exit-code -- plugin-chatgpt
```

No output means the published plugin is exactly what this source builds.

The same server is also published as a Claude Code plugin from its own repository,
[plaiiin-light-claudecode](https://github.com/nebeleben/plaiiin-light-claudecode); the two share
their version numbers, so a number may be skipped here when only the other one was released.

More on building and testing in [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Apache-2.0, see [LICENSE](LICENSE).
