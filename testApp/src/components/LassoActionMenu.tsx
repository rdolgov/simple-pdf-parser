import type { MouseEvent as ReactMouseEvent } from 'react';
import { ExploreIcon, LoadingIcon, WidgetIcon } from './OverlayIcons';

interface LassoActionMenuProps {
  previewDataUri: string;
  position: { top: number; left: number };
  activeAction: 'explain' | 'interactive' | null;
  error?: string | null;
  onExplain: () => void;
  onMakeInteractive: () => void;
  onReselect: () => void;
  onCancel: () => void;
}

export function LassoActionMenu({
  previewDataUri,
  position,
  activeAction,
  error = null,
  onExplain,
  onMakeInteractive,
  onReselect,
  onCancel
}: LassoActionMenuProps): JSX.Element {
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="lasso-action-menu"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onClick={handleClick}
    >
      <div className="lasso-action-menu__preview">
        <img src={previewDataUri} alt="Selected page region" />
      </div>
      <div className="lasso-action-menu__copy">
        <div className="lasso-action-menu__title">Selected region</div>
        <div className="lasso-action-menu__subtitle">Choose one action before anything is sent.</div>
      </div>
      <div className="lasso-action-menu__actions">
        <button
          type="button"
          className="lasso-action-menu__button lasso-action-menu__button--primary"
          onClick={onExplain}
          disabled={activeAction !== null}
        >
          {activeAction === 'explain' ? <LoadingIcon /> : <ExploreIcon />}
          <span>{activeAction === 'explain' ? 'Explaining...' : 'Explain'}</span>
        </button>
        <button
          type="button"
          className="lasso-action-menu__button"
          onClick={onMakeInteractive}
          disabled={activeAction !== null}
        >
          {activeAction === 'interactive' ? <LoadingIcon /> : <WidgetIcon />}
          <span>{activeAction === 'interactive' ? 'Building...' : 'Make Interactive'}</span>
        </button>
      </div>
      {error && <div className="lasso-action-menu__error">{error}</div>}
      <div className="lasso-action-menu__footer">
        <button type="button" className="lasso-action-menu__link" onClick={onReselect} disabled={activeAction !== null}>
          Select again
        </button>
        <button type="button" className="lasso-action-menu__link" onClick={onCancel} disabled={activeAction !== null}>
          Cancel
        </button>
      </div>
    </div>
  );
}
