import { IconCheck, IconCircleCheck } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { enable as openAtLogin } from "@tauri-apps/plugin-autostart";
import clsx from "clsx";
import { useState } from "react";

import { usePreferences, useSetPreferences } from "@/features/settings/api";
import { Page } from "@/shell/page";
import { AppMark } from "@/ui/app-mark";
import { Button } from "@/ui/button";
import { Kbd } from "@/ui/kbd";

import { StepEngine } from "./step-engine";
import { StepImport } from "./step-import";
import { StepResources } from "./step-resources";

const STEPS = ["welcome", "resources", "engine", "import", "done"] as const;
type Step = (typeof STEPS)[number];
const NAMES: Record<Step, string> = {
  welcome: "Welcome",
  resources: "Resources",
  engine: "Engine",
  import: "Import",
  done: "Done",
};

function Steps({ current }: { current: Step }) {
  const at = STEPS.indexOf(current);
  return (
    <ol className="m-0 mb-10 flex list-none gap-1 p-0">
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === at ? "step" : undefined}
          className={clsx(
            "flex h-6 items-center gap-1 rounded-full px-2.5 text-12 font-medium [&_.tabler-icon]:size-3.5",
            index === at ? "bg-brand-soft text-brand-ink" : "text-ink-3",
          )}
        >
          {index < at ? <IconCheck aria-hidden /> : null}
          {NAMES[step]}
        </li>
      ))}
    </ol>
  );
}

function Hero({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <AppMark size={72} />
      <h1 className="m-0 mt-2 text-24 font-semibold tracking-[-0.016em] text-balance text-ink">
        {title}
      </h1>
      <p className="m-0 max-w-[52ch] text-14 text-pretty text-ink-2">{body}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}

/**
 * First launch: what Containeria is, the engine's size, creating it, and bringing images over.
 * Finishing it turns on Open at login, as Docker Desktop and OrbStack do; Settings turns it off.
 */
export function WelcomePage() {
  const [step, setStep] = useState<Step>("welcome");
  const navigate = useNavigate();
  const { data: preferences } = usePreferences();
  const setPreferences = useSetPreferences();
  const next = () => setStep(STEPS[STEPS.indexOf(step) + 1] ?? "done");
  const finish = () => {
    if (preferences) {
      setPreferences.mutate({ ...preferences, onboarded: true });
    }
    openAtLogin().catch(() => undefined);
    navigate({ to: "/containers" }).catch(() => undefined);
  };
  const skip = (
    <Button variant="ghost" size="sm" onClick={finish}>
      Skip setup
    </Button>
  );
  return (
    <Page
      crumbs={<b className="px-1 text-14 font-semibold text-ink">Set up Containeria</b>}
      tools={step === "done" ? null : skip}
    >
      <div className="flex flex-col items-center px-6 pt-7 pb-10">
        <Steps current={step} />
        <div className="w-full max-w-[560px] animate-rise">
          {step === "welcome" ? (
            <Hero
              title="Containers, Kubernetes and Linux on your Mac"
              body="Containeria runs them in one small virtual machine. It works with the docker CLI, Compose and every tool that expects them."
              action={
                <Button variant="brand" size="lg" onClick={next}>
                  Get started
                </Button>
              }
            />
          ) : null}
          {step === "resources" ? <StepResources onDone={next} /> : null}
          {step === "engine" ? <StepEngine onDone={next} /> : null}
          {step === "import" ? <StepImport onDone={next} /> : null}
          {step === "done" ? <Done onFinish={finish} /> : null}
        </div>
      </div>
    </Page>
  );
}

function Done({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <IconCircleCheck className="size-12 text-ok" aria-hidden />
      <h1 className="m-0 text-24 font-semibold tracking-[-0.016em] text-ink">You're set</h1>
      <p className="m-0 text-14 text-ink-2">
        The engine is running. Find any container or setting from the command palette.
      </p>
      <span className="flex gap-1">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </span>
      <Button size="lg" className="mt-4" onClick={onFinish}>
        Open Containeria
      </Button>
    </div>
  );
}
