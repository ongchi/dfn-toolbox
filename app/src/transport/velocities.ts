// The velocities of dfntrans: one for each sector of a node (the point of the
// mesh with the same number), in m per time unit of the input. The mesh shows
// the mean speed of the sectors of each point, in m/s.
import { vectorMagnitudes } from "../viewerGeometry";
import type { TimeUnit } from "./state";

/** Seconds in one time unit, as dfntrans (`TimeUnit::seconds`: a year has 365 days) */
const SECONDS_PER_TIME_UNIT: Record<TimeUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
  years: 365 * 24 * 60 * 60,
};

/** The mean speed (m/s) of the sectors of each of the `pointCount` mesh points; 0 for a point with no sector */
export function nodeVelocityMagnitudes(
  nodes: Uint32Array,
  velocities: Float64Array,
  pointCount: number,
  timeUnit: TimeUnit,
): Float64Array {
  const speeds = vectorMagnitudes(velocities);
  const sums = new Float64Array(pointCount);
  const counts = new Uint32Array(pointCount);
  nodes.forEach((node, index) => {
    sums[node] += speeds[index];
    counts[node] += 1;
  });
  const seconds = SECONDS_PER_TIME_UNIT[timeUnit];
  return sums.map((sum, point) => (counts[point] === 0 ? 0 : sum / counts[point] / seconds));
}
