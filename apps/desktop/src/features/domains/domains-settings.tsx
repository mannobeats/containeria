import type { DomainsStatus } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { FieldRow } from "@/ui/field";
import { Switch } from "@/ui/switch";

import { useCertificate, useResolver, useSetDomainsEnabled } from "./api";

/** How names reach Containeria, and how to undo each change it made to the Mac. */
export function DomainsSettings({ status }: { status: DomainsStatus }) {
  const enable = useSetDomainsEnabled();
  const resolver = useResolver();
  const certificate = useCertificate();
  const ports = status.ports;
  return (
    <section className="max-w-[640px] px-5 pt-7 pb-12">
      <h2 className="m-0 mb-2.5 text-14 font-semibold text-ink">Name resolution</h2>
      <FieldRow
        label="Domains"
        hint="Turning domains off stops the DNS server and the proxy. Routes are kept."
      >
        <Switch
          checked={status.enabled}
          onCheckedChange={(enabled) => enable.mutate(enabled)}
          label="Domains"
        />
      </FieldRow>
      <FieldRow label="Top-level domain" hint="Resolved by Containeria's DNS on this Mac only.">
        <span className="font-mono text-mono-13 text-ink">.{status.tld}</span>
      </FieldRow>
      <FieldRow
        label="Listening on"
        hint="80 and 443 when they're free; otherwise 7080 and 7443, and URLs include the port."
      >
        <span className="text-ink tabular">
          {ports ? `HTTP ${ports.http} · HTTPS ${ports.https} · DNS ${ports.dns}` : "Starting…"}
        </span>
      </FieldRow>
      {status.resolver === "installed" ? (
        <FieldRow
          label="Resolver file"
          hint={`/etc/resolver/${status.tld} sends these names to Containeria.`}
        >
          <Button
            size="sm"
            loading={resolver.uninstall.isPending}
            onClick={() => resolver.uninstall.mutate()}
          >
            Remove
          </Button>
        </FieldRow>
      ) : null}
      {status.caTrusted ? (
        <FieldRow
          label="Local certificate"
          hint="Browsers warn on https:// links again until you trust it."
        >
          <Button
            size="sm"
            loading={certificate.untrust.isPending}
            onClick={() => certificate.untrust.mutate()}
          >
            Remove from Keychain
          </Button>
        </FieldRow>
      ) : null}
    </section>
  );
}
