//! The parts of the guest agent that are plain decisions about text and bytes, kept apart from the
//! Linux calls in `main.rs` so they are tested on the Mac.

pub mod changes;
pub mod daemon;
pub mod disk;
pub mod dns;
pub mod kube;
pub mod memory;
pub mod network;
pub mod ports;
