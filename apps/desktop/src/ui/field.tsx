import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

import { inputClass } from "./input-class";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(inputClass, className)} {...props} />;
}

type FieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  htmlFor: string;
  children: ReactNode;
};

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-13 font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="m-0 text-12 text-bad-ink">
          {error}
        </p>
      ) : null}
      {hint && !error ? <p className="m-0 text-12 text-ink-3">{hint}</p> : null}
    </div>
  );
}

type FieldRowProps = { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode };

/** A settings row: label on the left, control and hint on the right. */
export function FieldRow({ label, hint, htmlFor, children }: FieldRowProps) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] items-start gap-4 border-t-[0.5px] border-line py-3 first:border-t-0">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="pt-[5px] text-13 text-ink">
          {label}
        </label>
      ) : (
        <span className="pt-[5px] text-13 text-ink">{label}</span>
      )}
      <div className="min-w-0">
        {children}
        {hint ? <p className="m-0 mt-1 text-12 text-ink-3">{hint}</p> : null}
      </div>
    </div>
  );
}
