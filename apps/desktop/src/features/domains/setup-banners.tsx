import { IconCertificate, IconRoute, IconShieldCheck } from "@tabler/icons-react";

import type { DomainsStatus } from "@/lib/ipc/bindings";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";

import { useCertificate, useResolver } from "./api";

/** The two one-time steps that need the user: name resolution and trusting the certificate. */
export function SetupBanners({ status }: { status: DomainsStatus }) {
  const resolver = useResolver();
  const certificate = useCertificate();
  return (
    <div className="flex flex-col gap-2 px-5 pb-4">
      {status.resolver === "installed" ? null : (
        <Banner
          tone="warn"
          icon={<IconRoute aria-hidden />}
          action={
            <Button
              size="sm"
              loading={resolver.install.isPending}
              onClick={() => resolver.install.mutate()}
            >
              Set up names
            </Button>
          }
        >
          <b>Your Mac doesn't know .{status.tld} names yet.</b> macOS asks for your password once,
          so Containeria can add one small file,{" "}
          <code className="font-mono text-mono-12">/etc/resolver/{status.tld}</code>, that sends
          these names to it.
        </Banner>
      )}
      {status.caTrusted ? (
        <Banner tone="ok" icon={<IconShieldCheck aria-hidden />}>
          <b>HTTPS is trusted.</b> The Containeria certificate authority is in your login keychain.
          It was created on this Mac and never leaves it.
        </Banner>
      ) : (
        <Banner
          tone="warn"
          icon={<IconCertificate aria-hidden />}
          action={
            <Button
              size="sm"
              loading={certificate.trust.isPending}
              onClick={() => certificate.trust.mutate()}
            >
              Trust certificate
            </Button>
          }
        >
          <b>Browsers warn on https:// links.</b> Trust the local certificate authority once. macOS
          asks you to confirm.
        </Banner>
      )}
    </div>
  );
}
