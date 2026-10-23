//! Bindings of dfntrans: the particle tracking on the flow of fehm.

use dfntrans::{build_input_from_text, track_particles, write_output};
use wasm_bindgen::prelude::*;

use crate::{find_file, with_log, write_files_to_memory};

/// Checks the transport input and its flow input. Returns the error message,
/// or `None` for a valid input. The boundary names are checked by `run_transport`.
#[wasm_bindgen]
pub fn check_transport_input(
    transport_toml: &str,
    flow_toml: &str,
    mesh_text: &str,
) -> Option<String> {
    let check = || -> Result<(), String> {
        build_input_from_text(transport_toml).map_err(|error| error.to_string())?;
        fehm::build_input_from_text(flow_toml, mesh_text).map_err(|error| error.to_string())?;
        Ok(())
    };
    check().err()
}

/// Result of `run_transport`. With an error, there are no output files.
#[wasm_bindgen]
pub struct TransportResult {
    error: Option<String>,
    log: String,
    seed: u32,
    files: Vec<(String, String)>,
    particle_count: usize,
    exit_count: usize,
    inflow_volume_flux: f64,
    outflow_volume_flux: f64,
}

#[wasm_bindgen]
impl TransportResult {
    /// Error message of a failed run
    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<String> {
        self.error.clone()
    }

    /// Log lines of the run
    #[wasm_bindgen(getter)]
    pub fn log(&self) -> String {
        self.log.clone()
    }

    /// Seed of the random numbers which the run used
    #[wasm_bindgen(getter)]
    pub fn seed(&self) -> u32 {
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

    /// Number of seeded particles
    #[wasm_bindgen(getter)]
    pub fn particle_count(&self) -> usize {
        self.particle_count
    }

    /// Number of particles which exited through the out-flow boundary
    #[wasm_bindgen(getter)]
    pub fn exit_count(&self) -> usize {
        self.exit_count
    }

    /// Volume flux into the network through the in-flow boundary (m³/s)
    #[wasm_bindgen(getter)]
    pub fn inflow_volume_flux(&self) -> f64 {
        self.inflow_volume_flux
    }

    /// Volume flux out of the network through the out-flow boundary (m³/s)
    #[wasm_bindgen(getter)]
    pub fn outflow_volume_flux(&self) -> f64 {
        self.outflow_volume_flux
    }
}

/// Solves the flow, tracks the particles and writes the output files into memory
///
/// # Arguments
///
/// * `flow_toml` - The fehm input which the `flow` key of the transport input names
/// * `seed_if_zero` - Seed for an input with `seed = 0` (the binary uses the clock)
#[wasm_bindgen]
pub fn run_transport(
    transport_toml: &str,
    flow_toml: &str,
    mesh_text: &str,
    seed_if_zero: u32,
) -> TransportResult {
    let mut seed = 0;
    let (outcome, log) = with_log(|| {
        let mut input = build_input_from_text(transport_toml).map_err(|error| error.to_string())?;
        if input.seed == 0 {
            input.seed = seed_if_zero;
        }
        seed = input.seed;

        let flow =
            fehm::build_input_from_text(flow_toml, mesh_text).map_err(|error| error.to_string())?;
        let solution = fehm::solve(&flow).map_err(|error| error.to_string())?;
        let transport =
            track_particles(&input, &flow, &solution).map_err(|error| error.to_string())?;
        let files =
            write_files_to_memory(|create_file| write_output(&input, &transport, create_file))?;
        Ok::<_, String>((transport, files))
    });

    let mut result = TransportResult {
        error: None,
        log,
        seed,
        files: Vec::new(),
        particle_count: 0,
        exit_count: 0,
        inflow_volume_flux: 0.0,
        outflow_volume_flux: 0.0,
    };
    match outcome {
        Ok((transport, files)) => {
            result.files = files;
            result.particle_count = transport.particle_count;
            result.exit_count = transport.exit_count;
            result.inflow_volume_flux = transport.inflow_volume_flux;
            result.outflow_volume_flux = transport.outflow_volume_flux;
        }
        Err(message) => result.error = Some(message),
    }
    result
}
