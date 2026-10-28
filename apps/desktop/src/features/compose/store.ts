import { Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { create } from "zustand";

import { queryClient } from "@/app/query-client";
import { queryKeys } from "@/app/query-keys";
import { notifyWhenAway } from "@/features/settings/api";
import { commands, type OutputEvent } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

import { type ComposeDraft, fileDraft } from "./model";

/** Lines repeat word for word ("Pulling"), so each gets its own number. */
export type OutputLine = { id: number; text: string };

/** A tool run whose output the run sheet shows. It keeps going when the sheet is hidden. */
export type ComposeRun = {
  /** Tells this run's events from those of a run it replaced. */
  id: number;
  title: string;
  /** Said in the toast when it worked, e.g. "shop is up". */
  done: string;
  lines: OutputLine[];
  status: "running" | "done" | "failed";
  message: string | null;
  /** The draft it deployed, to edit after a failure. */
  draft: ComposeDraft | null;
};

type ComposeState = {
  draft: ComposeDraft | null;
  run: ComposeRun | null;
  runVisible: boolean;
  edit: (draft: ComposeDraft) => void;
  /** Edits the open draft. */
  change: (patch: Partial<Pick<ComposeDraft, "text" | "name">>) => void;
  closeEditor: () => void;
  hideRun: () => void;
};

export const useCompose = create<ComposeState>((set) => ({
  draft: null,
  run: null,
  runVisible: false,
  edit: (draft) => set({ draft }),
  change: (patch) => set((state) => (state.draft ? { draft: { ...state.draft, ...patch } } : {})),
  closeEditor: () => set({ draft: null }),
  hideRun: () =>
    set((state) =>
      state.run?.status === "running" ? { runVisible: false } : { run: null, runVisible: false },
    ),
}));

const MAX_LINES = 2000;

let runs = 0;

function update(id: number, change: (run: ComposeRun) => Partial<ComposeRun>) {
  useCompose.setState((state) =>
    state.run?.id === id ? { run: { ...state.run, ...change(state.run) } } : {},
  );
}

/** Settles run `id` once: its channel and its command can both report the end. */
function finish(id: number, failure: string | null) {
  queryClient.invalidateQueries({ queryKey: queryKeys.containers }).catch(() => undefined);
  queryClient.invalidateQueries({ queryKey: queryKeys.images }).catch(() => undefined);
  const { run, runVisible } = useCompose.getState();
  if (run?.id !== id || run.status !== "running") {
    return;
  }
  update(id, () => ({ status: failure === null ? "done" : "failed", message: failure }));
  notifyWhenAway(failure === null ? run.done : `${run.title} failed`, failure).catch(
    () => undefined,
  );
  if (!runVisible) {
    if (failure === null) {
      toast.success(run.done);
    } else {
      toast.error(`${run.title} failed`, { description: failure });
    }
    useCompose.setState({ run: null });
  }
}

type RunStart = {
  title: string;
  done: string;
  draft?: ComposeDraft;
  start: (channel: Channel<OutputEvent>) => Promise<number>;
};

/** Starts a tool run (Compose, an image build or push) and shows its output. */
export function startRun({ title, done, draft, start }: RunStart) {
  runs += 1;
  const id = runs;
  useCompose.setState({
    run: { id, title, done, lines: [], status: "running", message: null, draft: draft ?? null },
    runVisible: true,
  });
  const channel = new Channel<OutputEvent>((event) => {
    if (event.kind === "line") {
      update(id, (run) => ({
        lines: [
          ...run.lines.slice(-MAX_LINES),
          { id: (run.lines.at(-1)?.id ?? 0) + 1, text: event.text },
        ],
      }));
    } else {
      finish(id, event.kind === "failed" ? event.message : null);
    }
  });
  start(channel).catch((error: unknown) => finish(id, errorMessage(error)));
}

/** Opens a Compose file from the Mac in the editor. */
export function openComposeFile(path: string) {
  commands
    .composeRead(path)
    .then((document) => useCompose.getState().edit(fileDraft(document.path, document.text)))
    .catch((error: unknown) =>
      toast.error("Couldn't open the file", { description: errorMessage(error) }),
    );
}

/** Opens the file a running project came from. */
export function editProject(project: string) {
  commands
    .composeProjectFile(project)
    .then((document) =>
      useCompose.getState().edit(fileDraft(document.path, document.text, project)),
    )
    .catch((error: unknown) =>
      toast.error(`Couldn't open ${project}'s Compose file`, { description: errorMessage(error) }),
    );
}

/** Asks for a Compose file with the macOS open panel, then opens it in the editor. */
export function chooseComposeFile() {
  open({
    title: "Open a Compose file",
    filters: [{ name: "Compose file", extensions: ["yaml", "yml"] }],
  })
    .then((path) => {
      if (typeof path === "string") {
        openComposeFile(path);
      }
    })
    .catch(() => undefined);
}
