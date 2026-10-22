//! WebAssembly bindings of dfngen and fehm for the web app.
//!
//! The web app runs these functions in a Web Worker. Each function takes the
//! text of the input files and gives the text of the output files: there is
//! no file system.

mod flow;
mod generation;

use std::cell::RefCell;
use std::io::{self, Write};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use tracing_subscriber::fmt::MakeWriter;

/// The `create_file` callback of `write_output` of dfngen and fehm
type CreateFile<'a> = dyn FnMut(&str) -> io::Result<Box<dyn Write>> + 'a;

/// Runs `action` with a log subscriber; returns its result and the log lines,
/// as the binaries write them to stdout.
fn with_log<T>(action: impl FnOnce() -> T) -> (T, String) {
    let log = LogBuffer::default();
    let subscriber = tracing_subscriber::fmt()
        .compact()
        .without_time()
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO)
        .with_writer(log.clone())
        .finish();
    let result = tracing::subscriber::with_default(subscriber, action);
    (result, log.text())
}

/// Calls `write` with a `create_file` callback which writes into memory;
/// returns (name, text) for each file, in the order of the calls.
fn write_files_to_memory<E: ToString>(
    write: impl FnOnce(&mut CreateFile) -> Result<(), E>,
) -> Result<Vec<(String, String)>, String> {
    // `write_output` needs writers which own their buffer, thus the buffers are shared
    let mut buffers: Vec<(String, Rc<RefCell<Vec<u8>>>)> = Vec::new();
    write(&mut |file_name| {
        let buffer = Rc::new(RefCell::new(Vec::new()));
        buffers.push((file_name.to_string(), Rc::clone(&buffer)));
        Ok(Box::new(SharedBufferWriter(buffer)))
    })
    .map_err(|error| error.to_string())?;

    buffers
        .into_iter()
        .map(|(name, buffer)| {
            let text = String::from_utf8(buffer.take()).map_err(|error| error.to_string())?;
            Ok((name, text))
        })
        .collect()
}

/// Text of the file with the name, from the result of `write_files_to_memory`
fn find_file(files: &[(String, String)], name: &str) -> Option<String> {
    files
        .iter()
        .find(|(file_name, _)| file_name == name)
        .map(|(_, text)| text.clone())
}

struct SharedBufferWriter(Rc<RefCell<Vec<u8>>>);

impl Write for SharedBufferWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.borrow_mut().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Log output in memory. The subscriber of `tracing` must be `Send` and
/// `Sync`, thus `Arc<Mutex<_>>`.
#[derive(Clone, Default)]
struct LogBuffer(Arc<Mutex<Vec<u8>>>);

impl LogBuffer {
    fn text(&self) -> String {
        let bytes = self.0.lock().map(|bytes| bytes.clone()).unwrap_or_default();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

impl Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.extend_from_slice(bytes);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for LogBuffer {
    type Writer = LogBuffer;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}
