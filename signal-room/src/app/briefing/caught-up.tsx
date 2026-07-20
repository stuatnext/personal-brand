"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CaughtUpButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      data-testid="caught-up"
      className="btn btn-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/briefing", { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
    >
      Mark caught up
    </button>
  );
}
