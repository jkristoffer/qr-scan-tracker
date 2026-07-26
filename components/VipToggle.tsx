'use client';

interface VipToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function VipToggle({ checked, onChange, disabled = false, label = 'VIP guest' }: VipToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: '100%',
        minHeight: 54,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        border: checked ? '1px solid #eee4c9' : '1px solid #dcdcd8',
        borderRadius: 12,
        padding: '9px 11px 9px 14px',
        background: checked
          ? 'linear-gradient(135deg, #fffef9 0%, #fff2c4 54%, #ebcf7a 100%)'
          : '#fff',
        boxShadow: checked ? '0 5px 16px rgba(128, 96, 30, 0.12)' : 'none',
        color: '#2d2208',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 750 }}>{label}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 10.5, color: checked ? '#7d611d' : '#8a8a86' }}>
          {checked ? 'Gold VIP card enabled' : 'Standard guest card'}
        </span>
      </span>
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          width: 46,
          height: 26,
          flexShrink: 0,
          borderRadius: 999,
          background: checked
            ? 'linear-gradient(135deg, #9b741c 0%, #dfc06f 100%)'
            : '#d2d2ce',
          boxShadow: checked ? 'inset 0 0 0 1px rgba(80, 48, 0, 0.25)' : 'inset 0 0 0 1px rgba(0, 0, 0, 0.06)',
          transition: 'background 0.2s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 23 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 2px 5px rgba(0, 0, 0, 0.24)',
            transition: 'left 0.2s',
          }}
        />
      </span>
    </button>
  );
}
