//! The guest's resolver: the few names it answers itself. Every other question goes to the Mac's
//! resolver untouched, so only as much of a query is read here as it takes to see its name.

use std::net::{IpAddr, Ipv4Addr};

const HEADER: usize = 12;
const A: u16 = 1;
const INTERNET: u16 = 1;
const SERVER_FAILED: u8 = 2;
/// The answer never changes while the guest runs; a minute keeps a restarted one honest.
const SECONDS_TO_LIVE: u32 = 60;

/// The one question of a standard query: its name in lower case, its type, its class, and where
/// it ends in the packet.
fn question(query: &[u8]) -> Option<(String, u16, u16, usize)> {
    let flags = *query.get(2)?;
    let asks_one = query.get(4..6)? == [0, 1];
    // An answer, or anything but a standard query, is not for this resolver to read.
    if flags & 0xF8 != 0 || !asks_one {
        return None;
    }
    let mut name = String::new();
    let mut at = HEADER;
    loop {
        let length = usize::from(*query.get(at)?);
        at += 1;
        if length == 0 {
            break;
        }
        // Names in a question are written out; a pointer here is not a question worth answering.
        if length & 0xC0 != 0 {
            return None;
        }
        let label = std::str::from_utf8(query.get(at..at + length)?).ok()?;
        if !name.is_empty() {
            name.push('.');
        }
        name.push_str(&label.to_ascii_lowercase());
        at += length;
    }
    let kind = u16::from_be_bytes(query.get(at..at + 2)?.try_into().ok()?);
    let class = u16::from_be_bytes(query.get(at + 2..at + 4)?.try_into().ok()?);
    Some((name, kind, class, at + 4))
}

/// The start of an answer to `query`: its header and its question, with `answers` records to
/// follow and `outcome` as the result.
fn reply(query: &[u8], question_end: usize, answers: u16, outcome: u8) -> Vec<u8> {
    let mut reply = Vec::with_capacity(question_end + 16);
    reply.extend_from_slice(&query[..2]);
    // An answer, authoritative, repeating whether recursion was asked for; recursion is on offer.
    reply.extend_from_slice(&[0x84 | (query[2] & 0x01), 0x80 | outcome, 0, 1]);
    reply.extend_from_slice(&answers.to_be_bytes());
    reply.extend_from_slice(&[0, 0, 0, 0]);
    reply.extend_from_slice(&query[HEADER..question_end]);
    reply
}

/// The answer to `query` when it asks for one of `names`: `address` for a question about IPv4
/// addresses, nothing for any other, since the name has no other records. `None` when the
/// question is for someone else.
#[must_use]
pub fn answer(query: &[u8], names: &[&str], address: Ipv4Addr) -> Option<Vec<u8>> {
    let (name, kind, class, end) = question(query)?;
    if class != INTERNET || !names.contains(&name.as_str()) {
        return None;
    }
    if kind != A {
        return Some(reply(query, end, 0, 0));
    }
    let mut reply = reply(query, end, 1, 0);
    // The name, as a pointer back to the question's.
    reply.extend_from_slice(&[0xC0, 0x0C]);
    reply.extend_from_slice(&A.to_be_bytes());
    reply.extend_from_slice(&INTERNET.to_be_bytes());
    reply.extend_from_slice(&SECONDS_TO_LIVE.to_be_bytes());
    reply.extend_from_slice(&[0, 4]);
    reply.extend_from_slice(&address.octets());
    Some(reply)
}

/// The answer that says no resolver could be asked, so whoever asked fails now instead of
/// waiting. `None` for a packet that is no query.
#[must_use]
pub fn failure(query: &[u8]) -> Option<Vec<u8>> {
    let (.., end) = question(query)?;
    Some(reply(query, end, 0, SERVER_FAILED))
}

/// The resolvers named in a `resolv.conf`.
#[must_use]
pub fn resolvers(resolv_conf: &str) -> Vec<IpAddr> {
    resolv_conf
        .lines()
        .filter_map(|line| line.strip_prefix("nameserver"))
        .filter_map(|address| address.trim().parse().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAC: Ipv4Addr = Ipv4Addr::new(198, 18, 0, 1);
    const NAMES: [&str; 1] = ["host.docker.internal"];

    /// A query as a resolver library sends it: one question, recursion asked for.
    fn query(name: &str, kind: u16) -> Vec<u8> {
        let mut query = vec![0xAB, 0xCD, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
        for label in name.split('.') {
            query.push(u8::try_from(label.len()).unwrap());
            query.extend_from_slice(label.as_bytes());
        }
        query.push(0);
        query.extend_from_slice(&kind.to_be_bytes());
        query.extend_from_slice(&INTERNET.to_be_bytes());
        query
    }

    #[test]
    fn answers_its_name_with_the_macs_address() {
        let asked = query("host.docker.internal", A);
        let answer = answer(&asked, &NAMES, MAC).unwrap();
        assert_eq!(answer[..2], [0xAB, 0xCD], "the query's id");
        assert_eq!(answer[2..4], [0x85, 0x80], "an answer, with no error");
        assert_eq!(answer[4..8], [0, 1, 0, 1], "one question, one answer");
        assert_eq!(answer[HEADER..asked.len()], asked[HEADER..], "the question, repeated");
        assert_eq!(answer[answer.len() - 4..], [198, 18, 0, 1]);
    }

    #[test]
    fn names_match_whatever_their_case() {
        assert!(answer(&query("Host.Docker.INTERNAL", A), &NAMES, MAC).is_some());
    }

    #[test]
    fn has_no_ipv6_address_but_the_name_exists() {
        let answer = answer(&query("host.docker.internal", 28), &NAMES, MAC).unwrap();
        assert_eq!(answer[3] & 0x0F, 0, "no error");
        assert_eq!(answer[6..8], [0, 0], "no answers");
    }

    #[test]
    fn other_names_are_for_the_macs_resolver() {
        assert_eq!(answer(&query("example.com", A), &NAMES, MAC), None);
        assert_eq!(answer(&query("docker.internal", A), &NAMES, MAC), None);
    }

    #[test]
    fn what_is_no_query_is_left_alone() {
        assert_eq!(answer(&[], &NAMES, MAC), None);
        assert_eq!(answer(&[0; 12], &NAMES, MAC), None);
        let mut answered = query("host.docker.internal", A);
        answered[2] |= 0x80;
        assert_eq!(answer(&answered, &NAMES, MAC), None);
        let mut cut = query("host.docker.internal", A);
        cut.truncate(20);
        assert_eq!(answer(&cut, &NAMES, MAC), None);
    }

    #[test]
    fn a_failure_repeats_the_question_and_says_the_server_failed() {
        let asked = query("example.com", A);
        let failed = failure(&asked).unwrap();
        assert_eq!(failed[3] & 0x0F, SERVER_FAILED);
        assert_eq!(failed.len(), asked.len());
        assert_eq!(failure(&[1, 2, 3]), None);
    }

    #[test]
    fn reads_the_resolvers_the_network_gave() {
        let given = "# from the Mac\nnameserver 192.168.64.1\nnameserver fe80::1\nsearch lan\n";
        let resolvers = resolvers(given);
        assert_eq!(resolvers.len(), 2);
        assert_eq!(resolvers[0].to_string(), "192.168.64.1");
        assert!(super::resolvers("").is_empty());
    }
}
