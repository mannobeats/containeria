import { useId } from "react";

import { Field, Input } from "@/ui/field";
import { Tile } from "@/ui/tile";

import { blankForm, type ConnectionForm } from "./connection-form";
import { ENGINE_CHOICES, engineLogo } from "./engines";
import { parseConnectionUrl } from "./model";

/** First step of a new connection: paste a URL, or pick the engine. */
export function EnginePicker({ onPick }: { onPick: (form: ConnectionForm) => void }) {
  const url = useId();
  const fromUrl = (text: string) => {
    const parsed = parseConnectionUrl(text);
    if (!parsed?.engine) {
      return;
    }
    const base = blankForm(parsed.engine);
    onPick({
      ...base,
      name: parsed.name ?? "",
      host: parsed.host ?? base.host,
      port: parsed.port ? String(parsed.port) : base.port,
      user: parsed.user ?? base.user,
      password: parsed.password ?? "",
      database: parsed.database ?? "",
      tls: parsed.tls ?? base.tls,
    });
  };
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="Paste a connection string"
        htmlFor={url}
        hint="Containeria fills in the form and picks the engine."
      >
        <Input
          id={url}
          className="font-mono text-mono-13"
          placeholder="postgres://user:password@host:5432/database?sslmode=require"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => fromUrl(event.target.value)}
        />
      </Field>
      <div>
        <p className="m-0 mb-2 text-12 font-medium text-ink-3">Or choose an engine</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
          {ENGINE_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => onPick(blankForm(choice.id))}
              className="flex flex-col items-center gap-2 rounded-lg bg-fill px-2 pt-3.5 pb-3 text-12 font-medium text-ink transition-[background-color,transform,box-shadow] duration-140 hover:bg-hover hover:shadow-[inset_0_0_0_1px_var(--brand-line)] active:scale-[0.97]"
            >
              <Tile logo={engineLogo(choice.engine, choice.provider)} icon="data" size="lg" />
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
