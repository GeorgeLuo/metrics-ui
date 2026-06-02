/**
 * Returns the obstacle set remembered by the chaser's map memory.
 */
export function getRememberedObstacles(knowledgeBase: Record<string, any> | null | undefined) {
  return knowledgeBase?.memory?.abstracted?.mapShape?.obstacles ?? { walls: [] };
}
