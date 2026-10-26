// The velocities of dfntrans (`velocities.vtp`): one point for each sector of
// a node, with the node (the point of the mesh with the same number) and the
// velocity in m per time unit of the input. The mesh shows the mean speed of
// the sectors of each point, in m/s.
import { vectorMagnitudes } from "../flow/polyData";
import { dataArrayValues } from "../inputFiles";
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
export function nodeVelocityMagnitudes(velocitiesVtp: string, pointCount: number, timeUnit: TimeUnit): number[] {
  const nodes = dataArrayValues(velocitiesVtp, "node");
  const velocities = dataArrayValues(velocitiesVtp, "velocity");
  if (nodes === null || velocities === null) {
    throw new Error("the transport velocities have no node or velocity array");
  }
  const speeds = vectorMagnitudes(velocities);
  if (speeds.length !== nodes.length) {
    throw new Error(`the transport velocities have ${speeds.length} velocities for ${nodes.length} nodes`);
  }
  const sums = new Array<number>(pointCount).fill(0);
  const counts = new Array<number>(pointCount).fill(0);
  nodes.forEach((node, index) => {
    if (!Number.isInteger(node) || node < 0 || node >= pointCount) {
      throw new Error(`the transport velocities have the node ${node}, but the mesh has ${pointCount} points`);
    }
    sums[node] += speeds[index];
    counts[node] += 1;
  });
  const seconds = SECONDS_PER_TIME_UNIT[timeUnit];
  return sums.map((sum, point) => (counts[point] === 0 ? 0 : sum / counts[point] / seconds));
}
