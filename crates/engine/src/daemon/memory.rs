//! How much memory the guest may use right now.
//!
//! The VM is given its ceiling at start, but a guest left alone fills all of it with file cache
//! and the Mac never gets it back while the VM runs. So the engine keeps the guest close to what
//! its work holds, and lets it have more the moment it asks.

use contena_proto::Stats;

const MIB: u64 = 1 << 20;
/// Room above what the work holds: for file cache, and for growth between two looks.
const HEADROOM: u64 = 768 * MIB;
const FLOOR: u64 = 1024 * MIB;
/// How much is taken back at once, so the guest's file cache goes gradually.
const SHRINK_STEP: u64 = 256 * MIB;
/// What the guest gets on top when tasks in it wait for memory.
const PRESSURE_STEP: u64 = 1024 * MIB;
/// Share of time, in percent, that tasks waited for memory before the guest gets more.
const PRESSURE: f32 = 1.0;
/// Changes smaller than this aren't worth telling the guest about.
const WORTH_IT: u64 = 64 * MIB;

/// What a guest should be allowed when there is no file cache to spare yet, as right after boot:
/// what its work holds plus headroom.
pub(crate) fn settled(stats: &Stats, ceiling: u64) -> u64 {
    stats.memory_used().saturating_add(HEADROOM).clamp(FLOOR.min(ceiling), ceiling)
}

/// The next allowance, given the guest's memory, what it is allowed now and the most it may ever
/// have. Growing is immediate; shrinking goes a step at a time.
pub(crate) fn allowance(stats: &Stats, allowed: u64, ceiling: u64) -> u64 {
    let mut wanted = settled(stats, ceiling);
    if stats.memory_pressure >= PRESSURE {
        wanted = wanted.max(allowed.saturating_add(PRESSURE_STEP).min(ceiling));
    }
    let next =
        if wanted < allowed { wanted.max(allowed.saturating_sub(SHRINK_STEP)) } else { wanted };
    if next.abs_diff(allowed) < WORTH_IT && next != ceiling { allowed } else { next }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: u64 = 1 << 30;
    const CEILING: u64 = 8 * GIB;

    fn using(used: u64, allowed: u64, pressure: f32) -> Stats {
        Stats {
            memory_total: CEILING,
            memory_available: allowed.saturating_sub(used),
            memory_ballooned: CEILING - allowed,
            memory_pressure: pressure,
            busy: true,
            unix_millis: 0,
        }
    }

    #[test]
    fn a_guest_using_all_it_has_gets_room_on_top_at_once() {
        let next = allowance(&using(2 * GIB, 2 * GIB, 0.0), 2 * GIB, CEILING);
        assert_eq!(next, 2 * GIB + HEADROOM);
    }

    #[test]
    fn an_idle_guest_gives_memory_back_a_step_at_a_time() {
        let next = allowance(&using(GIB / 4, 4 * GIB, 0.0), 4 * GIB, CEILING);
        assert_eq!(next, 4 * GIB - SHRINK_STEP);
    }

    #[test]
    fn the_guest_never_gets_more_than_its_ceiling() {
        let allowed = CEILING - GIB / 2;
        assert_eq!(allowance(&using(allowed, allowed, 50.0), allowed, CEILING), CEILING);
    }

    #[test]
    fn the_guest_keeps_a_floor_to_run_in() {
        let mut allowed = 2 * GIB;
        for _ in 0..20 {
            allowed = allowance(&using(0, allowed, 0.0), allowed, CEILING);
        }
        assert_eq!(allowed, FLOOR);
    }

    #[test]
    fn a_ceiling_below_the_floor_wins() {
        assert_eq!(allowance(&using(0, GIB / 2, 0.0), GIB / 2, GIB / 2), GIB / 2);
    }

    #[test]
    fn tasks_waiting_for_memory_get_more_than_they_hold() {
        let next = allowance(&using(GIB, 2 * GIB, 5.0), 2 * GIB, CEILING);
        assert_eq!(next, 3 * GIB);
    }

    #[test]
    fn a_fresh_guest_is_sized_to_its_work_in_one_step() {
        assert_eq!(settled(&using(GIB / 4, CEILING, 0.0), CEILING), FLOOR);
        assert_eq!(settled(&using(2 * GIB, CEILING, 0.0), CEILING), 2 * GIB + HEADROOM);
    }

    #[test]
    fn a_small_change_is_left_alone() {
        let allowed = GIB + HEADROOM;
        assert_eq!(allowance(&using(GIB + 10 * MIB, allowed, 0.0), allowed, CEILING), allowed);
    }
}
