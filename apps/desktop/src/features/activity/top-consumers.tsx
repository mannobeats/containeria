import { Link } from "@tanstack/react-router";

import { formatMemory, formatPercent } from "@/lib/format";
import { logoFor } from "@/lib/logos";
import { Meter } from "@/ui/progress";
import { Tile } from "@/ui/tile";

import type { Consumer } from "./model";

const GIB = 1024 ** 3;

const linkClass = "flex min-w-0 items-center gap-2 text-ink no-underline";

/** A pod's container opens its pod; any other container opens itself. */
function ConsumerLink({ consumer }: { consumer: Consumer }) {
  const [namespace, name] = consumer.pod?.split("/") ?? [];
  const label = (
    <>
      <Tile logo={logoFor(consumer.image)} />
      <span className="truncate">{consumer.name}</span>
    </>
  );
  if (namespace && name) {
    return (
      <Link
        to="/kubernetes/pods/$namespace/$name"
        params={{ namespace, name }}
        className={linkClass}
      >
        {label}
      </Link>
    );
  }
  return (
    <Link to="/containers/$id" params={{ id: consumer.id }} className={linkClass}>
      {label}
    </Link>
  );
}

/** Containers using the most memory right now. */
export function TopConsumers({ consumers }: { consumers: Consumer[] }) {
  return (
    <section className="mt-4 border-t-[0.5px] border-line px-5 pt-5 pb-8">
      <div className="mb-3.5 flex items-center gap-3">
        <h2 className="m-0 text-14 font-semibold text-ink">Top consumers</h2>
        <span className="text-12 text-ink-3">Running containers, by memory</span>
      </div>
      {consumers.length === 0 ? (
        <p className="m-0 text-13 text-ink-3">Nothing is running.</p>
      ) : (
        <table className="-mx-5 w-[calc(100%+40px)] border-separate border-spacing-0 text-13">
          <thead>
            <tr className="[&>th]:h-[30px] [&>th]:border-b-[0.5px] [&>th]:border-line [&>th]:px-2.5 [&>th]:text-left [&>th]:text-12 [&>th]:font-medium [&>th]:text-ink-3 [&>th:first-child]:pl-5 [&>th:last-child]:pr-5">
              <th>Name</th>
              <th>Project</th>
              <th className="w-[90px] text-right!">CPU</th>
              <th className="w-[160px] text-right!">Memory</th>
            </tr>
          </thead>
          <tbody>
            {consumers.map((consumer) => (
              <tr
                key={consumer.id}
                className="h-9 hover:bg-hover [&>td]:border-b-[0.5px] [&>td]:border-line [&>td]:px-2.5 [&>td:first-child]:pl-5 [&>td:last-child]:pr-5"
              >
                <td className="max-w-0">
                  <ConsumerLink consumer={consumer} />
                </td>
                <td className="text-ink-3">{consumer.group}</td>
                <td className="text-right tabular">{formatPercent(consumer.cpuPercent)}</td>
                <td>
                  <span className="flex items-center justify-end gap-2 tabular">
                    {formatMemory(consumer.memoryBytes)}
                    <Meter
                      value={consumer.memoryBytes / GIB}
                      tone={consumer.memoryBytes > GIB ? "warn" : "neutral"}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
