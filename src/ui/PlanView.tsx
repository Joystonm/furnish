import type { Door, Plan, Rect, Room, Stair } from '../model/types';
import { SETBACK } from '../model/generator';

interface Props {
  plan: Plan;
  floor: number;
  /** Rooms a finding is about, so they can be marked on the drawing. */
  flagged: Set<string>;
  selected: string | null;
  onSelect: (roomId: string | null) => void;
}

interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

const ROOM_FILL: Record<string, string> = {
  living: '#f8fafc',
  kitchen: '#f8fafc',
  dining: '#f8fafc',
  bedroom: '#f8fafc',
  bathroom: '#f8fafc',
  study: '#f8fafc',
  hall: '#f1f5f9',
};

const EPS = 0.02;

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/** The side of `room` that `other` stands against, if any. */
function sharedSide(room: Room, other: Room): 'north' | 'south' | 'east' | 'west' | null {
  if (Math.abs(other.x + other.width - room.x) < EPS) {
    if (overlap1d(room.y, room.y + room.depth, other.y, other.y + other.depth) > 0.05) return 'east';
  }
  if (Math.abs(room.x + room.width - other.x) < EPS) {
    if (overlap1d(room.y, room.y + room.depth, other.y, other.y + other.depth) > 0.05) return 'west';
  }
  if (Math.abs(other.y + other.depth - room.y) < EPS) {
    if (overlap1d(room.x, room.x + room.width, other.x, other.x + other.width) > 0.05) return 'south';
  }
  if (Math.abs(room.y + room.depth - other.y) < EPS) {
    if (overlap1d(room.x, room.x + room.width, other.x, other.x + other.width) > 0.05) return 'north';
  }
  return null;
}

/**
 * Every wall on the floor, drawn once.
 *
 * A wall between two rooms is drawn once, at the thickness of an internal
 * partition. A wall with nothing on the other side is an outside wall, and is
 * drawn thicker — which is how a plan says "you cannot walk through here"
 * without a single word.
 */
function walls(rooms: Room[]): Wall[] {
  const drawn = new Set<string>();
  const walls: Wall[] = [];

  const add = (x1: number, y1: number, x2: number, y2: number, width: number) => {
    const key = [x1, y1, x2, y2].map((n) => Math.round(n * 100)).join(':');
    if (drawn.has(key)) return;
    drawn.add(key);
    walls.push({ x1, y1, x2, y2, width });
  };

  for (const room of rooms) {
    const others = rooms.filter((r) => r.id !== room.id);
    const east = others.some((o) => sharedSide(room, o) === 'east');
    const west = others.some((o) => sharedSide(room, o) === 'west');
    const north = others.some((o) => sharedSide(room, o) === 'north');
    const south = others.some((o) => sharedSide(room, o) === 'south');

    add(room.x, room.y, room.x + room.width, room.y, north ? 0.16 : 0.3);
    add(room.x, room.y + room.depth, room.x + room.width, room.y + room.depth, south ? 0.16 : 0.3);
    add(room.x, room.y, room.x, room.y + room.depth, west ? 0.16 : 0.3);
    add(room.x + room.width, room.y, room.x + room.width, room.y + room.depth, east ? 0.16 : 0.3);
  }

  return walls;
}

function doorGlyph(door: Door, plan: Plan) {
  const half = door.width / 2;
  const near =
    plan.rooms.find((r) => r.id === door.joins[0]) ?? plan.rooms.find((r) => r.id === door.joins[1]);

  if (door.axis === 'vertical') {
    const east = near ? near.x + near.width / 2 >= door.x : true;
    const sign = east ? 1 : -1;
    return {
      gap: { x: door.x - 0.14, y: door.y - half, width: 0.28, depth: door.width },
      leaf: {
        x1: door.x,
        y1: door.y + half,
        x2: door.x + sign * door.width,
        y2: door.y + half,
      },
      arc: `M ${door.x} ${door.y - half} A ${door.width} ${door.width} 0 0 ${sign > 0 ? 1 : 0} ${
        door.x + sign * door.width
      } ${door.y + half}`,
    };
  }

  const south = near ? near.y + near.depth / 2 >= door.y : true;
  const sign = south ? 1 : -1;
  return {
    gap: { x: door.x - half, y: door.y - 0.14, width: door.width, depth: 0.28 },
    leaf: { x1: door.x + half, y1: door.y, x2: door.x + half, y2: door.y + sign * door.width },
    arc: `M ${door.x - half} ${door.y} A ${door.width} ${door.width} 0 0 ${sign > 0 ? 0 : 1} ${door.x + half} ${
      door.y + sign * door.width
    }`,
  };
}

/**
 * The flight, drawn where it actually is.
 *
 * On the storey the flight starts from it is a flight: treads and a line
 * showing which way you go. On the storey it arrives at, it is an opening —
 * the floor is not there, and the drawing has to say so.
 */
function StairGlyph({ stair, mode }: { stair: Stair; mode: 'up' | 'void' }) {
  const top = stair.y + stair.flightOffset;
  const treads = 9;
  const lines = [];
  for (let i = 1; i < treads; i++) {
    const t = i / treads;
    const y = stair.direction === 1 ? top + stair.flightRun * t : top + stair.flightRun * (1 - t);
    lines.push(
      <line
        key={i}
        x1={stair.x}
        y1={y}
        x2={stair.x + stair.width}
        y2={y}
        stroke="#94a3b8"
        strokeWidth={0.06}
      />,
    );
  }
  const midX = stair.x + stair.width / 2;
  const fromY = stair.direction === 1 ? top + stair.flightRun * 0.25 : top + stair.flightRun * 0.75;
  const toY = stair.direction === 1 ? top + stair.flightRun * 0.75 : top + stair.flightRun * 0.25;

  if (mode === 'void') {
    return (
      <g data-testid="plan-stair-void" data-stair-id={stair.id}>
        <rect
          x={stair.x}
          y={top}
          width={stair.width}
          height={stair.flightRun}
          fill="#e2e8f0"
          stroke="#64748b"
          strokeWidth={0.08}
          strokeDasharray="0.2 0.16"
        />
      </g>
    );
  }

  return (
    <g data-testid="plan-stair" data-stair-id={stair.id} data-risers={stair.risers}>
      <rect
        x={stair.x}
        y={top}
        width={stair.width}
        height={stair.flightRun}
        fill="#f1f5f9"
        stroke="#64748b"
        strokeWidth={0.08}
      />
      {lines}
      <line
        x1={midX}
        y1={fromY}
        x2={midX}
        y2={toY}
        stroke="#0d9488"
        strokeWidth={0.1}
        markerEnd="url(#stair-arrow)"
      />
    </g>
  );
}

export function PlanView({ plan, floor, flagged, selected, onSelect }: Props) {
  const { plotWidth, plotDepth } = plan.brief;
  const rooms = plan.rooms.filter((r) => r.floor === floor || r.spans?.includes(floor) === true);
  const doors = plan.doors.filter((d) => d.floor === floor);
  const stairs = plan.stairs.filter((s) => s.floor === floor || s.toFloor === floor);
  const furniture = plan.furniture.filter((f) => f.floor === floor);
  const segments = walls(rooms);

  const northPoint = { x: plotWidth - 1.1, y: 1.4 };
  const scaleStart = { x: 0.8, y: plotDepth - 0.75 };

  return (
    <div className="plan" data-testid="plan">
      <svg
        data-testid="plan-svg"
        data-floor={floor}
        viewBox={`-0.6 -0.6 ${plotWidth + 1.2} ${plotDepth + 1.2}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Floor plan, storey ${floor + 1}`}
      >
        <defs>
          <marker
            id="stair-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0d9488" />
          </marker>
        </defs>

        {/* the plot */}
        <rect
          x={0}
          y={0}
          width={plotWidth}
          height={plotDepth}
          fill="#f1f3f6"
          stroke="#cbd3dd"
          strokeWidth={0.08}
          strokeDasharray="0.5 0.35"
          data-testid="plot-boundary"
        />

        {/* the setback line */}
        <rect
          x={SETBACK}
          y={SETBACK}
          width={plotWidth - 2 * SETBACK}
          height={plotDepth - 2 * SETBACK}
          fill="none"
          stroke="#d7dde4"
          strokeWidth={0.05}
          strokeDasharray="0.3 0.3"
        />

        {/* the rooms */}
        {rooms.map((room) => {
          const isFlagged = flagged.has(room.id);
          const isSelected = selected === room.id;
          const area = room.width * room.depth;
          return (
            <g
              key={room.id}
              data-testid="plan-room"
              data-room-id={room.id}
              data-room-label={room.label}
              data-room-kind={room.kind}
              data-room-area={area.toFixed(2)}
              data-room-width={room.width.toFixed(2)}
              data-room-depth={room.depth.toFixed(2)}
              data-has-finding={isFlagged ? 'true' : 'false'}
              onClick={() => onSelect(room.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={room.x}
                y={room.y}
                width={room.width}
                height={room.depth}
                fill={isFlagged ? '#fef2f2' : (ROOM_FILL[room.kind] ?? '#f8fafc')}
                stroke="none"
              />
              {isSelected ? (
                <rect
                  x={room.x + 0.05}
                  y={room.y + 0.05}
                  width={Math.max(0, room.width - 0.1)}
                  height={Math.max(0, room.depth - 0.1)}
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth={0.09}
                />
              ) : null}
              {room.width > 1.6 && room.depth > 1.1 ? (
                <>
                  <text
                    x={room.x + room.width / 2}
                    y={room.y + room.depth / 2 - 0.05}
                    textAnchor="middle"
                    fontSize={0.42}
                    fill="#0f172a"
                    fontWeight={600}
                    pointerEvents="none"
                  >
                    {room.label}
                  </text>
                  <text
                    x={room.x + room.width / 2}
                    y={room.y + room.depth / 2 + 0.45}
                    textAnchor="middle"
                    fontSize={0.34}
                    fill="#64748b"
                    pointerEvents="none"
                  >
                    {area.toFixed(1)} m²
                  </text>
                </>
              ) : null}
            </g>
          );
        })}

        {/* the walls */}
        {segments.map((wall, i) => (
          <line
            key={`w${i}`}
            x1={wall.x1}
            y1={wall.y1}
            x2={wall.x2}
            y2={wall.y2}
            stroke="#1e293b"
            strokeWidth={wall.width}
            strokeLinecap="square"
          />
        ))}

        {/* the doors */}
        {doors.map((door) => {
          const glyph = doorGlyph(door, plan);
          const isFront = door.kind === 'front';
          return (
            <g key={door.id} data-testid="plan-door" data-door-id={door.id} data-door-kind={door.kind}>
              <rect
                x={glyph.gap.x}
                y={glyph.gap.y}
                width={glyph.gap.width}
                height={glyph.gap.depth}
                fill="#ffffff"
              />
              <path
                d={glyph.arc}
                fill="none"
                stroke={isFront ? '#0d9488' : '#94a3b8'}
                strokeWidth={isFront ? 0.07 : 0.05}
              />
              <line
                x1={glyph.leaf.x1}
                y1={glyph.leaf.y1}
                x2={glyph.leaf.x2}
                y2={glyph.leaf.y2}
                stroke={isFront ? '#0d9488' : '#0f172a'}
                strokeWidth={isFront ? 0.12 : 0.09}
              />
              {isFront ? (
                <g data-testid="plan-front-door">
                  {/* an arrow in from the street, and a word on it */}
                  <path
                    d={`M ${door.x} ${door.y - 0.06} L ${door.x - 0.14} ${door.y + 0.26} L ${door.x + 0.14} ${
                      door.y + 0.26
                    } Z`}
                    fill="#0d9488"
                  />
                  <text
                    x={door.x}
                    y={door.y + 0.72}
                    textAnchor="middle"
                    fontSize={0.36}
                    fontWeight={700}
                    fill="#0f766e"
                  >
                    FRONT DOOR
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}

        {/* the stairs */}
        {stairs.map((stair) => (
          <StairGlyph
            key={`${stair.id}-${stair.floor === floor ? 'up' : 'void'}`}
            stair={stair}
            mode={stair.floor === floor ? 'up' : 'void'}
          />
        ))}

        {/* the furniture */}
        {furniture.map((item) => (
          <rect
            key={item.id}
            x={item.x}
            y={item.y}
            width={item.width}
            height={item.depth}
            fill="#e2e8f0"
            stroke="#94a3b8"
            strokeWidth={0.05}
            rx={0.06}
            data-testid="plan-furniture"
            data-furniture-id={item.id}
            data-furniture-label={item.label}
          />
        ))}

        {/* north point */}
        <g data-testid="north-point">
          <circle cx={northPoint.x} cy={northPoint.y} r={0.62} fill="#ffffff" stroke="#cbd3dd" strokeWidth={0.05} />
          <path d={`M ${northPoint.x} ${northPoint.y - 0.5} L ${northPoint.x + 0.22} ${northPoint.y + 0.32} L ${northPoint.x} ${northPoint.y + 0.12} L ${northPoint.x - 0.22} ${northPoint.y + 0.32} Z`} fill="#0f172a" />
          <text x={northPoint.x} y={northPoint.y + 0.58} textAnchor="middle" fontSize={0.34} fill="#475569">
            N
          </text>
        </g>

        {/* scale bar */}
        <g data-testid="scale-bar">
          <line
            x1={scaleStart.x}
            y1={scaleStart.y}
            x2={scaleStart.x + 2}
            y2={scaleStart.y}
            stroke="#0f172a"
            strokeWidth={0.07}
          />
          <line x1={scaleStart.x} y1={scaleStart.y - 0.12} x2={scaleStart.x} y2={scaleStart.y + 0.12} stroke="#0f172a" strokeWidth={0.07} />
          <line x1={scaleStart.x + 1} y1={scaleStart.y - 0.09} x2={scaleStart.x + 1} y2={scaleStart.y + 0.09} stroke="#0f172a" strokeWidth={0.05} />
          <line x1={scaleStart.x + 2} y1={scaleStart.y - 0.12} x2={scaleStart.x + 2} y2={scaleStart.y + 0.12} stroke="#0f172a" strokeWidth={0.07} />
          <text x={scaleStart.x} y={scaleStart.y + 0.45} fontSize={0.34} fill="#475569">
            0
          </text>
          <text x={scaleStart.x + 2} y={scaleStart.y + 0.45} fontSize={0.34} fill="#475569" textAnchor="middle">
            2 m
          </text>
        </g>
      </svg>
    </div>
  );
}

export type { Rect };
