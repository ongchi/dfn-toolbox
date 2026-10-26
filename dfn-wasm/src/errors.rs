//! The errors of dfngen, fehm and dfntrans for the web app: the kind of each
//! error (the variant, for example `dfngen.Family.NumberOfPoints`), its
//! values, and the text of the library. The app writes its own text for
//! each kind (`app/src/errors.ts`).

use dfngen::distribution::{exp, log_norm};
use dfngen::{DfngenError, FamilyError, RegionError, UserFractureError};
use dfntrans::DfntransError;
use fehm::{eos, FehmError};
use wasm_bindgen::prelude::*;

/// An error of a library
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct ErrorReport {
    kind: String,
    message: String,
    fields: Vec<(String, String)>,
}

#[wasm_bindgen]
impl ErrorReport {
    /// The variant of the error: `<library>.<variant>[.<variant of its source>]`
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.clone()
    }

    /// The text of the library
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String {
        self.message.clone()
    }

    /// Names of the values of the error, in the order of `field_values`
    #[wasm_bindgen(getter)]
    pub fn field_names(&self) -> Vec<String> {
        self.fields.iter().map(|(name, _)| name.clone()).collect()
    }

    /// The values of the error, as text
    #[wasm_bindgen(getter)]
    pub fn field_values(&self) -> Vec<String> {
        self.fields.iter().map(|(_, value)| value.clone()).collect()
    }
}

impl ErrorReport {
    fn new(kind: &str, error: &impl ToString) -> Self {
        Self {
            kind: kind.to_string(),
            message: error.to_string(),
            fields: Vec::new(),
        }
    }

    fn with(mut self, name: &str, value: &(impl ToString + ?Sized)) -> Self {
        self.fields.push((name.to_string(), value.to_string()));
        self
    }

    /// An error of the code which writes the output files (no library error)
    pub fn output(message: String) -> Self {
        Self {
            kind: "output".to_string(),
            message,
            fields: Vec::new(),
        }
    }
}

pub fn dfngen_report(error: &DfngenError) -> ErrorReport {
    let report = |kind: &str| ErrorReport::new(kind, error);
    match error {
        DfngenError::SystemTime(_) => report("dfngen.SystemTime"),
        DfngenError::Io(_) => report("dfngen.Io"),
        DfngenError::DistrUniform(_) => report("dfngen.DistrUniform"),
        DfngenError::LogNormalSampling(_) => report("dfngen.LogNormalSampling"),
        DfngenError::ExponentialSampling(_) => report("dfngen.ExponentialSampling"),
        DfngenError::FamilyRadius { family, source } => {
            report(&format!("dfngen.FamilyRadius.{}", radius_reason(source))).with("family", family)
        }
        DfngenError::InefficientSampling => report("dfngen.InefficientSampling"),
        DfngenError::ReadInput { file, .. } => report("dfngen.ReadInput").with("file", file),
        DfngenError::InvalidToml(_) => report("dfngen.InvalidToml"),
        DfngenError::InvalidFile { file, .. } => report("dfngen.InvalidFile").with("file", file),
        DfngenError::UserFractureFileMissing { file } => {
            report("dfngen.UserFractureFileMissing").with("file", file)
        }
        DfngenError::MinFeatureSize => report("dfngen.MinFeatureSize"),
        DfngenError::UserFracture { fracture, source } => match source {
            UserFractureError::Region(region_error) => {
                let (reason, region) = region_reason(region_error);
                report(&format!("dfngen.UserFracture.{reason}"))
                    .with("fracture", fracture)
                    .with("region", region)
            }
            UserFractureError::Aperture { aperture } => report("dfngen.UserFracture.Aperture")
                .with("fracture", fracture)
                .with("aperture", aperture),
        },
        DfngenError::UserFracturePieceApertures {
            fracture_id,
            first,
            other,
        } => report("dfngen.UserFracturePieceApertures")
            .with("fracture_id", fracture_id)
            .with("first", first)
            .with("other", other),
        DfngenError::Family { family, source } => family_report(error, *family, source),
        DfngenError::MeshNeedsRegionBoundaries => report("dfngen.MeshNeedsRegionBoundaries"),
        DfngenError::MeshMaxSizeFactor => report("dfngen.MeshMaxSizeFactor"),
        DfngenError::MeshSlope => report("dfngen.MeshSlope"),
        DfngenError::NoFractureDefined => report("dfngen.NoFractureDefined"),
        DfngenError::Mesh(_) => report("dfngen.Mesh"),
        DfngenError::NoIntersectingFractures => report("dfngen.NoIntersectingFractures"),
    }
}

fn family_report(error: &DfngenError, family: usize, source: &FamilyError) -> ErrorReport {
    let report = |reason: &str| {
        ErrorReport::new(&format!("dfngen.Family.{reason}"), error).with("family", &family)
    };
    match source {
        FamilyError::Region(region_error) => {
            let (reason, region) = region_reason(region_error);
            report(reason).with("region", region)
        }
        FamilyError::NumberOfPoints => report("NumberOfPoints"),
        FamilyError::AspectRatio => report("AspectRatio"),
        FamilyError::OrientationPair => report("OrientationPair"),
        FamilyError::P32TargetMissing => report("P32TargetMissing"),
        FamilyError::P32TargetNotAllowed => report("P32TargetNotAllowed"),
        FamilyError::Aperture(_) => report("Aperture"),
        FamilyError::MissingValue(_) => report("MissingValue"),
    }
}

/// The variant of a region error, and the region name
fn region_reason(error: &RegionError) -> (&'static str, &str) {
    match error {
        RegionError::Unknown { region } => ("UnknownRegion", region),
        RegionError::Empty { region } => ("EmptyRegion", region),
    }
}

/// The variant of the source of a `FamilyRadius` error
fn radius_reason(error: &DfngenError) -> &'static str {
    match error {
        DfngenError::LogNormalSampling(log_norm::Error::SigmaTooSmall) => "LogNormalSigma",
        DfngenError::LogNormalSampling(log_norm::Error::RangeTooFarFromMean { .. }) => {
            "LogNormalRange"
        }
        DfngenError::LogNormalSampling(log_norm::Error::InefficientSampling { .. }) => {
            "LogNormalInefficient"
        }
        DfngenError::ExponentialSampling(exp::Error::LambdaTooSmall) => "ExponentialMean",
        DfngenError::ExponentialSampling(_) => "ExponentialRange",
        DfngenError::InefficientSampling => "Inefficient",
        _ => "Other",
    }
}

pub fn fehm_report(error: &FehmError) -> ErrorReport {
    let report = |kind: &str| ErrorReport::new(kind, error);
    match error {
        FehmError::Io(_) => report("fehm.Io"),
        FehmError::InvalidToml(_) => report("fehm.InvalidToml"),
        FehmError::TemperatureRange { temperature } => report("fehm.TemperatureRange")
            .with("temperature", temperature)
            .with("min", &eos::MIN_TEMPERATURE)
            .with("max", &eos::MAX_TEMPERATURE),
        FehmError::NoBoundaryDefined => report("fehm.NoBoundaryDefined"),
        FehmError::DuplicateBoundary { boundary } => {
            report("fehm.DuplicateBoundary").with("boundary", boundary)
        }
        FehmError::PressureRange { boundary, pressure } => report("fehm.PressureRange")
            .with("boundary", boundary)
            .with("pressure", pressure)
            .with("min", &eos::MIN_PRESSURE)
            .with("max", &eos::MAX_PRESSURE),
        FehmError::UnknownBoundary { boundary } => {
            report("fehm.UnknownBoundary").with("boundary", boundary)
        }
        FehmError::EmptyBoundary { boundary } => {
            report("fehm.EmptyBoundary").with("boundary", boundary)
        }
        FehmError::BoundaryWithoutEffect { boundary } => {
            report("fehm.BoundaryWithoutEffect").with("boundary", boundary)
        }
        FehmError::SolverTolerance { tolerance } => {
            report("fehm.SolverTolerance").with("tolerance", tolerance)
        }
        FehmError::SolverMaxIterations => report("fehm.SolverMaxIterations"),
        FehmError::InvalidMesh(_) => report("fehm.InvalidMesh"),
        FehmError::DegenerateTriangle { cell } => {
            report("fehm.DegenerateTriangle").with("cell", cell)
        }
        FehmError::NoBoundary { fracture_ids } => report("fehm.NoBoundary").with(
            "fractures",
            &fracture_ids
                .iter()
                .map(i64::to_string)
                .collect::<Vec<_>>()
                .join(", "),
        ),
        FehmError::NoConvergence(iterations) => {
            report("fehm.NoConvergence").with("iterations", iterations)
        }
        FehmError::LinearSolver(_) => report("fehm.LinearSolver"),
    }
}

pub fn dfntrans_report(error: &DfntransError) -> ErrorReport {
    let report = |kind: &str| ErrorReport::new(kind, error);
    match error {
        DfntransError::Io(_) => report("dfntrans.Io"),
        DfntransError::ReadInput { file, .. } => report("dfntrans.ReadInput").with("file", file),
        DfntransError::InvalidToml(_) => report("dfntrans.InvalidToml"),
        DfntransError::Porosity => report("dfntrans.Porosity"),
        DfntransError::MaxTimeSteps => report("dfntrans.MaxTimeSteps"),
        DfntransError::InflowOutflowMissing => report("dfntrans.InflowOutflowMissing"),
        DfntransError::BoundaryInInflowAndOutflow { boundary } => {
            report("dfntrans.BoundaryInInflowAndOutflow").with("boundary", boundary)
        }
        DfntransError::ParticleCount => report("dfntrans.ParticleCount"),
        DfntransError::MatrixPorosity => report("dfntrans.MatrixPorosity"),
        DfntransError::MatrixDiffusivity => report("dfntrans.MatrixDiffusivity"),
        DfntransError::ControlPlaneSpacing => report("dfntrans.ControlPlaneSpacing"),
        DfntransError::WellControlSurface => report("dfntrans.WellControlSurface"),
        DfntransError::InvalidNetwork(_) => report("dfntrans.InvalidNetwork"),
        DfntransError::EmptyInflowOutflow => report("dfntrans.EmptyInflowOutflow"),
        DfntransError::FlowNotOfMesh => report("dfntrans.FlowNotOfMesh"),
        DfntransError::UnknownBoundary { boundary } => {
            report("dfntrans.UnknownBoundary").with("boundary", boundary)
        }
        DfntransError::NoSeededParticle => report("dfntrans.NoSeededParticle"),
        DfntransError::NoCellForSeeding => report("dfntrans.NoCellForSeeding"),
        DfntransError::NoInflowFlux { volume_flux } => {
            report("dfntrans.NoInflowFlux").with("volume_flux", &format!("{volume_flux:e}"))
        }
        DfntransError::Flow(flow_error) => fehm_report(flow_error),
    }
}
