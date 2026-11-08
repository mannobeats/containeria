# 4. Take the Docker context back on start, offer it otherwise

Date: 2026-10-29. Status: accepted.

## Context

With "Set Docker context" on, Colima's `autoActivate` makes `colima-containeria` the Docker CLI's
current context when Containeria's engine starts, and nothing reads it again. Any other engine that
starts later (Homebrew Colima, Docker Desktop, OrbStack, Rancher Desktop) can write its own
`currentContext` into `~/.docker/config.json`. In October 2026 a Homebrew `colima start` did that,
and for 40 hours every `docker` command on the owner's Mac went to a second VM. Containeria showed
nothing. The owner never wants to be left on another engine without knowing.

Two ways to fix it: switch the context back whenever Containeria notices, or show what happened and
offer to switch.

## Decision

- Containeria takes the context back by itself only when it starts its own engine: from the app, at
  login, or on a restart. It does that after `colima start` returns, as well as through
  `autoActivate`, because Colima can only set the context when it finds a `docker` binary.
- Otherwise it never switches by itself. On every engine status refresh (every 15 s while a window
  shows it, after every engine event, and whenever a Containeria window gains focus) it reads
  `currentContext`, honouring `DOCKER_CONFIG`. If that isn't Containeria's context, the sidebar
  under the engine card and the menu bar popover say which context `docker` uses, its endpoint, and
  whether anything answers there. They offer one action, "Use Containeria".
- "Use Containeria" does what `docker context use colima-containeria` does: it rewrites only
  `currentContext`, keeps every other key and the file's permissions, and writes a new file that it
  renames over the old one.
- The context name comes from the profile, `colima-<profile>`, as Colima names it. Nothing shows
  until that context exists, because there is nothing to switch back to before the first start.

## Consequences

- Another engine started on purpose keeps the context until the user picks Containeria or
  Containeria's engine starts again. Containeria never changes the context under a running
  `docker compose up` that someone started against the other engine.
- The banner shows only while Containeria is open. A Containeria that has quit can't notice
  anything, and a check every few seconds in the background would read a file nobody is waiting on.
  The next time a Containeria window gains focus, or the engine starts, it catches up.
- `DOCKER_CONTEXT` and `DOCKER_HOST` set in a shell override `currentContext` for that shell only.
  Containeria can't see a shell's environment, so it judges by the file. `DOCKER_HOST` in the app's
  own environment is honoured as the `default` context's endpoint.
- Turning "Set Docker context" off stops both the switch on start and the banner.
