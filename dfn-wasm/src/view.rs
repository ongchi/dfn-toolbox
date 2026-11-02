//! The results for the 3D view of the app, as arrays. They have the numbers
//! of the output files, in the coordinates of the mesh file.

use dfngen::fracture::poly::Poly;
use dfngen::io::output::to_output_coordinates;
use dfngen::Network;
use dfntrans::Transport;
use wasm_bindgen::prelude::*;

/// Polygons or triangles of one layer of the view
#[wasm_bindgen]
#[derive(Clone, Default)]
pub struct ViewShapes {
    points: Vec<f64>,
    vertex_counts: Vec<u32>,
    connectivity: Vec<u32>,
    cell_arrays: Vec<(String, Vec<f64>)>,
}

#[wasm_bindgen]
impl ViewShapes {
    /// x, y, z of each point
    #[wasm_bindgen(getter)]
    pub fn points(&self) -> Vec<f64> {
        self.points.clone()
    }

    /// Number of points of each cell
    #[wasm_bindgen(getter)]
    pub fn vertex_counts(&self) -> Vec<u32> {
        self.vertex_counts.clone()
    }

    /// The point numbers of all cells, one cell after the other
    #[wasm_bindgen(getter)]
    pub fn connectivity(&self) -> Vec<u32> {
        self.connectivity.clone()
    }

    /// Names of the arrays with one number for each cell
    #[wasm_bindgen(getter)]
    pub fn cell_array_names(&self) -> Vec<String> {
        self.cell_arrays
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }

    /// The array with the name
    pub fn cell_array(&self, name: &str) -> Option<Vec<f64>> {
        self.cell_arrays
            .iter()
            .find(|(array_name, _)| array_name == name)
            .map(|(_, values)| values.clone())
    }
}

/// The layers of the view of a generation
pub(crate) struct NetworkShapes {
    pub(crate) fractures: ViewShapes,
    /// `None` without removed fractures
    pub(crate) removed: Option<ViewShapes>,
    /// `None` unless the input asks for the rejected fractures
    pub(crate) rejected: Option<ViewShapes>,
    /// `None` without the triangle mesh
    pub(crate) mesh: Option<ViewShapes>,
}

impl NetworkShapes {
    pub(crate) fn new(network: &Network) -> Self {
        let accepted = &network.dfn.accepted_polys;
        let final_polys: Vec<&Poly> = network
            .final_fractures
            .iter()
            .map(|&index| &accepted[index])
            .collect();
        let removed_polys: Vec<&Poly> = (0..accepted.len())
            .filter(|index| network.final_fractures.binary_search(index).is_err())
            .map(|index| &accepted[index])
            .collect();
        let rejected_polys: Vec<&Poly> = network
            .dfn
            .rejected_polys
            .iter()
            .map(|rejected| &rejected.poly)
            .collect();
        let writes_rejected = network
            .input
            .fram
            .as_ref()
            .is_some_and(|fram| fram.write_rejected_fractures);

        let mut fractures = polygon_shapes(&final_polys, network);
        fractures.cell_arrays = final_fracture_arrays(&final_polys, &network.final_fractures);
        Self {
            fractures,
            removed: (!removed_polys.is_empty()).then(|| polygon_shapes(&removed_polys, network)),
            rejected: writes_rejected.then(|| polygon_shapes(&rejected_polys, network)),
            mesh: network.mesh.as_ref().map(|_| mesh_shapes(network)),
        }
    }
}

fn polygon_shapes(polys: &[&Poly], network: &Network) -> ViewShapes {
    let center = network.input.domain_mesh.center();
    let points: Vec<f64> = polys
        .iter()
        .flat_map(|poly| &poly.vertices)
        .map(|vertex| to_output_coordinates(vertex, &center))
        .flat_map(|point| [point.x, point.y, point.z])
        .collect();
    ViewShapes {
        connectivity: (0..(points.len() / 3) as u32).collect(),
        points,
        vertex_counts: polys
            .iter()
            .map(|poly| poly.vertices.len() as u32)
            .collect(),
        cell_arrays: Vec::new(),
    }
}

/// The arrays with one number of `fractures.vtp`
fn final_fracture_arrays(polys: &[&Poly], final_fractures: &[usize]) -> Vec<(String, Vec<f64>)> {
    let array = |name: &str, value: &dyn Fn(&Poly) -> f64| {
        let values = polys.iter().map(|poly| value(poly)).collect();
        (name.to_string(), values)
    };
    vec![
        (
            "fracture_id".to_string(),
            (1..=polys.len()).map(|number| number as f64).collect(),
        ),
        (
            "accepted_id".to_string(),
            final_fractures
                .iter()
                .map(|&index| (index + 1) as f64)
                .collect(),
        ),
        array("family", &|poly| poly.origin.output_number() as f64),
        array("user_fracture_id", &|poly| {
            poly.user_fracture_id.map_or(-1.0, |id| id as f64)
        }),
        // The cluster numbers of the file start at 1
        array("cluster", &|poly| {
            poly.group.map_or(0.0, |group| (group + 1) as f64)
        }),
        array("intersection_count", &|poly| {
            poly.intersection_indices.len() as f64
        }),
        array("x_radius", &|poly| poly.x_radius),
        array("y_radius", &|poly| poly.y_radius),
        array("aspect_ratio", &|poly| poly.aspect_ratio),
        array("area", &|poly| poly.area),
    ]
}

/// The triangle mesh with the cell arrays of `dfn_mesh.vtu`
fn mesh_shapes(network: &Network) -> ViewShapes {
    let Some(mesh) = &network.mesh else {
        return ViewShapes::default();
    };
    let center = network.input.domain_mesh.center();
    let apertures: Vec<f64> = mesh
        .triangle_fractures
        .iter()
        .map(|&fracture| mesh.apertures[fracture])
        .collect();
    ViewShapes {
        points: mesh
            .points
            .iter()
            .map(|point| to_output_coordinates(point, &center))
            .flat_map(|point| [point.x, point.y, point.z])
            .collect(),
        vertex_counts: vec![3; mesh.triangles.len()],
        connectivity: mesh
            .triangles
            .iter()
            .flatten()
            .map(|&point| point as u32)
            .collect(),
        cell_arrays: vec![
            (
                "fracture_id".to_string(),
                mesh.triangle_fractures
                    .iter()
                    .map(|&fracture| (fracture + 1) as f64)
                    .collect(),
            ),
            (
                "permeability".to_string(),
                apertures
                    .iter()
                    .map(|aperture| aperture * aperture / 12.)
                    .collect(),
            ),
            ("aperture".to_string(), apertures),
        ],
    }
}

/// The paths and the velocities of a transport
#[derive(Default)]
pub(crate) struct TransportArrays {
    /// x, y, z of each point of all paths
    pub(crate) path_points: Vec<f64>,
    /// x, y, z of the velocity at each point of all paths
    pub(crate) path_velocities: Vec<f64>,
    /// Number of points of each path
    pub(crate) path_point_counts: Vec<u32>,
    /// The mesh point of each sector
    pub(crate) sector_nodes: Vec<u32>,
    /// x, y, z of the velocity of each sector (m per time unit)
    pub(crate) sector_velocities: Vec<f64>,
}

impl TransportArrays {
    pub(crate) fn new(transport: &Transport) -> Self {
        let mut arrays = Self::default();
        for particle in &transport.particles {
            arrays
                .path_point_counts
                .push(particle.trajectory.len() as u32);
            for point in &particle.trajectory {
                arrays.path_points.extend(point.position);
                arrays.path_velocities.extend(point.velocity);
            }
        }
        let network = &transport.network;
        for (index, node) in network.nodes.iter().enumerate() {
            for sector in &node.sectors {
                arrays.sector_nodes.push(index as u32);
                arrays
                    .sector_velocities
                    .extend(network.fractures[sector.fracture].vector_to_space(sector.velocity));
            }
        }
        arrays
    }
}
