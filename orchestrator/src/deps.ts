/**
 * deps.ts — Dependency graph: topological sort with cycle detection
 *
 * Uses Kahn's algorithm to produce batches of sessions that can
 * start in parallel. Sessions within the same batch have no
 * inter-dependencies and are tie-broken by priority.
 */

import type { SessionConfig, DepBatch } from "./types.js";

/** Error thrown when a dependency cycle is detected */
export class CycleError extends Error {
  constructor(public cycle: string[]) {
    super(`Dependency cycle detected: ${cycle.join(" → ")}`);
    this.name = "CycleError";
  }
}

/**
 * Compute startup order using Kahn's topological sort.
 * Returns batches: all sessions in batch[0] can start in parallel,
 * then batch[1] after batch[0] is running, etc.
 *
 * Only includes enabled sessions. Within each batch, sessions are
 * sorted by priority (lower = first).
 */
export function computeStartupOrder(sessions: SessionConfig[]): DepBatch[] {
  const enabled = sessions.filter((s) => s.enabled);
  const nameSet = new Set(enabled.map((s) => s.name));

  // Build adjacency list and in-degree map
  // Edge: dependency → dependent (dep must start before dependent)
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const s of enabled) {
    adj.set(s.name, []);
    inDegree.set(s.name, 0);
  }

  for (const s of enabled) {
    for (const dep of s.depends_on) {
      if (!nameSet.has(dep)) continue; // skip refs to disabled/unknown sessions
      adj.get(dep)!.push(s.name);
      inDegree.set(s.name, (inDegree.get(s.name) ?? 0) + 1);
    }
  }

  // Kahn's algorithm — BFS by layers (batches)
  const batches: DepBatch[] = [];
  const processed = new Set<string>();

  // Seed: nodes with in-degree 0
  let queue = enabled
    .filter((s) => (inDegree.get(s.name) ?? 0) === 0)
    .map((s) => s.name);

  let depth = 0;

  while (queue.length > 0) {
    // Sort this batch by priority
    const byPriority = new Map(enabled.map((s) => [s.name, s.priority]));
    queue.sort((a, b) => (byPriority.get(a) ?? 10) - (byPriority.get(b) ?? 10));

    batches.push({ depth, sessions: [...queue] });

    const nextQueue: string[] = [];

    for (const name of queue) {
      processed.add(name);
      for (const dependent of adj.get(name) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          nextQueue.push(dependent);
        }
      }
    }

    queue = nextQueue;
    depth++;
  }

  // Cycle detection: if not all nodes were processed, there's a cycle
  if (processed.size < enabled.length) {
    const remaining = enabled
      .filter((s) => !processed.has(s.name))
      .map((s) => s.name);
    throw new CycleError(remaining);
  }

  return batches;
}

/**
 * Compute shutdown order — reverse of startup order.
 * Dependents stop before their dependencies.
 */
export function computeShutdownOrder(sessions: SessionConfig[]): DepBatch[] {
  const startOrder = computeStartupOrder(sessions);
  return startOrder.reverse().map((batch, i) => ({
    ...batch,
    depth: i,
  }));
}

/**
 * Get all transitive dependencies for a given session.
 * Used to determine what must be started when starting a single session.
 */
export function getTransitiveDeps(sessionName: string, sessions: SessionConfig[]): string[] {
  const byName = new Map(sessions.map((s) => [s.name, s]));
  const visited = new Set<string>();
  const result: string[] = [];

  function walk(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const session = byName.get(name);
    if (!session) return;
    for (const dep of session.depends_on) {
      walk(dep);
    }
    result.push(name);
  }

  walk(sessionName);
  // Remove the session itself from its deps list (it's the target, not a dep)
  return result.filter((n) => n !== sessionName);
}

/**
 * Get all transitive dependents — sessions that depend on this one.
 * Used to determine what must be stopped when stopping a single session.
 */
export function getTransitiveDependents(sessionName: string, sessions: SessionConfig[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function walk(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    // Find all sessions that list `name` in their depends_on
    for (const s of sessions) {
      if (s.depends_on.includes(name)) {
        walk(s.name);
      }
    }
    result.push(name);
  }

  walk(sessionName);
  return result.filter((n) => n !== sessionName);
}
