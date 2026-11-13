/**
 * The floor in front of a door.
 *
 * A door is a hole, a leaf and the floor in front of it. The floor in front
 * of it is the part that gets blocked, so it is the part that is measured: a
 * rectangle one door-width wide and one door-width deep, on one side of the
 * wall.
 *
 * An interior door has two sides — you stand on the floor in front of it in
 * whichever room you are coming from — so it has two zones. The front door
 * has one, inside the house.
 *
 * The checker measures against these, and the generator places furniture
 * clear of them. They have to be the same zones, so they are computed here
 * once.
 */

import { DOOR_APPROACH } from './constants';
import type { Door, Rect, Room } from './types';

/**
 * The zone on the given room's side of the door.
 *
 * Returns null when the room is not one of the spaces the door joins.
 */
export function zoneOnSide(door: Door, room: Room): Rect | null {
  const half = door.width / 2;

  if (!door.joins.includes(room.id)) return null;

  if (door.axis === 'horizontal') {
    // The wall runs east–west, so the floor in front of it is north or south.
    const north = room.y + room.depth / 2 <= door.y;
    return {
      x: door.x - half,
      y: north ? door.y - DOOR_APPROACH : door.y,
      width: door.width,
      depth: DOOR_APPROACH,
    };
  }

  // The wall runs north–south, so the floor in front of it is east or west.
  const west = room.x + room.width / 2 <= door.x;
  return {
    x: west ? door.x - DOOR_APPROACH : door.x,
    y: door.y - half,
    width: DOOR_APPROACH,
    depth: door.width,
  };
}

/** Every zone of a door, one for each side it opens onto. */
export function doorZones(door: Door, rooms: Room[]): Rect[] {
  const zones: Rect[] = [];
  for (const room of rooms) {
    if (room.floor !== door.floor) continue;
    const zone = zoneOnSide(door, room);
    if (zone) zones.push(zone);
  }
  return zones;
}

/** The zones that fall inside one room. */
export function zonesInRoom(room: Room, doors: Door[]): Rect[] {
  const zones: Rect[] = [];
  for (const door of doors) {
    if (door.floor !== room.floor) continue;
    const zone = zoneOnSide(door, room);
    if (zone) zones.push(zone);
  }
  return zones;
}
