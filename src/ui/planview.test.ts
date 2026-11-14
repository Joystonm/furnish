import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { defaultBrief } from '../model/report';
import { generatePlan, STAIR_ID } from '../model/generator';
import type { Plan } from '../model/types';
import { PlanView } from './PlanView';

/**
 * The front door has to be legible on the drawing.
 *
 * The model knows which door is the front one — it is `kind: 'front'` — but
 * until the front door was marked, the drawing drew it exactly like every
 * other door. Nothing on the plan said which opening is the way in from the
 * street, so neither a person nor an agent looking at the drawing could tell.
 */

function plan(): Plan {
  const result = generatePlan(defaultBrief());
  if (!result.ok) throw new Error('The default brief did not draw a plan.');
  return result.plan;
}

function draw() {
  return renderToStaticMarkup(
    createElement(PlanView, {
      plan: plan(),
      floor: 0,
      flagged: new Set<string>(),
      selected: null,
      onSelect: () => {},
    }),
  );
}

describe('the front door on the drawing', () => {
  it('is marked once, and only once', () => {
    const markup = draw();
    const marks = markup.match(/data-testid="plan-front-door"/g) ?? [];
    expect(marks).toHaveLength(1);
  });

  it('says so in words on the drawing', () => {
    expect(draw()).toContain('FRONT DOOR');
  });

  it('marks the door the model calls the front one', () => {
    const front = plan().doors.filter((door) => door.kind === 'front');
    expect(front).toHaveLength(1);
    const markup = draw();
    expect(markup).toContain('data-door-id="' + front[0].id + '"');
    expect(markup).toContain('data-door-kind="front"');
  });

  it('leaves the internal doors unmarked', () => {
    const internal = plan().doors.filter((door) => door.kind !== 'front' && door.floor === 0);
    expect(internal.length).toBeGreaterThan(0);
    const markup = draw();
    for (const door of internal) {
      const at = markup.indexOf('data-door-id="' + door.id + '"');
      expect(at).toBeGreaterThan(-1);
      // The mark sits after the door's own group, so it must not be inside it.
      const groupEnd = markup.indexOf('</g>', at);
      expect(markup.slice(at, groupEnd)).not.toContain('plan-front-door');
    }
  });
});

/**
 * The door into the stairwell has to be visible too.
 *
 * The flight of stairs is as wide as the shaft it runs in, so when it was
 * drawn after the doors it painted over the doorway in the shaft's own wall.
 * The checker never noticed — the door is in the model — but the drawing did
 * not show it, and a person reading the plan could not see that the stair was
 * not walled off.
 */
describe('the door into the stairwell', () => {
  it('is drawn over the flight, not under it', () => {
    const stairDoor = plan().doors.find((door) => door.joins.includes(STAIR_ID) && door.floor === 0);
    expect(stairDoor).toBeDefined();
    const markup = draw();
    const flight = markup.indexOf('data-testid="plan-stair"');
    const doorway = markup.indexOf('data-door-id="' + stairDoor!.id + '"');
    expect(flight).toBeGreaterThan(-1);
    expect(doorway).toBeGreaterThan(flight);
  });

  it('is clear of the corner, so the opening reads as a doorway', () => {
    const stairwell = plan().rooms.find((room) => room.id === STAIR_ID);
    expect(stairwell).toBeDefined();
    const stairDoor = plan().doors.find((door) => door.joins.includes(STAIR_ID) && door.floor === 0);
    expect(stairDoor).toBeDefined();
    const south = stairwell!.y + stairwell!.depth;
    const reveal = south - (stairDoor!.y + stairDoor!.width / 2);
    expect(reveal).toBeGreaterThan(0.19);
  });
});

/**
 * The flight that arrives at an upper storey has to be drawn as a flight.
 *
 * The plan of an upper storey used to show the flight arriving there as an
 * empty dashed rectangle — the opening in the floor. That is honest about the
 * slab, but it does not show the flight, so anyone reading the upper plan
 * could not see where the stairs come from or which way they run.
 */
describe('the flight arriving at an upper storey', () => {
  function drawFloor(storey: number) {
    return renderToStaticMarkup(
      createElement(PlanView, {
        plan: plan(),
        floor: storey,
        flagged: new Set<string>(),
        selected: null,
        onSelect: () => {},
      }),
    );
  }

  it('is drawn on the storey it arrives at', () => {
    expect(drawFloor(1)).toContain('data-testid="plan-stair-arriving"');
  });

  it('shows its treads, and the way it comes', () => {
    const markup = drawFloor(1);
    const at = markup.indexOf('data-testid="plan-stair-arriving"');
    const group = markup.slice(at, markup.indexOf('</g>', at));
    expect(group).toContain('marker-end="url(#stair-arrow)"');
    expect(group.match(/stroke="#94a3b8"/g)?.length ?? 0).toBeGreaterThan(4);
  });

  it('and the storey it leaves still shows the flight it starts', () => {
    const markup = drawFloor(0);
    expect(markup).toContain('data-testid="plan-stair"');
  });
});
