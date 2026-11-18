//! Calls in both directions over one connection, as lines of JSON.
//!
//! Either side may call the other at any time; answers come back in whatever order they are ready.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The connection closed before an answer came.")]
    Closed,
    /// The other side answered with an error, in its words.
    #[error("{0}")]
    Refused(String),
    #[error("A message could not be read: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Serialize, Deserialize)]
struct Line {
    id: u64,
    body: Body,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Body {
    Call(Value),
    Ok(Value),
    Err(String),
}

type Waiting = HashMap<u64, oneshot::Sender<Result<Value>>>;

/// A line to write, and who to tell once it is written.
type Outgoing = (Line, Option<oneshot::Sender<()>>);

/// Makes calls on the other side. Clones share the connection.
#[derive(Debug, Clone)]
pub struct Caller {
    lines: mpsc::Sender<Outgoing>,
    /// `None` once the connection is gone, so a late call fails instead of waiting forever.
    waiting: Arc<Mutex<Option<Waiting>>>,
    next: Arc<AtomicU64>,
}

impl Caller {
    /// Sends `call` and waits for its answer.
    ///
    /// # Errors
    /// [`Error::Refused`] with the other side's message when it answers with an error,
    /// [`Error::Closed`] when the connection ends first.
    pub async fn call<Q, A>(&self, call: &Q) -> Result<A>
    where
        Q: Serialize + Sync,
        A: DeserializeOwned,
    {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (answer, answered) = oneshot::channel();
        match self.waiting.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
            Some(waiting) => waiting.insert(id, answer),
            None => return Err(Error::Closed),
        };
        let line = Line { id, body: Body::Call(serde_json::to_value(call)?) };
        self.lines.send((line, None)).await.map_err(|_| Error::Closed)?;
        let value = answered.await.map_err(|_| Error::Closed)??;
        Ok(serde_json::from_value(value)?)
    }
}

/// A call from the other side, to be answered once.
#[derive(Debug)]
pub struct Incoming<T> {
    pub call: T,
    id: u64,
    lines: mpsc::Sender<Outgoing>,
}

impl<T> Incoming<T> {
    /// Takes the call apart from the means to answer it, for answering from another task.
    pub fn split(self) -> (T, Answer) {
        (self.call, Answer { id: self.id, lines: self.lines })
    }
}

#[derive(Debug)]
pub struct Answer {
    id: u64,
    lines: mpsc::Sender<Outgoing>,
}

impl Answer {
    /// Answers the call, and returns once the answer is written to the connection: a process
    /// that answers and then exits has still answered. An `Err` reaches the caller as
    /// [`Error::Refused`] with this text.
    pub async fn send<A: Serialize>(self, answer: std::result::Result<A, String>) {
        let body = match answer.map(|value| serde_json::to_value(value)) {
            Ok(Ok(value)) => Body::Ok(value),
            Ok(Err(error)) => Body::Err(error.to_string()),
            Err(message) => Body::Err(message),
        };
        let (written, wrote) = oneshot::channel();
        // Both only fail once the connection is gone, and then nobody waits for the answer.
        if self.lines.send((Line { id: self.id, body }, Some(written))).await.is_ok() {
            let _ = wrote.await;
        }
    }
}

/// Starts speaking over `reader` and `writer`. The returned receiver yields the other side's calls
/// and ends when the connection does. Dropping it hangs up, so keep it for as long as you call.
pub fn open<R, W, Theirs>(reader: R, writer: W) -> (Caller, mpsc::Receiver<Incoming<Theirs>>)
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
    Theirs: DeserializeOwned + Send + 'static,
{
    let (lines, outgoing) = mpsc::channel(64);
    let (calls, incoming) = mpsc::channel(64);
    let waiting = Arc::new(Mutex::new(Some(Waiting::new())));
    tokio::spawn(write(writer, outgoing));
    tokio::spawn(read(reader, lines.clone(), calls, Arc::clone(&waiting)));
    (Caller { lines, waiting, next: Arc::new(AtomicU64::new(1)) }, incoming)
}

async fn write<W: AsyncWrite + Unpin>(mut writer: W, mut outgoing: mpsc::Receiver<Outgoing>) {
    while let Some((line, written)) = outgoing.recv().await {
        let Ok(mut text) = serde_json::to_vec(&line) else { continue };
        text.push(b'\n');
        if writer.write_all(&text).await.is_err() || writer.flush().await.is_err() {
            return;
        }
        if let Some(written) = written {
            let _ = written.send(());
        }
    }
}

async fn read<R, Theirs>(
    reader: R,
    lines: mpsc::Sender<Outgoing>,
    calls: mpsc::Sender<Incoming<Theirs>>,
    waiting: Arc<Mutex<Option<Waiting>>>,
) where
    R: AsyncRead + Unpin,
    Theirs: DeserializeOwned,
{
    let mut text = BufReader::new(reader).lines();
    loop {
        let line = tokio::select! {
            line = text.next_line() => line,
            () = calls.closed() => break,
        };
        let Ok(Some(line)) = line else { break };
        let Ok(Line { id, body }) = serde_json::from_str(&line) else { continue };
        match body {
            Body::Call(value) => match serde_json::from_value(value) {
                Ok(call) => {
                    if calls.send(Incoming { call, id, lines: lines.clone() }).await.is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let body = Body::Err(format!("The call was not understood: {error}"));
                    let _ = lines.send((Line { id, body }, None)).await;
                }
            },
            Body::Ok(value) => answer(&waiting, id, Ok(value)),
            Body::Err(message) => answer(&waiting, id, Err(Error::Refused(message))),
        }
    }
    // Dropping the senders fails every call still waiting with `Closed`.
    waiting.lock().unwrap_or_else(PoisonError::into_inner).take();
}

fn answer(waiting: &Mutex<Option<Waiting>>, id: u64, result: Result<Value>) {
    let sender = waiting
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
        .and_then(|waiting| waiting.remove(&id));
    if let Some(sender) = sender {
        let _ = sender.send(result);
    }
}

#[cfg(test)]
mod tests {
    use tokio::io::{duplex, split};

    use super::*;

    type Calls = mpsc::Receiver<Incoming<String>>;

    fn pair() -> ((Caller, Calls), (Caller, Calls)) {
        let (left, right) = duplex(4096);
        let (left_read, left_write) = split(left);
        let (right_read, right_write) = split(right);
        (open(left_read, left_write), open(right_read, right_write))
    }

    async fn echo(mut calls: Calls) {
        while let Some(incoming) = calls.recv().await {
            let (call, answer) = incoming.split();
            let result =
                if call == "fail" { Err("no".to_owned()) } else { Ok(call.to_uppercase()) };
            answer.send(result).await;
        }
    }

    #[tokio::test]
    async fn a_call_gets_its_answer() {
        let ((caller, _calls), (_other, calls)) = pair();
        tokio::spawn(echo(calls));
        assert_eq!(caller.call::<_, String>(&"hello").await.unwrap(), "HELLO");
    }

    #[tokio::test]
    async fn both_sides_can_call() {
        let ((left, left_calls), (right, right_calls)) = pair();
        tokio::spawn(echo(left_calls));
        tokio::spawn(echo(right_calls));
        assert_eq!(left.call::<_, String>(&"a").await.unwrap(), "A");
        assert_eq!(right.call::<_, String>(&"b").await.unwrap(), "B");
    }

    #[tokio::test]
    async fn an_error_answer_carries_the_other_sides_words() {
        let ((caller, _calls), (_other, calls)) = pair();
        tokio::spawn(echo(calls));
        let error = caller.call::<_, String>(&"fail").await.unwrap_err();
        assert!(matches!(error, Error::Refused(message) if message == "no"));
    }

    #[tokio::test]
    async fn answers_match_their_calls_out_of_order() {
        let ((caller, _calls), (_other, mut calls)) = pair();
        tokio::spawn(async move {
            let first = calls.recv().await.unwrap();
            let second = calls.recv().await.unwrap();
            for incoming in [second, first] {
                let (call, answer) = incoming.split();
                answer.send(Ok(call)).await;
            }
        });
        let (one, two) =
            tokio::join!(caller.call::<_, String>(&"one"), caller.call::<_, String>(&"two"));
        assert_eq!((one.unwrap(), two.unwrap()), ("one".to_owned(), "two".to_owned()));
    }

    #[tokio::test]
    async fn an_answer_is_on_the_wire_by_the_time_send_returns() {
        let (left, right) = duplex(4096);
        let (left_read, left_write) = split(left);
        let (_caller, mut calls) = open::<_, _, String>(left_read, left_write);
        let (mut right_read, mut right_write) = split(right);
        right_write.write_all(b"{\"id\":7,\"body\":{\"call\":\"hello\"}}\n").await.unwrap();
        let (_, answer) = calls.recv().await.unwrap().split();
        answer.send(Ok::<_, String>("done")).await;
        // Nothing else runs between `send` returning and this read: the bytes must be there.
        let mut wire = [0; 64];
        let count = tokio::io::AsyncReadExt::read(&mut right_read, &mut wire).await.unwrap();
        assert_eq!(&wire[..count], b"{\"id\":7,\"body\":{\"ok\":\"done\"}}\n");
    }

    #[tokio::test]
    async fn a_waiting_call_fails_when_the_connection_closes() {
        let ((caller, _calls), other) = pair();
        let waiting = tokio::spawn(async move { caller.call::<_, String>(&"hello").await });
        tokio::task::yield_now().await;
        drop(other);
        assert!(matches!(waiting.await.unwrap(), Err(Error::Closed)));
    }

    #[tokio::test]
    async fn a_call_after_the_connection_closed_fails_at_once() {
        let ((caller, _calls), other) = pair();
        drop(other);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(matches!(caller.call::<_, String>(&"late").await, Err(Error::Closed)));
    }
}
