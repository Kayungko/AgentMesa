import { IconButton } from '../ui/icon-button.js';
import {
  Archive,
  ChatCircle,
  CheckSquare,
  ClipboardText,
  GearSix,
  UsersThree,
} from '../ui/icons.js';
import type { Section } from './route.js';

export interface RailCounts {
  unread: number;
  tasks: number;
  approvals: number;
}

const RAIL_ITEMS: Array<{ section: Section; label: string; icon: typeof ChatCircle }> = [
  { section: 'messages', label: '消息', icon: ChatCircle },
  { section: 'agents', label: 'Agent', icon: UsersThree },
  { section: 'tasks', label: '任务', icon: CheckSquare },
  { section: 'approvals', label: '审批', icon: ClipboardText },
  { section: 'archive', label: '归档', icon: Archive },
];

export function Rail({
  view,
  counts,
  onNavigate,
  onOpenDeploy,
}: {
  view: Section;
  counts: RailCounts;
  onNavigate: (section: Section) => void;
  onOpenDeploy: () => void;
}) {
  const activeSection = view === 'sessions' || view === 'sessions-new' || view === 'rooms' || view === 'rooms-new' || view === 'home'
    ? 'messages'
    : view;

  return (
    <nav className="rail" aria-label="快捷入口">
      <div className="rail__top">
        {RAIL_ITEMS.map(({ section, label, icon: Icon }) => (
          <IconButton
            key={section}
            label={label}
            active={activeSection === section}
            aria-current={activeSection === section ? 'page' : undefined}
            onClick={() => onNavigate(section)}
            className="rail__item"
          >
            <Icon size={20} weight={activeSection === section ? 'fill' : 'regular'} />
            {section === 'messages' && counts.unread > 0 ? (
              <b className="rail__badge">{counts.unread > 99 ? '99+' : counts.unread}</b>
            ) : null}
            {section === 'approvals' && counts.approvals > 0 ? (
              <i className="rail__dot" aria-label={`${counts.approvals} 个待审批`} />
            ) : null}
          </IconButton>
        ))}
      </div>
      <IconButton label="部署与集成" onClick={onOpenDeploy}>
        <GearSix size={20} />
      </IconButton>
    </nav>
  );
}
