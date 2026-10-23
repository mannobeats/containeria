//! Any Host header or SNI name a client sends the proxy: a name it accepts is already canonical, so
//! two spellings of one host always reach the same route.

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|raw: &str| {
    let Some(name) = containeria_net::fuzzing::normalize_host(raw) else { return };
    assert_eq!(containeria_net::fuzzing::normalize_host(&name).as_deref(), Some(name.as_str()));
    assert!(name.len() <= 253);
    assert!(!name.bytes().any(|byte| byte.is_ascii_uppercase()));
});
