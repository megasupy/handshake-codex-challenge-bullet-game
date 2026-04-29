# Balance Notes

## Pass 1
- `1x` run felt calm through the first half, then turned into a late pickup and bullet pileup.
- Boss was much too short relative to the rest of the run.
- Late state had too many bullets and pickups on screen for comfortable dodging.
- Follow-up changes: lower pickup/bullet pressure and keep the boss dense but readable.

## Pass 2
- Better curve overall.
- Boss duration landed closer to target, but late-game clutter still built up.
- Screen pressure was more manageable than pass 1, but pickup count was still too high.
- Follow-up changes: lower pickup drops and active pickup cap, then retest.

## Pass 3
- Enemy palette still needed separation from projectiles and pickups; fixed by moving enemies into blue/violet/amber/cyan.
- Player had no obvious dash readiness cue; added a live outer ring that changes color and opacity with cooldown state.
- Next check: verify the ring remains readable in motion and that enemy color contrast stays clear in capture.

## Pass 4
- Spawn pacing is now much more conservative through threat 5 and beyond.
- One 1x run reached threat 15 and ended by player death at 112.1s.
- Peak pressure stayed bounded: p95 enemy bullets 125 and p95 pickups 45, with no runaway spike in the sampled timeline.
- Current read: the new spawn curve looks materially calmer than the previous fast-spawn version, but the late game still needs more samples before making another large change.

## Pass 5
- Dash readiness cue should stay inside the player silhouette, not as an outer box.
- Updated cue to a small internal chip so it reads as cooldown state instead of a second hitbox.
- Keep this visual language for future ability indicators: inside the character, not around it.

## Pass 6
- Boss pacing should not fall off after the first fight.
- Added a fixed second boss checkpoint at 120s so the run has another major spike instead of tapering out.
- Boss health was scaled up to more than 2.5x the previous baseline so the fight lasts long enough to matter.
