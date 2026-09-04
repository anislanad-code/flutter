type Props = {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  value: string;
  onChange: (valeur: string) => void;
  erreur?: string;
  requis?: boolean;
};

export function ChampTexte({
  id,
  label,
  type = "text",
  autoComplete,
  value,
  onChange,
  erreur,
  requis = true,
}: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[length:var(--texte-sm)] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={requis}
        value={value}
        onChange={(evenement) => onChange(evenement.target.value)}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
        className="rounded border border-muted bg-paper px-3 py-2.5 text-[length:var(--texte-base)] text-ink outline-none focus-visible:border-zellige focus-visible:ring-2 focus-visible:ring-zellige/40"
      />
      {erreur ? (
        <p id={`${id}-erreur`} className="text-[length:var(--texte-sm)] text-danger">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
