/**
 * The sample house.
 *
 * One plan, defined once, that three different things use:
 *
 *   - the landing page's hero, so the marketing page illustrates a plan the
 *     studio really produces;
 *   - the studio's "load the sample plan", so anyone opening the app has a
 *     house to look at instead of an empty plot and a form;
 *   - the verification scripts, which need a plan they can rebuild exactly,
 *     so the checker can be run against a known geometry at any commit.
 *
 * The last one is why it lives in the model rather than in the interface. The
 * independent checker compares runs; a plan that changed every time it was
 * drawn could not be compared with anything.
 *
 * It is built by the same generator the studio calls, with no model involved:
 * `generateFromBrief` with no program packs the catalogue room sizes. That is
 * deliberate. The model plans a *different* house every time it is asked —
 * that is the point of asking a model — so a sample that depended on the
 * network could not be a sample at all.
 */
import { generateFromBrief } from './layout.ts';
import { DEFAULT_PLOT, emptyProject } from './ops.ts';
import type { DesignBrief, Project } from './types.ts';

/**
 * An 18 × 20 m plot, two storeys, and eleven rooms.
 *
 * The ground floor takes the living room, the kitchen, the dining room, the
 * utility and the storage; the floor above takes three bedrooms, three
 * bathrooms and the guest room. That is the same shape of house the model
 * produces when it is asked for a two-storey family home, and about the same
 * size — some 256 m² of rooms on a 360 m² plot, roughly 37% covered.
 *
 * The preferred areas are what the packer is asked for rather than what it
 * delivers: asked for less than the plot can hold, the packer enlarges the
 * rooms and then says so ("this plot has room to spare"). Asking for the sizes
 * this house actually ends up with keeps the sample honest — it draws with no
 * warning from the packer and none from the checker.
 */
export const SAMPLE_BRIEF: DesignBrief = {
  plot: { ...DEFAULT_PLOT, width: 18, depth: 20, setbacks: { ...DEFAULT_PLOT.setbacks } },
  floorCount: 2,
  rooms: [
    { kind: 'living', count: 1 },
    { kind: 'kitchen', count: 1 },
    { kind: 'dining', count: 1 },
    { kind: 'bedroom', count: 3 },
    { kind: 'bathroom', count: 3 },
    { kind: 'utility', count: 1 },
    { kind: 'storage', count: 1 },
    { kind: 'guest', count: 1 },
  ],
  preferredAreas: {
    living: 34,
    kitchen: 14,
    dining: 14,
    bedroom: 20,
    bathroom: 8,
    utility: 8,
    storage: 6,
    guest: 16,
  },
  style: 'contemporary',
  preferences: { accessibility: false, ventilation: true, privacy: false, daylight: true },
};

/** The name the sample carries in the app. */
export const SAMPLE_NAME = 'Sample house';

/**
 * Build the sample house.
 *
 * Returns the same shape the generator does, so a caller can tell a refusal
 * from a plan. Nothing here can fail for a reason a person can act on — the
 * brief is fixed and fits — but the generator still refuses plans that do not
 * fit, and that refusal must not be swallowed.
 *
 * The `reason` on the provenance is the point of the whole exercise: it is the
 * sentence the drawing carries to say that no model planned this house, in
 * plain words, for as long as the plan is open — rather than in a toast that
 * disappears.
 */
export function sampleProject() {
  return generateFromBrief(emptyProject(SAMPLE_NAME), SAMPLE_BRIEF, {
    provenanceNote: {
      reason: 'it is the sample house, drawn by the layout code with no model involved',
    },
  });
}

/** The sample house's rooms on one floor, for a caller that only needs them. */
export function sampleRoomsOn(project: Project, floorId: string) {
  return project.rooms.filter((room) => room.floorId === floorId);
}
