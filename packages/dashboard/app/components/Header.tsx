import { Settings } from "lucide-react";

interface HeaderProps {
  onOpenSettings?: () => void;
}

export function Header({ onOpenSettings }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <img src="/logo.svg" alt="kb logo" className="header-logo" width={24} height={24} />
        <h1 className="logo">kb</h1>
        <span className="logo-sub">board</span>
      </div>
      <div className="header-actions">
        <button className="btn-icon" onClick={onOpenSettings} title="Settings">
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
