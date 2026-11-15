/**
 * beat-scheduler — [agent-zai/W1] sovereign heartbeat cadence for the
 * machine-local engine (steem@saos-cockpit → mini-services/saos-engine).
 *
 * This sandbox host has no cron and reaps detached background processes;
 * the ONLY persistent process is the platform-managed Next.js server. The
 * scheduler therefore lives here: a catch-up beat shortly after boot, then
 * a beat every 30 minutes, aligned to the half-hour boundary.
 *
 * The keeper itself (/home/z/audit/beat-keeper.sh) mirrors the cloud
 * workflow contract: run ci-cycle → honest verdicts → state-churn commit
 * ([agent-zai/beat] identity) → FF-only push, no force. Engine-level lease
 * (withLease "ci-selftest") plus the keeper's flock prevent any overlap.
 * The cloud beat (saos-runtime 30-min cron) stays the wipe-proof primary.
 */
import { spawn } from "node:child_process";

/* W2.0: the DEX keeper (git-resident in saos-dex) — redundant pacer by design;
 * the OS flock + the keeper's own standby guard (cloud-first, 10min) arbitrate
 * overlap — honest skip, never a double beat. */
const DEX_KEEPER = "/home/z/audit/saos-dex/deploy/dex-beat-keeper.sh";
/* WIPE-26 LAW (2026-11-15): the SOVEREIGN engine beat (steem@saos-cockpit
 * deploy/beat-keeper.sh, now git-resident — was local-only and died with every
 * wipe) runs the ONLINE content lane: SAOS_ONLINE_CONTENT=1 dials THIS desk's
 * bridge route so fresh LLM drafts feed the queue the cloud publish rail airs.
 * The cloud beat stays the wipe-proof primary (offline corpus floor); this
 * local layer is the only place the live bridge can exist. */
const SOVEREIGN_KEEPER = "/home/z/my-project/fleet/steem/deploy/beat-keeper.sh";
const HALF_HOUR_MS = 30 * 60 * 1000;

let started = false;

export function startBeatScheduler(): void {
  if (started) return;
  started = true;

  const log = (...a: unknown[]) =>
    console.log("[beat-keeper]", new Date().toISOString(), ...a);

  const runKeeper = (keeper: string, label: string) => {
    try {
      const p = spawn("/bin/bash", [keeper], { stdio: "ignore" });
      p.on("exit", (code) => log(label, "finished, exit =", code));
      p.on("error", (e) => log(label, "spawn error:", String(e)));
      return p;
    } catch (e) {
      log(label, "spawn-fail:", String(e));
      return null;
    }
  };
  const runBeat = () => {
    runKeeper(SOVEREIGN_KEEPER, "sovereign-beat");
    runKeeper(DEX_KEEPER, "dex-beat");
  };

  log("scheduler armed — catch-up beat in 15s, then every 30min (sovereign+dex)");

  /* catch-up beat: cover the gap since the last session's beats */
  setTimeout(runBeat, 15_000);

  /* cadence: aligned to :00/:30 so local and cloud beats share the clock */
  const tick = () => {
    runBeat();
    const now = Date.now();
    const next = Math.ceil(now / HALF_HOUR_MS) * HALF_HOUR_MS;
    setTimeout(tick, Math.max(1000, next - now));
  };
  setTimeout(tick, HALF_HOUR_MS);
}
