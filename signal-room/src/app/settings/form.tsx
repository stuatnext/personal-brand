"use client";

import { useEffect, useState } from "react";
import { dimensionLabel } from "@/components/ui";

interface Settings {
  user: { name: string; email: string } | null;
  provider: { name: string; isReal: boolean };
  database: string;
  passcodeConfigured: boolean;
  currentThemes: string[];
  scoreWeights: Record<string, number>;
  defaultWeights: Record<string, number>;
  followUpDays: number;
}

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [themes, setThemes] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [followUpDays, setFollowUpDays] = useState(5);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Settings) => {
        setSettings(data);
        setThemes(data.currentThemes.join(", "));
        setWeights(data.scoreWeights);
        setFollowUpDays(data.followUpDays ?? 5);
      });
  }, []);

  if (!settings) return <div className="k-value text-[--color-mut]">Loading…</div>;

  async function save() {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        currentThemes: themes
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        scoreWeights: weights,
        followUpDays,
      }),
    });
    setNotice(res.ok ? "Saved. Applies to the next processing run." : "Save failed.");
    setBusy(false);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <div>
          <div className="k-label mb-2">Current themes (comma-separated)</div>
          <textarea value={themes} onChange={(e) => setThemes(e.target.value)} className="h-[90px] w-full" />
          <p className="mt-1.5 text-[11.5px] text-[--color-dim]">
            Stories matching these get a theme-relevance boost in the next run.
          </p>
        </div>
        <div>
          <div className="k-label mb-2">Score weights</div>
          <div className="space-y-1.5">
            {Object.entries(settings.defaultWeights).map(([dim, def]) => (
              <div key={dim} className="flex items-center gap-3">
                <span className="w-[190px] font-mono text-[11px] uppercase tracking-wider text-[--color-mut]">
                  {dimensionLabel(dim)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={2.5}
                  step={0.1}
                  value={weights[dim] ?? def}
                  onChange={(e) => setWeights({ ...weights, [dim]: Number(e.target.value) })}
                  className="flex-1 accent-[#FFCF33]"
                />
                <span className="k-value w-[34px] text-right">{(weights[dim] ?? def).toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="k-label mb-2">Follow-up window (days)</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={21}
              step={1}
              value={followUpDays}
              onChange={(e) => setFollowUpDays(Number(e.target.value))}
              className="flex-1 accent-[#FFCF33]"
            />
            <span className="k-value w-[34px] text-right">{followUpDays}d</span>
          </div>
          <p className="mt-1.5 text-[11.5px] text-[--color-dim]">
            Sent outreach with no recorded reply for this many days surfaces on Today and the
            Briefing as a follow-up nudge. The nudge is a reminder; sending stays yours.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            Save settings
          </button>
          {notice ? <span className="font-mono text-[11.5px] text-[--color-mut]">{notice}</span> : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="panel p-5">
          <div className="k-label mb-3">System</div>
          <dl className="space-y-2 font-mono text-[12.5px]">
            <div className="flex justify-between">
              <dt className="text-[--color-dim]">user</dt>
              <dd>{settings.user ? `${settings.user.name} · ${settings.user.email}` : "not seeded"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[--color-dim]">intelligence provider</dt>
              <dd className={settings.provider.isReal ? "text-[--color-ok]" : "text-[--color-signal]"}>
                {settings.provider.name}
                {settings.provider.isReal ? " (live)" : " (deterministic, no API key)"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[--color-dim]">database</dt>
              <dd>{settings.database}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[--color-dim]">access</dt>
              <dd>{settings.passcodeConfigured ? "passcode gate" : "open local mode"}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t hairline pt-3 text-[11.5px] leading-relaxed text-[--color-dim]">
            To use Claude for editorial synthesis and drafting, set ANTHROPIC_API_KEY and restart. To
            require a login, set SIGNAL_ROOM_PASSCODE. To move to server PostgreSQL or Supabase, set
            DATABASE_URL and run the migrations. Details in the README.
          </p>
        </div>
        <div className="panel p-5">
          <div className="k-label mb-2">Standing rules</div>
          <ul className="list-inside space-y-1.5 text-[12.5px] text-[--color-mut]">
            <li>· Signal Room never sends or publishes; drafts end at final.</li>
            <li>· Restricted evidence never enters public drafts; the leak scanner double-checks.</li>
            <li>· No invented facts: mock drafts use bracketed slots, live drafts use allowed evidence only.</li>
            <li>· Unverified claims stay hedged: reported, appears to, according to the post.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
