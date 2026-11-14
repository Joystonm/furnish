/**
 * Asking the model for the room program, and refusing to pretend it answered.
 *
 * The API key lives on the server. This module sends the brief over and gets
 * back a `RoomProgram` — room sizes and which rooms must be next to each other
 * — and nothing else. It cannot receive a coordinate, an object id or a
 * validation override, because `server/program.ts` never offers those fields.
 *
 * The important part of this file is the failure path. Generate must work with
 * no model configured, and when it does it produces the same deterministic plan
 * it always produced. The danger is not that fallback — it is a user reading
 * "Planned 1 storey with 8 rooms" and believing a model designed it. So every
 * failure returns a *reason*, and the caller is expected to say it out loud.
 */
import { parseProgram, reviewProgram, type RoomProgram } from '../model/program.ts';
import type { DesignBrief } from '../model/types.ts';

/**
 * The outcome of asking the model to plan, including the honest reasons it may
 * not have. `planned` is false whenever the model did not choose these rooms.
 */
export type ProgramOutcome =
  | {
      /** The model planned this. `program` was placed by the packer. */
      planned: true;
      program: RoomProgram;
      /** One line from the model on the shape of the design, for the user. */
      summary: string | undefined;
      /** Non-fatal notes from parsing and reviewing the program: a dangling
       *  `touches`, an absurd area, a field the model left out and that was
       *  repaired. The program is still used, and the user is told what was
       *  changed — a plan that arrived altered and said nothing about it would
       *  be a plan the model never actually wrote. */
      warnings: string[];
    }
  | {
      /** The model did not plan this, and here is exactly why. */
      planned: false;
      /**
       * A sentence for the user, naming the cause. Never empty, never vague:
       * "something went wrong" is exactly the message that lets a fallback
       * pass for a design.
       */
      reason: string;
      /** True when no API key is configured, as opposed to a call that failed. */
      unconfigured: boolean;
    };

/** What the server sent back, before any of it is believed. */
interface ProgramResponse {
  program?: unknown;
  error?: string;
}

/**
 * Ask MiniMax to plan the rooms for this brief.
 *
 * Resolves to a `ProgramOutcome`; it does not throw. A Generate button that can
 * fail shut is a Generate button that sometimes does nothing, and the honest
 * fallback is always available.
 */
export async function requestRoomProgram(brief: DesignBrief, signal?: AbortSignal): Promise<ProgramOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/room-program', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        plot: brief.plot,
        floorCount: brief.floorCount,
        rooms: brief.rooms,
        style: brief.style,
        preferences: brief.preferences,
        notes: brief.notes ?? null,
      }),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      planned: false,
      unconfigured: false,
      reason: `The plan request never reached the server (${e instanceof Error ? e.message : 'network error'}).`,
    };
  }

  const body = (await res.json().catch(() => ({}))) as ProgramResponse;

  if (!res.ok) {
    // 503 is the server saying there is no key. It is the one failure a user
    // can fix themselves, so it is worth separating from a bad response.
    const unconfigured = res.status === 503;
    return {
      planned: false,
      unconfigured,
      reason: unconfigured
        ? 'MiniMax is not configured on the server, so no model planned this layout.'
        : body.error ?? `The plan request failed with HTTP ${res.status}.`,
    };
  }

  // The server forwards what the model returned without checking its shape.
  // `parseProgram` is the same closed-set check the app applies to everything
  // else a model produces: unknown room kinds, invented ids, duplicate names
  // and nonsense areas are all refusals rather than silent defaults.
  const parsed = parseProgram(body.program);
  if (!parsed.ok) {
    return {
      planned: false,
      unconfigured: false,
      reason: `MiniMax returned a room program this studio could not use — ${parsed.error} Nothing was changed.`,
    };
  }

  // A program that asks for more floor than the envelope holds is refused here
  // for the same reason `reviewProgram` exists: the packer fills whatever box
  // it is given, so an over-large program lays out rooms that overlap.
  const review = reviewProgram(parsed.program, brief.plot, brief.floorCount);
  if (!review.ok) {
    return { planned: false, unconfigured: false, reason: review.error ?? 'The room program did not fit the plot.' };
  }

  return {
    planned: true,
    program: parsed.program,
    summary: parsed.program.summary,
    // Repairs first: they describe the program as it will now be used, which is
    // the thing the user is about to look at. The review warnings follow, and
    // describe the program as the model meant it. Leading with what is actually
    // on screen is the honest order.
    warnings: [...parsed.repairs, ...review.warnings],
  };
}
