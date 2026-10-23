use std::net::Ipv4Addr;
use std::sync::{Arc, PoisonError, RwLock};

use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::{RData, Record, RecordType, rdata::A};
use tokio::net::UdpSocket;

use crate::routes::RouteTable;

/// How long resolvers may cache an answer. Short, because routes come and go with containers.
const TTL: u32 = 5;

/// The reply to one DNS query: `127.0.0.1` for names Containeria routes, an empty answer for other
/// record types of those names (so lookups fall back to IPv4 at once), `NXDOMAIN` for the rest.
/// `None` when the packet isn't a query worth answering.
#[must_use]
pub(crate) fn answer(packet: &[u8], resolves: impl Fn(&str) -> bool) -> Option<Vec<u8>> {
    let request = Message::from_vec(packet).ok()?;
    if request.metadata.message_type != MessageType::Query {
        return None;
    }
    let mut response = Message::response(request.metadata.id, request.metadata.op_code);
    response.metadata.recursion_desired = request.metadata.recursion_desired;
    response.metadata.authoritative = true;
    response.add_queries(request.queries.iter().cloned());
    let Some(query) = request.queries.first().filter(|_| request.metadata.op_code == OpCode::Query)
    else {
        response.metadata.response_code = ResponseCode::NotImp;
        return response.to_vec().ok();
    };
    let name = query.name().to_ascii();
    if !resolves(&name) {
        response.metadata.response_code = ResponseCode::NXDomain;
    } else if query.query_type() == RecordType::A {
        response.add_answer(Record::from_rdata(
            query.name().clone(),
            TTL,
            RData::A(A(Ipv4Addr::LOCALHOST)),
        ));
    }
    response.to_vec().ok()
}

/// Answers queries on `socket` until the task is dropped.
pub(crate) async fn serve(socket: UdpSocket, table: Arc<RwLock<RouteTable>>) {
    let mut buffer = [0_u8; 1500];
    loop {
        let Ok((length, peer)) = socket.recv_from(&mut buffer).await else { continue };
        let reply = {
            let table = table.read().unwrap_or_else(PoisonError::into_inner);
            answer(&buffer[..length], |name| table.resolves(name))
        };
        if let Some(reply) = reply {
            let _ = socket.send_to(&reply, peer).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use hickory_proto::op::Query;
    use hickory_proto::rr::Name;

    use super::*;

    fn query(name: &str, kind: RecordType) -> Vec<u8> {
        let mut message = Message::new(7, MessageType::Query, OpCode::Query);
        message.metadata.recursion_desired = true;
        message.add_query(Query::query(Name::from_ascii(name).unwrap(), kind));
        message.to_vec().unwrap()
    }

    fn resolves(name: &str) -> bool {
        name.trim_end_matches('.').ends_with("containeria.local")
    }

    #[tokio::test]
    async fn answers_over_udp_with_localhost() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let address = server.local_addr().unwrap();
        let table =
            Arc::new(RwLock::new(RouteTable::build("containeria.local", &[], &[], &[], true)));
        let task = tokio::spawn(serve(server, table));

        let client = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        client
            .send_to(&query("web.shop.containeria.local.", RecordType::A), address)
            .await
            .unwrap();
        let mut buffer = [0_u8; 512];
        let length = client.recv(&mut buffer).await.unwrap();
        task.abort();

        let reply = Message::from_vec(&buffer[..length]).unwrap();
        assert_eq!(reply.metadata.id, 7);
        assert_eq!(reply.answers[0].data, RData::A(A(Ipv4Addr::LOCALHOST)));
    }

    #[test]
    fn refuses_names_it_does_not_route() {
        let reply =
            Message::from_vec(&answer(&query("example.com.", RecordType::A), resolves).unwrap())
                .unwrap();
        assert_eq!(reply.metadata.response_code, ResponseCode::NXDomain);
        assert!(reply.answers.is_empty());
    }

    #[test]
    fn answers_ipv6_lookups_with_no_records() {
        let reply = Message::from_vec(
            &answer(&query("web.containeria.local.", RecordType::AAAA), resolves).unwrap(),
        )
        .unwrap();
        assert_eq!(reply.metadata.response_code, ResponseCode::NoError);
        assert!(reply.answers.is_empty());
    }

    #[test]
    fn ignores_garbage() {
        assert_eq!(answer(b"not dns", resolves), None);
    }
}
