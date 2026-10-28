//! Bindings of dfngen: the generation of the network.

use dfngen::{build_input_from_text, generate, read_input_file_names, write_output};
use wasm_bindgen::prelude::*;

use crate::errors::{dfngen_report, ErrorReport};
use crate::{find_file, with_log, write_files_to_memory};

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

/// Checks the input. Returns the error, or `None` for a valid input.
#[wasm_bindgen]
#[expect(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen does not take Option<&str>"
)]
pub fn check_input(
    toml_text: &str,
    domain_mesh_text: &str,
    user_fractures_text: Option<String>,
) -> Option<ErrorReport> {
    build_input_from_text(toml_text, domain_mesh_text, user_fractures_text.as_deref())
        .err()
        .map(|error| dfngen_report(&error))
}

/// Result of `run_generation`. With an error, there are no output files,
/// and the log tells what was done before the error.
#[wasm_bindgen]
pub struct GenerationResult {
    error: Option<ErrorReport>,
    log: String,
    seed: u64,
    files: Vec<(String, String)>,
    accepted_count: usize,
    final_count: usize,
    rejected_count: usize,
    is_without_cluster_on_all_surfaces: bool,
}

#[wasm_bindgen]
impl GenerationResult {
    /// Error of a failed generation
    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<ErrorReport> {
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
        find_file(&self.files, name)
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

    /// True if no cluster connects all boundary surfaces: the generation kept all clusters
    #[wasm_bindgen(getter)]
    pub fn is_without_cluster_on_all_surfaces(&self) -> bool {
        self.is_without_cluster_on_all_surfaces
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
    let mut seed = 0;
    let (outcome, log) = with_log(|| {
        let (mut input, family_collection) =
            build_input_from_text(toml_text, domain_mesh_text, user_fractures_text.as_deref())
                .map_err(|error| dfngen_report(&error))?;
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
        .map_err(|error| dfngen_report(&error))?;

        let files = write_files_to_memory(|create_file| write_output(&network, create_file))?;
        Ok::<_, ErrorReport>((network, files))
    });

    let mut result = GenerationResult {
        error: None,
        log,
        seed,
        files: Vec::new(),
        accepted_count: 0,
        final_count: 0,
        rejected_count: 0,
        is_without_cluster_on_all_surfaces: false,
    };
    match outcome {
        Ok((network, files)) => {
            result.files = files;
            result.accepted_count = network.dfn.accepted_polys.len();
            result.final_count = network.final_fractures.len();
            result.rejected_count = network.dfn.rejected_polys.len();
            result.is_without_cluster_on_all_surfaces = network.is_without_cluster_on_all_surfaces;
        }
        Err(report) => result.error = Some(report),
    }
    result
}
