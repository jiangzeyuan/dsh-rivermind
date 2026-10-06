import { useId, useLayoutEffect, useRef, useState } from 'react';

const MODEL_HELP = 'Iris 首次行动时采用 DeepSeek Harness（DSH）当前默认模型，没有固定选择 Pro 或 Flash。已有 Iris 会话继续使用创建时的选择。更换模型：先在 DSH 普通会话中选择模型，再完全退出并重启 DSH（Web 版重启服务）。仅重新开始训练不会切换模型；复盘显示该次实际请求模型，未捕获时标明创建时选择。';

export function ModelHelp() {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const visible = pinned || hovered || focused;
  useLayoutEffect(() => {
    if (!visible) return;
    tooltip.current?.setAttribute('popover', 'manual');
    tooltip.current?.showPopover();
    const update = () => {
      const box = button.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(280, Math.max(0, innerWidth - 24));
      const height = tooltip.current?.offsetHeight ?? 200;
      const left = Math.max(12, Math.min(box.right - width, innerWidth - width - 12));
      const top = box.top > height + 20 ? box.top - height - 8 : Math.max(12, Math.min(box.bottom + 8, innerHeight - height - 12));
      setPosition({ left, top, width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [visible]);
  useLayoutEffect(() => {
    if (!visible || !position || !tooltip.current || !button.current) return;
    const box = button.current.getBoundingClientRect(), height = tooltip.current.offsetHeight;
    const top = box.top > height + 20 ? box.top - height - 8 : Math.max(12, Math.min(box.bottom + 8, innerHeight - height - 12));
    if (top !== position.top) setPosition({ ...position, top });
  }, [visible, position]);
  function dismiss() { setPinned(false); setHovered(false); setFocused(false); }
  return <span className="rm-model-help" onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => setHovered(false)}>
    <button ref={button} type="button" aria-label="Iris 模型选择说明" aria-describedby={visible ? id : undefined} aria-expanded={visible}
      onClick={() => { if (pinned) { dismiss(); button.current?.blur(); } else setPinned(true); }}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPinned(false); }}
      onKeyDown={event => { if (event.key === 'Escape') dismiss(); }}>?</button>
    {visible && <span ref={tooltip} id={id} role="tooltip" className="rm-model-tooltip" style={position ?? undefined}>{MODEL_HELP}</span>}
  </span>;
}
