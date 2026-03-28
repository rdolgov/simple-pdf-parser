import type { CSSProperties, MouseEvent, ReactNode } from 'react';

interface OverlayToolbarProps {
  onClose: () => void;
  children?: ReactNode;
  position?: 'top-right' | 'top-left';
  showClose?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function OverlayToolbar({
  onClose,
  children,
  position = 'top-right',
  showClose = true,
  style,
  className = ''
}: OverlayToolbarProps): JSX.Element {
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
      className={`overlay-toolbar ${positionClass} ${className}`.trim()}
      role="toolbar"
      aria-label="Overlay actions"
      onClick={handleToolbarClick}
      style={style}
    >
      {children}
      {showClose && (
        <button
          type="button"
          className="overlay-toolbar-btn overlay-toolbar-btn--close"
          onClick={handleClose}
          aria-label="Close"
          title="Close"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

interface OverlayToolbarButtonProps {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
  disabled?: boolean;
  ariaDisabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  className?: string;
}

export function OverlayToolbarButton({
  onClick,
  icon,
  label,
  title,
  disabled = false,
  ariaDisabled = false,
  variant = 'default',
  className = ''
}: OverlayToolbarButtonProps): JSX.Element {
  const variantClass = variant !== 'default' ? `overlay-toolbar-btn--${variant}` : '';

  const handleClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (disabled || ariaDisabled) {
      return;
    }
    onClick();
  };

  return (
    <button
      type="button"
      className={`overlay-toolbar-btn ${variantClass} ${className}`.trim()}
      onClick={handleClick}
      aria-label={label}
      aria-disabled={ariaDisabled || undefined}
      title={title ?? label}
      disabled={disabled}
      tabIndex={ariaDisabled ? -1 : undefined}
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
