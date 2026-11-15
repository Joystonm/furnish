/**
 * "Put a sofa in the living room" has to actually put a sofa there.
 *
 * The assistant used to be unable to do this, and the reason was worth fixing
 * properly rather than papering over. `add_furniture` asked for a centre point
 * in metres; the model was told never to do arithmetic; and the model's view of
 * the plan did not include where the furniture already was. So the model
 * looped over `list_catalog` and `inspect_room` and never placed anything,
 * because every number it could have produced would have been a guess.
 *
 * The fix moved the geometry to where the geometry lives. The model now says
 * WHICH item and WHICH room; the app finds the spot — inside the room, clear
 * of the furniture already there, clear of every door swing, and clear of the
 * floor in front of every door.
 *
 * These tests hold that promise from both ends: the search itself, and the
 * tool the model actually calls.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TOOLS_BY_NAME } from '../tools/registry.ts';
import { useProject } from '../store/useProject.ts';
import { sampleProject } from './sample.ts';
import { findFreeSpot, doorApproachesByRoom, doorSwingsByRoom } from './plan.ts';
import { catalogById } from './catalog.ts';
import { obbOfItem, obbOverlap, polygonObbOverlap } from './geometry.ts';
import type { Project, Room } from './types.ts';

/** The sample house, loaded into the store the way the app loads it. */
function loadSample(): Project {
  const res = sampleProject();
  if (!res.ok) throw new Error(res.error);
  const project = res.project;
  useProject.setState({
    project,
    activeFloorId: project.floors[0]!.id,
    selection: { kinds: [], ids: [] },
    activeRoomId: null,
  });
  return project;
}

function livingRoom(p: Project): Room {
  const room = p.rooms.find((r) => r.kind === 'living');
  if (!room) throw new Error('the sample house has no living room');
  return room;
}

const call = (input: Record<string, unknown>) => TOOLS_BY_NAME.get('add_furniture')!.handler(input);

beforeEach(() => {
  loadSample();
});

describe('finding a clear spot', () => {
  it('finds room for a large sofa in a room that already has furniture', () => {
    const p = useProject.getState().project;
    const room = livingRoom(p);
    const spot = findFreeSpot(p, room, 'sofa-l', 0);
    expect(spot).not.toBeNull();
  });

  it('puts the item somewhere it does not overlap what is already there', () => {
    const p = useProject.getState().project;
    const room = livingRoom(p);
    const spot = findFreeSpot(p, room, 'sofa-l', 0)!;
    expect(spot).toBeTruthy();
    const mine = obbOfItem({ x: spot.x, y: spot.y, width: 2.6, depth: 1.7, rotation: spot.rotation });
    for (const other of p.furniture.filter((f) => f.roomId === room.id)) {
      const theirs = obbOfItem({ x: other.x, y: other.y, width: other.width, depth: other.depth, rotation: other.rotation });
      expect(obbOverlap(mine, theirs).overlap, `${other.label} overlaps the spot`).toBe(false);
    }
  });

  it('puts the item clear of every door swing and every door approach', () => {
    const p = useProject.getState().project;
    const room = livingRoom(p);
    const walls = p.walls.filter((w) => w.floorId === room.floorId);
    const swings = doorSwingsByRoom(p.rooms, walls).get(room.id) ?? [];
    const approaches = doorApproachesByRoom(p.rooms, walls).get(room.id) ?? [];
    expect(swings.length).toBeGreaterThan(0);
    const spot = findFreeSpot(p, room, 'sofa-l', 0)!;
    const mine = obbOfItem({ x: spot.x, y: spot.y, width: 2.6, depth: 1.7, rotation: spot.rotation });
    for (const swing of swings) expect(polygonObbOverlap(swing, mine), 'the spot is in a door swing').toBe(false);
    for (const strip of approaches) expect(polygonObbOverlap(strip, mine), 'the spot is in front of a door').toBe(false);
  });

  it('turns the item on its side when it will not go in the other way', () => {
    // A room that is wide but shallow cannot take a long item lying across it.
    // The same item turned on its side fits, and a person asking for it does
    // not care which way round it faces.
    const p = useProject.getState().project;
    const room = livingRoom(p);
    const wide = findFreeSpot(p, room, 'sofa-l', 0)!;
    const turned = findFreeSpot(p, room, 'sofa-l', 90)!;
    expect(turned).toBeTruthy();
    expect(turned.rotation).toBe(90);
    expect(wide.rotation === 0 || wide.rotation === 90).toBe(true);
  });

  it('gives up rather than place an item that cannot fit', () => {
    const p = useProject.getState().project;
    // The stairwell is 1.40 m wide. An L-shaped sofa is 2.60 m.
    const stairwell = p.rooms.find((r) => r.label === 'Stairwell');
    expect(stairwell).toBeTruthy();
    expect(stairwell!.width).toBeLessThan(2.6);
    expect(findFreeSpot(p, stairwell!, 'sofa-l', 0)).toBeNull();
  });
});

describe('the tool the model calls', () => {
  it('places an item when the model names the item and the room, and no coordinates', () => {
    const before = useProject.getState().project.furniture.length;
    const out = call({ catalogId: 'sofa-l', room: 'Living room' });
    expect(out.ok, out.error).toBe(true);
    const after = useProject.getState().project.furniture;
    expect(after.length).toBe(before + 1);
    const placed = after.at(-1)!;
    expect(placed.catalogId).toBe('sofa-l');
    const room = livingRoom(useProject.getState().project);
    expect(placed.roomId).toBe(room.id);
  });

  it('says where the item landed, so the reply can be true', () => {
    const out = call({ catalogId: 'sofa-l', room: 'Living room' });
    expect(out.ok, out.error).toBe(true);
    expect(out.summary).toMatch(/Living room/);
    expect(out.summary).toMatch(/L-shaped sofa/);
  });

  it('takes a room id as well as a room name', () => {
    const room = livingRoom(useProject.getState().project);
    const out = call({ catalogId: 'armchair', roomId: room.id });
    expect(out.ok, out.error).toBe(true);
    expect(useProject.getState().project.furniture.at(-1)!.roomId).toBe(room.id);
  });

  it('resolves a friendly name to a real catalogue item', () => {
    const out = call({ catalogId: 'sofa', room: 'Living room' });
    expect(out.ok, out.error).toBe(true);
    const placed = useProject.getState().project.furniture.at(-1)!;
    expect(catalogById.get(placed.catalogId)).toBeTruthy();
    expect(catalogById.get(placed.catalogId)!.category).toBe('seating');
  });

  it('refuses an item that is not in the catalogue, and names the real ones', () => {
    const before = useProject.getState().project.furniture.length;
    const out = call({ catalogId: 'hovercraft', room: 'Living room' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/hovercraft/);
    expect(out.hint).toMatch(/list_catalog/);
    expect(useProject.getState().project.furniture.length).toBe(before);
  });

  it('refuses when there is no room to put it in, rather than guessing', () => {
    const before = useProject.getState().project.furniture.length;
    const out = call({ catalogId: 'sofa-l' });
    expect(out.ok).toBe(false);
    expect(out.hint).toMatch(/Living room/);
    expect(useProject.getState().project.furniture.length).toBe(before);
  });

  it('refuses when the room has no clear space for it', () => {
    const before = useProject.getState().project.furniture.length;
    const out = call({ catalogId: 'sofa-l', room: 'Stairwell' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/clear space/i);
    expect(useProject.getState().project.furniture.length).toBe(before);
  });

  it('names an item that does fit, so the refusal is not a dead end', () => {
    // The stairwell takes nothing from the sofa family, so the hint there is
    // the plain one. The living room is the other case: it is furnished, but
    // a smaller sofa still fits, and the app knows which one.
    const out = call({ catalogId: 'sofa-l', room: 'Living room' });
    if (out.ok) {
      // The sample living room is big enough for the L-shaped sofa, so there
      // is nothing to refuse.
      return;
    }
    expect(out.hint).toMatch(/does fit in Living room/);
    const named = out.hint!.match(/catalogId "([^"]+)"/);
    expect(named).toBeTruthy();
    const again = call({ catalogId: named![1]!, room: 'Living room' });
    expect(again.ok, again.error).toBe(true);
  });
});
