import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";

import { SqlText } from "../sql-text";

type ReviewSheetProps = {
  sql: string | undefined;
  /** MongoDB writes instead of SQL statements. */
  documents: boolean;
  onClose: () => void;
  onCommit: () => void;
  committing: boolean;
};

/** The exact statements a commit runs, in one transaction, for a last look. */
export function ReviewSheet({ sql, documents, onClose, onCommit, committing }: ReviewSheetProps) {
  return (
    <Sheet
      open={sql !== undefined}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={documents ? "Review changes" : "Review SQL"}
      description={
        documents
          ? "On a replica set these run in one transaction. A standalone server has no transactions, so they run in order and stop at the first document that changed since it was read."
          : "These statements run in one transaction. If any row changed since it was read, nothing is committed."
      }
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
