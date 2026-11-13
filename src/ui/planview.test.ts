import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { defaultBrief } from '../model/report';
import { generatePlan } from '../model/generator';
import { PlanView } from './PlanView';

/**
 * The front door has to be legible on the drawing.
 *
 * The model knows which door is the front one — it is `kind: 'front'` — but
 * until the front door was marked, the drawing drew it exactly like every
 * other door. Nothing on the plan said which opening is the way in from the
 * street, so neither a person nor an agent looking at the drawing could tell.
 */

function draw() {
  const brief = defaultBrief();
  const result = generatePlan(brief);
  if (!result.ok) throw new Error('The default brief did not draw a plan.');
  return renderToStaticMarkup(
    createElement(PlanView, {
      plan: result.plan,
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
    const brief = defaultBrief();
    const result = generatePlan(brief);
    if (!result.ok) throw new Error('The default brief did not draw a plan.');
    const front = result.plan.doors.filter((door) => door.kind === 'front');
    expect(front).toHaveLength(1);
    const markup = draw();
    expect(markup).toContain('data-door-id="' + front[0].id + '"');
    expect(markup).toContain('data-door-kind="front"');
  });

  it('leaves the internal doors unmarked', () => {
    const brief = defaultBrief();
    const result = generatePlan(brief);
    if (!result.ok) throw new Error('The default brief did not draw a plan.');
    const internal = result.plan.doors.filter((door) => door.kind !== 'front' && door.floor === 0);
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
