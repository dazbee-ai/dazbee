// What a phone shows in place of the app: Daz and a line saying Dazbee for small screens is coming,
// to open it on a computer or a tablet for now. The root layout puts it first in the body, hidden;
// globals.css shows it, and hides everything else, on a screen a phone's size (`.phone-soon`).
import { EmptyState } from './empty-state.tsx'

export function PhoneSoon({ title, line }: { title: string; line: string }) {
  return (
    <main className="phone-soon min-h-dvh items-center justify-center bg-bg">
      <EmptyState pose="build" titleAs="h1" title={title} line={line} />
    </main>
  )
}
