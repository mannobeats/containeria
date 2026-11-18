//! The guest's memory, read from `/proc`.

const PAGE: u64 = 4096;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Memory {
    pub total: u64,
    pub available: u64,
    pub ballooned: u64,
    pub pressure: f32,
}

impl Memory {
    /// Reads `/proc/meminfo`, `/proc/vmstat` and `/proc/pressure/memory`. A figure that is missing
    /// reads as zero.
    #[must_use]
    pub fn parse(meminfo: &str, vmstat: &str, pressure: &str) -> Self {
        let kib = |name| field(meminfo, name).saturating_mul(1024);
        let pages = |name| field(vmstat, name);
        Self {
            total: kib("MemTotal:"),
            available: kib("MemAvailable:"),
            ballooned: pages("balloon_inflate")
                .saturating_sub(pages("balloon_deflate"))
                .saturating_mul(PAGE),
            pressure: some_avg10(pressure),
        }
    }
}

fn field(text: &str, name: &str) -> u64 {
    text.lines()
        .find_map(|line| {
            let mut words = line.split_whitespace();
            (words.next() == Some(name)).then(|| words.next()?.parse().ok()).flatten()
        })
        .unwrap_or(0)
}

/// The `avg10` of the line `some avg10=1.23 avg60=0.40 avg300=0.10 total=4567`.
fn some_avg10(pressure: &str) -> f32 {
    pressure
        .lines()
        .find_map(|line| line.strip_prefix("some "))
        .and_then(|rest| rest.split_whitespace().find_map(|word| word.strip_prefix("avg10=")))
        .and_then(|value| value.parse().ok())
        .unwrap_or(0.0)
}

/// Whether a control group's `cgroup.events` says processes run in it or below it.
#[must_use]
pub fn populated(events: &str) -> bool {
    events.lines().any(|line| line == "populated 1")
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEMINFO: &str = "MemTotal:        8149868 kB\nMemFree:          261352 kB\n\
        MemAvailable:     266992 kB\nBuffers:            1180 kB\nCached:           144592 kB\n";
    const VMSTAT: &str = "nr_free_pages 65338\nballoon_inflate 1900544\nballoon_deflate 4096\n\
        balloon_migrate 0\n";
    const PRESSURE: &str = "some avg10=1.25 avg60=0.40 avg300=0.10 total=4567\n\
        full avg10=0.50 avg60=0.10 avg300=0.00 total=1200\n";

    #[test]
    fn reads_memory_in_bytes() {
        let memory = Memory::parse(MEMINFO, VMSTAT, PRESSURE);
        assert_eq!(memory.total, 8_149_868 * 1024);
        assert_eq!(memory.available, 266_992 * 1024);
    }

    #[test]
    fn the_balloon_holds_what_it_took_less_what_it_gave_back() {
        let memory = Memory::parse(MEMINFO, VMSTAT, PRESSURE);
        assert_eq!(memory.ballooned, (1_900_544 - 4096) * 4096);
    }

    #[test]
    fn pressure_is_the_ten_second_share_of_some_tasks_waiting() {
        let memory = Memory::parse(MEMINFO, VMSTAT, PRESSURE);
        assert!((memory.pressure - 1.25).abs() < f32::EPSILON);
    }

    #[test]
    fn missing_figures_read_as_zero() {
        let memory = Memory::parse("", "", "");
        assert_eq!((memory.total, memory.available, memory.ballooned), (0, 0, 0));
        assert!(memory.pressure.abs() < f32::EPSILON);
    }

    #[test]
    fn a_group_is_populated_only_when_it_says_so() {
        assert!(populated("populated 1\nfrozen 0\n"));
        assert!(!populated("populated 0\nfrozen 0\n"));
        assert!(!populated(""));
    }
}
