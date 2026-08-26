# Setup

Getting this board running on your machine. Two commands, then a URL.

> **Read this rather than upstream's quickstart.** Upstream's instructions pull a prebuilt Docker image
> (`sirsjg/flux-mcp`). That image is *their* build and does **not** contain this fork's custom columns.
> Everything here builds from the source in this repo, so you get what's actually in it.

---

## What you need first

**Docker.** That's genuinely it — everything else runs inside the container.
If you don't have it: <https://www.docker.com/get-started>

Bun and Node are only needed if you want to run the code outside Docker for development.

## Start it

```bash
git clone https://github.com/YOUR-GITHUB-USERNAME/flux.git
cd flux
./scripts/setup.sh
```

The first run takes a couple of minutes because it builds the image. After that it's seconds.

When it finishes it prints the URL — **http://localhost:3001** by default. Open it and you have a board.

### What that script actually did

Worth knowing, because Docker is easy to get wrong:

- **Built an image from this checkout**, tagged `flux-local:<commit>`. Not upstream's image.
- **Made a container** called `flux-local-web` and a data volume called `flux-local-data`.
- **Picked a free port**, starting at 3001 and counting up if something's already there.

It will **refuse** to touch anything called `flux-web` or `flux-data`, and refuses port 5173. Those names
belong to other Flux instances, and losing a board's contents because a setup script was too eager is not
a thing that should be possible.

Running `setup.sh` again is safe. It replaces the container and **keeps your data**.

## Check it's really this version

```bash
curl localhost:3001/version
```

That returns the git commit it was built from. If it matches this repo's `git rev-parse HEAD`, you're
running your own build. If it returns something else, you're looking at a different container — probably
upstream's image on another port.

This matters more than it sounds. A board that loads looks identical whichever build is behind it; the
version sha is the only thing that actually tells you.

## Stop it

```bash
./scripts/teardown.sh
```

Removes the container, **keeps your tasks**. To erase the board's contents as well:

```bash
./scripts/teardown.sh --remove-data
```

It will only remove things it created itself, and refuses `flux-web` / `flux-data` outright.

---

## Changing the defaults

Set these before running the script:

| Variable | Does what |
|---|---|
| `FLUX_SETUP_PORT` | Use a specific port instead of hunting from 3001 |
| `FLUX_SETUP_CONTAINER_NAME` | Name the container something else |
| `FLUX_SETUP_VOLUME_NAME` | Keep the board's data in a different volume |

For example, to run a second board alongside the first:

```bash
FLUX_SETUP_PORT=3005 \
FLUX_SETUP_CONTAINER_NAME=flux-experiment \
FLUX_SETUP_VOLUME_NAME=flux-experiment-data \
./scripts/setup.sh
```

See `.env.example` for every environment variable the app itself reads.

## Docker Compose instead

If you'd rather use Compose:

```bash
docker compose up -d --build
```

Same result, and also on port 3001 by default. Copy `.env.example` to `.env` to change the port, container
name or volume — Compose reads that file; the shell script reads the same settings from the environment.

---

## Connecting your AI agents

Flux's real point is that agents write to the board too. Point them at the container you just started —
note this is `flux-local-web`, not upstream's `flux-web`:

```bash
# Claude Code
claude mcp add flux -- docker exec -i \
  -e FLUX_DIR=/app/packages/data/.flux \
  -e FLUX_DATA=/app/packages/data/flux.sqlite \
  flux-local-web bun packages/mcp/dist/index.js

# Codex
codex mcp add flux -- docker exec -i \
  -e FLUX_DIR=/app/packages/data/.flux \
  -e FLUX_DATA=/app/packages/data/flux.sqlite \
  flux-local-web bun packages/mcp/dist/index.js
```

Both environment variables are required. Leave `FLUX_DIR` out and the server dies on startup with
`EACCES: permission denied, mkdir '/home/flux'` — an easy hour to lose.

To check an agent can see your columns, ask it to run the `list_columns` tool. It should come back with
your board's columns and what each one means.

---

## Developing on it

```bash
bun install
bun run typecheck     # builds every package; must exit 0
bun test
bun run dev           # web dev server
bun run dev:server    # API
```

**Known:** five tests in `packages/server/tests/auth.test.ts` fail. They fail on a clean upstream checkout
too — a dev-mode auth environment leak, nothing to do with this fork. Everything else should pass.

---

## When something's wrong

**The board loads but the columns look like upstream's four and there's no "Manage columns" button.**
You're on upstream's image. Check `curl localhost:PORT/version` against `git rev-parse HEAD`.

**`EACCES: permission denied, mkdir '/home/flux'` in the container logs.**
`FLUX_DIR` isn't set. `setup.sh` sets it; a hand-rolled `docker run` probably didn't.

**Port already in use.**
`setup.sh` hunts for a free one. If you pinned `FLUX_SETUP_PORT`, pick another.

**Where did my tasks go?**
In the Docker volume, not in this repo. `docker volume ls | grep flux`. `teardown.sh` keeps it unless you
pass `--remove-data`.

---

## Keeping up with upstream

Upstream is the source of truth and still being developed. To pull their changes in:

```bash
git remote add upstream https://github.com/sirsjg/flux.git   # once
git fetch upstream
git merge upstream/main
```

[CHANGES-FROM-UPSTREAM.md](CHANGES-FROM-UPSTREAM.md) lists exactly what this fork changed and which files
it touched, which is what you'll want open if a merge conflicts.
