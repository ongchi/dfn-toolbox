//! Bindings of fehm: the steady flow on the triangle mesh of the network.

use fehm::{build_input_from_text, solve, write_output};
use wasm_bindgen::prelude::*;

use crate::errors::{fehm_report, ErrorReport};
use crate::{find_file, with_log, write_files_to_memory};

/// Checks the flow input. Returns the error, or `None` for a valid input.
#[wasm_bindgen]
pub fn check_flow_input(toml_text: &str, mesh_text: &str) -> Option<ErrorReport> {
    build_input_from_text(toml_text, mesh_text)
        .err()
        .map(|error| fehm_report(&error))
}

/// Result of `run_flow`. With an error, there are no output files.
#[wasm_bindgen]
pub struct FlowResult {
    error: Option<ErrorReport>,
    log: String,
    files: Vec<(String, String)>,
    boundary_names: Vec<String>,
    boundary_flows: Vec<f64>,
    newton_iterations: usize,
}

#[wasm_bindgen]
impl FlowResult {
    /// Error of a failed run
    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<ErrorReport> {
        self.error.clone()
    }

    /// Log lines of the run
    #[wasm_bindgen(getter)]
    pub fn log(&self) -> String {
        self.log.clone()
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

    /// Names of the boundaries, in the order of the input file
    #[wasm_bindgen(getter)]
    pub fn boundary_names(&self) -> Vec<String> {
        self.boundary_names.clone()
    }

    /// For each boundary: mass flow into the network (kg/s); negative for an out-flow
    #[wasm_bindgen(getter)]
    pub fn boundary_flows(&self) -> Vec<f64> {
        self.boundary_flows.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn newton_iterations(&self) -> usize {
        self.newton_iterations
    }
}

/// Solves the flow and writes its output files into memory
#[wasm_bindgen]
pub fn run_flow(toml_text: &str, mesh_text: &str) -> FlowResult {
    let (outcome, log) = with_log(|| {
        let input =
            build_input_from_text(toml_text, mesh_text).map_err(|error| fehm_report(&error))?;
        let solution = solve(&input).map_err(|error| fehm_report(&error))?;
        let files =
            write_files_to_memory(|create_file| write_output(&input, &solution, create_file))?;
        Ok::<_, ErrorReport>((input, solution, files))
    });

    let mut result = FlowResult {
        error: None,
        log,
        files: Vec::new(),
        boundary_names: Vec::new(),
        boundary_flows: Vec::new(),
        newton_iterations: 0,
    };
    match outcome {
        Ok((input, solution, files)) => {
            result.files = files;
            result.boundary_names = input
                .boundaries
                .into_iter()
                .map(|boundary| boundary.name)
                .collect();
            result.boundary_flows = solution.boundary_flows;
            result.newton_iterations = solution.newton_iterations;
        }
        Err(report) => result.error = Some(report),
    }
    result
}
