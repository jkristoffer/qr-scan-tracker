'use client';

interface StaffToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function StaffToggle({ checked, onChange, disabled = false }: StaffToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{ width: '100%', minHeight: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, border: checked ? '1px solid #bfdbfe' : '1px solid #dcdcd8', borderRadius: 12, padding: '9px 11px 9px 14px', background: checked ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 54%, #93c5fd 100%)' : '#fff', boxShadow: checked ? '0 5px 16px rgba(30, 64, 175, 0.12)' : 'none', color: '#102a56', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, textAlign: 'left', fontFamily: 'inherit', transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s' }}
    >
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 750 }}>Staff</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 10.5, color: checked ? '#1d4ed8' : '#8a8a86' }}>{checked ? 'Blue Staff card enabled' : 'Standard guest card'}</span>
      </span>
      <span aria-hidden="true" style={{ position: 'relative', width: 46, height: 26, flexShrink: 0, borderRadius: 999, background: checked ? 'linear-gradient(135deg, #1d4ed8 0%, #38bdf8 100%)' : '#d2d2ce', boxShadow: checked ? 'inset 0 0 0 1px rgba(15, 46, 110, 0.25)' : 'inset 0 0 0 1px rgba(0, 0, 0, 0.06)', transition: 'background 0.2s' }}>
        <span style={{ position: 'absolute', top: 3, left: checked ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 5px rgba(0, 0, 0, 0.24)', transition: 'left 0.2s' }} />
      </span>
    </button>
  );
}
