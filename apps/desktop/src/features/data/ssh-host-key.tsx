import { IconShieldQuestion } from "@tabler/icons-react";

import type { SshTunnel } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";

import { useSshHostKey, useTrustHostKey } from "./api";

type HostKeyPromptProps = { ssh: SshTunnel; onTrusted: () => void; className: string };

/**
 * An SSH server seen for the first time: its key fingerprint to compare, and the choice to trust
 * it. Trusted keys go to Containeria's own known hosts, never `~/.ssh`.
 */
export function HostKeyPrompt({ ssh, onTrusted, className }: HostKeyPromptProps) {
  const key = useSshHostKey(ssh);
  const trust = useTrustHostKey();
  return (
    <Banner
      tone="warn"
      icon={<IconShieldQuestion className="size-4 shrink-0" aria-hidden />}
      className={className}
      action={
        <Button
          size="sm"
          disabled={!key.data}
          loading={trust.isPending}
          onClick={() => key.data && trust.mutate(key.data, { onSuccess: onTrusted })}
        >
          Trust and connect
        </Button>
      }
    >
      <b>{ssh.host} isn't a known SSH server.</b> Check that its key matches the one its
      administrator gave you before trusting it.
      {key.data ? (
        <span className="mt-1 block font-mono text-mono-12 break-all select-text">
          {key.data.algorithm} {key.data.fingerprint}
        </span>
      ) : (
        <span className="mt-1 block text-12">
          {key.isError ? errorMessage(key.error) : "Reading the server's key…"}
        </span>
      )}
    </Banner>
  );
}
