//! Any UDP packet a local process sends the DNS server: it must never panic, and every reply it
//! sends must be a well-formed DNS response to the same query id.

#![no_main]

use hickory_proto::op::{Message, MessageType};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|packet: &[u8]| {
    let Some(reply) = containeria_net::fuzzing::dns_answer(packet) else { return };
    let reply = Message::from_vec(&reply).expect("the reply parses");
    let query = Message::from_vec(packet).expect("only a parsed query gets a reply");
    assert_eq!(reply.metadata.message_type, MessageType::Response);
    assert_eq!(reply.metadata.id, query.metadata.id);
});
