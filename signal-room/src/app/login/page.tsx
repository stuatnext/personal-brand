"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("Wrong passcode.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#080808]">
      <form onSubmit={submit} className="panel w-[340px] space-y-4 p-6">
        <div>
          <div className="font-mono text-[16px] font-semibold tracking-[0.22em]">
            SIGNAL <span className="text-[--color-signal]">ROOM</span>
          </div>
          <div className="k-label mt-1">Private. Passcode required.</div>
        </div>
        <input
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          className="w-full"
        />
        {error ? <div className="font-mono text-[11.5px] text-[--color-risk]">{error}</div> : null}
        <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy}>
          Enter
        </button>
      </form>
    </div>
  );
}
