import { useState } from 'react';
import type { Platform, RenameSettings } from '../../core/types.js';
import { TABS, tabCounts, type TabId } from '../lib/tabs.js';
import { CleanupTab } from './tabs/CleanupTab.js';
import { DatesTab } from './tabs/DatesTab.js';
import { FindReplaceTab } from './tabs/FindReplaceTab.js';
import { MoveTab } from './tabs/MoveTab.js';
import { SequenceTab } from './tabs/SequenceTab.js';
import type { Update } from './tabs/types.js';

export interface OptionTabsProps {
  settings: RenameSettings;
  onChange: Update;
  platform: Platform | null;
  onChooseDestination(): void;
}

/** The option tabs: one option group at a time; a tab counts its active settings. */
export function OptionTabs({ settings, onChange, platform, onChooseDestination }: OptionTabsProps) {
  const [active, setActive] = useState<TabId>('sequence');
  const counts = tabCounts(settings, platform);
  return (
    <section className="options" aria-label="Options">
      <div className="tabs" role="tablist" aria-label="Options">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls="options-panel"
            className="tab"
            onClick={() => setActive(t.id)}
          >
            {t.label}
            {counts[t.id] > 0 && <span className="tab-count">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id="options-panel" aria-labelledby={`tab-${active}`}>
        {active === 'sequence' && <SequenceTab settings={settings} onChange={onChange} changed={counts.sequence > 0} />}
        {active === 'findReplace' && <FindReplaceTab settings={settings} onChange={onChange} />}
        {active === 'cleanup' && <CleanupTab settings={settings} onChange={onChange} />}
        {active === 'move' && <MoveTab settings={settings} onChange={onChange} onChooseDestination={onChooseDestination} />}
        {active === 'dates' && <DatesTab settings={settings} onChange={onChange} platform={platform} />}
      </div>
    </section>
  );
}
