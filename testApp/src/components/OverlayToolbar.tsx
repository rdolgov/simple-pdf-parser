import type { MouseEvent, ReactNode } from 'react';

interface OverlayToolbarProps {
  onClose: () => void;
  children?: ReactNode;
  position?: 'top-right' | 'top-left';
}

export function OverlayToolbar({ onClose, children, position = 'top-right' }: OverlayToolbarProps): JSX.Element {
  const positionClass = position === 'top-left' ? 'overlay-toolbar--left' : '';

  const handleToolbarClick = (event: MouseEvent) => {
    // Prevent clicks from bubbling to parent handlers (e.g., canvas click handler)
    event.stopPropagation();
  };

  const handleClose = (event: MouseEvent) => {
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      className={`overlay-toolbar ${positionClass}`}
      role="toolbar"
      aria-label="Overlay actions"
      onClick={handleToolbarClick}
    >
      {children}
      <button
        type="button"
        className="overlay-toolbar-btn overlay-toolbar-btn--close"
        onClick={handleClose}
        aria-label="Close"
        title="Close"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

interface OverlayToolbarButtonProps {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
}

export function OverlayToolbarButton({
  onClick,
  icon,
  label,
  title,
  disabled = false,
  variant = 'default'
}: OverlayToolbarButtonProps): JSX.Element {
  const variantClass = variant !== 'default' ? `overlay-toolbar-btn--${variant}` : '';

  const handleClick = (event: MouseEvent) => {
    event.stopPropagation();
    onClick();
  };

  return (
    <button
      type="button"
      className={`overlay-toolbar-btn ${variantClass}`}
      onClick={handleClick}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
