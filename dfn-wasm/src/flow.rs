//! Bindings of fehm: the steady flow on the triangle mesh of the network.

use fehm::velocity::calculate_darcy_velocities;
use fehm::{build_input_from_mesh, build_input_from_text, solve, write_output};
use wasm_bindgen::prelude::*;

use crate::errors::{fehm_report, ErrorReport};
use crate::view::{FileOutput, FlowMesh};
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
    pressures: Vec<f64>,
    darcy_velocities: Vec<f64>,
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

    /// Pressure of each mesh point (MPa)
    #[wasm_bindgen(getter)]
    pub fn pressures(&self) -> Vec<f64> {
        self.pressures.clone()
    }

    /// x, y, z of the Darcy velocity of each triangle (m/s)
    #[wasm_bindgen(getter)]
    pub fn darcy_velocities(&self) -> Vec<f64> {
        self.darcy_velocities.clone()
    }
}

/// Solves the flow; `file_output` selects the output files (default: their text)
#[wasm_bindgen]
pub fn run_flow(toml_text: &str, mesh: &FlowMesh, file_output: Option<FileOutput>) -> FlowResult {
    let (outcome, log) = with_log(|| {
        let input =
            build_input_from_mesh(toml_text, mesh.mesh()).map_err(|error| fehm_report(&error))?;
        let solution = solve(&input).map_err(|error| fehm_report(&error))?;
        let files = match file_output.unwrap_or_default() {
            FileOutput::Text => {
                write_files_to_memory(|create_file| write_output(&input, &solution, create_file))?
            }
            FileOutput::Skip => Vec::new(),
        };
        Ok::<_, ErrorReport>((input, solution, files))
    });

    let mut result = FlowResult {
        error: None,
        log,
        files: Vec::new(),
        boundary_names: Vec::new(),
        boundary_flows: Vec::new(),
        newton_iterations: 0,
        pressures: Vec::new(),
        darcy_velocities: Vec::new(),
    };
    match outcome {
        Ok((input, solution, files)) => {
            result.files = files;
            result.darcy_velocities = calculate_darcy_velocities(&input, &solution.pressures)
                .into_iter()
                .flatten()
                .collect();
            result.boundary_names = input
                .boundaries
                .into_iter()
                .map(|boundary| boundary.name)
                .collect();
            result.boundary_flows = solution.boundary_flows;
            result.newton_iterations = solution.newton_iterations;
            result.pressures = solution.pressures;
        }
        Err(report) => result.error = Some(report),
    }
    result
}
