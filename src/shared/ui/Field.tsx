import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

interface FieldProps extends Omit<
  ComponentPropsWithRef<"input">,
  "id" | "aria-invalid" | "aria-describedby" | "children"
> {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error: string | null;
  readonly adornment?: ReactNode;
}

export function Field({ label, hint, error, adornment, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    error !== null ? errorId : hint === undefined ? undefined : hintId;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="input-wrap">
        <input
          {...input}
          id={id}
          className="input"
          aria-invalid={error !== null}
          aria-describedby={describedBy}
        />
        {adornment}
      </div>
      {error !== null && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
      {hint !== undefined && error === null && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
