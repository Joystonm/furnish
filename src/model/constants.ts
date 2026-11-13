/**
 * The numbers the house is measured by.
 *
 * They live in one place because two different pieces of code need them: the
 * generator, which builds the plan, and the checker, which measures it. If
 * they each carried their own copy, the checker would be measuring the plan
 * against rules the plan was not built with.
 *
 * These are sanity bounds for early design, not the rules of any jurisdiction.
 */

/** How far the building sits back from the plot boundary. */
export const SETBACK = 1.5;
/** Floor to floor, in metres. */
export const STOREY_HEIGHT = 2.9;
/** A clear opening. */
export const DOOR_WIDTH = 0.9;
/** How much floor a person needs to stand on to use a door. */
export const DOOR_APPROACH = 0.9;
/** The width of the stair shaft, and of the flight inside it. */
export const STAIR_WIDTH = 1.4;
/** The depth of the flight in plan. */
export const STAIR_RUN = 3.0;
/** Riser height, in metres. */
export const RISER = 0.175;
/** A corridor is never narrower than this. */
export const MIN_CIRCULATION_WIDTH = 1.4;
