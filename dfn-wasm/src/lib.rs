//! WebAssembly bindings of dfngen for the web app.
//!
//! The web app runs these functions in a Web Worker. Each function takes the
//! text of the input files and gives the text of the output files: there is
//! no file system.

use std::cell::RefCell;
use std::io::{self, Write};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use dfngen::{build_input_from_text, generate, read_input_file_names, write_output, Network};
use tracing_subscriber::fmt::MakeWriter;
use wasm_bindgen::prelude::*;

/// The files which an input file needs, from its text
#[wasm_bindgen(getter_with_clone)]
pub struct InputFileNames {
    /// Name of the domain mesh file (`domain` key)
    pub domain: String,
    /// Name of the user-defined fracture file (`user_fractures` key), if any
    pub user_fractures: Option<String>,
}

/// Reads the names of the files which the TOML input needs
#[wasm_bindgen]
pub fn input_file_names(toml_text: &str) -> Result<InputFileNames, JsError> {
    let names = read_input_file_names(toml_text)?;
    Ok(InputFileNames {
        domain: names.domain,
        user_fractures: names.user_fractures,
    })
}

/// Checks the input. Returns the error message, or `None` for a valid input.
#[wasm_bindgen]
#[expect(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen does not take Option<&str>"
)]
pub fn check_input(
    toml_text: &str,
    domain_mesh_text: &str,
    user_fractures_text: Option<String>,
) -> Option<String> {
    build_input_from_text(toml_text, domain_mesh_text, user_fractures_text.as_deref())
        .err()
        .map(|error| error.to_string())
}

/// Result of `run_generation`. With an error, there are no output files,
/// and the log tells what was done before the error.
#[wasm_bindgen]
pub struct GenerationResult {
    error: Option<String>,
    log: String,
    seed: u64,
    files: Vec<(String, String)>,
    accepted_count: usize,
    final_count: usize,
    rejected_count: usize,
}

#[wasm_bindgen]
impl GenerationResult {
    /// Error message of a failed generation
    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<String> {
        self.error.clone()
    }

    /// Log lines of the generation, as the binary writes them to stdout
    #[wasm_bindgen(getter)]
    pub fn log(&self) -> String {
        self.log.clone()
    }

    /// Seed of the random generator which the generation used
    #[wasm_bindgen(getter)]
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// Names of the output files, in the order of `write_output`
    #[wasm_bindgen(getter)]
    pub fn file_names(&self) -> Vec<String> {
        self.files.iter().map(|(name, _)| name.clone()).collect()
    }

    /// Text of an output file
    pub fn file(&self, name: &str) -> Option<String> {
        self.files
            .iter()
            .find(|(file_name, _)| file_name == name)
            .map(|(_, text)| text.clone())
    }

    /// Number of accepted fractures
    #[wasm_bindgen(getter)]
    pub fn accepted_count(&self) -> usize {
        self.accepted_count
    }

    /// Number of final fractures (after the cluster analysis)
    #[wasm_bindgen(getter)]
    pub fn final_count(&self) -> usize {
        self.final_count
    }

    /// Number of rejected fractures
    #[wasm_bindgen(getter)]
    pub fn rejected_count(&self) -> usize {
        self.rejected_count
    }
}

/// Generates a network and writes its output files into memory
///
/// # Arguments
///
/// * `seed_if_zero` - Seed for an input with `seed = 0` (the binary uses the clock)
/// * `on_progress` - Called as `on_progress(accepted_count, fraction)` after
///   each accepted stochastic fracture
#[wasm_bindgen]
#[expect(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen does not take Option<&str>"
)]
pub fn run_generation(
    toml_text: &str,
    domain_mesh_text: &str,
    user_fractures_text: Option<String>,
    seed_if_zero: u64,
    on_progress: &js_sys::Function,
) -> GenerationResult {
    let log = LogBuffer::default();
    let subscriber = tracing_subscriber::fmt()
        .compact()
        .without_time()
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO)
        .with_writer(log.clone())
        .finish();

    let mut seed = 0;
    let outcome = tracing::subscriber::with_default(subscriber, || {
        let (mut input, family_collection) =
            build_input_from_text(toml_text, domain_mesh_text, user_fractures_text.as_deref())
                .map_err(|error| error.to_string())?;
        if input.seed == 0 {
            input.seed = seed_if_zero;
        }
        seed = input.seed;

        let network = generate(input, family_collection, &mut |update| {
            // A failed call of the JS callback does not stop the generation
            let _ = on_progress.call2(
                &JsValue::NULL,
                &JsValue::from(update.accepted_count as f64),
                &JsValue::from(update.fraction),
            );
        })
        .map_err(|error| error.to_string())?;

        let files = write_files_to_memory(&network).map_err(|error| error.to_string())?;
        Ok::<_, String>((network, files))
    });

    let mut result = GenerationResult {
        error: None,
        log: log.text(),
        seed,
        files: Vec::new(),
        accepted_count: 0,
        final_count: 0,
        rejected_count: 0,
    };
    match outcome {
        Ok((network, files)) => {
            result.files = files;
            result.accepted_count = network.dfn.accepted_polys.len();
            result.final_count = network.final_fractures.len();
            result.rejected_count = network.dfn.rejected_polys.len();
        }
        Err(message) => result.error = Some(message),
    }
    result
}

/// Writes the output files of a network into memory: (name, text) for each file
fn write_files_to_memory(network: &Network) -> io::Result<Vec<(String, String)>> {
    // `write_output` needs writers which own their buffer, thus the buffers are shared
    let mut buffers: Vec<(String, Rc<RefCell<Vec<u8>>>)> = Vec::new();
    write_output(network, &mut |file_name| {
        let buffer = Rc::new(RefCell::new(Vec::new()));
        buffers.push((file_name.to_string(), Rc::clone(&buffer)));
        Ok(Box::new(SharedBufferWriter(buffer)))
    })?;

    buffers
        .into_iter()
        .map(|(name, buffer)| {
            let bytes = buffer.take();
            let text = String::from_utf8(bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            Ok((name, text))
        })
        .collect()
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
