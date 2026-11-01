//! Bindings of dfntrans: the particle tracking on the flow of fehm.

use dfntrans::{build_input_from_text, track_particles, write_output, Transport};
use wasm_bindgen::prelude::*;

use crate::errors::{dfntrans_report, fehm_report, ErrorReport};
use crate::{find_file, with_log, write_files_to_memory};

/// Largest distance of a path of the 3D view from the path of the particle,
/// relative to the diagonal of the bounds of all paths: 10 % of the tube radius
const VIEW_PATH_TOLERANCE_PART: f64 = 0.0003;

/// The points of each path in the trajectories file
#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq)]
pub enum TrajectoryDetail {
    /// A point for each time step, as in the file of the binary
    Full,
    /// Only the points which the 3D view needs
    View,
}

/// Checks the transport input and its flow input. Returns the error, or
/// `None` for a valid input. The boundary names are checked by `run_transport`.
#[wasm_bindgen]
pub fn check_transport_input(
    transport_toml: &str,
    flow_toml: &str,
    mesh_text: &str,
) -> Option<ErrorReport> {
    let check = || -> Result<(), ErrorReport> {
        build_input_from_text(transport_toml).map_err(|error| dfntrans_report(&error))?;
        fehm::build_input_from_text(flow_toml, mesh_text).map_err(|error| fehm_report(&error))?;
        Ok(())
    };
    check().err()
}

/// Result of `run_transport`. With an error, there are no output files.
#[wasm_bindgen]
pub struct TransportResult {
    error: Option<ErrorReport>,
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
/// * `trajectory_detail` - The points of each path in the trajectories file
#[wasm_bindgen]
pub fn run_transport(
    transport_toml: &str,
    flow_toml: &str,
    mesh_text: &str,
    seed_if_zero: u32,
    trajectory_detail: TrajectoryDetail,
) -> TransportResult {
    let mut seed = 0;
    let (outcome, log) = with_log(|| {
        let mut input =
            build_input_from_text(transport_toml).map_err(|error| dfntrans_report(&error))?;
        if input.seed == 0 {
            input.seed = seed_if_zero;
        }
        seed = input.seed;

        let flow = fehm::build_input_from_text(flow_toml, mesh_text)
            .map_err(|error| fehm_report(&error))?;
        let solution = fehm::solve(&flow).map_err(|error| fehm_report(&error))?;
        let mut transport =
            track_particles(&input, &flow, &solution).map_err(|error| dfntrans_report(&error))?;
        if trajectory_detail == TrajectoryDetail::View {
            simplify_trajectories(&mut transport);
        }
        let files =
            write_files_to_memory(|create_file| write_output(&input, &transport, create_file))?;
        Ok::<_, ErrorReport>((transport, files))
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
        Err(report) => result.error = Some(report),
    }
    result
}

/// Only the points of each path which the 3D view needs
fn simplify_trajectories(transport: &mut Transport) {
    let positions = || {
        transport
            .particles
            .iter()
            .flat_map(|particle| &particle.trajectory)
            .map(|point| point.position)
    };
    let tolerance = VIEW_PATH_TOLERANCE_PART * bounds_diagonal(positions());
    for particle in &mut transport.particles {
        let path: Vec<[f64; 3]> = particle
            .trajectory
            .iter()
            .map(|point| point.position)
            .collect();
        let kept = simplified_path_indices(&path, tolerance);
        particle.trajectory = kept
            .iter()
            .map(|&index| particle.trajectory[index])
            .collect();
    }
}

fn bounds_diagonal(positions: impl Iterator<Item = [f64; 3]>) -> f64 {
    let mut minimum = [f64::INFINITY; 3];
    let mut maximum = [f64::NEG_INFINITY; 3];
    for position in positions {
        for axis in 0..3 {
            minimum[axis] = minimum[axis].min(position[axis]);
            maximum[axis] = maximum[axis].max(position[axis]);
        }
    }
    let squared_sum: f64 = (0..3)
        .map(|axis| (maximum[axis] - minimum[axis]).powi(2))
        .sum();
    if squared_sum.is_finite() {
        squared_sum.sqrt()
    } else {
        0.0
    }
}

/// Douglas-Peucker: the sorted indices of the points of `path` which stay. The
/// path through them is at most `tolerance` from each removed point.
fn simplified_path_indices(path: &[[f64; 3]], tolerance: f64) -> Vec<usize> {
    if path.len() < 3 {
        return (0..path.len()).collect();
    }
    let mut kept = vec![0, path.len() - 1];
    let mut sections = vec![(0, path.len() - 1)];
    while let Some((first, last)) = sections.pop() {
        let farthest = (first + 1..last)
            .map(|index| {
                (
                    index,
                    distance_to_segment(path[index], path[first], path[last]),
                )
            })
            .max_by(|left, right| left.1.total_cmp(&right.1));
        if let Some((index, distance)) = farthest {
            if distance > tolerance {
                kept.push(index);
                sections.push((first, index));
                sections.push((index, last));
            }
        }
    }
    kept.sort_unstable();
    kept
}

fn distance_to_segment(point: [f64; 3], start: [f64; 3], end: [f64; 3]) -> f64 {
    let direction: [f64; 3] = std::array::from_fn(|axis| end[axis] - start[axis]);
    let from_start: [f64; 3] = std::array::from_fn(|axis| point[axis] - start[axis]);
    let squared_length: f64 = direction.iter().map(|value| value * value).sum();
    let projection: f64 = from_start.iter().zip(&direction).map(|(a, b)| a * b).sum();
    let part = if squared_length > 0.0 {
        (projection / squared_length).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (0..3)
        .map(|axis| (from_start[axis] - part * direction[axis]).powi(2))
        .sum::<f64>()
        .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collinear_points_are_removed() {
        let path = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [3.0, 0.0, 0.0],
        ];
        assert_eq!(simplified_path_indices(&path, 1e-3), vec![0, 3]);
    }

    #[test]
    fn a_bend_stays() {
        let path = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [2.0, 1.0, 0.0],
            [2.0, 2.0, 0.0],
        ];
        assert_eq!(simplified_path_indices(&path, 1e-3), vec![0, 2, 4]);
    }

    #[test]
    fn a_deviation_within_the_tolerance_is_removed() {
        let path = [[0.0, 0.0, 0.0], [1.0, 0.01, 0.0], [2.0, 0.0, 0.0]];
        assert_eq!(simplified_path_indices(&path, 0.1), vec![0, 2]);
    }

    #[test]
    fn a_path_which_returns_to_its_start_keeps_its_far_point() {
        let path = [[0.0, 0.0, 0.0], [5.0, 0.0, 0.0], [0.0, 0.0, 0.0]];
        assert_eq!(simplified_path_indices(&path, 1e-3), vec![0, 1, 2]);
    }

    #[test]
    fn short_paths_stay() {
        assert_eq!(simplified_path_indices(&[[1.0, 2.0, 3.0]], 1.0), vec![0]);
        assert!(simplified_path_indices(&[], 1.0).is_empty());
    }

    #[test]
    fn the_diagonal_of_no_points_is_zero() {
        assert_eq!(bounds_diagonal(std::iter::empty()), 0.0);
    }

    #[test]
    fn the_diagonal_covers_all_points() {
        let positions = [[0.0, 0.0, 0.0], [3.0, 4.0, 0.0]];
        assert_eq!(bounds_diagonal(positions.into_iter()), 5.0);
    }
}
