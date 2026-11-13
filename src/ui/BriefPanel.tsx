import type { BriefRoom, Refusal } from '../model/types';

interface Props {
  text: string;
  onTextChange: (text: string) => void;
  plotWidth: number;
  plotDepth: number;
  onPlotChange: (width: number, depth: number) => void;
  storeys: number;
  onStoreysChange: (storeys: number) => void;
  program: BriefRoom[];
  onProgramChange: (rooms: BriefRoom[]) => void;
  onGenerate: () => void;
  refusal: Refusal | null;
  canGenerate: boolean;
}

export function BriefPanel(props: Props) {
  const {
    text,
    onTextChange,
    plotWidth,
    plotDepth,
    onPlotChange,
    storeys,
    onStoreysChange,
    program,
    onProgramChange,
    onGenerate,
    refusal,
    canGenerate,
  } = props;

  const total = program.reduce((sum, room) => sum + room.area, 0);

  const update = (id: string, patch: Partial<BriefRoom>) => {
    onProgramChange(program.map((room) => (room.id === id ? { ...room, ...patch } : room)));
  };

  const remove = (id: string) => {
    onProgramChange(program.filter((room) => room.id !== id));
  };

  const add = () => {
    const n = program.length + 1;
    onProgramChange([
      ...program,
      {
        id: `r${Date.now().toString(36)}`,
        label: `Room ${n}`,
        kind: 'bedroom',
        area: 10,
        floor: 0,
      },
    ]);
  };

  return (
    <>
      <section className="panel">
        <h2 className="panel__title">The brief</h2>
        <label className="field">
          <span className="field__label">What do you want to build?</span>
          <textarea
            className="input"
            data-testid="brief-text"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">Plot</span>
          <div className="field__row">
            <input
              className="input input--number"
              data-testid="plot-width"
              type="number"
              min={4}
              max={60}
              step={0.5}
              value={plotWidth}
              onChange={(event) => onPlotChange(Number(event.target.value), plotDepth)}
              aria-label="Plot width in metres"
            />
            <input
              className="input input--number"
              data-testid="plot-depth"
              type="number"
              min={4}
              max={60}
              step={0.5}
              value={plotDepth}
              onChange={(event) => onPlotChange(plotWidth, Number(event.target.value))}
              aria-label="Plot depth in metres"
            />
            <select
              className="input"
              data-testid="storeys"
              value={storeys}
              onChange={(event) => onStoreysChange(Number(event.target.value))}
              aria-label="Number of storeys"
            >
              <option value={1}>1 storey</option>
              <option value={2}>2 storeys</option>
              <option value={3}>3 storeys</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--block"
          data-testid="generate"
          onClick={onGenerate}
          disabled={!canGenerate}
        >
          Generate the plan
        </button>
        {refusal ? (
          <div className="refusal" data-testid="refusal" style={{ marginTop: 12 }}>
            <div className="refusal__title">{refusal.reason}</div>
            <div className="refusal__detail">{refusal.detail}</div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel__title">
          The program
          <button type="button" className="btn btn--small" data-testid="add-room" onClick={add}>
            Add
          </button>
        </h2>
        <div className="program" data-testid="program">
          {program.map((room) => (
            <div className="program__row" key={room.id} data-testid="program-room" data-room-label={room.label}>
              <span className="program__name" title={room.label}>
                {room.label}
              </span>
              <input
                className="program__area"
                type="number"
                min={1}
                max={80}
                step={0.5}
                value={room.area}
                aria-label={`Area of ${room.label} in square metres`}
                onChange={(event) => update(room.id, { area: Number(event.target.value) })}
              />
              <select
                className="program__floor"
                value={room.floor}
                aria-label={`Storey for ${room.label}`}
                onChange={(event) => update(room.id, { floor: Number(event.target.value) })}
              >
                {Array.from({ length: storeys }, (_, index) => (
                  <option key={index} value={index}>
                    {index === 0 ? 'Ground' : `Floor ${index + 1}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="program__drop"
                aria-label={`Remove ${room.label}`}
                onClick={() => remove(room.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="program__total">
          <span>Total</span>
          <span data-testid="program-total">{total.toFixed(1)} m²</span>
        </div>
      </section>
    </>
  );
}
