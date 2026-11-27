import React, { forwardRef, useId } from 'react';
import { motion } from '../motion';
import { cn } from '../../lib/utils';
import { durationSeconds } from '../../lib/motion';

// ─── Context ──────────────────────────────────────────────────────────────────

interface RadioContextValue {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  name: string;
}

const RadioContext = React.createContext<RadioContextValue | null>(null);

function useRadioContext(name: string) {
  const ctx = React.useContext(RadioContext);
  if (!ctx) throw new Error(`<${name}> phải dùng bên trong <Radio.Group>`);
  return ctx;
}

// ─── Radio.Group ──────────────────────────────────────────────────────────────

export interface RadioGroupProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  name?: string;
  className?: string;
  /** Id của phần tử đặt tên cho nhóm (trình đọc màn hình đọc tên nhóm trước các lựa chọn). */
  'aria-labelledby'?: string;
}

function RadioGroup({ value, onChange, children, disabled = false, name, className = '', 'aria-labelledby': labelledBy }: RadioGroupProps) {
  const defaultName = useId();
  const internalName = name || defaultName;
  return (
    <RadioContext.Provider value={{ value, onChange, disabled, name: internalName }}>
      <div aria-labelledby={labelledBy} className={cn('flex flex-col gap-2', className)} role="radiogroup">
        {children}
      </div>
    </RadioContext.Provider>
  );
}
RadioGroup.displayName = 'Radio.Group';

// ─── Radio.Item ───────────────────────────────────────────────────────────────

export interface RadioItemProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  label?: React.ReactNode;
  description?: string;
}

const RadioItem = forwardRef<HTMLInputElement, RadioItemProps>(
  ({ value, label, description, disabled = false, className = '', id, 'aria-describedby': callerDescribedBy, ...props }, ref) => {
    const context = useRadioContext('Radio.Item');
    const defaultId = useId();
    const internalId = id || defaultId;
    const descId = description ? `${internalId}-desc` : undefined;

    const isChecked = context.value === value;
    const isDisabled = context.disabled || disabled;

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === ' ' || e.key === 'Enter') && !isDisabled) {
        e.preventDefault();
        context.onChange(value);
      }
    };

    return (
      <label
        htmlFor={internalId}
        className={cn(
          'group/radio flex items-start min-h-8 cursor-pointer outline-hidden',
          isDisabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        <div className="relative flex items-center justify-center mt-[3px]">
          <input
            ref={ref}
            id={internalId}
            type="radio"
            name={context.name}
            value={value}
            checked={isChecked}
            disabled={isDisabled}
            aria-describedby={[callerDescribedBy, descId].filter(Boolean).join(' ') || undefined}
            onChange={() => context.onChange(value)}
            onKeyDown={handleKeyDown}
            className="peer sr-only"
            {...props}
          />

          {/* Nhấn bằng CSS (`group-active`), không `whileTap`: framer gắn `tabindex="0"` cho phần tử có
              cử chỉ nhấn, vòng vẽ thành điểm dừng Tab thứ hai không tên (như BUG-012 của Checkbox). */}
          <div
            className={cn(
              'w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center transition duration-120 motion-reduce:transition-none',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2',
              isChecked ? 'border-accent' : 'border-border-control bg-bg-surface',
              !isDisabled && 'motion-safe:group-active/radio:scale-[0.94]'
            )}
          >
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-accent"
              initial={{ scale: 0 }}
              animate={{ scale: isChecked ? 1 : 0 }}
              transition={{ duration: durationSeconds('instant'), ease: 'easeOut' }}
            />
          </div>
        </div>

        {(label || description) && (
          <div className="ml-2 flex flex-col">
            {label && (
              <span className={cn('text-[15px] leading-6 select-none', isDisabled ? 'text-text-muted' : 'text-text-primary')}>
                {label}
              </span>
            )}
            {description && (
              <span id={descId} className="text-[13px] leading-[18px] text-text-secondary select-none">
                {description}
              </span>
            )}
          </div>
        )}
      </label>
    );
  }
);
RadioItem.displayName = 'Radio.Item';

// ─── Radio.Label (standalone label slot) ──────────────────────────────────────

const RadioLabel = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ children, className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('text-[15px] leading-6 select-none text-text-primary', className)}
      {...props}
    >
      {children}
    </span>
  )
);
RadioLabel.displayName = 'Radio.Label';

// ─── Radio.Icon (IconRadioGroup) ──────────────────────────────────────────────

export interface IconRadioGroupProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; icon: React.ReactNode; label: string }[];
  disabled?: boolean;
  className?: string;
}

function IconRadioGroup({ value, onChange, options, disabled = false, className = '' }: IconRadioGroupProps) {
  return (
    <div className={cn('flex gap-1', className)} role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          aria-label={opt.label}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-120',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
            disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-bg-hover',
            value === opt.value ? 'bg-accent-wash text-accent' : 'text-text-secondary'
          )}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
IconRadioGroup.displayName = 'Radio.Icon';

// ─── Namespace ────────────────────────────────────────────────────────────────

export const Radio = Object.assign(
  // Legacy API: <Radio value="..." label="..." />
  RadioItem,
  {
    Group: RadioGroup,
    Item: RadioItem,
    Label: RadioLabel,
    Icon: IconRadioGroup,
  }
);

// ─── Legacy re-exports (backward compat) ─────────────────────────────────────

export { RadioGroup, IconRadioGroup };
