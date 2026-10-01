import { company } from "@/lib/company";
import { IconMail, IconMapPin } from "../icons";

/** Footer for the public careers pages. */
export function SiteFooter({ hrContact }: { hrContact: string }) {
  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
              {company.name.slice(0, 1)}
            </span>
            <div className="leading-tight">
              <p className="font-semibold text-fg">{company.name}</p>
              <p className="text-xs text-fg-3">A {company.group} company</p>
            </div>
          </div>
          <p className="mt-4 max-w-sm text-sm text-fg-3">{company.intro}</p>
          <p className="mt-4 flex items-start gap-2 text-sm text-fg-3">
            <IconMapPin className="mt-0.5 size-4 shrink-0" /> {company.headOffice}
          </p>
          <p className="mt-2 flex items-start gap-2 text-sm text-fg-3">
            <IconMail className="mt-0.5 size-4 shrink-0" /> Hiring questions: {hrContact}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wider text-fg-3 uppercase">Careers</p>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ["/#roles", "Open roles"],
              ["/track", "Track your application"],
              ["/login", "Interview login"],
            ].map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-fg-2 hover:text-brand-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wider text-fg-3 uppercase">{company.group}</p>
          <ul className="mt-3 space-y-2 text-sm text-fg-2">
            {company.links.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-brand-fg">
                  {l.label} ↗
                </a>
              </li>
            ))}
            <li className="pt-1 text-fg-3">
              {company.contact.email} · {company.contact.phone}
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-fg-4">
          © {new Date().getFullYear()} {company.name} · {company.group}. Toyota is a trademark of Toyota Motor Corporation.
        </p>
      </div>
    </footer>
  );
}
