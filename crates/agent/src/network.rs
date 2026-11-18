//! The guest's route to the outside, read from `/proc/net/route`.

use std::net::Ipv4Addr;

/// The gateway of the default route, the one whose destination is all zeros.
#[must_use]
pub fn default_gateway(routes: &str) -> Option<Ipv4Addr> {
    routes.lines().skip(1).find_map(|line| {
        let mut columns = line.split_whitespace().skip(1);
        let (destination, gateway) = (columns.next()?, columns.next()?);
        // The kernel prints addresses as hex in the machine's byte order: little-endian here.
        let address = u32::from_str_radix(gateway, 16).ok()?;
        (destination == "00000000" && address != 0).then(|| Ipv4Addr::from(address.swap_bytes()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROUTES: &str = "\
Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t0140A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0
docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0
eth0\t0040A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0
";

    #[test]
    fn reads_the_default_routes_gateway() {
        assert_eq!(default_gateway(ROUTES), Some(Ipv4Addr::new(192, 168, 64, 1)));
    }

    #[test]
    fn a_guest_with_no_way_out_has_no_gateway() {
        let local = "Iface\tDestination\tGateway\neth0\t0040A8C0\t00000000\t0001\n";
        assert_eq!(default_gateway(local), None);
        assert_eq!(default_gateway(""), None);
    }
}
