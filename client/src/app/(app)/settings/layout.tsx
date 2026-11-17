import { SettingsNav } from '@/components/settings/subnav';
import { Topbar } from '@/components/shell';

/** Settings (screen 10): the topbar, then the four tabs beside the tab's panels. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="Settings" search={false} />
      <div className="page">
        <div className="page-in">
          <div className="set">
            <SettingsNav />
            <div className="set-main">{children}</div>
          </div>
        </div>
      </div>
    </>
  );
}
