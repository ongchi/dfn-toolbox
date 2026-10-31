//! Bindings of dfngen: the generation of the network.

use dfngen::io::input::Input;
use dfngen::io::output::to_output_coordinates;
use dfngen::mesh::MeshOptions;
use dfngen::{
    build_input_from_text, generate, read_input_file_names, resume, write_output, Checkpoint,
    DfngenError, ProgressUpdate, Resume, ResumeMode,
};
use tracing::warn;
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
    is_without_connecting_cluster: bool,
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

    /// True if no cluster connects an in-flow and an out-flow surface: the generation kept all clusters
    #[wasm_bindgen(getter)]
    pub fn is_without_connecting_cluster(&self) -> bool {
        self.is_without_connecting_cluster
    }
}

/// How a restart from a checkpoint continues (`dfngen::ResumeMode`)
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum RestartMode {
    /// Insertion until the stop condition: the network of a run with no stop
    Continue,
    /// No more insertion: the network of the fractures of the checkpoint
    Finish,
}

impl From<RestartMode> for ResumeMode {
    fn from(mode: RestartMode) -> Self {
        match mode {
            RestartMode::Continue => Self::ContinueInsertion,
            RestartMode::Finish => Self::Finish,
        }
    }
}

/// Whether a generation makes the triangle mesh
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum MeshStep {
    /// Only the fractures: `mesh_generation` makes the mesh later
    Skip,
    /// The fractures and the mesh
    Make,
}

/// The mesh options of a run
#[derive(Clone, Copy)]
enum MeshSource<'a> {
    /// No mesh
    Skip,
    /// The options of the input of the run
    Input,
    /// The options of other input texts: the fractures stay those of the run
    Texts(&'a InputTexts<'a>),
}

impl From<MeshStep> for MeshSource<'_> {
    fn from(step: MeshStep) -> Self {
        match step {
            MeshStep::Skip => Self::Skip,
            MeshStep::Make => Self::Input,
        }
    }
}

/// The texts of the input files
struct InputTexts<'a> {
    toml: &'a str,
    domain_mesh: &'a str,
    user_fractures: Option<&'a str>,
}

/// The JS callbacks of a generation
struct Callbacks<'a> {
    on_progress: Option<&'a js_sys::Function>,
    on_checkpoint: Option<&'a js_sys::Function>,
}

/// Generates a network and writes its output files into memory
///
/// # Arguments
///
/// * `seed_if_zero` - Seed for an input with `seed = 0` (the binary uses the clock)
/// * `mesh_step` - Whether the run makes the triangle mesh
/// * `on_progress` - Called as `on_progress(accepted_count, fraction,
///   vertices, family)` after each accepted stochastic fracture. `vertices`
///   is a `Float64Array` (x, y, z of each vertex, in the coordinates of the
///   mesh file), `family` the family number (from 1). A return value `true`
///   asks for a checkpoint after the fracture.
/// * `on_checkpoint` - Called as `on_checkpoint(bytes, accepted_count)`
///   with the checkpoint (`Uint8Array`) which `on_progress` asked for
#[wasm_bindgen]
#[expect(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen does not take Option<&str> and Option<&Function>"
)]
pub fn run_generation(
    toml_text: &str,
    domain_mesh_text: &str,
    user_fractures_text: Option<String>,
    seed_if_zero: u64,
    mesh_step: MeshStep,
    on_progress: &js_sys::Function,
    on_checkpoint: Option<js_sys::Function>,
) -> GenerationResult {
    let texts = InputTexts {
        toml: toml_text,
        domain_mesh: domain_mesh_text,
        user_fractures: user_fractures_text.as_deref(),
    };
    let callbacks = Callbacks {
        on_progress: Some(on_progress),
        on_checkpoint: on_checkpoint.as_ref(),
    };
    run(&texts, seed_if_zero, None, mesh_step.into(), &callbacks)
}

/// Generates a network from the checkpoint of a stopped generation, as
/// `run_generation`. The input files must be those of the stopped
/// generation, and the seed is that of the checkpoint.
///
/// # Arguments
///
/// * `checkpoint` - Bytes of the checkpoint (of `on_checkpoint`)
/// * `mode` - What to do after the checkpoint
/// * `mesh_step` - Whether the run makes the triangle mesh
#[wasm_bindgen]
#[expect(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen does not take Option<&str> and Option<&Function>"
)]
#[expect(
    clippy::too_many_arguments,
    reason = "the arguments of a wasm-bindgen function are the JS interface"
)]
pub fn resume_generation(
    toml_text: &str,
    domain_mesh_text: &str,
    user_fractures_text: Option<String>,
    checkpoint: &[u8],
    mode: RestartMode,
    mesh_step: MeshStep,
    on_progress: &js_sys::Function,
    on_checkpoint: Option<js_sys::Function>,
) -> GenerationResult {
    let texts = InputTexts {
        toml: toml_text,
        domain_mesh: domain_mesh_text,
        user_fractures: user_fractures_text.as_deref(),
    };
    let callbacks = Callbacks {
        on_progress: Some(on_progress),
        on_checkpoint: on_checkpoint.as_ref(),
    };
    // The seed of the checkpoint replaces the seed of the input
    run(
        &texts,
        0,
        Some((checkpoint, mode)),
        mesh_step.into(),
        &callbacks,
    )
}

/// Makes the triangle mesh of a network of `MeshStep::Skip`, and all output
/// files again (the mesh can remove fractures). The fractures come from the
/// input of the generation, the mesh options and the apertures from the
/// current input.
///
/// # Arguments
///
/// * `network_toml_text`, `network_user_fractures_text` - The input of the generation
/// * `current_toml_text`, `current_user_fractures_text` - The current input
/// * `seed` - The seed of the generation
/// * `checkpoint` - The checkpoint after the last accepted fracture. `None`
///   runs the generation again from the seed: a network with only
///   user-defined fractures has no checkpoint.
#[wasm_bindgen]
#[expect(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen does not take Option<&str> and Option<&[u8]>"
)]
pub fn mesh_generation(
    network_toml_text: &str,
    current_toml_text: &str,
    domain_mesh_text: &str,
    network_user_fractures_text: Option<String>,
    current_user_fractures_text: Option<String>,
    seed: u64,
    checkpoint: Option<Vec<u8>>,
) -> GenerationResult {
    let network_texts = InputTexts {
        toml: network_toml_text,
        domain_mesh: domain_mesh_text,
        user_fractures: network_user_fractures_text.as_deref(),
    };
    let current_texts = InputTexts {
        toml: current_toml_text,
        domain_mesh: domain_mesh_text,
        user_fractures: current_user_fractures_text.as_deref(),
    };
    // The fractures of the checkpoint are all of the network
    let restart = checkpoint
        .as_deref()
        .map(|bytes| (bytes, RestartMode::Finish));
    let callbacks = Callbacks {
        on_progress: None,
        on_checkpoint: None,
    };
    run(
        &network_texts,
        seed,
        restart,
        MeshSource::Texts(&current_texts),
        &callbacks,
    )
}

/// The mesh options of the current input. The number of families must be
/// that of the network: each family has an aperture.
fn current_mesh_options(
    current: &InputTexts,
    network: &Input,
) -> Result<Option<MeshOptions>, ErrorReport> {
    let (current_input, _) =
        build_input_from_text(current.toml, current.domain_mesh, current.user_fractures)
            .map_err(|error| dfngen_report(&error))?;
    let family_count = |input: &Input| {
        input
            .mesh
            .as_ref()
            .map(|options| options.family_apertures.len())
    };
    if family_count(&current_input) != family_count(network) {
        return Err(dfngen_report(&DfngenError::CheckpointInputChanged));
    }
    Ok(current_input.mesh)
}

fn run(
    texts: &InputTexts,
    seed_if_zero: u64,
    restart: Option<(&[u8], RestartMode)>,
    mesh_source: MeshSource,
    callbacks: &Callbacks,
) -> GenerationResult {
    let mut seed = 0;
    let (outcome, log) = with_log(|| {
        let (mut input, family_collection) =
            build_input_from_text(texts.toml, texts.domain_mesh, texts.user_fractures)
                .map_err(|error| dfngen_report(&error))?;
        if input.seed == 0 {
            input.seed = seed_if_zero;
        }
        seed = input.seed;
        match mesh_source {
            MeshSource::Skip => input.mesh = None,
            MeshSource::Input => {}
            MeshSource::Texts(current) => input.mesh = current_mesh_options(current, &input)?,
        }
        let mesh_center = input.domain_mesh.center();

        let mut on_progress = |update: &ProgressUpdate| {
            let Some(on_progress) = callbacks.on_progress else {
                return;
            };
            let vertices: Vec<f64> = update
                .fracture
                .vertices
                .iter()
                .flat_map(|vertex| {
                    let point = to_output_coordinates(vertex, &mesh_center);
                    [point.x, point.y, point.z]
                })
                .collect();
            // A failed call of the JS callback does not stop the generation
            let is_checkpoint_asked = on_progress
                .call4(
                    &JsValue::NULL,
                    &JsValue::from(update.accepted_count as f64),
                    &JsValue::from(update.fraction),
                    &js_sys::Float64Array::from(vertices.as_slice()),
                    &JsValue::from(update.fracture.origin.output_number() as f64),
                )
                .is_ok_and(|answer| answer.is_truthy());
            if let (true, Some(on_checkpoint)) = (is_checkpoint_asked, callbacks.on_checkpoint) {
                send_checkpoint(update, on_checkpoint);
            }
        };

        let network = match restart {
            None => generate(input, family_collection, &mut on_progress),
            Some((bytes, mode)) => {
                let checkpoint =
                    Checkpoint::from_bytes(bytes).map_err(|error| dfngen_report(&error))?;
                let restart = Resume {
                    checkpoint: &checkpoint,
                    mode: mode.into(),
                };
                resume(input, family_collection, restart, &mut on_progress)
            }
        }
        .map_err(|error| dfngen_report(&error))?;
        seed = network.input.seed;

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
        is_without_connecting_cluster: false,
    };
    match outcome {
        Ok((network, files)) => {
            result.files = files;
            result.accepted_count = network.dfn.accepted_polys.len();
            result.final_count = network.final_fractures.len();
            result.rejected_count = network.dfn.rejected_polys.len();
            result.is_without_connecting_cluster = network.is_without_connecting_cluster;
        }
        Err(report) => result.error = Some(report),
    }
    result
}

/// Gives the checkpoint after the fracture of the update to `on_checkpoint`.
/// A failure is in the log: the generation continues.
fn send_checkpoint(update: &ProgressUpdate, on_checkpoint: &js_sys::Function) {
    match update.checkpoint().to_bytes() {
        Ok(bytes) => {
            let _ = on_checkpoint.call2(
                &JsValue::NULL,
                &js_sys::Uint8Array::from(bytes.as_slice()),
                &JsValue::from(update.accepted_count as f64),
            );
        }
        Err(error) => warn!("No checkpoint: {}", error),
    }
}
