import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";

import { SqlText } from "../sql-text";

type ReviewSheetProps = {
  sql: string | undefined;
  onClose: () => void;
  onCommit: () => void;
  committing: boolean;
};

/** The exact statements a commit runs, in one transaction, for a last look. */
export function ReviewSheet({ sql, onClose, onCommit, committing }: ReviewSheetProps) {
  return (
    <Sheet
      open={sql !== undefined}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Review SQL"
      description="These statements run in one transaction. If any row changed since it was read, nothing is committed."
      width="lg"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="brand" loading={committing} onClick={onCommit}>
            Commit
          </Button>
        </>
      }
    >
      <SqlText
        sql={sql ?? ""}
        className="max-h-[360px] overflow-auto rounded-md bg-fill px-3 py-2.5"
      />
    </Sheet>
  );
}
