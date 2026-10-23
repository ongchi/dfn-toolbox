// `trajectories.vtp` of dfntrans has no active vectors. The cones of the
// view are oriented by the active vectors, thus the text marks the point
// array `velocity` as the vectors before VTK reads it.

/** The text of `trajectories.vtp` with `velocity` as the active point vectors */
export function markVelocityAsVectors(vtpText: string): string {
  if (!vtpText.includes("<PointData>")) {
    throw new Error("trajectories.vtp has no <PointData>");
  }
  return vtpText.replace("<PointData>", '<PointData Vectors="velocity">');
}
