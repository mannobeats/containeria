//! `containeria-engine`: the engine process. The app and `cx` start it; see `daemon`.

use std::process::ExitCode;

use containeria_engine::Home;

fn main() -> ExitCode {
    tracing_subscriber::fmt().with_writer(std::io::stderr).with_ansi(false).init();
    let ran = Home::from_env().and_then(|home| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(Into::into)
            .and_then(|runtime| runtime.block_on(containeria_engine::run(home)))
    });
    match ran {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error}");
            ExitCode::FAILURE
        }
    }
}
