"use client";

import Link from "next/link";
import { CreateOrganization, OrganizationProfile, OrganizationSwitcher } from "@clerk/nextjs";

export function TeamClient(props: { hasOrg: boolean }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">TEAM</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Organizations</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Organization scope is <span className="font-medium text-zinc-900">shared project memory</span> for all members.
              Personal scope stays <span className="font-medium text-zinc-900">private</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-zinc-300 bg-white px-2 py-1">
              <OrganizationSwitcher
                appearance={{
                  elements: {
                    rootBox: "rounded-full",
                  },
                }}
              />
            </div>
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to console
            </Link>
          </div>
        </header>

        <div className="mt-6 rounded-2xl border border-zinc-200/70 bg-white/70 p-4 text-sm text-zinc-800 shadow-[0_1px_0_0_rgba(0,0,0,0.06)] backdrop-blur">
          <p className="font-semibold text-zinc-950">Invite teammates</p>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            Add members to your org. Once they join, they automatically share access to org projects and memories in this app.
          </p>
        </div>

        <main className="mt-8">
          {props.hasOrg ? (
            <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-4 shadow-sm backdrop-blur">
              <OrganizationProfile routing="hash" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur lg:col-span-5">
                <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Create an organization</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  Organizations enable <span className="font-medium text-zinc-900">shared project memory</span>. After creating one,
                  invite your teammates and switch to org scope in the console.
                </p>
              </section>
              <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-4 shadow-sm backdrop-blur lg:col-span-7">
                <CreateOrganization routing="hash" />
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

