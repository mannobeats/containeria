import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";

import { plural } from "@/lib/format";
import { commands, type Severity, type Vulnerability } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Progress } from "@/ui/progress";
import { Segmented } from "@/ui/segmented";
import { Sheet } from "@/ui/sheet";

const SEVERITIES: { value: Severity; label: string; tone: "bad" | "warn" | "neutral" }[] = [
  { value: "critical", label: "Critical", tone: "bad" },
  { value: "high", label: "High", tone: "bad" },
  { value: "medium", label: "Medium", tone: "warn" },
  { value: "low", label: "Low", tone: "neutral" },
  { value: "unknown", label: "Unknown", tone: "neutral" },
];

type Filter = Severity | "all";

function filterOptions(found: Vulnerability[]) {
  return [
    { value: "all" as const, label: "All", count: found.length },
    ...SEVERITIES.filter((severity) => severity.value !== "unknown").map((severity) => ({
      value: severity.value,
      label: severity.label,
      count: found.filter((item) => item.severity === severity.value).length,
    })),
  ];
}

function Findings({ found }: { found: Vulnerability[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = found.filter((item) => filter === "all" || item.severity === filter);
  return (
    <>
      <Segmented label="Show" value={filter} onChange={setFilter} options={filterOptions(found)} />
      <ul aria-label="Vulnerabilities" className="m-0 mt-3 flex list-none flex-col p-0">
        {shown.map((item) => {
          const severity = SEVERITIES.find((candidate) => candidate.value === item.severity);
          return (
            <li
              key={`${item.id}-${item.package}`}
              className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-start gap-3 border-t-[0.5px] border-line py-2 first:border-t-0"
            >
              <Chip tone={severity?.tone ?? "neutral"}>{severity?.label}</Chip>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  {item.url ? (
                    <button
                      type="button"
                      onClick={() => openUrl(item.url ?? "").catch(() => undefined)}
                      className="font-mono text-mono-12 text-brand-ink"
                    >
                      {item.id}
                    </button>
                  ) : (
                    <span className="font-mono text-mono-12 text-ink">{item.id}</span>
                  )}
                  <span className="truncate text-12 text-ink-3">{item.target}</span>
                </div>
                {item.title ? (
                  <p className="m-0 mt-0.5 text-12 text-pretty text-ink-2">{item.title}</p>
                ) : null}
              </div>
              <div className="text-right text-12">
                <div className="font-medium text-ink">{item.package}</div>
                <div className="font-mono text-mono-12 text-ink-3">
                  {item.installed}
                  {item.fixed ? ` → ${item.fixed}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Summary({ found }: { found: Vulnerability[] }) {
  const fixable = found.filter((item) => item.fixed).length;
  if (found.length === 0) {
    return (
      <Banner tone="ok" className="mb-3">
        No known vulnerabilities in its packages.
      </Banner>
    );
  }
  return (
    <p className="m-0 mb-3 text-13 text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
      <b>{plural(found.length, "vulnerability", "vulnerabilities")}</b>, {fixable} with a fixed
      version available. Updating the base image usually fixes most of them.
    </p>
  );
}

type ScanSheetProps = { reference: string | null; onClose: () => void };

/** Scans an image with Trivy and lists what it finds, worst first. */
export function ScanSheet({ reference, onClose }: ScanSheetProps) {
  const scan = useQuery({
    queryKey: ["images", "scan", reference],
    queryFn: () => commands.imageScan(reference ?? ""),
    enabled: reference !== null,
    retry: false,
    staleTime: 10 * 60_000,
  });
  return (
    <Sheet
      open={reference !== null}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`Vulnerabilities in ${reference ?? ""}`}
      description="Found by Trivy in the image's OS packages and app dependencies."
      width="lg"
      footer={
        <>
          <Button
            className="mr-auto"
            disabled={scan.isFetching}
            onClick={() => scan.refetch().catch(() => undefined)}
          >
            Scan Again
          </Button>
          <Button variant="brand" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {scan.isFetching ? (
        <div className="flex flex-col gap-2 py-2">
          <Progress label="Scanning" />
          <p className="m-0 text-12 text-ink-3">
            Scanning… The first scan downloads Trivy and its vulnerability database, which takes a
            minute.
          </p>
        </div>
      ) : null}
      {scan.isError && !scan.isFetching ? (
        <Banner tone="bad">{errorMessage(scan.error)}</Banner>
      ) : null}
      {scan.data && !scan.isFetching ? (
        <>
          <Summary found={scan.data.vulnerabilities} />
          {scan.data.vulnerabilities.length > 0 ? (
            <Findings found={scan.data.vulnerabilities} />
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
